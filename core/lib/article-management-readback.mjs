import fs from 'node:fs';
import {resolveSchoolAccountBinding} from './school-account.mjs';
import {ARTICLE_CONTRACTS} from './article-contracts.mjs';

// Creator-list evidence is independent of public-page body verification.
export function articleId(url,platform) {
 let u;try{u=new URL(url);}catch{return '';}
 if(platform==='toutiao'&&u.hostname==='www.toutiao.com')return u.pathname.match(/^\/item\/([0-9]+)\/?$/)?.[1]||'';
 // Pending/draft Toutiao articles stay on the creator-management host and use pgc_id;
 // they are not public /item/ URLs yet, but pgc_id is the exact platform content ID.
 if(platform==='toutiao'&&u.hostname==='mp.toutiao.com'&&['/profile_v4/graphic/preview','/profile_v4/graphic/publish'].includes(u.pathname))return u.searchParams.get('pgc_id')?.match(/^[0-9]+$/)?.[0]||'';
 if(platform==='sohu'&&u.hostname==='www.sohu.com')return u.pathname.match(/^\/a\/([0-9]+)_[0-9]+$/)?.[1]||'';
 if(platform==='sohu'&&u.hostname==='mp.sohu.com'&&u.pathname==='/mpfe/v4/contentManagement/news/articlepreview')return u.searchParams.get('id')||'';
 if(platform==='baijiahao'&&u.hostname==='baijiahao.baidu.com'&&['/s','/builder/preview/s'].includes(u.pathname))return u.searchParams.get('id')||'';
 return '';
}
export function classifyArticleRow(text,url,platform) {
 if(/已下线|已撤回|已删除/.test(text))return 'OFFLINE';
 if(/修改审核中/.test(text))return 'REVISION_UNDER_REVIEW';
 if(/审核未通过|未通过/.test(text))return 'REJECTED';
 if(/审核中/.test(text))return 'UNDER_REVIEW';
 if(/草稿/.test(text))return 'DRAFT';
 if(/已发布/.test(text))return 'PUBLISHED';
 // Sohu provides a public link per published row, not a per-row status label.
 if(platform==='sohu'&&/^https:\/\/www\.sohu\.com\/a\/[0-9]+_[0-9]+$/.test(url))return 'PUBLIC_LINK_PRESENT';
 return 'STATUS_UNKNOWN';
}
// Sohu's management row displays local publication time to minute precision.
// Preserve the native precision; do not synthesize seconds when the UI omits them.
export function parseSohuPublishedAt(text) {
 const matches=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(x=>/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(x));
 if(matches.length!==1)return null;
 const localText=matches[0],m=localText.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
 if(!m)return null;
 const [year,month,day,hour,minute,second]=m.slice(1).map(x=>x===undefined?0:Number(x));
 if(hour>23||minute>59||second>59)return null;
 const check=new Date(Date.UTC(year,month-1,day,hour,minute,second));
 if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day||check.getUTCHours()!==hour||check.getUTCMinutes()!==minute||check.getUTCSeconds()!==second)return null;
 const hasSeconds=m[6]!==undefined;
 return {
  publishedAt:hasSeconds?`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`:`${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]} Asia/Shanghai`,
  publishedAtPrecision:hasSeconds?'second':'minute',
  publishedAtLocalText:localText,
 };
}
// Only the current editor's account store is consulted. Never serialize the full user
// object: it also contains phone/token fields unrelated to account binding.
export function readScopedEditorAccount(selector) {
 const nodes=[...document.querySelectorAll(selector)];
 if(nodes.length!==1)return null;
 const el=nodes[0],rect=el.getBoundingClientRect();
 if(!rect.width||!rect.height||getComputedStyle(el).visibility==='hidden')return null;
 let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))],user;
 for(let i=0;f&&i<24;i++,f=f.return){
  const getState=f.memoizedProps?.store?.getState;
  if(typeof getState==='function')user=f.memoizedProps.store.getState()?.global?.user;
 }
 if(!user)return null;
 const id=user.app_id;
 if(!(typeof id==='string'&&/^\d+$/.test(id))&&!(typeof id==='number'&&Number.isSafeInteger(id)&&id>0))return null;
 if(typeof user.name!=='string'||!user.name.trim())return null;
 return {accountId:String(id),storeAccountName:user.name.trim(),accountStatus:String(user.status||''),accountStatusText:String(user.status_cn||''),userStatus:String(user.user_status||'')};
}
// Only original visible header ancestors, never global stores or arbitrary rows.
export function readScopedHeaderAccount(selector) {
 const nodes=[...document.querySelectorAll(selector)];if(nodes.length!==1)return null;
 const e=nodes[0],r=e.getBoundingClientRect(),style=getComputedStyle(e);
 if(r.width<=0||r.height<=0||r.bottom<=0||r.right<=0||r.top>=innerHeight||r.left>=innerWidth||style.visibility==='hidden'||style.display==='none')return null;
 let f=e[Object.keys(e).find(k=>k.startsWith('__reactFiber'))];const candidates=[];
 for(let i=0;f&&i<64;i++,f=f.return){
  const u=f.memoizedProps?.user;if(!u)continue;const id=u.app_id;
  if(!((typeof id==='string'&&/^\d+$/.test(id))||(typeof id==='number'&&Number.isSafeInteger(id)&&id>0))||typeof u.name!=='string'||!u.name.trim())return null;
  const candidate={accountId:String(id),storeAccountName:u.name.trim()};
  if(!candidates.some(x=>x.accountId===candidate.accountId&&x.storeAccountName===candidate.storeAccountName))candidates.push(candidate);
 }
 return candidates.length===1?candidates[0]:null;
}
export function buildManagementReadScript(binding,contract,{platformContentId=''}={}) {
 return `const b=${JSON.stringify(binding)},c=${JSON.stringify(contract)},expectedContentId=${JSON.stringify(platformContentId)};
const matches=(await listTaskSpaces()).filter(s=>s.id===b.taskSpaceId&&s.name===b.taskSpaceName);
if(matches.length!==1||matches[0].ownership!=='agent'||(b.egoProfileId&&matches[0].profileId!==b.egoProfileId))throw Error('EXACT_AGENT_SESSION_REQUIRED');
const t=await taskSpace(b.taskSpaceId);if(t.spaceId!==b.taskSpaceId||t.name!==b.taskSpaceName||t.ownership!=='agent')throw Error('SPACE_CHANGED');
const p=t.page(b.pageLabel);
const verifyTarget=async()=>{if(!b.targetId)return;if((await t.tabs()).filter(x=>x.label===b.pageLabel&&x.targetId===b.targetId).length!==1)throw Error('EXACT_TARGET_REQUIRED');};
await verifyTarget();
// Sohu's manager has a keyword filter and a separate status filter. A stale
// keyword can leave an otherwise healthy account page with zero rows; clear it
// and return to the all-content view before using the list for deduplication.
let sohuAllContentViewVerified=false;
if(b.platform==='sohu'){
 const initial=await p.evaluate(c=>{
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const inputs=[...document.querySelectorAll(c.searchInputSelector)].filter(visible),buttons=[...document.querySelectorAll(c.searchButtonSelector)].filter(visible);
  const total=[...document.querySelectorAll(c.totalFilterSelector)].filter(visible),active=[...document.querySelectorAll(c.statusFilterSelector)].filter(e=>visible(e)&&e.classList.contains('status-active'));
  if(inputs.length!==1||buttons.length!==1||total.length!==1||active.length!==1)return {ok:false,code:'SOHU_MANAGER_FILTER_CONTROLS_NOT_UNIQUE'};
  return {ok:true,query:inputs[0].value,allActive:active[0]===total[0]};
 },c);
 if(!initial.ok)throw Error(initial.code);
 if(initial.query){await p.fill(c.searchInputSelector,'');await p.click('css='+c.searchButtonSelector);}
 if(!initial.allActive)await p.click('css='+c.totalFilterSelector);
 await p.waitForFunction(c=>{
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const filters=[...document.querySelectorAll(c.totalFilterActiveSelector)].filter(visible);
  const rows=[...document.querySelectorAll(c.rowSelector)].filter(visible);
  const label=filters.length===1?String(filters[0].innerText||'').trim():'';
  const filterCount=label.match(/^全部\\s*(\\d+)$/),empty=document.body.innerText.includes(c.emptyResultText);
  if(!filterCount)return false;
  if(Number(filterCount[1])===0&&empty)return true;
  const pagers=[...document.querySelectorAll(c.pagination.containerSelector)].filter(visible);
  if(pagers.length!==1)return false;
  const total=pagers[0].querySelector(c.pagination.totalSelector),pageCount=String(total?.innerText||'').match(/共\\s*(\\d+)\\s*条/);
  return !!pageCount&&Number(pageCount[1])===Number(filterCount[1])&&(rows.length>0||empty);
 },c,{timeout:15000});
 sohuAllContentViewVerified=true;
}
let nativeStatusEvidence=null;
if(b.platform==='sohu'&&expectedContentId&&c.publishedFilterSelector&&c.totalFilterSelector){
 const initialFilter=await p.evaluate(({c})=>{
  if(c.statusFilterSelector!=='.status-control.status-active'||c.publishedFilterSelector!=='.status-control.published'||c.publishedFilterActiveSelector!=='.status-control.published.status-active'||c.totalFilterSelector!=='.status-control.total'||c.totalFilterActiveSelector!=='.status-control.total.status-active')return {valid:false,reason:'STATUS_FILTER_SELECTOR_CONTRACT_CHANGED'};
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const active=[...document.querySelectorAll(c.statusFilterSelector||'.status-control.status-active')].filter(visible).filter(e=>e.classList.contains('status-active'));
  const published=[...document.querySelectorAll(c.publishedFilterSelector)].filter(visible);
  const total=[...document.querySelectorAll(c.totalFilterSelector)].filter(visible);
  if(active.length!==1||published.length!==1||total.length!==1)return {valid:false};
  const label=e=>String(e.innerText||'').trim().replace(/\\s*\\d+\\s*$/,'').trim();
  if(!/^已发布\\s*\\d+$/.test(String(published[0].innerText||'').trim())||!/^全部\\s*\\d+$/.test(String(total[0].innerText||'').trim()))return {valid:false};
  const activeLabel=label(active[0]);
  return {valid:true,active:activeLabel==='全部'?'total':activeLabel==='已发布'?'published':'other'};
 },{c});
 if(!initialFilter.valid)nativeStatusEvidence={source:'sohu_native_published_filter',filterVerified:false,matchCount:0,contentId:expectedContentId,reason:initialFilter.reason||'STATUS_FILTER_CONTROLS_UNVERIFIED'};
 else if(!['total','published'].includes(initialFilter.active))nativeStatusEvidence={source:'sohu_native_published_filter',filterVerified:false,matchCount:0,contentId:expectedContentId,reason:'ORIGINAL_STATUS_FILTER_NOT_TOTAL_OR_PUBLISHED'};
 else {
  const switched=initialFilter.active==='total';
  if(!switched)sohuAllContentViewVerified=false;
  try{
   if(switched)await p.click('css='+c.publishedFilterSelector);
   await p.waitForFunction(({c,id,accountId})=>{
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const filters=[...document.querySelectorAll(c.publishedFilterActiveSelector)].filter(visible);
    const url='https://www.sohu.com/a/'+id+'_'+accountId;
    const rows=[...document.querySelectorAll(c.rowSelector)].filter(visible);
    const links=rows.flatMap(row=>[...row.querySelectorAll(c.articleLinkSelector||'a[href]')]).filter(a=>a.href===url&&visible(a));
    return filters.length===1&&/^已发布\\s*\\d+$/.test(String(filters[0].innerText||'').trim())&&links.length===1;
   },{c,id:expectedContentId,accountId:b.accountId},{timeout:12000});
   nativeStatusEvidence=await p.evaluate(({c,id,accountId})=>{
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
    const filters=[...document.querySelectorAll(c.publishedFilterActiveSelector)].filter(visible);
    const url='https://www.sohu.com/a/'+id+'_'+accountId;
    const rows=[...document.querySelectorAll(c.rowSelector)].filter(visible);
    const found=rows.flatMap(row=>[...row.querySelectorAll(c.articleLinkSelector||'a[href]')].filter(a=>a.href===url&&visible(a)).map(a=>({title:a.innerText.trim(),url:a.href,rowText:row.innerText})));
    return {source:'sohu_native_published_filter',filterLabel:'已发布',filterText:filters.length===1?filters[0].innerText.trim():null,filterVerified:filters.length===1&&/^已发布\\s*\\d+$/.test(String(filters[0].innerText||'').trim()),matchCount:found.length,...(found.length===1?{contentId:id,title:found[0].title,url:found[0].url,rowText:found[0].rowText}:{}),observedAt:new Date().toISOString()};
   },{c,id:expectedContentId,accountId:b.accountId});
  }catch(error){
   // The status probe is optional evidence; an adapter/UI failure here must
   // not erase a usable all-content readback or collapse to a generic outage.
   // Keep only a bounded code, never the platform's raw page/error text.
   const timedOut=/timeout|timed out/i.test(String(error?.message||error));
   nativeStatusEvidence={source:'sohu_native_published_filter',filterLabel:'已发布',filterVerified:false,matchCount:0,contentId:expectedContentId,reason:timedOut?'EXACT_ID_NOT_READ_FROM_PUBLISHED_FILTER':'SOHU_PUBLISHED_FILTER_READ_FAILED',observedAt:new Date().toISOString()};
  }finally{
   if(switched){
    try{
     await p.click('css='+c.totalFilterSelector);
     await p.waitForFunction(c=>{
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
      const filters=[...document.querySelectorAll(c.totalFilterActiveSelector)].filter(visible);
      const label=filters.length===1?String(filters[0].innerText||'').trim():'';
      const filterCount=label.match(/^全部\\s*(\\d+)$/),empty=document.body.innerText.includes(c.emptyResultText);
      if(!filterCount)return false;
      if(Number(filterCount[1])===0&&empty)return true;
      const rows=[...document.querySelectorAll(c.rowSelector)].filter(visible),pagers=[...document.querySelectorAll(c.pagination.containerSelector)].filter(visible);
      if(pagers.length!==1)return false;
      const total=pagers[0].querySelector(c.pagination.totalSelector),pageCount=String(total?.innerText||'').match(/共\\s*(\\d+)\\s*条/);
      return !!pageCount&&Number(pageCount[1])===Number(filterCount[1])&&(rows.length>0||empty);
     },c,{timeout:10000});
     sohuAllContentViewVerified=true;
     if(nativeStatusEvidence)nativeStatusEvidence.filterRestoreVerified=true;
    }catch(restoreError){
     // A failed restore cannot be mistaken for a complete all-content list.
     // Exact Published-filter evidence, if already obtained, remains separate
     // and can still prove status for this exact ID.
     sohuAllContentViewVerified=false;
     if(!nativeStatusEvidence)nativeStatusEvidence={source:'sohu_native_published_filter',filterLabel:'已发布',filterVerified:false,matchCount:0,contentId:expectedContentId,reason:'SOHU_TOTAL_FILTER_RESTORE_FAILED',observedAt:new Date().toISOString()};
     nativeStatusEvidence.filterRestoreVerified=false;
     nativeStatusEvidence.restoreReason='SOHU_TOTAL_FILTER_RESTORE_FAILED';
    }
   }
  }
 }
}
const readEditorAccount=${readScopedEditorAccount.toString()};
const readHeaderAccount=${readScopedHeaderAccount.toString()};
if(c.readySelector&&b.platform!=='sohu'){if(c.emptyResultText)await p.waitForFunction(({ready,empty})=>!!document.querySelector(ready)||document.body.innerText.includes(empty),{ready:c.readySelector,empty:c.emptyResultText},{timeout:15000});else await p.waitForSelector(c.readySelector);}
if(c.identityMode==='scoped_vue_user_info')await p.waitForFunction(c=>{for(let n=document.querySelector(c.identitySelector);n;n=n.parentElement){const u=n.__vue__?.$store?.state?.app?.userInfo;if(u?.id&&u?.nickName)return true;}return false;},c);
let editorIdentity=null;
if(['scoped_editor_redux_user','scoped_header_react_user'].includes(c.identityMode)){
 if(!b.targetId)throw Error('EXACT_TARGET_REQUIRED');
 const reader=c.identityMode==='scoped_header_react_user'?readHeaderAccount:readEditorAccount;
 await p.waitForFunction(reader,c.identitySelector,{timeout:15000});
 editorIdentity=await p.evaluate(reader,c.identitySelector);
}
const state=await p.evaluate(({c,editorIdentity})=>{
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 const nodes=c.identitySelector?[...document.querySelectorAll(c.identitySelector)].filter(visible):[];
 const rows=c.rowSelector?[...document.querySelectorAll(c.rowSelector)].filter(visible).map(row=>{const as=[...row.querySelectorAll(c.articleLinkSelector||'a[href]')];return {text:row.innerText,links:as.map(a=>({title:a.innerText,url:a.href}))};}):[];
 const scopedId=e=>{if(c.identityMode!=='scoped_vue_user_info')return {};for(let n=e;n;n=n.parentElement){const u=n.__vue__?.$store?.state?.app?.userInfo;if(u)return {accountId:String(u.id??''),storeAccountName:String(u.nickName??'')};}return {};};
 const text=document.body.innerText;const zeroCount=/共\s*0\s*篇/.test(text);const emptyVerified=!!c.emptyResultText&&text.includes(c.emptyResultText)&&rows.length===0&&zeroCount;return {url:location.href,identity:editorIdentity?[editorIdentity]:nodes.map(e=>({text:e.innerText,href:e.href||'',...scopedId(e)})),text,rows,contentListReadbackVerified:rows.length>0||emptyVerified,emptyInventoryVerified:emptyVerified,observedAt:new Date().toISOString()};
},{c,editorIdentity});
if(b.platform==='sohu'){
 if(sohuAllContentViewVerified){
 // A manager tab may already be on page 2+ (for example after a human's
 // prior inspection). Pagination must always cover the complete inventory,
 // not merely the remainder from the current page. Rewind safely before the
 // forward scan, then require the collected row count to match the native
 // total before marking the list complete or using it for deduplication.
 const readPagerState=async()=>p.evaluate(c=>{
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const pagers=[...document.querySelectorAll(c.pagination.containerSelector)].filter(visible);
  if(pagers.length!==1)return {ok:false,code:'SOHU_PAGINATION_NOT_UNIQUE'};
  const pager=pagers[0],active=[...pager.querySelectorAll(c.pagination.pageNumberSelector)].filter(visible).filter(e=>e.classList.contains('active'));
  const prev=[...pager.querySelectorAll(c.pagination.prevSelector)].filter(visible),total=pager.querySelector(c.pagination.totalSelector);
  const m=String(total?.innerText||'').match(/共\\s*(\\d+)\\s*条/);
  if(active.length!==1||prev.length!==1||!m)return {ok:false,code:'SOHU_PAGINATION_STATE_UNVERIFIED'};
  const page=Number(active[0].innerText.trim());
  if(!Number.isInteger(page)||page<1)return {ok:false,code:'SOHU_PAGINATION_START_PAGE_UNVERIFIED'};
  return {ok:true,page,total:Number(m[1]),canGoBack:!prev[0].disabled&&!prev[0].classList.contains('disabled')};
 },c);
 let start=await readPagerState();
 if(!start.ok)throw Error(start.code);
 for(let rewind=0;start.page>1&&rewind<100;rewind++){
  if(!start.canGoBack)throw Error('SOHU_PAGINATION_FIRST_PAGE_UNREACHABLE');
  await p.evaluate(c=>{const pg=document.querySelector(c.pagination.containerSelector);if(!pg)throw Error('SOHU_PAGER_REQUIRED');pg.scrollIntoView({block:'center',inline:'nearest'});},c);
  await p.mouse.move(20,25,{label:'移开评分悬浮说明'});await new Promise(r=>setTimeout(r,350));
  await p.click('css='+c.pagination.containerSelector+' '+c.pagination.prevSelector);
  await p.waitForFunction(({c,previous})=>{const pg=document.querySelector(c.pagination.containerSelector);const a=pg?[...pg.querySelectorAll(c.pagination.pageNumberSelector)].find(e=>e.classList.contains('active')):null;return !!a&&Number(a.innerText.trim())<previous;},{c,previous:start.page},{timeout:10000});
  start=await readPagerState();
  if(!start.ok)throw Error(start.code);
 }
 if(start.page!==1)throw Error('SOHU_PAGINATION_FIRST_PAGE_UNREACHABLE');
 const expectedTotal=start.total;
 const allRows=[];let previousPage=0;
 for(let step=0;step<100;step++){
  const pageState=await p.evaluate(c=>{
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
   const pagers=[...document.querySelectorAll(c.pagination.containerSelector)].filter(visible);
   if(pagers.length!==1)return {ok:false,code:'SOHU_PAGINATION_NOT_UNIQUE'};
   const pager=pagers[0],active=[...pager.querySelectorAll(c.pagination.pageNumberSelector)].filter(visible).filter(e=>e.classList.contains('active'));
   const next=[...pager.querySelectorAll(c.pagination.nextSelector)].filter(visible),total=pager.querySelector(c.pagination.totalSelector);
   if(next.length!==1||!total)return {ok:false,code:'SOHU_PAGINATION_STATE_UNVERIFIED'};
   const rows=[...document.querySelectorAll(c.rowSelector)].filter(visible).map(row=>{const as=[...row.querySelectorAll(c.articleLinkSelector||'a[href]')];return {text:row.innerText,links:as.map(a=>({title:a.innerText,url:a.href}))};});
   const m=String(total.innerText||'').match(/共\\s*(\\d+)\\s*条/),empty=document.body.innerText.includes(c.emptyResultText);
   if(m&&Number(m[1])===0&&empty)return {ok:true,page:1,total:0,rows,hasNext:false,empty:true};
   if(active.length!==1)return {ok:false,code:'SOHU_PAGINATION_STATE_UNVERIFIED'};
   const n=Number(active[0].innerText.trim());
   if(!Number.isInteger(n)||!m)return {ok:false,code:'SOHU_PAGINATION_COUNT_UNVERIFIED'};
   return {ok:true,page:n,total:Number(m[1]),rows,hasNext:!next[0].disabled&&!next[0].classList.contains('disabled'),empty};
  },c);
  if(!pageState.ok)throw Error(pageState.code);
  if(pageState.total!==expectedTotal)throw Error('SOHU_PAGINATION_TOTAL_CHANGED');
  if(pageState.page===previousPage)throw Error('SOHU_PAGINATION_DID_NOT_ADVANCE');
  previousPage=pageState.page;allRows.push(...pageState.rows);
  if(!pageState.rows.length&&pageState.total>0&&!pageState.empty)throw Error('SOHU_MANAGER_EMPTY_STATE_UNVERIFIED');
  if(!pageState.hasNext)break;
  if(step===99)throw Error('SOHU_PAGINATION_LIMIT_EXCEEDED');
  await p.evaluate(c=>{const pg=document.querySelector(c.pagination.containerSelector);if(!pg)throw Error('SOHU_PAGER_REQUIRED');pg.scrollIntoView({block:'center',inline:'nearest'});},c);
  await p.mouse.move(20,25,{label:'移开评分悬浮说明'});await new Promise(r=>setTimeout(r,350));
  await p.click('css='+c.pagination.containerSelector+' '+c.pagination.nextSelector);
  await p.waitForFunction(({c,previous})=>{
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
   const pagers=[...document.querySelectorAll(c.pagination.containerSelector)].filter(visible);
   const active=pagers.length===1?[...pagers[0].querySelectorAll(c.pagination.pageNumberSelector)].filter(visible).filter(e=>e.classList.contains('active')):[];
   const rows=[...document.querySelectorAll(c.rowSelector)].filter(visible);
   return active.length===1&&Number(active[0].innerText.trim())!==previous&&(rows.length>0||document.body.innerText.includes(c.emptyResultText));
  },{c,previous:pageState.page},{timeout:10000});
 }
 if(allRows.length!==expectedTotal)throw Error('SOHU_INVENTORY_ROW_COUNT_MISMATCH');
 const inventoryIds=allRows.map(row=>{
  if(!Array.isArray(row.links)||row.links.length!==1)return '';
  try{const u=new URL(row.links[0].url);if(u.hostname==='www.sohu.com')return u.pathname.match(/^\\/a\\/([0-9]+)_[0-9]+$/)?.[1]||'';if(u.hostname==='mp.sohu.com'&&u.pathname==='/mpfe/v4/contentManagement/news/articlepreview')return u.searchParams.get('id')?.match(/^[0-9]+$/)?.[0]||'';}catch{}return '';
 });
 if(inventoryIds.some(id=>!id)||new Set(inventoryIds).size!==inventoryIds.length)throw Error('SOHU_INVENTORY_IDS_NOT_UNIQUE_AND_COMPLETE');
 // Leave the original manager in its normal first-page/all-content state.
 for(let i=0;i<100;i++){
  const current=await p.evaluate(c=>{const pg=document.querySelector(c.pagination.containerSelector);const a=pg?[...pg.querySelectorAll(c.pagination.pageNumberSelector)].find(e=>e.classList.contains('active')):null;const prev=pg?.querySelector(c.pagination.prevSelector);return {page:Number(a?.innerText.trim()),canGoBack:!!prev&&!prev.disabled&&!prev.classList.contains('disabled')};},c);
  if(!current.page||current.page===1||!current.canGoBack)break;
  await p.evaluate(c=>{const pg=document.querySelector(c.pagination.containerSelector);if(!pg)throw Error('SOHU_PAGER_REQUIRED');pg.scrollIntoView({block:'center',inline:'nearest'});},c);
  await p.mouse.move(20,25,{label:'移开评分悬浮说明'});await new Promise(r=>setTimeout(r,350));
  await p.click('css='+c.pagination.containerSelector+' '+c.pagination.prevSelector);
  await p.waitForFunction(({c,previous})=>{const pg=document.querySelector(c.pagination.containerSelector);const a=pg?[...pg.querySelectorAll(c.pagination.pageNumberSelector)].find(e=>e.classList.contains('active')):null;return !!a&&Number(a.innerText.trim())<previous;},{c,previous:current.page},{timeout:10000});
 }
 state.rows=allRows;state.contentListReadbackVerified=true;
 }else state.contentListReadbackVerified=false;
}
if(b.platform==='toutiao'){
 const originalManagerUrl=await p.url(),originalManagerPath=new URL(originalManagerUrl).pathname;
 let switchedToArticleList=false;
 if(originalManagerPath==='/profile_v4/manage/content/all'){
  const tabs=await p.evaluate(()=>[...document.querySelectorAll('.byte-tabs-header-title')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}).map(e=>({text:String(e.innerText||'').trim(),active:e.classList.contains('active')})));
  if(tabs.filter(x=>x.text==='文章').length!==1||tabs.filter(x=>x.active).length!==1)throw Error('TOUTIAO_ARTICLE_FILTER_NOT_UNIQUE');
  const activeTab=tabs.find(x=>x.active)?.text;
  if(activeTab!=='文章'){
   await p.click('css=.byte-tabs-header-title:text-is("文章")');
   await p.waitForFunction(()=>location.pathname==='/profile_v4/graphic/articles',undefined,{timeout:10000});
   switchedToArticleList=true;
  }
 }
 if(new URL(await p.url()).pathname!=='/profile_v4/graphic/articles')throw Error('TOUTIAO_ARTICLE_LIST_ROUTE_UNVERIFIED');
 await p.waitForSelector(c.readySelector||'.article-card-wrap');
 state.url=await p.url();
 const legacyPagerSelector='.byte-pagination',currentPagerSelector='.fake-pagination';
 const legacyActiveSelector='.byte-pagination-item-active',currentActiveSelector='.fake-pagination-item.active';
 const legacyIconSelector='.byte-pagination-list > li.byte-pagination-item-icon',currentIconSelector='.fake-pagination-list > li.fake-pagination-item-icon';
 const readPager=async()=>p.evaluate(c=>{
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const pagers=[...document.querySelectorAll(c.pagerSelector)].filter(visible),totals=[...document.querySelectorAll('.search-result')].filter(visible);
  const rows=[...document.querySelectorAll(c.rowSelector)].filter(visible);
  if(totals.length!==1)return {ok:false,code:'TOUTIAO_PAGINATION_TOTAL_NOT_UNIQUE'};
  const m=String(totals[0].innerText||'').trim().match(/^共\\s*(\\d+)\\s*条内容$/);
  if(!m)return {ok:false,code:'TOUTIAO_PAGINATION_TOTAL_UNVERIFIED'};
  const total=Number(m[1]);
  if(total===0&&rows.length===0&&pagers.length===0)return {ok:true,page:1,total,rows:[],hasPrev:false,hasNext:false,empty:true};
  if(pagers.length===0){
   const items=rows.map(row=>{
    const links=[...row.querySelectorAll(c.articleLinkSelector||'a[href]')].filter(visible);
    if(links.length!==1)return {invalid:'TOUTIAO_INVENTORY_ROW_LINK_NOT_UNIQUE'};
    const a=links[0],url=a.href,title=String(a.innerText||'').trim();let id='';
    try{const u=new URL(url);if(u.hostname==='www.toutiao.com')id=u.pathname.match(/^\\/item\\/([0-9]+)\\/?$/)?.[1]||'';else if(u.hostname==='mp.toutiao.com'&&['/profile_v4/graphic/preview','/profile_v4/graphic/publish'].includes(u.pathname))id=u.searchParams.get('pgc_id')?.match(/^[0-9]+$/)?.[0]||'';}catch{}
    return {title,url,id,text:String(row.innerText||''),links:[{title,url}]};
   });
   return {ok:true,page:1,total,rows:items,hasPrev:false,hasNext:false,empty:total===0,pagerType:null};
  }
  if(pagers.length!==1)return {ok:false,code:'TOUTIAO_PAGINATION_NOT_UNIQUE'};
  const pager=pagers[0],pagerType=pager.matches(c.currentPagerSelector)?'fake-pagination':'byte-pagination';
  const active=[...pager.querySelectorAll(c.activeSelector)].filter(visible);
  const icons=[...pager.querySelectorAll(c.iconSelector)].filter(visible);
  if(active.length!==1||icons.length!==2)return {ok:false,code:'TOUTIAO_PAGINATION_STATE_UNVERIFIED'};
  const page=Number(String(active[0].innerText||'').trim());
  if(!Number.isInteger(page)||page<1)return {ok:false,code:'TOUTIAO_PAGINATION_PAGE_UNVERIFIED'};
  const items=rows.map(row=>{
   const links=[...row.querySelectorAll(c.articleLinkSelector||'a[href]')].filter(visible);
   if(links.length!==1)return {invalid:'TOUTIAO_INVENTORY_ROW_LINK_NOT_UNIQUE'};
   const a=links[0],url=a.href,title=String(a.innerText||'').trim();let id='';
   try{const u=new URL(url);if(u.hostname==='www.toutiao.com')id=u.pathname.match(/^\\/item\\/([0-9]+)\\/?$/)?.[1]||'';else if(u.hostname==='mp.toutiao.com'&&['/profile_v4/graphic/preview','/profile_v4/graphic/publish'].includes(u.pathname))id=u.searchParams.get('pgc_id')?.match(/^[0-9]+$/)?.[0]||'';}catch{}
   return {title,url,id,text:String(row.innerText||''),links:[{title,url}]};
  });
  const next=icons.at(-1),prev=icons[0];
  return {ok:true,page,total,rows:items,hasPrev:!prev.classList.contains('disabled')&&!prev.disabled,hasNext:!next.classList.contains('disabled')&&!next.disabled,empty:false,pagerType};
 },{...c,pagerSelector:legacyPagerSelector+', '+currentPagerSelector,currentPagerSelector,activeSelector:legacyActiveSelector+', '+currentActiveSelector,iconSelector:legacyIconSelector+', '+currentIconSelector});
 const clickPage=async(direction,current)=>{
  const iconSelector=current.pagerType==='fake-pagination'?currentIconSelector:legacyIconSelector;
  const activeSelector=current.pagerType==='fake-pagination'?currentActiveSelector:legacyActiveSelector;
  const selector=direction==='next'?iconSelector+':last-child':iconSelector+':first-child';
  await p.click('css='+selector);
  await p.waitForFunction(({previous,direction,activeSelector})=>{const active=[...document.querySelectorAll(activeSelector)];if(active.length!==1)return false;const page=Number(String(active[0].innerText||'').trim());return direction==='next'?page>previous:page<previous;},{previous:current.page,direction,activeSelector},{timeout:10000});
 };
 const restoreFirst=async()=>{
  for(let i=0;i<100;i++){const s=await readPager();if(!s.ok)throw Error(s.code);if(s.page===1)return;if(!s.hasPrev)throw Error('TOUTIAO_PAGINATION_FIRST_PAGE_UNREACHABLE');await clickPage('prev',s);}
  throw Error('TOUTIAO_PAGINATION_LIMIT_EXCEEDED');
 };
 let inventoryError=null,allRows=[];
 try{
  let first=await readPager();if(!first.ok)throw Error(first.code);
  while(first.page>1){if(!first.hasPrev)throw Error('TOUTIAO_PAGINATION_FIRST_PAGE_UNREACHABLE');await clickPage('prev',first);first=await readPager();if(!first.ok)throw Error(first.code);}
  const expectedTotal=first.total;let previousPage=0;
  for(let step=0;step<100;step++){
   const s=await readPager();if(!s.ok)throw Error(s.code);
   if(s.page!==previousPage+1)throw Error('TOUTIAO_PAGINATION_DID_NOT_ADVANCE');
   if(s.total!==expectedTotal)throw Error('TOUTIAO_PAGINATION_TOTAL_CHANGED');
   if(s.rows.some(row=>row.invalid))throw Error(s.rows.find(row=>row.invalid).invalid);
   if(expectedTotal>0&&!s.rows.length)throw Error('TOUTIAO_MANAGER_EMPTY_STATE_UNVERIFIED');
   previousPage=s.page;allRows.push(...s.rows);
   if(!s.hasNext)break;
   if(step===99)throw Error('TOUTIAO_PAGINATION_LIMIT_EXCEEDED');
   await clickPage('next',s);
  }
  if(allRows.length!==expectedTotal)throw Error('TOUTIAO_INVENTORY_ROW_COUNT_MISMATCH');
  const ids=allRows.map(row=>row.id);
  if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw Error('TOUTIAO_INVENTORY_IDS_NOT_UNIQUE_AND_COMPLETE');
 }catch(error){inventoryError=error;}
 try{await restoreFirst();}catch(error){if(!inventoryError)inventoryError=error;else inventoryError=Error('TOUTIAO_PAGINATION_FIRST_PAGE_RESTORE_FAILED');}
 if(switchedToArticleList){
  try{await p.goto(originalManagerUrl);await p.waitForSelector(c.readySelector||'.article-card-wrap');state.managementPageRestored=true;}
  catch(error){if(!inventoryError)inventoryError=Error('TOUTIAO_ORIGINAL_MANAGER_RESTORE_FAILED');else inventoryError=Error('TOUTIAO_ORIGINAL_MANAGER_RESTORE_FAILED');}
 }
 if(inventoryError)throw inventoryError;
 state.rows=allRows;state.contentListReadbackVerified=true;state.emptyInventoryVerified=allRows.length===0;
}
if(b.platform==='baijiahao'&&c.contentListPathPattern&&new RegExp(c.contentListPathPattern).test(new URL(state.url).pathname+new URL(state.url).hash)){
 // Baijiahao's visible first page can contain only 10 rows while the native
 // manager total is larger. Do not expose a partial page as a complete
 // duplicate inventory; rewind to page 1, scan all pages, and restore page 1.
 const readPager=async()=>p.evaluate(c=>{
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const url=new URL(location.href);
  if(['search','type','collection','startDate','endDate'].some(k=>url.searchParams.get(k)))return {ok:false,code:'BAIJIAHAO_FILTERS_NOT_CLEAR'};
  const totals=[...document.querySelectorAll('.client_pages_content_v2_components_search .total')].filter(visible);
  const rows=[...document.querySelectorAll(c.rowSelector)].filter(visible);
  if(totals.length!==1)return {ok:false,code:'BAIJIAHAO_PAGINATION_TOTAL_NOT_UNIQUE'};
  const match=String(totals[0].innerText||'').trim().match(/^共\\s*(\\d+)\\s*篇$/);
  if(!match)return {ok:false,code:'BAIJIAHAO_PAGINATION_TOTAL_UNVERIFIED'};
  const total=Number(match[1]),pagers=[...document.querySelectorAll('.cheetah-pagination')].filter(visible);
  const empty=document.body.innerText.includes('暂无数据');
  if(total===0&&rows.length===0&&empty&&pagers.length===0)return {ok:true,page:1,total,rows:[],hasPrev:false,hasNext:false,empty:true};
  if(pagers.length!==1)return {ok:false,code:'BAIJIAHAO_PAGINATION_NOT_UNIQUE'};
  const pager=pagers[0],active=[...pager.querySelectorAll('.cheetah-pagination-item-active')].filter(visible),prev=[...pager.querySelectorAll('li.cheetah-pagination-prev')].filter(visible),next=[...pager.querySelectorAll('li.cheetah-pagination-next')].filter(visible);
  if(active.length!==1||prev.length!==1||next.length!==1)return {ok:false,code:'BAIJIAHAO_PAGINATION_STATE_UNVERIFIED'};
  const page=Number(String(active[0].title||active[0].innerText||'').trim());
  if(!Number.isInteger(page)||page<1)return {ok:false,code:'BAIJIAHAO_PAGINATION_PAGE_UNVERIFIED'};
  const items=rows.map(row=>{
   const links=[...row.querySelectorAll(c.articleLinkSelector||'a[href]')].filter(visible);
   if(links.length!==1)return {invalid:'BAIJIAHAO_INVENTORY_ROW_LINK_NOT_UNIQUE'};
   const a=links[0],url=a.href,title=String(a.innerText||'').trim();
   return {text:String(row.innerText||''),links:[{title,url}]};
  });
  const can=el=>el.getAttribute('aria-disabled')!=='true'&&!el.classList.contains('cheetah-pagination-disabled')&&!el.querySelector('button')?.disabled;
  return {ok:true,page,total,rows:items,hasPrev:can(prev[0]),hasNext:can(next[0]),empty:false};
 },c);
 const originalScroll=await p.evaluate(()=>({x:scrollX,y:scrollY}));
 const clickPage=async(direction,current)=>{
  // Baijiahao's desktop content list overflows the narrow Ego viewport
  // horizontally; a fixed "规则中心" handle can overlap the pager's right
  // edge. Bring the native pager into view with the real mouse wheel, then
  // click an unobstructed point inside its actual enabled button.
  await p.mouse.move(300,250,{label:'定位百家号原生分页'});
  await p.mouse.wheel(700,0,{label:'横向查看百家号分页'});
  await p.mouse.wheel(0,3000,{label:'滚动到百家号分页'});
  const selector=direction==='next'?'.cheetah-pagination-next:not(.cheetah-pagination-disabled) button':'.cheetah-pagination-prev:not(.cheetah-pagination-disabled) button';
  const point=await p.evaluate(selector=>{
   const target=document.querySelector(selector);if(!target||target.disabled)return null;
   const r=target.getBoundingClientRect();
   for(const dx of [2,4,6,8])for(const dy of [2,Math.floor(r.height/2),Math.max(2,r.height-2)]){
    const x=r.left+dx,y=r.top+dy;if(x<0||y<0||x>=innerWidth||y>=innerHeight)continue;
    const hit=document.elementFromPoint(x,y);if(hit&&(hit===target||target.contains(hit)))return {x,y};
   }
   return null;
  },selector);
  if(!point)throw Error('BAIJIAHAO_PAGINATION_CLICK_POINT_UNAVAILABLE');
  const oldFirst=await p.evaluate(c=>document.querySelector(c.rowSelector+' '+c.articleLinkSelector)?.href||'',c);
  if(!oldFirst)throw Error('BAIJIAHAO_PAGINATION_OLD_FIRST_ROW_UNAVAILABLE');
  await p.mouse.click(point.x,point.y,{label:direction==='next'?'翻到百家号下一页':'返回百家号上一页'});
  await p.waitForFunction(({previous,direction,oldFirst,rowSelector,articleLinkSelector})=>{
   const active=[...document.querySelectorAll('.cheetah-pagination-item-active')];if(active.length!==1)return false;
   const page=Number(String(active[0].title||active[0].innerText||'').trim());
   const newFirst=document.querySelector(rowSelector+' '+articleLinkSelector)?.href||'';
   return (direction==='next'?page>previous:page<previous)&&!!newFirst&&newFirst!==oldFirst;
  },{previous:current,direction,oldFirst,rowSelector:c.rowSelector,articleLinkSelector:c.articleLinkSelector},{timeout:10000});
 };
 const restoreFirst=async()=>{
  for(let i=0;i<100;i++){
   const s=await readPager();if(!s.ok)throw Error(s.code);if(s.page===1)return;
   if(!s.hasPrev)throw Error('BAIJIAHAO_PAGINATION_FIRST_PAGE_UNREACHABLE');await clickPage('prev',s.page);
  }
  throw Error('BAIJIAHAO_PAGINATION_LIMIT_EXCEEDED');
 };
 let inventoryError=null,allRows=[],expectedTotal=null;
 try{
  let first=await readPager();if(!first.ok)throw Error(first.code);
  expectedTotal=first.total;
  while(first.page>1){if(!first.hasPrev)throw Error('BAIJIAHAO_PAGINATION_FIRST_PAGE_UNREACHABLE');await clickPage('prev',first.page);first=await readPager();if(!first.ok)throw Error(first.code);}
  if(first.page!==1)throw Error('BAIJIAHAO_PAGINATION_FIRST_PAGE_UNREACHABLE');
  let previousPage=0;
  for(let step=0;step<100;step++){
   const s=await readPager();if(!s.ok)throw Error(s.code);
   if(s.page!==previousPage+1)throw Error('BAIJIAHAO_PAGINATION_DID_NOT_ADVANCE');
   if(s.total!==expectedTotal)throw Error('BAIJIAHAO_PAGINATION_TOTAL_CHANGED');
   if(s.rows.some(row=>row.invalid))throw Error(s.rows.find(row=>row.invalid).invalid);
   if(expectedTotal>0&&!s.rows.length)throw Error('BAIJIAHAO_MANAGER_EMPTY_STATE_UNVERIFIED');
   previousPage=s.page;allRows.push(...s.rows);
   if(!s.hasNext)break;
   if(step===99)throw Error('BAIJIAHAO_PAGINATION_LIMIT_EXCEEDED');
   await clickPage('next',s.page);
  }
  if(allRows.length!==expectedTotal)throw Error('BAIJIAHAO_INVENTORY_ROW_COUNT_MISMATCH');
  const ids=allRows.map(row=>{
   if(!Array.isArray(row.links)||row.links.length!==1)return '';
   try{const u=new URL(row.links[0].url);return u.hostname==='baijiahao.baidu.com'&&['/s','/builder/preview/s'].includes(u.pathname)?u.searchParams.get('id')?.match(/^[0-9]+$/)?.[0]||'':'';}catch{return '';}
  });
  if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw Error('BAIJIAHAO_INVENTORY_IDS_NOT_UNIQUE_AND_COMPLETE');
 }catch(error){inventoryError=error;}
 try{await restoreFirst();await p.evaluate(({x,y})=>window.scrollTo(x,y),originalScroll);}catch(error){if(!inventoryError)inventoryError=error;else inventoryError=Error('BAIJIAHAO_PAGINATION_FIRST_PAGE_RESTORE_FAILED');}
 if(inventoryError)throw inventoryError;
 state.rows=allRows;state.contentListReadbackVerified=true;state.emptyInventoryVerified=allRows.length===0;
}
state.nativeStatusEvidence=nativeStatusEvidence;
if(editorIdentity){const after=await p.evaluate(c.identityMode==='scoped_header_react_user'?readHeaderAccount:readEditorAccount,c.identitySelector);if(JSON.stringify(after)!==JSON.stringify(editorIdentity))throw Error('ACCOUNT_IDENTITY_CHANGED');}
await verifyTarget();
console.log('SCHOOL_ARTICLE_MANAGEMENT:'+JSON.stringify(state));`;
}
export function assessArticleManagement(raw,binding,contract,pkg={}) {
 const u=new URL(raw.url);
 if(!binding.platformHosts.includes(u.hostname)||!new RegExp(contract.managementPathPattern).test(u.pathname+u.hash))throw Error('MANAGEMENT_PAGE_MISMATCH');
 const routeAccountId=contract.accountIdQuery?u.searchParams.get(contract.accountIdQuery):'';
 if(contract.accountIdQuery&&(routeAccountId||!['scoped_editor_redux_user','scoped_header_react_user'].includes(contract.identityMode))&&routeAccountId!==binding.accountId)throw Error('ACCOUNT_ROUTE_ID_MISMATCH');
 const normalized=x=>String(x||'').trim();
 const reduxMode=contract.identityMode==='scoped_editor_redux_user';
 const headerMode=contract.identityMode==='scoped_header_react_user';
 const identity=(raw.identity||[]).filter(x=>normalized(reduxMode||headerMode?x.storeAccountName:x.text).split(/\r?\n/).some(t=>t.trim()===binding.accountName));
 const nameVerified=identity.length===1;
 const idVerified=['scoped_vue_user_info','scoped_editor_redux_user','scoped_header_react_user'].includes(contract.identityMode)?identity.length===1&&identity[0].accountId===binding.accountId&&identity[0].storeAccountName===binding.accountName:!binding.accountId||!contract.identityHrefPattern||identity.some(x=>new RegExp(contract.identityHrefPattern).exec(x.href)?.[1]===binding.accountId);
 const identityVerified=nameVerified&&idVerified;
 const runtimeReview=reduxMode&&identityVerified&&(identity[0].accountStatus==='audit'||identity[0].userStatus==='audit')&&identity[0].accountStatusText==='审核中';
 const restricted=runtimeReview?'ACCOUNT_REVIEW_PENDING':/您的账号已被封停|账号已封禁/.test(raw.text)?'ACCOUNT_SUSPENDED':/您的账号信息正在审核中|账号信息审核中/.test(raw.text)?'ACCOUNT_REVIEW_PENDING':null;
 const rows=(raw.rows||[]).flatMap(row=>row.links.map(a=>({contentId:articleId(a.url,binding.platform),title:a.title,url:a.url,text:row.text})).filter(a=>a.contentId));
 const articles=rows.map(row=>{
  const native=raw.nativeStatusEvidence;
  const exactSohuPublished=binding.platform==='sohu'&&native?.source==='sohu_native_published_filter'&&native.filterVerified===true&&native.matchCount===1&&native.contentId===row.contentId&&native.title===row.title&&native.url===row.url;
  const status=exactSohuPublished?'PUBLISHED':classifyArticleRow(row.text,row.url,binding.platform);
  const metric=label=>{const m=row.text.match(new RegExp(label+'\\s*([0-9]+)'));return m?Number(m[1]):null;};
  const publishedTime=exactSohuPublished?parseSohuPublishedAt(native.rowText):null;
  return {contentId:row.contentId,title:row.title,url:row.url,status,platformStatusVerified:status!=='STATUS_UNKNOWN'&&status!=='PUBLIC_LINK_PRESENT',publicReadbackVerified:false,...(exactSohuPublished?{statusEvidence:native.source,nativeStatusEvidence:native,...(publishedTime||{publishedAt:null,publishedAtPrecision:'UNKNOWN'})}:{}),metrics:{impressions:metric('展现'),reads:metric('阅读'),likes:metric('点赞'),comments:metric('评论')}};
 });
 const base={accountIdentityVerified:identityVerified,...(reduxMode?{accountName:identityVerified?binding.accountName:null,accountId:identityVerified?binding.accountId:null,contentListAvailable:false}:{}),...(['sohu','baijiahao','toutiao'].includes(binding.platform)?{contentListReadbackVerified:raw.contentListReadbackVerified===true,emptyInventoryVerified:raw.emptyInventoryVerified===true}:{}),identitySource:identityVerified?(headerMode?'scoped_visible_header_react_account_id_and_name':reduxMode?'scoped_editor_redux_account_id_and_name':contract.identityMode==='scoped_vue_user_info'?'scoped_visible_name_and_store_account_id':'scoped_visible_account_header'):contract.accountIdQuery?'route_id_only':'unverified',observedAt:raw.observedAt,url:raw.url,readOnly:true,publicReadbackVerified:false,articles};
 if((reduxMode||headerMode)&&!identityVerified)return {...base,articles:[],ok:false,status:'BLOCKED',code:'ACCOUNT_IDENTITY_UNVERIFIED'};
 if(restricted)return {...base,ok:false,status:restricted,code:restricted,publishAllowed:false,platformMessage:runtimeReview?identity[0].accountStatusText:restricted==='ACCOUNT_SUSPENDED'?'您的账号已被封停':'您的账号信息正在审核中，请耐心等待哦'};
 if(!identityVerified)return {...base,articles:[],ok:false,status:'BLOCKED',code:'ACCOUNT_IDENTITY_UNVERIFIED'};
 if(reduxMode&&pkg.platformContentId!==undefined)return {...base,ok:false,status:'ARTICLE_LIST_NOT_READ',code:'ARTICLE_LIST_NOT_READ',platformContentId:pkg.platformContentId};
 if(pkg.platformContentId!==undefined){
  if(typeof pkg.platformContentId!=='string'||!pkg.platformContentId||!/^\d+$/.test(pkg.platformContentId))throw Error('EXACT_STRING_CONTENT_ID_REQUIRED');
  const found=articles.filter(a=>a.contentId===pkg.platformContentId);
  if(found.length!==1)return {...base,ok:false,status:'CONTENT_NOT_UNIQUELY_FOUND',code:found.length?'AMBIGUOUS_CONTENT_ID':'CONTENT_NOT_IN_CURRENT_LIST',platformContentId:pkg.platformContentId};
  if(pkg.title&&found[0].title!==pkg.title)return {...base,ok:false,status:'BLOCKED',code:'CONTENT_TITLE_MISMATCH'};
  return {...base,...found[0],ok:true,platformContentId:pkg.platformContentId,platformReadbackVerified:true};
 }
 if(reduxMode)return {...base,ok:true,status:'ACCOUNT_IDENTITY_READBACK_VERIFIED',publishAllowed:null,platformReadbackVerified:false};
 return {...base,ok:true,status:'ACCOUNT_MANAGEMENT_READBACK_VERIFIED',publishAllowed:null,platformReadbackVerified:true};
}
export async function runArticleManagement(pkg,matrix,execute,{contractPath=ARTICLE_CONTRACTS}={}) {


 const binding=resolveSchoolAccountBinding(pkg.schoolAccount,matrix);
 const c=JSON.parse(fs.readFileSync(contractPath,'utf8')).platforms[binding.platform]?.managementReadback;
 if(!c)throw Error('ARTICLE_MANAGEMENT_CONTRACT_NOT_VERIFIED');
 const readbackBinding=binding.managementPageLabel?{...binding,pageLabel:binding.managementPageLabel,targetId:binding.managementTargetId,taskSpaceId:binding.managementTaskSpaceId||binding.taskSpaceId,taskSpaceName:binding.managementTaskSpaceName||binding.taskSpaceName}:binding;
 const r=await execute('ego-browser',['nodejs'],{input:buildManagementReadScript(readbackBinding,c,{platformContentId:pkg.platformContentId})});
 const line=(r.stdout+'\n'+r.stderr).split(/\r?\n/).find(x=>x.startsWith('SCHOOL_ARTICLE_MANAGEMENT:'));
 if(r.code!==0||!line)return {ok:false,status:'READBACK_UNAVAILABLE',code:'ARTICLE_MANAGEMENT_READBACK_UNAVAILABLE',publicReadbackVerified:false};
 return assessArticleManagement(JSON.parse(line.slice('SCHOOL_ARTICLE_MANAGEMENT:'.length)),readbackBinding,c,pkg);
}
