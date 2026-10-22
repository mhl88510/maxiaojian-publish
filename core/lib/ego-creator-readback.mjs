import {fileURLToPath} from 'node:url';
import {validateDouyinScheduleIntent} from './content-package.mjs';
const HELPER=fileURLToPath(new URL('./ego-creator-read.mjs',import.meta.url));
const MARKER='__SCHOOL_NATIVE_CREATOR_READ__';

// Executed inside the existing Ego node runtime; injectable functions also make all gates testable.
export async function readNativeDouyinContent({route,id,limit,includeDetailedStats,get,identity,control,now=()=>Date.now()}) {
 const fail=(code,extra={})=>({ok:false,status:'BLOCKED',code,readOnly:true,platformReadbackVerified:false,platformStatusVerified:false,publicReadbackVerified:false,...extra});
 const equalName=(a,b)=>String(a??'').normalize('NFC').replace(/\s+/g,' ').trim()===String(b??'').normalize('NFC').replace(/\s+/g,' ').trim();
 const resolvedUid=route.api_uid;
 const owned=v=>{if(!v||String(v.uid)!==resolvedUid||String(v.unique_id)!==String(route.public_account_id)||!equalName(v.nickname,route.account_name))throw Error('NATIVE_ACCOUNT_IDENTITY_MISMATCH');return v;};
 if(typeof id!=='string'||!/^\d{15,22}$/.test(id)||!Number.isInteger(limit)||limit<1||limit>200)throw Error('NATIVE_READ_ARGUMENT_INVALID');
 await control();const before=owned(await identity());const beforeCheckedAt=new Date(now()).toISOString();
 const workUrl='https://creator.douyin.com/janus/douyin/creator/pc/work_list';
 const load=async(status,deep=false)=>{
  const rows=[],seenIds=new Set(),seenCursors=new Set();let cursor=deep?'0':undefined;
  for(let hop=0;hop<20;hop++) {
   await control();const q=deep?new URLSearchParams({status:'0',count:'50',max_cursor:cursor,scene:'star_atlas',device_platform:'android',aid:'1128'}):new URLSearchParams({page_size:String(Math.min(limit,50)),status:String(status)});
   if(!deep&&cursor!==undefined)q.set('max_cursor',cursor);
   const response=await get(workUrl+'?'+q),d=response.data??response,batch=deep?d.items:(d.work_list??d.aweme_list);
   if(!Array.isArray(batch)||![false,true,0,1].includes(d.has_more))throw Error('NATIVE_WORK_LIST_SHAPE');
   for(const work of batch) {
    const key=deep?work?.id:work?.aweme_id;
    if(typeof key!=='string'||!/^\d{15,22}$/.test(key))throw Error('NATIVE_LONG_CONTENT_ID_REQUIRED');
    const owner=deep?work.user_id:(work.author?.uid??work.author_user_id);
    if(owner==null||String(owner)!==resolvedUid)throw Error('NATIVE_WORK_OWNER_MISMATCH');
    if(seenIds.has(key))throw Error('NATIVE_DUPLICATE_CONTENT_ID');seenIds.add(key);rows.push(work);
   }
   // Validate the complete batch even if a platform returns more than page_size.
   // Keep exact-ID matching within the requested read window, not overflow records.
   const windowRows=rows.slice(0,limit);
   if(rows.length>=limit||windowRows.some(w=>(deep?w.id:w.aweme_id)===id)||!d.has_more)return windowRows;
   if(d.max_cursor==null||String(d.max_cursor)===String(cursor)||seenCursors.has(String(d.max_cursor)))throw Error('NATIVE_CURSOR_STALLED');
   cursor=String(d.max_cursor);seenCursors.add(cursor);
  }
  throw Error('NATIVE_READ_WINDOW_INCOMPLETE');
 };
 const rows=await load(0),row=rows.find(r=>r.aweme_id===id);
 let publishedRow=null;
 let state='UNKNOWN',statusEvidence=null;
 const publicTimeSeconds=row&&((typeof row.public_time==='number'&&Number.isSafeInteger(row.public_time))||(typeof row.public_time==='string'&&/^\d{1,12}$/.test(row.public_time)))?Number(row.public_time):null;
 const publicTimeIso=Number.isSafeInteger(publicTimeSeconds)&&publicTimeSeconds>0&&Number.isFinite(new Date(publicTimeSeconds*1000).getTime())?new Date(publicTimeSeconds*1000).toISOString():null;
 if(row) {
  const raw=row.status;
  const flag=k=>raw&&typeof raw==='object'&&[true,1].includes(raw[k]);
  if(flag('is_delete')){state='DELETED';statusEvidence='creator_explicit_status';}
  else if(flag('is_prohibited')){state='PROHIBITED';statusEvidence='creator_explicit_status';}
  else if(flag('in_reviewing')){state='REVIEWING';statusEvidence='creator_explicit_status';}
  else if(flag('is_private')){state='PRIVATE';statusEvidence='creator_explicit_status';}
  else if(publicTimeSeconds!==null&&publicTimeSeconds>now()/1000){state='SCHEDULED';statusEvidence='creator_explicit_future_public_time';}
  else {const published=await load(1);publishedRow=published.find(r=>r.aweme_id===id)||null;if(publishedRow){state='PUBLISHED';statusEvidence='creator_work_list_server_filter_published';}}
 }
 const rawCreatedAt=publishedRow?.create_time;
 const createdAtSeconds=(typeof rawCreatedAt==='number'&&Number.isSafeInteger(rawCreatedAt))?rawCreatedAt:(typeof rawCreatedAt==='string'&&/^\d{1,12}$/.test(rawCreatedAt)&&Number.isSafeInteger(Number(rawCreatedAt))?Number(rawCreatedAt):null);
 const nowSeconds=Math.floor(now()/1000);
 const publishedAtSeconds=state==='PUBLISHED'&&Number.isSafeInteger(createdAtSeconds)&&createdAtSeconds>=946684800&&createdAtSeconds<=nowSeconds+300&&Number.isFinite(new Date(createdAtSeconds*1000).getTime())?createdAtSeconds:null;
 const publishedAt=publishedAtSeconds===null?null:new Date(publishedAtSeconds*1000).toISOString();
 let detailedMetrics=null,metricsUpdatedAt=null;const warnings=[];
 if(row&&includeDetailedStats) {
  try {
   const item=(await load(0,true)).find(r=>r.id===id);
   if(!item)throw Error('NATIVE_METRICS_NOT_IN_READ_WINDOW');
   const raw=item.metrics;if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('NATIVE_METRICS_SHAPE');
   const allowed=['avg_view_proportion','avg_view_second','bounce_rate_2s','comment_count','comment_rate','completion_rate','completion_rate_5s','cover_show','danmaku_count','dislike_count','dislike_rate','download_count','fan_view_proportion','favorite_count','favorite_rate','homepage_visit_count','like_count','like_rate','share_count','share_rate','subscribe_count','subscribe_rate','unsubscribe_count','unsubscribe_rate','view_count'];
   const values=[];
   for(const metric of allowed) {const value=raw[metric],n=value===null||(typeof value==='string'&&!value.trim())?NaN:Number(value);
    if(!['string','number'].includes(typeof value)||!Number.isFinite(n)||n<0||(metric.endsWith('_rate')&&n>1)||(metric.endsWith('_count')&&!Number.isSafeInteger(n)))continue;
    values.push({metric,value});}
   if(!values.length)throw Error('NATIVE_METRICS_EMPTY');detailedMetrics=values;
   const epoch=item.metrics_offline_update_time,date=typeof epoch==='number'&&epoch>0?new Date(epoch*1000):null;
   if(date&&Number.isFinite(date.getTime()))metricsUpdatedAt=date.toISOString();
   if(values.length<25)warnings.push({code:'DOUYIN_DETAILED_METRICS_PARTIAL',message:'平台仅返回部分指标；未返回字段保持缺失，不补零。'});
  }catch(e){warnings.push({code:String(e.message),message:'深层指标未取得，基础列表/状态独立保留；不要求重登或重发。'});}
 }
 await control();const after=owned(await identity());await control();
 const checkedAt=new Date(now()).toISOString();
 const identityEvidence={
  before:{accountId:String(before.unique_id),apiUid:String(before.uid),accountName:String(before.nickname),profileId:route.ego_profile_id,checkedAt:beforeCheckedAt},
  after:{accountId:String(after.unique_id),apiUid:String(after.uid),accountName:String(after.nickname),profileId:route.ego_profile_id,checkedAt}
 };
 if(!row)return fail('VIDEO_CONTENT_NOT_FOUND_IN_READ_WINDOW',{platformContentId:id,scannedLimit:limit,checkedAt:new Date(now()).toISOString(),message:'本次窗口未找到，不表示删除或不存在；不自动重发。'});
 const keys=['play_count','digg_count','comment_count','collect_count','share_count'];
 const rawMetrics=Object.fromEntries(keys.map(k=>[k,row.statistics?.[k]??null]));
 const metrics=Object.fromEntries(keys.map(k=>[k,typeof rawMetrics[k]==='number'&&Number.isSafeInteger(rawMetrics[k])&&rawMetrics[k]>=0?rawMetrics[k]:null]));
 return {ok:true,status:state==='UNKNOWN'?'CONTENT_FOUND_STATUS_UNKNOWN':state,platformContentId:id,title:typeof row.desc==='string'?row.desc:'',reportedStatus:row.status??null,publicTimeSeconds:Number.isSafeInteger(publicTimeSeconds)?publicTimeSeconds:null,publicTimeIso,publishedAt,publishedAtSource:publishedAt?'ego_creator_work_list.create_time':null,metrics,rawMetrics,detailedMetrics,detailedMetricsSource:detailedMetrics?'ego_creator_work_list_items':null,metricsUpdatedAt,warnings,readOnly:true,platformReadbackVerified:true,platformStatusVerified:state!=='UNKNOWN',publicReadbackVerified:false,statusEvidence,source:'ego_native_creator_work_list',metricSource:'creator_raw_statistics',metricCaveat:'原始缺字段保持null；后台状态不等于公开页/像素验收。',identityVerification:'canonical_name_and_api_uid',identityVerifiedBeforeAndAfter:true,identityEvidence,executionTransport:'ego_creator_native',opencliContextId:null,egoProfileId:route.ego_profile_id,checkedAt,scannedLimit:limit};
}

