import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {runPublicHttpReadback} from './public-http-readback.mjs';
import {ARTICLE_CONTRACTS} from './article-contracts.mjs';
import {FORM_HOSTS,formBinding} from './ego-form-backend.mjs';
import {runArticleManagement} from './article-management-readback.mjs';
export const PUBLIC_ARTICLE_HOSTS=Object.freeze({zhihu:['zhuanlan.zhihu.com'],sohu:['www.sohu.com'],toutiao:['www.toutiao.com'],baijiahao:['baijiahao.baidu.com'],netease:['www.163.com']});
export function publicUrlAliases(value,binding){
 const url=new URL(value);if(url.protocol!=='https:')throw Error('PUBLIC_HTTPS_REQUIRED');if(!PUBLIC_ARTICLE_HOSTS[binding.platform]?.includes(url.hostname))throw new Error('PUBLIC_HOST_MISMATCH');
 if(url.search||url.hash)throw new Error('CANONICAL_PUBLIC_URL_REQUIRED');
 if(binding.platform==='zhihu'&&!/^\/p\/\d+$/.test(url.pathname))throw new Error('CANONICAL_PUBLIC_ARTICLE_REQUIRED');
 if(binding.platform==='sohu'){
  const m=url.pathname.match(/^\/a\/([0-9]+)_([0-9]+)$/);if(!m||(binding.accountId&&m[2]!==binding.accountId))throw Error('PUBLIC_ARTICLE_ACCOUNT_ID_MISMATCH');
 }
 if(binding.platform==='toutiao'){
  const m=url.pathname.match(/^\/(?:item|article)\/([0-9]+)\/$/);if(!m)throw Error('CANONICAL_PUBLIC_ARTICLE_REQUIRED');
  return ['https://www.toutiao.com/item/'+m[1]+'/','https://www.toutiao.com/article/'+m[1]+'/'];
 }
 return [value];
}
// Expected text always derives from the declared local source, never from the observed public page.
export function expectedPublicArticleBody(pkg,binding){
 if(pkg.body!==undefined&&pkg.body!==null)return pkg.body;
 const raw=pkg.articlePath?fs.readFileSync(pkg.articlePath,'utf8'):'';
 if(!pkg.articlePath||!['.md','.markdown'].includes(path.extname(pkg.articlePath).toLowerCase())||!['zhihu','toutiao'].includes(binding.platform))return raw;
 const require=createRequire(import.meta.url),{Marked}=require('marked'),{parseFragment}=require('parse5');
 const first=raw.match(/^# ([^\n]+)\r?\n+/),body=first&&first[1].trim().normalize('NFC')===String(pkg.title||'').trim().normalize('NFC')?raw.slice(first[0].length):raw;
 const tree=parseFragment(new Marked().parse(body));
 const text=n=>n.nodeName==='#text'?n.value:['script','style'].includes(n.tagName)?'':(n.childNodes||[]).map(text).join('');
 return text(tree);
}
export function publicReadbackScript(pkg,binding,preset) {
 const expectedURLs=publicUrlAliases(pkg.publicUrl,binding);
 const body=expectedPublicArticleBody(pkg,binding);
 if(!pkg.title||!body)throw new Error('EXPECTED_TITLE_AND_BODY_REQUIRED');
 const data={url:pkg.publicUrl,expectedURLs,title:pkg.title,body,author:binding.accountName,preset,requiredLinks:pkg.requiredLinks||[],managementHosts:FORM_HOSTS[binding.platform]};
 return `const b=${JSON.stringify(binding)},input=${JSON.stringify(data)};const spaces=await listTaskSpaces();const matches=spaces.filter(x=>x.id===b.taskSpaceId&&x.name===b.taskSpaceName),s=matches[0];if(matches.length!==1||!s||s.ownership!=='agent'||(b.egoProfileId&&s.profileId!==b.egoProfileId))throw new Error('EXACT_AGENT_SESSION_REQUIRED');const t=await taskSpace(b.taskSpaceId);if(t.spaceId!==b.taskSpaceId||t.name!==b.taskSpaceName||t.ownership!=='agent')throw new Error('SPACE_CHANGED');const p=t.page(b.pageLabel);let original=null;
try{
 if(input.preset.navigateExistingPage){
  const current=await p.url(),u=new URL(current);if(!input.managementHosts.includes(u.hostname)||!new RegExp(input.preset.managementReadback.managementPathPattern).test(u.pathname+u.hash))throw Error('EXACT_MANAGEMENT_ENTRY_REQUIRED');
  original=current;await p.goto(input.url);await p.waitForSelector(input.preset.publicBodySelector);
 }
 const result=await p.evaluate(input=>{
 const compact=x=>String(x||'').replace(/[\\s\\u200b\\ufeff]+/g,'').trim();
 const es=selector=>[...document.querySelectorAll(selector)],title=es(input.preset.publicTitleSelector),body=es(input.preset.publicBodySelector),authors=es(input.preset.publicAuthorSelector);
 let actualBody=body[0]?.innerText||'',ignoredPlatformFooterCount=0;
 if(body.length===1&&input.preset.platformFooter){const clone=body[0].cloneNode(true),last=clone.lastElementChild,f=input.preset.platformFooter;
  const candidates=f.selector?[...clone.querySelectorAll(f.selector)]:last?.tagName==='P'?[...last.querySelectorAll('a[href]')]:[];
  if(candidates.length===1){const anchor=candidates[0],u=new URL(anchor.href),inFinalParagraph=f.selector?anchor.parentElement===last&&last?.tagName==='P'&&last.lastElementChild===anchor:last?.innerText.trim()===f.text;
   if(inFinalParagraph&&(anchor.innerText||anchor.textContent||'').trim()===f.text&&u.protocol==='https:'&&u.hostname===f.linkHost&&u.pathname===f.linkPath){anchor.remove();actualBody=clone.innerText??clone.textContent??'';ignoredPlatformFooterCount=1;}}

 }
 const titleMatches=title.length===1&&compact(title[0].innerText)===compact(input.title),bodyMatches=body.length===1&&compact(actualBody)===compact(input.body);
 const authorMatches=authors.length===1&&compact(authors[0].innerText)===compact(input.author);
 const links=body.flatMap(e=>[...e.querySelectorAll('a[href]')].map(a=>{const u=new URL(a.href);return u.hostname==='link.zhihu.com'&&u.pathname==='/'?(u.searchParams.get('target')||a.href):a.href;}));
 const urlTokenChar=ch=>!!ch&&/[A-Za-z0-9._~:/?#\\[\\]@!$&'()*+,;=%-]/.test(ch);
 const hasExactUrlToken=(source,url)=>{let at=source.indexOf(url);while(at!==-1){if(!urlTokenChar(source[at-1])&&!urlTokenChar(source[at+url.length]))return true;at=source.indexOf(url,at+1);}return false;};
 const literalLinks=input.preset.sourceLinksMode==='exact_text_lines'?(actualBody.split(/\\r?\\n/).map(x=>x.trim())):[];
 const tokenLinks=input.preset.sourceLinksMode==='exact_url_tokens';
 const linksMatch=input.requiredLinks.every(url=>links.includes(url)||literalLinks.includes(url)||(tokenLinks&&hasExactUrlToken(actualBody,url))),urlMatches=input.expectedURLs.includes(location.origin+location.pathname);
 return {ok:urlMatches&&titleMatches&&bodyMatches&&authorMatches&&linksMatch,status:urlMatches&&titleMatches&&bodyMatches&&authorMatches&&linksMatch?'PUBLIC_READBACK_VERIFIED':'PUBLIC_READBACK_MISMATCH',url:location.origin+location.pathname,title: title[0]?.innerText,bodyLength:actualBody.length,titleMatches,bodyMatches,authorMatches,linksMatch,ignoredPlatformFooterCount,publicReadbackVerified:urlMatches&&titleMatches&&bodyMatches&&authorMatches&&linksMatch,publicReadbackScope:'title_body_author_source_links',actual_rendered_pixel_QA:false};
},input);console.log('SCHOOL_PUBLIC_READBACK:'+JSON.stringify(result));
}finally{if(original!==null)await p.goto(original);}`;
}
export async function runArticleReadback(pkg,matrix,execute,{contractPath=ARTICLE_CONTRACTS,httpDependencies={}}={}) {


 const binding=formBinding(pkg,matrix),preset=JSON.parse(fs.readFileSync(contractPath,'utf8')).platforms[binding.platform];
 if(!preset?.publicTitleSelector)throw new Error('PUBLIC_PAGE_CONTRACT_NOT_VERIFIED');
 if(preset.publicReadbackTransport==='direct_public_http_v1')return runPublicHttpReadback(pkg,binding,preset,execute,httpDependencies);
 if(preset.navigateExistingPage){const before=await runArticleManagement(pkg,matrix,execute,{contractPath});if(!before.ok)return before;}
 const r=await execute('ego-browser',['nodejs'],{input:publicReadbackScript(pkg,binding,preset)});
 const line=(r.stdout+'\n'+r.stderr).split(/\r?\n/).find(l=>l.startsWith('SCHOOL_PUBLIC_READBACK:'));
 if(r.code!==0||!line)return {ok:false,status:'READBACK_UNAVAILABLE',code:'PUBLIC_READBACK_UNAVAILABLE',publicReadbackVerified:false};
 return JSON.parse(line.slice('SCHOOL_PUBLIC_READBACK:'.length));
}
