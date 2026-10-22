import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const marked=require('marked');
const {parseFragment}=require('parse5');
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');

export const SOHU_INLINE_IMAGE_ADAPTER_ISSUE='ARTICLE_INLINE_IMAGES_WRITE_UNVERIFIED:sohu';

export function isSohuInlineImagesOnlyAdapterGap(pkg,issues=pkg?.studio?.adapterIssues) {
 return pkg?.schoolAccount?.platform==='sohu'&&pkg?.schoolAccount?.accountKey==='EXCLUDED_ROUTE_ACCOUNT'&&pkg?.backend==='ego_article'
  &&pkg?.studio?.schema==='school-content-publish/v1'&&pkg?.studio?.needsAdapter===true
  &&Array.isArray(issues)&&issues.length===1&&issues[0]===SOHU_INLINE_IMAGE_ADAPTER_ISSUE;
}

function fail(code){throw new Error(code);}
function readBoundFile(pkg,file,{required=true}={}) {
 const stat=fs.statSync(file,{throwIfNoEntry:false});
 if(!stat?.isFile())fail('SOHU_INLINE_SOURCE_FILE_MISSING');
 const bytes=fs.readFileSync(file),digest=sha256(bytes),size=stat.size;
 const bindings=pkg?.studio?.assetBindings;
 if(!Array.isArray(bindings)||!bindings.length)fail('SOHU_INLINE_ASSET_BINDING_REQUIRED');
 const matches=bindings.filter(binding=>binding&&typeof binding.path==='string'&&path.resolve(binding.path)===path.resolve(file));
 if(matches.length!==1)fail('ARTICLE_INLINE_IMAGE_ASSET_BINDING_MISMATCH');
 if(matches[0].sha256!==digest||matches[0].size!==size)fail('ARTICLE_INLINE_IMAGE_ASSET_BINDING_MISMATCH');
 return {bytes,digest,size};
}
function countMarkdownImages(tokens) {
 let count=0;
 const visit=value=>{
  if(Array.isArray(value)){for(const item of value)visit(item);return;}
  if(!value||typeof value!=='object')return;
  if(value.type==='image')count++;
  for(const [key,child] of Object.entries(value))if(key!=='raw'&&key!=='text'&&key!=='href')visit(child);
 };
 visit(tokens);return count;
}
function hasImageNode(node){
 if(!node)return false;
 if(node.tagName==='img')return true;
 return (node.childNodes||[]).some(hasImageNode);
}
function textOf(node){
 if(node?.nodeName==='#text')return node.value||'';
 const children=node?.childNodes||[];
 const sep=['ul','ol'].includes(node?.tagName)?'\n':'';
 return children.map(textOf).join(sep);
}
function markdownBlockText(raw){
 const html=marked.parse(raw);
 return parseFragment(html).childNodes.filter(node=>node.nodeName!=='#comment').map(textOf).join('').trim();
}
function isTerminalQrReference(ref){
 return typeof ref?.alt==='string'&&/预约|二维码/.test(ref.alt)&&typeof ref.path==='string'&&/(?:qr|二维码|预约)/i.test(path.basename(ref.path));
}
function isLegacyTerminalQr(tokens,imageBlocks,refs,sourceWithoutTitle){
 if(refs.length!==2||imageBlocks.length!==2)return false;
 const lastImage=imageBlocks[1],after=tokens.slice(lastImage.tokenIndex+1).filter(t=>t.type!=='space'&&t.type!=='def');
 const prior=tokens.slice(0,lastImage.tokenIndex).reverse().find(t=>t.type!=='space'&&t.type!=='def');
 return after.length===0&&sourceWithoutTitle.slice(lastImage.start+lastImage.raw.length).trim()===''
  &&prior?.type==='paragraph'&&markdownBlockText(prior.raw)==='扫码预约'
  &&tokens.filter(t=>t.type==='paragraph'&&markdownBlockText(t.raw)==='扫码预约').length===1&&isTerminalQrReference(refs[1]);
}

/**
 * Pure local proof for the narrow Sohu inline-image adapter gap. It reads only
 * the already-bound Markdown/image files; it never accesses an account, browser,
 * network, submission job, or publication state.
 */
