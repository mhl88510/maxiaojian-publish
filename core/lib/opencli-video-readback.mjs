import {fileURLToPath} from "node:url";
import fs from 'node:fs';
import {executeEgoOpencliRead} from './ego-opencli-read-transport.mjs';
import {executeNativeCreatorReadback} from './ego-creator-readback.mjs';
import {runChannelsReadback} from './ego-channels-readback.mjs';

export const OPENCLI_ROUTE_PATH= process.env.MAXIAOJIAN_READBACK_ROUTES || fileURLToPath(new URL("../../config/readback-routes.json", import.meta.url));
const SUPPORTED=new Set(['douyin','xiaohongshu']);
const METRICS={douyin:['play_count','digg_count','comment_count','collect_count','share_count'],xiaohongshu:['views','likes','comments','collects']};
const blocked=(code,extra={})=>({ok:false,status:'BLOCKED',code,readOnly:true,platformReadbackVerified:false,platformStatusVerified:false,publicReadbackVerified:false,...extra});

export function resolveOpencliReadbackRoute(pkg,matrix,mapping){
 const t=pkg.schoolAccount||{};
 const accounts=(matrix.platforms?.[t.platform]?.accounts||[]).filter(a=>a.key===t.accountKey);
 if(accounts.length!==1)throw new Error('ACCOUNT_BINDING_REQUIRED');
 const account=accounts[0];
 const routes=(mapping.routes||[]).filter(r=>r.platform===t.platform&&r.account_key===t.accountKey);
 if(routes.length!==1)throw new Error('OPENCLI_ACCOUNT_ROUTE_REQUIRED');
 const route=routes[0];
 const native=['ego_opencli_adapter','ego_creator_native'].includes(route.transport);
 if((route.transport&&!['browser_bridge','ego_opencli_adapter','ego_creator_native'].includes(route.transport))
   ||(!native&&!route.opencli_context_id)||!route.ego_profile_id||route.account_name!==account.name
   ||(route.public_account_id&&String(route.public_account_id)!==String(account.id))
   ||(account.ego?.profileId&&account.ego.profileId!==route.ego_profile_id)
   ||(t.egoProfileId&&t.egoProfileId!==route.ego_profile_id)
   ||(t.accountName&&t.accountName!==account.name)
   ||(t.accountId&&String(t.accountId)!==String(account.id)))throw new Error('OPENCLI_ACCOUNT_ROUTE_MISMATCH');
 if(native&&(t.platform!=='douyin'||!account.ego
   ||route.task_space_id!==account.ego.taskSpaceId||route.task_space_name!==account.ego.taskSpaceName
   ||route.page_label!==account.ego.pageLabel||!route.public_account_id
   ||(t.taskSpaceId!==undefined&&t.taskSpaceId!==route.task_space_id)
   ||(t.pageLabel&&t.pageLabel!==route.page_label)))throw new Error('OPENCLI_EGO_ROUTE_MISMATCH');
 if(native&&route.target_id!==undefined&&(
   typeof route.target_id!=='string'||! /^[A-Fa-f0-9]{32}$/.test(route.target_id)
   ||account.ego?.targetId!==route.target_id
   ||(t.targetId!==undefined&&t.targetId!==route.target_id)))throw new Error('OPENCLI_EGO_ROUTE_MISMATCH');
 if(native&&t.targetId!==undefined&&route.target_id===undefined)throw new Error('OPENCLI_EGO_ROUTE_MISMATCH');
 // Douyin API UID and public Douyin number are different namespaces.
 if(t.platform==='douyin'&&!route.api_uid)throw new Error('OPENCLI_API_IDENTITY_REQUIRED');
 return route;
}
function identityMatches(identity,route){
 const name=s=>typeof s==='string'?s.normalize('NFC').replace(/\s+/g,' ').trim():'';
 return identity?.logged_in===true&&identity.site===route.platform&&name(identity.username)===name(route.account_name)
   &&(!route.api_uid||String(identity.id)===String(route.api_uid));
}
function contentId(pkg,platform){
 const id=pkg.platformContentId??pkg.awemeId??pkg.noteId;
 if(typeof id!=='string')return ''; // Numeric JSON IDs can lose precision. Never coerce them.
 return (platform==='douyin'?/^\d{15,22}$/:/^[0-9a-f]{24}$/).test(id)?id:'';
}
export async function runVideoReadback(pkg,matrix,execute,{mapping,routePath=OPENCLI_ROUTE_PATH}={}){


 const platform=pkg.schoolAccount?.platform;
 if(platform==='wechat_channels')return runChannelsReadback(pkg,matrix,execute);
 if(!SUPPORTED.has(platform))return blocked('VIDEO_READBACK_PLATFORM_UNSUPPORTED');
 const id=contentId(pkg,platform);
 if(!id)return blocked('VIDEO_CONTENT_ID_REQUIRED',{message:'传入精确字符串 platformContentId；不按标题猜作品，不把未找到解释为删除。'});
 const limit=pkg.readback?.limit??50;
 if(!Number.isInteger(limit)||limit<1||limit>200)return blocked('VIDEO_READBACK_LIMIT_INVALID');
 let route;
 try{route=resolveOpencliReadbackRoute(pkg,matrix,mapping||JSON.parse(fs.readFileSync(routePath,'utf8')));}
 catch(error){return blocked(error.code==='ENOENT'?'OPENCLI_ACCOUNT_ROUTE_REQUIRED':String(error.message));}
 if(route.readback_blocker?.code==='EGO_DEFAULT_CDP_UNRESPONSIVE')return blocked('EGO_DEFAULT_CDP_UNRESPONSIVE',{message:'原Ego Default窗口的Runtime/Target请求持续超时；暂停本号读取，不重复调用OpenCLI、不要求重登、不换号或重发。'});
 if(route.transport==='ego_creator_native'){
  try{return await executeNativeCreatorReadback(route,{id,limit,includeDetailedStats:pkg.readback?.includeDetailedStats===true},execute);}
  catch(error){return blocked(String(error.message));}
 }
 const call=async(command,args=[])=>{
  if(route.transport==='ego_opencli_adapter'){
   const kwargs=command==='stats'?{aweme_id:args[0]}:command==='videos'?{limit:Number(args[args.indexOf('--limit')+1]),status:args.includes('--status')?args[args.indexOf('--status')+1]:'all'}:{};
   try{return await executeEgoOpencliRead(route,command,kwargs,execute);}
   catch(error){error.api4=/Douyin API error 4\b/.test(error.message||'');throw error;}
  }
  const r=await execute('opencli',['--profile',route.opencli_context_id,platform,command,...args,'-f','json'],{timeoutMs:150000});
  if(r.code!==0){const e=new Error('OPENCLI_READ_FAILED');e.api4=/Douyin API error 4\b/.test(r.stderr||'');e.timeout=!!r.timedOut;throw e;}
  try{return JSON.parse(r.stdout);}catch{throw new Error('OPENCLI_INVALID_JSON');}
 };
 try{
  const before=await call('whoami');
  if(!identityMatches(before,route))return blocked('OPENCLI_ACCOUNT_IDENTITY_MISMATCH');
  const command=platform==='douyin'?'videos':'creator-notes';
  const rows=await call(command,['--limit',String(limit)]);
  if(!Array.isArray(rows))return blocked('OPENCLI_INVALID_LIST');
  const idKey=platform==='douyin'?'aweme_id':'id';
  const matches=rows.filter(r=>typeof r?.[idKey]==='string'&&r[idKey]===id);
  if(matches.length>1)return blocked('VIDEO_CONTENT_ID_AMBIGUOUS');
  let state='UNKNOWN',statusVerified=false,statusEvidence=null;
  const row=matches[0];
  if(platform==='douyin'&&row){
   // OpenCLI 1.8.6 normalizes missing status to published. An all-list row
   // alone must never establish publication; require exact-ID membership in
   // the backend's explicit published-status filter (status=1).
   if(row.status==='published'){
    const published=await call('videos',['--limit',String(limit),'--status','published']);
    if(!Array.isArray(published))return blocked('OPENCLI_INVALID_LIST');
    const found=published.filter(r=>typeof r?.aweme_id==='string'&&r.aweme_id===id);
    if(found.length>1)return blocked('VIDEO_CONTENT_ID_AMBIGUOUS');
    if(found.length===1){state='PUBLISHED';statusVerified=true;statusEvidence='opencli_videos_server_filter_published';}
   }else if(['reviewing','scheduled','private','prohibited','deleted'].includes(row.status)){
    state=row.status.toUpperCase();statusVerified=true;statusEvidence='opencli_videos_explicit_status';
   }
  }
  let detailedMetrics=null;const warnings=[];
  if(row&&platform==='douyin'&&pkg.readback?.includeDetailedStats===true){
   try{
    const values=await call('stats',[id]);
    if(!Array.isArray(values)||!values.length||values.some(v=>!v||typeof v.metric!=='string'||!v.metric
      ||!['string','number'].includes(typeof v.value))||new Set(values.map(v=>v.metric)).size!==values.length)throw new Error('OPENCLI_INVALID_DETAILED_METRICS');
    detailedMetrics=values;
   }
   catch(error){warnings.push({code:error.api4?'DOUYIN_DETAILED_METRICS_API_ERROR_4':'DOUYIN_DETAILED_METRICS_UNAVAILABLE',message:'详细分析接口未成功；基础作品列表回读独立保留，不要求重新登录或重发。'});}
  }
  const after=await call('whoami');
  if(!identityMatches(after,route)||(before.id!==after.id))return blocked('OPENCLI_ACCOUNT_CHANGED_DURING_READ');
  if(!row)return blocked('VIDEO_CONTENT_NOT_FOUND_IN_READ_WINDOW',{platformContentId:id,scannedLimit:limit,checkedAt:new Date().toISOString(),message:'仅表示本次列表窗口未找到，不能推断作品不存在或已删除；不自动重发。'});
  const metrics=Object.fromEntries(METRICS[platform].map(k=>[k,typeof row[k]==='number'&&Number.isFinite(row[k])&&row[k]>=0?row[k]:null]));
  return {ok:true,status:statusVerified?state:'CONTENT_FOUND_STATUS_UNKNOWN',platformContentId:id,title:row.title??'',
   reportedStatus:row.status??null,metrics,detailedMetrics,
   detailedMetricsSource:detailedMetrics?'opencli_douyin_stats':null,warnings,readOnly:true,
   platformReadbackVerified:true,platformStatusVerified:statusVerified,publicReadbackVerified:false,
   statusEvidence,source:'opencli_creator_list',metricSource:'opencli_normalized_list',
   metricCaveat:'列表指标由 OpenCLI 归一化；上游缺字段可能被补零，不等于独立原始指标验收。',
   identityVerification:route.api_uid?'canonical_name_and_api_uid':'canonical_name_only',
   executionTransport:route.transport||'browser_bridge',opencliContextId:route.opencli_context_id||null,
   egoProfileId:route.ego_profile_id,checkedAt:new Date().toISOString()};
 }catch(error){return blocked(error.timeout?'OPENCLI_READ_TIMEOUT':String(error.message));}
}
