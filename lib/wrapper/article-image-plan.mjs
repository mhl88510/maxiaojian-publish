// Pure-local document/image reconciliation; not an uploader or visual reviewer.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let parsers;
function dependencies() {
  if(!parsers) {
    try {parsers={Marked:require('marked').Marked,parseFragment:require('parse5').parseFragment};}
    catch {throw new Error('ARTICLE_IMAGE_PARSER_UNAVAILABLE: existing local Markdown/HTML parsers required; no automatic install or network');}
  }
  return parsers;
}
const fail=code=>{throw new Error(code);};
const escape=value=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function localPath(value,base) {
  if(typeof value!=='string'||!value.trim()) fail('ARTICLE_IMAGE_SRC_REQUIRED');
  let decoded;try{decoded=decodeURIComponent(value);}catch{fail('ARTICLE_IMAGE_PATH_ENCODING_INVALID');}
  if(/^(?:[a-z][\w+.-]*:|\/\/)/i.test(decoded)) fail('ARTICLE_REMOTE_IMAGE_UNSUPPORTED');
  if(/[\u0000-\u001f]/u.test(decoded)||/[?#]/.test(decoded)) fail('ARTICLE_IMAGE_PATH_UNSUPPORTED');
  if(!path.isAbsolute(decoded)&&!base) fail('ARTICLE_IMAGE_ABSOLUTE_PATH_REQUIRED_FOR_BODY');
  const file=path.resolve(base||'/',decoded);
  if(!/\.(?:png|jpe?g|gif|webp)$/i.test(file)) fail('ARTICLE_IMAGE_FORMAT_UNSUPPORTED');
  return file;
}
function textOf(node) {
  if(node.nodeName==='#text')return node.value;
  if(['script','style','template'].includes(node.tagName))return '';
  return (node.childNodes||[]).map(textOf).join('');
}
function discover(text,{format,base,role}) {
  const {Marked,parseFragment}=dependencies();
  let html=text;
  if(format==='markdown') {
    // Use the real Markdown parser: code fences and escaped examples are not images.
    const markdown=new Marked({async:false});
    markdown.use({extensions:[{name:'localWikiImage',level:'inline',start(src){return src.indexOf('![[');},tokenizer(src){
      const match=/^!\[\[([^\]\n]+)\]\]/.exec(src);
      if(!match)return undefined;
      const [href,...aliases]=match[1].split('|');
      return {type:'localWikiImage',raw:match[0],href:href.trim(),alt:aliases.filter(x=>!/^\d+(?:x\d+)?$/.test(x.trim())).join('|').trim()};
    },renderer(token){return `<img src="${escape(token.href)}" alt="${escape(token.alt)}">`;}}]});
    const front=text.match(/^\s*---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    // A leading horizontal-rule section is not YAML metadata.
    const body=front&&/^title\s*:/m.test(front[1])?text.slice(front[0].length):text;
    html=markdown.parse(body);
  }
  const root=parseFragment(html),refs=[];
  let heading='',preceding='';
  function visit(node) {
    if(node.tagName==='style'&&/url\(/i.test((node.childNodes||[]).map(n=>n.value||'').join('')))fail('ARTICLE_IMAGE_EMBED_UNSUPPORTED');
    if(['script','style','template'].includes(node.tagName))return;
    const attrs=Object.fromEntries((node.attrs||[]).map(a=>[a.name,a.value]));
    if(node.tagName==='base')fail('ARTICLE_IMAGE_BASE_UNSUPPORTED');
    if((node.tagName==='img'&&('srcset' in attrs))||(node.tagName==='source'&&('srcset' in attrs))||node.tagName==='image'||/background(?:-image)?\s*:[^;]*url\(/i.test(attrs.style||'')||(node.tagName==='style'&&/url\(/i.test(textOf(node)))) fail('ARTICLE_IMAGE_EMBED_UNSUPPORTED');
    if(/^h[1-6]$/.test(node.tagName||''))heading=textOf(node).replace(/\s+/g,' ').trim();
    if(node.tagName==='img') {
      const file=localPath(attrs.src,base);
      if(attrs['data-local-path']!==undefined&&localPath(attrs['data-local-path'],base)!==file)fail('ARTICLE_IMAGE_LOCAL_PATH_CONFLICT');
      refs.push({document:role,ordinal:refs.length+1,path:file,alt:attrs.alt||'',anchor:{heading,precedingText:preceding.replace(/\s+/g,' ').trim().slice(-160)}});
    }
    if(node.nodeName==='#text')preceding=(preceding+' '+node.value).slice(-500);
    for(const child of node.childNodes||[])visit(child);
  }
  visit(root);
  return refs;
}
export function buildArticleImagePlan({body,articlePath,layoutPath,images=[]}) {
  if((body!==undefined)===(articlePath!==undefined))fail('ARTICLE_IMAGE_SOURCE_REQUIRED');
  if(!Array.isArray(images)||images.some(x=>typeof x!=='string'||!path.isAbsolute(x)))fail('ARTICLE_IMAGE_LIST_INVALID');
  const listed=images.map(x=>path.resolve(x)),documents=[],references=[];
  const sources=[{role:'source',file:articlePath,text:body},...(layoutPath?[{role:'layout',file:layoutPath}]:[])];
  for(const source of sources) {
    const text=source.file?fs.readFileSync(source.file,'utf8'):source.text;
    if(typeof text!=='string')fail('ARTICLE_IMAGE_SOURCE_INVALID');
    const format=source.role==='layout'||/\.html?$/i.test(source.file||'')?'html':'markdown';
    const refs=discover(text,{format,base:source.file?path.dirname(source.file):null,role:source.role});
    references.push(...refs);documents.push({role:source.role,path:source.file??null,format,imageCount:refs.length});
  }
  const sourceRefs=references.filter(r=>r.document==='source'),layoutRefs=references.filter(r=>r.document==='layout');
  if(layoutPath&&JSON.stringify(sourceRefs.map(r=>[r.path,r.alt]))!==JSON.stringify(layoutRefs.map(r=>[r.path,r.alt])))fail('ARTICLE_SOURCE_LAYOUT_IMAGES_MISMATCH');
  const chosen=layoutPath?layoutRefs:sourceRefs;
  if(chosen.length) {
    if(!listed.length)fail('ARTICLE_INLINE_IMAGES_REQUIRED');
    if(chosen.some(r=>!listed.includes(r.path)))fail('ARTICLE_INLINE_IMAGE_NOT_LISTED');
    if(JSON.stringify(chosen.map(r=>r.path))!==JSON.stringify(listed))fail('ARTICLE_INLINE_IMAGE_ORDER_MISMATCH');
  }
  return {schema:'article-inline-image-plan/v1',scope:'local_document_references_only',documents,references,
    uploadOrder:listed.map((file,i)=>({ordinal:i+1,path:file,...(chosen[i]?{alt:chosen[i].alt,anchor:chosen[i].anchor}:{alt:null,anchor:null})})),
    unanchoredPaths:chosen.length?[]:listed,status:chosen.length?'LOCAL_REFERENCES_RECONCILED':listed.length?'NATIVE_POSITIONS_UNRESOLVED':'NO_INLINE_IMAGES',
    nativeUploadVerified:false,nativePlacementVerified:false,pixelsVerified:false};
}