export function buildSohuStudioInlineIntent(pkg) {
 if(!isSohuInlineImagesOnlyAdapterGap(pkg))fail('SOHU_INLINE_IMAGE_ADAPTER_GAP_NOT_EXACT');
 const plan=pkg.studio.articleImages;
 if(!plan||plan.schema!=='article-inline-image-plan/v1'||plan.scope!=='local_document_references_only'||plan.status!=='LOCAL_REFERENCES_RECONCILED'
  ||!Array.isArray(plan.documents)||plan.documents.length!==1||!Array.isArray(plan.references)||plan.references.length<1
  ||!Array.isArray(plan.uploadOrder)||plan.uploadOrder.length!==plan.references.length||!Array.isArray(plan.unanchoredPaths)||plan.unanchoredPaths.length)
  fail('SOHU_STUDIO_INLINE_PLAN_INVALID');
 const doc=plan.documents[0];
 if(doc.role!=='source'||doc.format!=='markdown'||doc.path!==pkg.articlePath||doc.imageCount!==plan.references.length)fail('SOHU_STUDIO_INLINE_DOCUMENT_MISMATCH');
 if(!Array.isArray(pkg.images)||pkg.images.length!==plan.references.length)fail('SOHU_STUDIO_INLINE_IMAGE_ORDER_MISMATCH');
 if(!path.isAbsolute(pkg.articlePath||''))fail('SOHU_INLINE_SOURCE_PATH_INVALID');
 const sourceBinding=readBoundFile(pkg,pkg.articlePath),source=sourceBinding.bytes.toString('utf8');
 const titleMatch=source.match(/^# ([^\r\n]+)\r?\n+/);
 if(titleMatch&&titleMatch[1]!==pkg.title)fail('SOHU_INLINE_MARKDOWN_TITLE_MISMATCH');
 const markdown=titleMatch?source.slice(titleMatch[0].length):source;
 // A package-level body is an explicit competing content source. Accept only
 // the same bound Markdown verbatim, or that same source with its package H1
 // removed (the documented title/body split); never silently substitute the
 // articlePath when an explicit body contains different content.
 if(pkg.body!==undefined&&typeof pkg.body!=='string')fail('SOHU_INLINE_EXPLICIT_BODY_SOURCE_MISMATCH');
 if(pkg.body!==undefined&&pkg.body!==source&&pkg.body!==markdown)fail('SOHU_INLINE_EXPLICIT_BODY_SOURCE_MISMATCH');
 if(/<img\b/i.test(markdown))fail('SOHU_INLINE_RAW_HTML_IMAGE_UNSUPPORTED');
 const tokens=marked.lexer(markdown);
 const allImageCount=countMarkdownImages(tokens);
 const imageBlocks=[];
 for(let tokenIndex=0;tokenIndex<tokens.length;tokenIndex++){
  const token=tokens[tokenIndex];
  const imageTokens=token?.type==='paragraph'?(token.tokens||[]).filter(part=>part.type==='image'):[];
  if(!imageTokens.length)continue;
  if(token.type!=='paragraph'||imageTokens.length!==1||token.tokens.length!==1)fail('SOHU_INLINE_IMAGE_DIRECTIVE_MUST_BE_STANDALONE');
  imageBlocks.push({tokenIndex,raw:token.raw,image:imageTokens[0],start:markdown.indexOf(token.raw)});
 }
 if(allImageCount!==plan.references.length||imageBlocks.length!==plan.references.length||imageBlocks.some((item,i)=>i&&item.start<=imageBlocks[i-1].start))fail('SOHU_STUDIO_INLINE_MARKDOWN_IMAGE_COUNT_MISMATCH');
 const legacyTerminalQr=isLegacyTerminalQr(tokens,imageBlocks,plan.references,markdown);
 const sanitizedMarkdown=markdown.replace(/^!\[[^\]]*\]\(([^)]+)\)[ \t]*\r?\n?/gm,'');
 const html=marked.parse(sanitizedMarkdown);
 const fragment=parseFragment(html);
 if(fragment.childNodes.some(hasImageNode))fail('SOHU_INLINE_HTML_IMAGE_NOT_REMOVED');
 const body=fragment.childNodes.filter(node=>node.nodeName!=='#comment').map(textOf).map(x=>x.trim()).filter(Boolean).join('\n\n');
 const bodyBlocks=body.split(/\n{2,}/).map(x=>x.trim()).filter(Boolean);
 const renderedParagraphs=tokens.filter(t=>t.type==='paragraph'&&!((t.tokens||[]).some(part=>part.type==='image'))).map(t=>markdownBlockText(t.raw));
 const items=[],references=[],uploadOrder=[];
 for(let i=0;i<plan.references.length;i++){
  const ref=plan.references[i],ordered=plan.uploadOrder[i],block=imageBlocks[i],match=block.image;
  if(!ref||ref.document!=='source'||ref.ordinal!==i+1||!ordered||ordered.ordinal!==i+1||ordered.path!==ref.path||ordered.alt!==ref.alt
   ||pkg.images[i]!==ref.path||match.href!==ref.path||match.text!==ref.alt)fail('SOHU_STUDIO_INLINE_IMAGE_ORDER_MISMATCH');
  if(!path.isAbsolute(ref.path))fail('SOHU_STUDIO_INLINE_ASSET_PATH_INVALID');
  const asset=readBoundFile(pkg,ref.path);
  if(asset.size>10*1024*1024||! /\.(?:png|jpe?g|gif)$/i.test(ref.path))fail('ARTICLE_INLINE_IMAGE_FILE_UNSUPPORTED');
  const previous=tokens.slice(0,block.tokenIndex).reverse().find(t=>t.type!=='space'&&t.type!=='def');
  if(!previous||previous.type!=='paragraph'||(previous.tokens||[]).some(part=>part.type==='image'))fail('SOHU_INLINE_IMAGE_PRECEDING_PARAGRAPH_REQUIRED');
  const precedingText=markdownBlockText(previous.raw);
  if(!precedingText||renderedParagraphs.filter(text=>text===precedingText).length!==1||bodyBlocks.filter(text=>text===precedingText).length!==1)fail('SOHU_STUDIO_INLINE_ANCHOR_NOT_UNIQUE');
  const pathEnd=block.start+block.raw.length;
  const nextBlock=tokens.slice(block.tokenIndex+1).find(t=>t.type!=='space'&&t.type!=='def');
  const position={kind:'after_paragraph',text:precedingText};
  const sourcePosition={markdownImageOrdinal:i+1,markdownImageStart:block.start,markdownImageEnd:pathEnd,
   precedingBlockStart:markdown.lastIndexOf(previous.raw,block.start),precedingBlockEnd:markdown.lastIndexOf(previous.raw,block.start)+previous.raw.length,
   precedingBlockType:previous.type,nextBlockType:nextBlock?.type||null,uniqueParagraph:true};
  const originalAnchor=ref.anchor?.precedingText;
  const anchorStatus=originalAnchor===precedingText?'VERIFIED_MATCH':'REBUILT_FROM_BOUND_MARKDOWN';
  const anchor={...(ref.anchor||{}),precedingText};
  const nextRef={...ref,anchor};
  const nextOrder={...ordered,anchor};
  references.push(nextRef);uploadOrder.push(nextOrder);
  items.push({path:ref.path,filename:path.basename(ref.path),role:ref.role||ordered.role||ref.alt,position,sha256:asset.digest,size:asset.size,
   source:{path:pkg.articlePath,sha256:sourceBinding.digest,size:sourceBinding.size,anchorStatus,sourcePosition}});
 }
 if(new Set(items.map(item=>item.position.text)).size!==items.length)fail('ARTICLE_INLINE_IMAGE_POSITION_DUPLICATED');
 const effectivePlan={...plan,references,uploadOrder,sourceProof:{path:pkg.articlePath,sha256:sourceBinding.digest,size:sourceBinding.size,
  method:'bound-markdown-token-order-and-unique-preceding-paragraph',legacyTerminalQr,anchorValuesDerivedFromSource:true}};
 return {items,body,html,plan:effectivePlan,proof:{sourcePath:pkg.articlePath,sourceSha256:sourceBinding.digest,sourceSize:sourceBinding.size,
  imageCount:items.length,markdownImageOrderVerified:true,sourceAnchorOrderVerified:true,assetBytesVerified:true,bodyTextIsPlain:true,
  htmlContainsNoInlineImage:true,legacyTerminalQr,uploadVerified:false,placementVerified:false,pixelsVerified:false}};
}

export function verifySohuStudioInlinePlan(pkg) {
 try{
  if(!isSohuInlineImagesOnlyAdapterGap(pkg))return {ok:false,code:'SOHU_INLINE_IMAGE_ADAPTER_GAP_NOT_EXACT'};
  const intent=buildSohuStudioInlineIntent(pkg);
  return {ok:true,mode:intent.proof.legacyTerminalQr?'legacy_terminal_qr':'source_anchored_midbody',proof:intent.proof,
   items:intent.items,body:intent.body,html:intent.html,plan:intent.plan};
 }catch(error){return {ok:false,code:String(error?.message||error)};}
}
