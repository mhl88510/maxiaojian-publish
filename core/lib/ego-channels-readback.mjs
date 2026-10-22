const MARKER='__SCHOOL_CHANNELS_READ__';
const fail=(code,extra={})=>({ok:false,status:'BLOCKED',code,readOnly:true,platformReadbackVerified:false,platformStatusVerified:false,publicReadbackVerified:false,...extra});
const validId=id=>typeof id==='string'&&(/^[0-9]{15,22}$/.test(id)||/^export\/[A-Za-z0-9_-]{16,256}$/.test(id));
export function channelsBinding(pkg,matrix){
 const t=pkg.schoolAccount||{},accounts=(matrix.platforms?.wechat_channels?.accounts||[]).filter(a=>a.key===t.accountKey);
 if(t.platform!=='wechat_channels'||accounts.length!==1)throw Error('CHANNELS_ACCOUNT_BINDING_REQUIRED');
 const a=accounts[0],e=a.ego;
 if(!a.name||!/^sph[A-Za-z0-9_-]+$/.test(a.id||'')||!e||!e.profileId||!Number.isSafeInteger(e.taskSpaceId)||e.taskSpaceId<1||!e.taskSpaceName||!/^p[1-9]\d*$/.test(e.pageLabel||'')||!e.targetId)throw Error('CHANNELS_EXACT_EXISTING_BINDING_REQUIRED');
 for(const [key,value] of Object.entries({accountName:a.name,accountId:a.id,egoProfileId:e.profileId,taskSpaceId:e.taskSpaceId,taskSpaceName:e.taskSpaceName,pageLabel:e.pageLabel,targetId:e.targetId}))if(t[key]!==undefined&&t[key]!==value)throw Error('CHANNELS_ACCOUNT_BINDING_MISMATCH');
 return {accountName:a.name,accountId:a.id,egoProfileId:e.profileId,taskSpaceId:e.taskSpaceId,taskSpaceName:e.taskSpaceName,pageLabel:e.pageLabel,targetId:e.targetId};
}
// Runs browser-side. Only whitelisted public account / work fields leave the page.
export function channelsPageSnapshot(){
 const folds=[...document.querySelectorAll('.fold')].filter(n=>n.__vue__?.userStore);
 if(folds.length!==1)throw Error('CHANNELS_IDENTITY_STORE_AMBIGUOUS');
 const user=folds[0].__vue__.userStore,finder=user.finder;
 const identity={nickname:finder?.nickname,id:finder?.uniqId,isExpired:user.isExpired};
 const text=document.body.innerText;
 const visibleIdentity=typeof identity.nickname==='string'&&typeof identity.id==='string'&&text.includes(identity.nickname)&&text.includes(identity.id);
 const roots=[...document.querySelectorAll('wujie-app')].map(n=>n.shadowRoot).filter(r=>r?.querySelector('.post-list'));
 if(roots.length!==1)throw Error('CHANNELS_POST_SURFACE_AMBIGUOUS');
 const root=roots[0],lists=[...root.querySelectorAll('.post-list')];
 if(lists.length!==1||!lists[0].__vue__)throw Error('CHANNELS_POST_LIST_UNVERIFIED');
 const list=lists[0].__vue__;
 const rows=[...root.querySelectorAll('.post-feed-item')].map(n=>{
  const v=n.__vue__,p=v?.post;if(!p)throw Error('CHANNELS_POST_ROW_UNVERIFIED');
  return {objectId:p.objectId,description:p.desc?.description,createTime:p.createTime,status:p.status,visibleType:p.visibleType,visibleEnums:v.VisibleType?{public:v.VisibleType.public,follow:v.VisibleType.follow,self:v.VisibleType.self}:null,isDisabled:p.disableInfo?.isDisabled,hasPosted:v.isPostHasPosted,processSuccess:v.isPostProcessSuccess,processing:v.isPostProcessing,processFailed:v.isPostProcessFail,timePublish:v.isTimePublish,memberNotVisible:v.isPostMemberNotVisiable,metrics:{readCount:p.readCount,likeCount:p.likeCount,commentCount:p.commentCount,forwardCount:p.forwardCount,favCount:p.favCount}};
 });
 return {url:location.href,identity,visibleIdentity,isPageReady:list.isPageReady,isDraftMode:list.isDraftMode,totalNum:list.totalNum,renderedRows:rows.length,rows};
}
export async function readChannelsContent({binding,id,snapshot,control,now=()=>Date.now()}){
 if(!validId(id))return fail('VIDEO_CONTENT_ID_REQUIRED',{message:'视频号需要精确字符串objectId，不按标题猜作品。'});
 const identity=s=>{
  if(s?.url!=='https://channels.weixin.qq.com/platform'||s.identity?.isExpired!==false)throw Error('CHANNELS_AUTH_OR_SURFACE_UNVERIFIED');
  if(s.identity?.id!==binding.accountId||s.identity?.nickname!==binding.accountName||s.visibleIdentity!==true)throw Error('CHANNELS_ACCOUNT_IDENTITY_MISMATCH');
  if(s.isPageReady!==true||s.isDraftMode!==false||!Array.isArray(s.rows))throw Error('CHANNELS_POST_LIST_NOT_READY');
  if(s.rows.some(r=>!validId(r?.objectId)))throw Error('CHANNELS_EXACT_CONTENT_ID_UNVERIFIED');
 };
 const find=s=>{const rows=s.rows.filter(r=>r.objectId===id);if(rows.length>1)throw Error('VIDEO_CONTENT_ID_AMBIGUOUS');return rows[0];};
 await control();const before=await snapshot();identity(before);const first=find(before);
 await control();const after=await snapshot();identity(after);const row=find(after);await control();
 if(!first&&!row)return fail('VIDEO_CONTENT_NOT_FOUND_IN_READ_WINDOW',{platformContentId:id,scannedCount:after.renderedRows,message:'仅本页已加载列表未找到，不表示作品不存在或删除，不重发。'});
 if(!first||!row||JSON.stringify([first.status,first.visibleType,first.hasPosted,first.processSuccess,first.processing,first.processFailed,first.timePublish,first.isDisabled])!==JSON.stringify([row.status,row.visibleType,row.hasPosted,row.processSuccess,row.processing,row.processFailed,row.timePublish,row.isDisabled]))return fail('CHANNELS_STATUS_CHANGED_DURING_READ');
 let state='CONTENT_FOUND_STATUS_UNKNOWN';
 if(row.isDisabled===true)state='DISABLED';
 else if(row.processFailed===true)state='PROCESS_FAILED';
 else if(row.timePublish===true)state='SCHEDULED';
 else if(row.processing===true)state='PROCESSING';
 else if(row.status===1&&row.hasPosted===true&&row.processSuccess===true&&row.isDisabled===false&&row.memberNotVisible===false){
  if(typeof row.visibleType==='number'&&typeof row.visibleEnums?.public==='number'&&row.visibleType===row.visibleEnums.public)state='PUBLISHED';
  else if(typeof row.visibleType==='number'&&typeof row.visibleEnums?.self==='number'&&row.visibleType===row.visibleEnums.self)state='PRIVATE';
  else if(typeof row.visibleType==='number'&&typeof row.visibleEnums?.follow==='number'&&row.visibleType===row.visibleEnums.follow)state='FOLLOWERS_ONLY';
 }
 const metrics=Object.fromEntries(['readCount','likeCount','commentCount','forwardCount','favCount'].map(k=>[k,typeof row.metrics?.[k]==='number'&&Number.isSafeInteger(row.metrics[k])&&row.metrics[k]>=0?row.metrics[k]:null]));
 const createTime=typeof row.createTime==='number'&&Number.isSafeInteger(row.createTime)&&row.createTime>0&&row.createTime<=8640000000000?row.createTime:null;
 return {ok:true,status:state,platformContentId:id,title:typeof row.description==='string'?row.description:'',reportedStatus:row.status??null,visibleType:row.visibleType??null,createdAt:createTime?new Date(createTime*1000).toISOString():null,metrics,metricsUpdatedAt:null,checkedAt:new Date(now()).toISOString(),readOnly:true,platformReadbackVerified:true,platformStatusVerified:state!=='CONTENT_FOUND_STATUS_UNKNOWN',publicReadbackVerified:false,statusEvidence:'existing_assistant_exact_objectId_loaded_post_state',identityVerification:'visible_name_and_finder_uniqId',identityVerifiedBeforeAndAfter:true,executionTransport:'ego_channels_native_dom',source:'existing_assistant_loaded_post_list',scannedCount:after.renderedRows,totalNum:after.totalNum??null,metricCaveat:'当前已加载后台作品数据；未刷新/请求新统计，不是公开播放页或最新平台更新时间验证。'};
}
export function buildChannelsReadScript(binding,id){
 if(!validId(id))throw Error('VIDEO_CONTENT_ID_REQUIRED');
 return `
const marker=${JSON.stringify(MARKER)};
try {
 const binding=${JSON.stringify(binding)};let task,page;
 const control=async()=>{
  const spaces=await listTaskSpaces();if(spaces.filter(s=>s.id===binding.taskSpaceId&&s.name===binding.taskSpaceName&&s.profileId===binding.egoProfileId&&s.ownership==='agent').length!==1)throw Error('CHANNELS_EXACT_AGENT_SPACE_REQUIRED');
  if(!task)task=await taskSpace(binding.taskSpaceId);if(task.name!==binding.taskSpaceName||task.ownership!=='agent')throw Error('CHANNELS_SPACE_CHANGED');
  const tabs=await task.tabs(),matches=tabs.filter(t=>t.label===binding.pageLabel&&t.targetId===binding.targetId);if(matches.length!==1)throw Error('CHANNELS_PAGE_BINDING_CHANGED');
  if(!page)page=task.page(binding.pageLabel);if(await page.url()!=='https://channels.weixin.qq.com/platform')throw Error('CHANNELS_READ_SURFACE_REQUIRED');
 };
 const snapshot=()=>page.evaluate(${channelsPageSnapshot.toString()});
 const fail=${fail.toString()},validId=${validId.toString()},read=${readChannelsContent.toString()};
 const result=await read({binding,id:${JSON.stringify(id)},snapshot,control});console.log(marker+JSON.stringify(result));
}catch(e){console.log(marker+JSON.stringify({ok:false,status:'BLOCKED',code:String(e.message),readOnly:true,platformReadbackVerified:false,platformStatusVerified:false,publicReadbackVerified:false}));}
`;
}
export async function runChannelsReadback(pkg,matrix,execute){


 if(!validId(pkg.platformContentId))return fail('VIDEO_CONTENT_ID_REQUIRED');
 let binding;try{binding=channelsBinding(pkg,matrix);}catch(e){return fail(String(e.message));}
 const r=await execute('ego-browser',['nodejs'],{input:buildChannelsReadScript(binding,pkg.platformContentId),timeoutMs:60000});
 if(r.timedOut)return fail('CHANNELS_READ_TIMEOUT');
 const lines=[r.stdout,r.stderr].flatMap(s=>String(s??'').split('\n')).filter(s=>s.startsWith(MARKER));
 if(r.code!==0||lines.length!==1)return fail('CHANNELS_READ_TRANSPORT_FAILED');
 let data;try{data=JSON.parse(lines[0].slice(MARKER.length));}catch{return fail('CHANNELS_READ_INVALID_RESULT');}
 if(!data||typeof data.ok!=='boolean'||data.readOnly!==true||data.publicReadbackVerified!==false)return fail('CHANNELS_READ_INVALID_RESULT');
 return data;
}