export function verifyDouyinScheduleReadback({readback,intent,contentId}={}) {
 const blocked={ok:false,code:'DOUYIN_SCHEDULE_READBACK_MISMATCH'};
 if(typeof contentId!=='string'||!/^\d{15,22}$/.test(contentId)||readback?.platformContentId!==contentId)return blocked;
 if(!intent||typeof intent!=='object'||typeof intent.publishAt!=='string')return {ok:false,code:'DOUYIN_SCHEDULE_INTENT_INVALID'};
 const scheduledEpoch=Date.parse(intent.publishAt);
 const intentCheck=validateDouyinScheduleIntent(intent,{now:scheduledEpoch-3*60*60*1000});
 if(!intentCheck.ok||!Number.isFinite(scheduledEpoch)||scheduledEpoch%60000!==0)return {ok:false,code:'DOUYIN_SCHEDULE_INTENT_INVALID'};
 const expectedPublicTimeSeconds=scheduledEpoch/1000;
 const actual=readback?.publicTimeSeconds;
 if(readback?.ok!==true||readback.readOnly!==true||readback.platformReadbackVerified!==true||readback.platformStatusVerified!==true
   ||readback.publicReadbackVerified!==false||readback.status!=='SCHEDULED'||actual!==expectedPublicTimeSeconds
   ||readback.publicTimeIso!==new Date(expectedPublicTimeSeconds*1000).toISOString())return {...blocked,expectedPublicTimeSeconds,actualPublicTimeSeconds:actual??null,status:readback?.status||null};
 return {ok:true,platformContentId:contentId,status:'SCHEDULED',publicTimeSeconds:actual,publicTimeIso:readback.publicTimeIso,expectedPublicTimeSeconds};
}

