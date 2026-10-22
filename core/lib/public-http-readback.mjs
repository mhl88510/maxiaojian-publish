import fs from 'node:fs';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const PARSER=fileURLToPath(new URL('../parse-public-http.py',import.meta.url));
const MAX_BYTES=4_000_000;
export function checkedPublicHttpUrl(pkg,binding) {
 if(binding.platform!=='sohu')throw Error('PUBLIC_HTTP_PLATFORM_NOT_VERIFIED');
 const u=new URL(pkg.publicUrl);
 if(u.protocol!=='https:'||u.hostname!=='www.sohu.com'||u.username||u.password||u.port||u.search||u.hash)throw Error('PUBLIC_HTTP_URL_NOT_ALLOWED');
 const m=u.pathname.match(/^\/a\/([0-9]+)_([0-9]+)$/);
 if(!m||!binding.accountId||m[2]!==binding.accountId)throw Error('PUBLIC_ARTICLE_ACCOUNT_ID_MISMATCH');
 if(pkg.platformContentId!==undefined&&(typeof pkg.platformContentId!=='string'||pkg.platformContentId!==m[1]))throw Error('PUBLIC_HTTP_CONTENT_ID_MISMATCH');
 return {url:u.href,contentId:m[1]};
}
export function assessPublicHttpState(raw,pkg,binding,preset) {
 const {url,contentId}=checkedPublicHttpUrl(pkg,binding);
 const body=pkg.body??(pkg.articlePath?fs.readFileSync(pkg.articlePath,'utf8'):'');
 const compact=x=>String(x??'').replace(/[\s\u200b\ufeff]+/g,'');
 if(!pkg.title||!body)throw Error('EXPECTED_TITLE_AND_BODY_REQUIRED');
 if(pkg.requiredLinks!==undefined&&(!Array.isArray(pkg.requiredLinks)||pkg.requiredLinks.some(x=>typeof x!=='string')))throw Error('EXPECTED_SOURCE_LINKS_INVALID');
 if(!raw||raw.parser!=='scoped_server_html_v1'||raw.url!==url)throw Error('PUBLIC_HTTP_PARSER_SHAPE');
 const titleMatches=raw.titleCount===1&&compact(raw.title)===compact(pkg.title);
 const bodyMatches=raw.bodyCount===1&&compact(raw.body)===compact(body);
 const authorMatches=raw.authorCount===1&&compact(raw.author)===compact(binding.accountName);
 const tokenChar=ch=>!!ch&&/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]/.test(ch);
 const token=(text,url)=>{let i=text.indexOf(url);while(i!==-1){if(!tokenChar(text[i-1])&&!tokenChar(text[i+url.length]))return true;i=text.indexOf(url,i+1);}return false;};
 const linksMatch=(pkg.requiredLinks||[]).every(url=>(raw.links||[]).includes(url)||(preset.sourceLinksMode==='exact_url_tokens'&&token(raw.body||'',url)));
 const ok=titleMatches&&bodyMatches&&authorMatches&&linksMatch;
 return {ok,status:ok?'PUBLIC_READBACK_VERIFIED':'PUBLIC_READBACK_MISMATCH',url,platformContentId:contentId,title:raw.title,bodyLength:String(raw.body||'').length,titleMatches,bodyMatches,authorMatches,linksMatch,ignoredPlatformFooterCount:raw.ignoredPlatformFooterCount||0,publicReadbackVerified:ok,publicAuthorIdentityVerified:authorMatches,accountSessionIdentityVerified:false,platformStatusVerified:false,publicPublicationObserved:ok,publicReadbackScope:'server_rendered_title_body_author_source_links',actual_rendered_pixel_QA:false,readOnly:true,readbackTransport:'direct_public_http_v1',browserRequired:false,cookieRequired:false,publicPageTemplate:raw.template||'legacy_scoped_html',templateIdentityVerified:raw.templateIdentityVerified??null};
}
export async function runPublicHttpReadback(pkg,binding,preset,execute,{fetchImpl=globalThis.fetch,timeoutMs=12000}={}) {


 const {url}=checkedPublicHttpUrl(pkg,binding);
 // Reject incomplete packages before network I/O. No cookie, token or browser bridge.
 const body=pkg.body??(pkg.articlePath?fs.readFileSync(pkg.articlePath,'utf8'):'');
 if(!pkg.title||!body)throw Error('EXPECTED_TITLE_AND_BODY_REQUIRED');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 const fail=code=>({ok:false,status:'READBACK_UNAVAILABLE',code,readOnly:true,readbackTransport:'direct_public_http_v1',browserRequired:false,cookieRequired:false,publicReadbackVerified:false,browserFallbackUsed:false});
 try {
  const response=await fetchImpl(url,{method:'GET',credentials:'omit',redirect:'manual',signal:controller.signal,headers:{accept:'text/html'}});
  if(response.status!==200)return fail(response.status>=300&&response.status<400?'PUBLIC_HTTP_REDIRECT_BLOCKED':'PUBLIC_HTTP_STATUS_'+response.status);
  if(response.url&&response.url!==url)return fail('PUBLIC_HTTP_RESPONSE_URL_CHANGED');
  const type=response.headers.get('content-type')||'';
  if(!/^text\/html(?:;|$)/i.test(type))return fail('PUBLIC_HTTP_CONTENT_TYPE');
  if(Number(response.headers.get('content-length'))>MAX_BYTES)return fail('PUBLIC_HTTP_SIZE_LIMIT');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.byteLength;if(size>MAX_BYTES){controller.abort();return fail('PUBLIC_HTTP_SIZE_LIMIT');}chunks.push(Buffer.from(chunk));}
  const bytes=Buffer.concat(chunks),html=bytes.toString('utf8');
  const parsed=await execute('python3',[PARSER],{input:JSON.stringify({url,html,preset})});
  if(parsed.code!==0)return fail('PUBLIC_HTTP_PARSER_UNAVAILABLE');
  let raw;try{raw=JSON.parse(parsed.stdout);}catch{return fail('PUBLIC_HTTP_PARSER_UNVERIFIED');}
  const result=assessPublicHttpState(raw,{...pkg,body},binding,preset);
  return {...result,httpStatus:200,observedAt:new Date().toISOString(),responseSha256:crypto.createHash('sha256').update(bytes).digest('hex'),browserFallbackUsed:false};
 }catch(e){return fail(e?.name==='AbortError'?'PUBLIC_HTTP_TIMEOUT':'PUBLIC_HTTP_READ_FAILED');}
 finally{clearTimeout(timer);}
}
