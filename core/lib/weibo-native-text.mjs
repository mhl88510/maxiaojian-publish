import fs from 'node:fs';
import crypto from 'node:crypto';
export function validateWeiboNativeInventory(payload,uid,visibleCount){
 const d=payload?.data;if(payload?.ok!==1||!d||!Number.isSafeInteger(d.total)||d.total<0||d.total!==visibleCount||!Array.isArray(d.list)||d.list.length!==d.total||d.since_id!==''||new Set(d.list.map(x=>x.mblogid)).size!==d.total)throw Error('WEIBO_COMPLETE_NATIVE_INVENTORY_REQUIRED');
 if(d.list.some(x=>String(x.user?.idstr||x.user?.id)!==uid||!/^\d+$/.test(x.idstr||'')||!/^[A-Za-z0-9]+$/.test(x.mblogid||'')||typeof x.text_raw!=='string'||typeof x.isLongText!=='boolean'))throw Error('WEIBO_NATIVE_INVENTORY_IDENTITY_INVALID');return d.list;
}
export function validateWeiboNativeInventoryPages(pages,uid,visibleCount){
 if(!Array.isArray(pages)||!Number.isSafeInteger(visibleCount)||visibleCount<0||visibleCount>200||pages.length!==Math.max(1,Math.ceil(visibleCount/20)))throw Error('WEIBO_COMPLETE_NATIVE_INVENTORY_REQUIRED');
 const all=[];
 for(let i=0;i<pages.length;i++){
  const payload=pages[i],d=payload?.data,expected=Math.min(20,visibleCount-i*20),terminal=i===pages.length-1;
  if(payload?.ok!==1||!d||d.total!==visibleCount||!Array.isArray(d.list)||d.list.length!==expected)throw Error('WEIBO_COMPLETE_NATIVE_INVENTORY_REQUIRED');
  if(terminal?d.since_id!=='' : !((typeof d.since_id==='string'||Number.isSafeInteger(d.since_id))&&/^\d+$/.test(String(d.since_id))&&String(d.since_id)===pages[i+1]?.data?.list?.[0]?.idstr))throw Error('WEIBO_NATIVE_INVENTORY_CURSOR_INVALID');
  // Preserve the established per-post identity/type rules; only pagination is new.
  validateWeiboNativeInventory({ok:1,data:{total:expected,list:d.list,since_id:''}},uid,expected);
  all.push(...d.list);
 }
 if(all.length!==visibleCount||new Set(all.map(x=>x.mblogid)).size!==visibleCount||new Set(all.map(x=>x.idstr)).size!==visibleCount)throw Error('WEIBO_COMPLETE_NATIVE_INVENTORY_REQUIRED');
 return all;
}
export function validateWeiboText(pkg,account,action){
 if(pkg.schoolAccount?.platform!=='weibo'||pkg.backend!=='ego_weibo_text'||pkg.contentType!=='text'||!['check','publish','status'].includes(action))throw Error('WEIBO_TEXT_CONTRACT_REQUIRED');
 const body=pkg.body??fs.readFileSync(pkg.articlePath,'utf8');
 if(!body.trim()||pkg.title||pkg.images?.length||pkg.coverPath||pkg.videoPath||pkg.declaration!=='none')throw Error('WEIBO_PLAIN_TEXT_ONLY');
 const c=pkg.nativeTextContract,b=account.ego;
 if(c?.version!==1||c.expectedUid!==account.id||c.expectedTargetId!==b?.targetId||!/^\d+$/.test(account.id)||!b.targetId||!/^p\d+$/.test(b.pageLabel))throw Error('WEIBO_EXACT_BINDING_REQUIRED');
 if(c.bodySha256!==crypto.createHash('sha256').update(body).digest('hex'))throw Error('WEIBO_SOURCE_HASH_MISMATCH');
 if(action==='status'&&(!pkg.publicUrl||!new RegExp('^https://weibo\\.com/'+account.id+'/[A-Za-z0-9]+$').test(pkg.publicUrl)))throw Error('WEIBO_EXACT_PUBLIC_URL_REQUIRED');
 return {body,action,publicUrl:pkg.publicUrl||'',uid:account.id,...b};
}
export function weiboTextScript(input){return `
const b=${JSON.stringify(input)},mark='WEIBO_NATIVE_TEXT:';let stage='identity',submitAttempted=false,mutated=false;
const compact=x=>String(x||'').replace(/[\\s\\u200b-\\u200d\\ufeff]/g,'');
const out=x=>console.log(mark+JSON.stringify(x));
async function main(){try{
const s=(await listTaskSpaces()).filter(x=>x.id===b.taskSpaceId&&x.name===b.taskSpaceName&&x.profileId===b.profileId&&x.ownership==='agent');if(s.length!==1)throw Error('WEIBO_EXACT_AGENT_SPACE_REQUIRED');
const t=await taskSpace(b.taskSpaceId);const verifyTarget=async()=>{if((await t.tabs()).filter(x=>x.label===b.pageLabel&&x.targetId===b.targetId).length!==1)throw Error('WEIBO_EXACT_TARGET_REQUIRED');};await verifyTarget();const p=t.page(b.pageLabel);
const identity=async()=>{const r=await p.evaluate(()=>({url:location.href,nav:[...document.querySelectorAll('.woo-tab-nav a[title]')].map(a=>({href:a.href,name:a.title||a.getAttribute('aria-label')||a.innerText}))}));if(new URL(r.url).hostname!=='weibo.com'||r.nav.filter(x=>x.href==='https://weibo.com/u/'+b.uid).length!==1)throw Error('WEIBO_UID_MISMATCH');return r;};
await identity();
if(b.action!=='status'){
 stage='dedup';await p.goto('https://weibo.com/u/'+b.uid);await p.waitForFunction(()=>document.body.innerText.includes('全部微博（'),null,{timeout:15000});await identity();await p.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 const visibleCount=await p.evaluate(()=>Number(document.body.innerText.match(/全部微博（([0-9]+)）/)?.[1]));
 const listings=await p.evaluate(async ({uid,visibleCount})=>{const endpoint='https://weibo.com/ajax/statuses/mymblog?uid='+uid+'&page=1&feature=0';if(!performance.getEntriesByType('resource').some(x=>x.name===endpoint))throw Error('WEIBO_NATIVE_INVENTORY_REQUEST_NOT_OBSERVED');if(!Number.isSafeInteger(visibleCount)||visibleCount<0||visibleCount>200)throw Error('WEIBO_NATIVE_INVENTORY_SCOPE_LIMIT');const pages=[];for(let page=1;page<=Math.max(1,Math.ceil(visibleCount/20));page++){const u=new URL(endpoint);u.searchParams.set('page',String(page));const r=await fetch(u.href);if(!r.ok)throw Error('WEIBO_NATIVE_INVENTORY_HTTP_FAILED');const payload=await r.json();if(payload?.ok!==1||payload?.data?.total!==visibleCount)throw Error('WEIBO_NATIVE_INVENTORY_TOTAL_CHANGED');pages.push(payload);if(page<Math.ceil(visibleCount/20))await new Promise(r=>setTimeout(r,1000));}return pages;},{uid:b.uid,visibleCount});
 const validateWeiboNativeInventory=${validateWeiboNativeInventory.toString()};const nativePosts=(${validateWeiboNativeInventoryPages.toString()})(listings,b.uid,visibleCount),historyItems=new Map();
 for(const post of nativePosts){let text=post.text_raw;if(post.isLongText){const long=await p.evaluate(async mid=>{const endpoint=new URL('https://weibo.com/ajax/statuses/longtext');endpoint.searchParams.set('id',mid);const r=await fetch(endpoint.href);if(!r.ok)throw Error('WEIBO_LONGTEXT_HTTP_FAILED');const j=await r.json();if(j.ok!==1||typeof j.data?.longTextContent_raw!=='string'||!j.data.longTextContent_raw.trim())throw Error('WEIBO_LONGTEXT_FULL_SOURCE_REQUIRED');return j.data.longTextContent_raw;},post.mblogid);if(!compact(long).startsWith(compact(post.text_raw).replace(/[\\u200b-\\u200d\\ufeff]/g,'')))throw Error('WEIBO_LONGTEXT_ID_BINDING_MISMATCH');text=long;await new Promise(r=>setTimeout(r,1000));}historyItems.set('https://weibo.com/'+b.uid+'/'+post.mblogid,{text,links:['https://weibo.com/'+b.uid+'/'+post.mblogid],nativeId:post.idstr});}
 await identity();await verifyTarget();const count=visibleCount,history={transport:'same_session_observed_native_json_complete_list_plus_bound_longtext',expectedCount:count,articles:[...historyItems.values()]};
 if(history.articles.some(e=>compact(e.text).includes(compact(b.body)))){out({ok:false,status:'DUPLICATE_EXISTING_POST',submitted:false,history});return;}
 if(historyItems.size!==count)throw Error('WEIBO_COMPLETE_HISTORY_DEDUP_REQUIRED');
 stage='editor';await p.goto('https://weibo.com/');await p.waitForSelector('textarea[placeholder="有什么新鲜事想分享给大家？"]',{state:'visible'});await identity();
 const before=await p.evaluate(()=>{const f=[...document.querySelectorAll('textarea[placeholder="有什么新鲜事想分享给大家？"]')];return {count:f.length,value:f[0]?.value,maxLength:f[0]?.maxLength,text:document.body.innerText};});if(before.count!==1||before.value.trim())throw Error('WEIBO_EXISTING_COMPOSER_PROTECTED');if(before.maxLength>0&&Array.from(b.body).length>before.maxLength)throw Error('WEIBO_NATIVE_LENGTH_LIMIT_EXCEEDED');
 if(b.action==='check'){out({ok:true,status:'WEIBO_TEXT_PREFLIGHT_VERIFIED',readOnly:true,submitted:false,identityUid:b.uid,nativeMaxLength:before.maxLength>0?before.maxLength:null,historyCount:count,ownHistory:[...historyItems.entries()].map(([publicUrl,item])=>({publicUrl,text:item.text})),bodyCharacters:Array.from(b.body).length});return;}
 mutated=true;await p.fill('textarea[placeholder="有什么新鲜事想分享给大家？"]',b.body);
 const prepared=await p.evaluate(()=>({body:document.querySelector('textarea[placeholder="有什么新鲜事想分享给大家？"]')?.value,text:document.body.innerText,buttons:[...document.querySelectorAll('button')].filter(x=>x.innerText.trim()==='发送').map(x=>({disabled:x.disabled,html:x.outerHTML})),required:[...document.querySelectorAll('[required]')].filter(x=>x.getBoundingClientRect().width>0).map(x=>({name:x.name,value:x.value}))}));
 if(prepared.body!==b.body||prepared.buttons.length!==1||prepared.buttons[0].disabled||prepared.required.some(x=>!x.value))throw Error('WEIBO_NATIVE_PREPARE_BLOCKED');if(/超出.{0,8}(字数|限制)|请.{0,8}声明|请.{0,8}验证/.test(prepared.text))throw Error('WEIBO_VISIBLE_VALIDATION_REQUIRED');
 await identity();await verifyTarget();stage='submit';submitAttempted=true;await p.click('loc=role:button[name="发送"]');
 await p.waitForFunction(()=>document.querySelector('textarea[placeholder="有什么新鲜事想分享给大家？"]')?.value==='',null,{timeout:15000});
 await p.goto('https://weibo.com/u/'+b.uid);await p.waitForSelector('article',{state:'visible'});await identity();
}else{stage='public';await p.goto(b.publicUrl);await p.waitForSelector('article',{state:'visible'});await identity();}
 stage='readback';const markArticle=await p.evaluate(({body,uid})=>{const c=x=>x.replace(/[\\s\\u200b-\\u200d\\ufeff]/g,'');const head=c(body).slice(0,55);const items=[...document.querySelectorAll('article')].filter(e=>c(e.innerText).includes(head)&&[...e.querySelectorAll('a')].some(a=>a.href==='https://weibo.com/u/'+uid));if(items.length!==1)return false;items[0].setAttribute('data-maxiaojian-weibo-readback','exact');return true;},{body:b.body,uid:b.uid});if(!markArticle)throw Error('WEIBO_EXACT_POST_NOT_FOUND');
const exp=await p.evaluate(()=>[...document.querySelectorAll('[data-maxiaojian-weibo-readback=exact] .expand')].filter(a=>a.innerText.trim()==='展开').length);if(exp===1)await p.evaluate(()=>{const e=[...document.querySelectorAll('[data-maxiaojian-weibo-readback=exact] .expand')].filter(x=>x.innerText.trim()==='展开');if(e.length!==1)throw Error('WEIBO_EXACT_POST_EXPAND_CHANGED');e[0].click()});
await p.waitForFunction(body=>{const e=document.querySelector('[data-maxiaojian-weibo-readback=exact]');const c=x=>String(x||'').replace(/[\\s\\u200b-\\u200d\\ufeff]/g,'');return e&&c(e.innerText).includes(c(body));},b.body,{timeout:10000});
const post=await p.evaluate(uid=>{const e=document.querySelector('[data-maxiaojian-weibo-readback=exact]');return {text:e.innerText,links:[...e.querySelectorAll('a')].map(a=>a.href).filter(u=>new RegExp('^https://weibo\\.com/'+uid+'/[A-Za-z0-9]+$').test(u))};},b.uid);
const urls=[...new Set(post.links)];if(urls.length!==1||!compact(post.text).includes(compact(b.body)))throw Error('WEIBO_PUBLIC_FULL_BODY_NOT_VERIFIED');await verifyTarget();await identity();
out({ok:true,status:'PUBLISHED',submitted:b.action==='publish'?true:false,submitAttempted,submitClicks:submitAttempted?1:0,platformContentId:urls[0].split('/').at(-1),publicUrl:urls[0],identityUid:b.uid,publicReadbackVerified:true,publicFullBodyVerified:true,readback:post});
}catch(e){out({ok:false,status:submitAttempted?'SUBMISSION_UNCERTAIN':mutated?'PREPARATION_BLOCKED':'PREFLIGHT_BLOCKED',code:String(e.message),stage,mutated,submitAttempted,submitted:submitAttempted?null:false,publicReadbackVerified:false});}}
await main();
`;}
export async function runWeiboText(pkg,account,action,execute){

const input=validateWeiboText(pkg,account,action);const r=await execute('ego-browser',['nodejs'],{input:weiboTextScript(input)});const line=(r.stdout+'\n'+r.stderr).split(/\r?\n/).find(x=>x.startsWith('WEIBO_NATIVE_TEXT:'));if(r.code!==0||!line)return {ok:false,status:action==='publish'?'SUBMISSION_UNCERTAIN':'READBACK_UNAVAILABLE',code:'WEIBO_TRANSPORT_UNCONFIRMED',submitted:action==='publish'?null:false,readOnly:action!=='publish',publicReadbackVerified:false};return JSON.parse(line.slice('WEIBO_NATIVE_TEXT:'.length));}