export function buildNativeCreatorReadScript(route,{id,limit,includeDetailedStats}) {
 if(route.platform!=='douyin'||route.transport!=='ego_creator_native'||!/^[0-9]+$/.test(route.api_uid)||!/^\d+$/.test(route.public_account_id)||!Number.isSafeInteger(route.task_space_id)||!route.task_space_name||!route.ego_profile_id||!route.account_name||(!route.target_id&&!/^p[1-9]\d*$/.test(route.page_label))||(route.allow_upload_page!==undefined&&typeof route.allow_upload_page!=='boolean'))throw Error('NATIVE_EXACT_BINDING_REQUIRED');
 if(route.target_id!==undefined&&(typeof route.target_id!=='string'||! /^[A-Fa-f0-9]{32}$/.test(route.target_id)))throw Error('NATIVE_EXACT_BINDING_REQUIRED');
 if(typeof id!=='string'||!/^\d{15,22}$/.test(id)||!Number.isInteger(limit)||limit<1||limit>200)throw Error('NATIVE_READ_ARGUMENT_INVALID');
 return `
const marker=${JSON.stringify(MARKER)};
try {
 const route=${JSON.stringify(route)};let task,page,expectedTarget,expectedLabel;
 const allowedPaths=route.allow_upload_page===true?['/creator-micro/home','/creator-micro/content/manage','/creator-micro/content/upload']:['/creator-micro/home','/creator-micro/content/manage'];
 const safeUrl=async(p)=>{let u;try{u=new URL(await p.url());}catch{throw Error('NATIVE_READ_SURFACE_REQUIRED');}if(u.origin!=='https://creator.douyin.com'||!allowedPaths.includes(u.pathname))throw Error('NATIVE_READ_SURFACE_REQUIRED');};
 const safeTabUrl=(value)=>{if(typeof value!=='string'||!value.trim())throw Error('NATIVE_READ_SURFACE_REQUIRED');let u;try{u=new URL(value);}catch{throw Error('NATIVE_READ_SURFACE_REQUIRED');}if(u.origin!=='https://creator.douyin.com'||!allowedPaths.includes(u.pathname))throw Error('NATIVE_READ_SURFACE_REQUIRED');};
 const control=async()=>{const all=await listTaskSpaces();if(all.filter(s=>s.id===route.task_space_id&&s.name===route.task_space_name&&s.profileId===route.ego_profile_id&&s.ownership==='agent').length!==1)throw Error('NATIVE_EXACT_AGENT_SPACE_REQUIRED');
  if(!task)task=await taskSpace(route.task_space_id);if(task.spaceId!==route.task_space_id||task.name!==route.task_space_name||task.ownership!=='agent')throw Error('NATIVE_SPACE_CHANGED');
  if(!page){const tabs=await task.tabs();let matches;
   if(route.target_id){matches=tabs.filter(x=>x.targetId===route.target_id);if(matches.length!==1)throw Error('NATIVE_PAGE_BINDING_CHANGED');const tab=matches[0];if(!tab.page)throw Error('NATIVE_PAGE_BINDING_CHANGED');if(tab.page.spaceId!==route.task_space_id)throw Error('NATIVE_SPACE_CHANGED');if(tab.page.targetId!==route.target_id)throw Error('NATIVE_PAGE_BINDING_CHANGED');safeTabUrl(tab.url);if(tab.label){page=task.page(tab.label);if(!page||page.spaceId!==route.task_space_id||(page.targetId!==undefined&&page.targetId!==route.target_id))throw Error('NATIVE_PAGE_BINDING_CHANGED');}else{page=await task.adopt(tab.page);if(!page||page.spaceId!==route.task_space_id||(page.targetId!==undefined&&page.targetId!==route.target_id))throw Error('NATIVE_PAGE_BINDING_CHANGED');}expectedTarget=route.target_id;expectedLabel=page.label;if(typeof expectedLabel!=='string'||!/^p[1-9]\\d*$/.test(expectedLabel))throw Error('NATIVE_PAGE_BINDING_CHANGED');
   }else{matches=tabs.filter(x=>x.label===route.page_label);if(matches.length!==1)throw Error('NATIVE_PAGE_BINDING_CHANGED');const tab=matches[0];if(tab.page?.spaceId!==route.task_space_id)throw Error('NATIVE_SPACE_CHANGED');expectedTarget=tab.targetId;expectedLabel=tab.label;if(tab.page?.targetId!==expectedTarget)throw Error('NATIVE_PAGE_BINDING_CHANGED');page=task.page(expectedLabel);if(!page||page.spaceId!==route.task_space_id||(page.targetId!==undefined&&page.targetId!==expectedTarget))throw Error('NATIVE_PAGE_BINDING_CHANGED');}
  }
  await safeUrl(page);
  const tabs=await task.tabs(),bound=tabs.filter(x=>x.targetId===expectedTarget);if(bound.length!==1||bound[0].label!==expectedLabel)throw Error('NATIVE_PAGE_BINDING_CHANGED');};
 await control();const {creatorGet}=await import(${JSON.stringify(HELPER)});
 const get=url=>creatorGet(page,url);
 const identity=async()=>{const r=await get('https://creator.douyin.com/web/api/media/user/info/?aid=1128');return r.user_info??r.user;};
 if(new URL(await page.url()).pathname==='/creator-micro/home'){const text=await page.evaluate(()=>document.body.textContent);const compact=s=>String(s??'').normalize('NFC').replace(/\\s+/g,' ').trim();if(!compact(text).includes(compact(route.account_name))||!text.includes(route.public_account_id))throw Error('NATIVE_VISIBLE_ACCOUNT_MISMATCH');}
 const read=${readNativeDouyinContent.toString()};
 const data=await read({route,id:${JSON.stringify(id)},limit:${limit},includeDetailedStats:${includeDetailedStats===true},get,identity,control});
 const finalTabs=(await task.tabs()).filter(x=>x.targetId===expectedTarget);if(finalTabs.length!==1||finalTabs[0].label!==expectedLabel)throw Error('NATIVE_PAGE_BINDING_CHANGED');
 console.log(marker+JSON.stringify(data));
}catch(e){console.log(marker+JSON.stringify({ok:false,status:'BLOCKED',code:String(e.message),readOnly:true,platformReadbackVerified:false,platformStatusVerified:false,publicReadbackVerified:false}));}
`;
}
export async function executeNativeCreatorReadback(route,options,execute) {


 const {timeoutMs=180000}=options||{};
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>180000)throw Error('NATIVE_READ_TIMEOUT_INVALID');
 const script=buildNativeCreatorReadScript(route,options),r=await execute('ego-browser',['nodejs'],{input:script,timeoutMs});
 if(r.timedOut)throw Error('NATIVE_CREATOR_READ_TIMEOUT');
 const lines=[r.stdout,r.stderr].flatMap(s=>String(s??'').split('\n')).filter(l=>l.startsWith(MARKER));
 if(r.code!==0||lines.length!==1)throw Error('NATIVE_CREATOR_TRANSPORT_FAILED');
 let d;try{d=JSON.parse(lines[0].slice(MARKER.length));}catch{throw Error('NATIVE_CREATOR_INVALID_RESULT');}
 if(!d||typeof d!=='object'||d.readOnly!==true||d.publicReadbackVerified!==false)throw Error('NATIVE_CREATOR_INVALID_RESULT');return d;
}
