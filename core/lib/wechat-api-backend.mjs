import path from 'node:path';
import fs from 'node:fs';
import {wechatOriginality, preflightWechatDeclaration} from './wechat-originality.mjs';
export {wechatDeclarationIntent, preflightWechatDeclaration} from './wechat-originality.mjs';
import {readAccountMatrix,resolveAccountMatrixPath} from './school-account.mjs';
export const WECHAT_ROOT = process.env.MAXIAOJIAN_WECHAT_ROOT || '';
function wechatBinding(pkg) {
 const rows=readAccountMatrix(resolveAccountMatrixPath()).platforms?.wechat_official?.accounts||[];
 const matches=rows.filter(a=>a.key===pkg.schoolAccount?.accountKey);
 if(matches.length!==1)throw Error('UNREGISTERED_WECHAT_API_ACCOUNT');
 const a=matches[0],b=a.wechatApi;
 if(!b||!b.alias||!Number.isSafeInteger(b.slot)||b.slot<1||!a.name)throw Error('WECHAT_API_MAPPING_REQUIRED');
 if(!WECHAT_ROOT||!fs.statSync(WECHAT_ROOT).isDirectory())throw Error('WECHAT_DEPENDENCY_ROOT_REQUIRED');
 return {...b,name:a.name};
}
// Never expose credentials in the package, command arguments, or probe output.
export function credentialProbeCode(binding) {
  return `import fs from 'node:fs';
import {loadWechatExtendConfig,resolveAccount,loadCredentials} from './skills/baoyu-post-to-wechat/scripts/wechat-extend-config.ts';
const b=${JSON.stringify(binding)};
const config=loadWechatExtendConfig();
const a=(config.accounts||[]).filter(x=>x.alias===b.alias);
if(a.length!==1||a[0].name!==b.name) throw new Error('API_ACCOUNT_CONFIG_MISMATCH');
const c=loadCredentials(resolveAccount(config,b.alias));
const values={};
for(const line of fs.readFileSync('aws.env','utf8').split(/\\r?\\n/)){
const m=line.trim().replace(/^export\\s+/,'').match(/^([^#=]+)=(.*)$/);if(m)values[m[1].trim()]=m[2].trim().replace(/^['"]|['"]$/g,'');
}
const same=c.appId===values['WECHAT_'+b.slot+'_APPID'] && c.appSecret===values['WECHAT_'+b.slot+'_APPSECRET'];
console.log(JSON.stringify({ok: same, code:same?'API_LOCAL_CROSSWALK_VERIFIED':'API_SLOT_CREDENTIAL_MISMATCH',alias:b.alias,slot:b.slot,name:b.name,remoteIdentityVerified:false}));`;
}
export function planWechat(pkg, action) {
  const binding = wechatBinding(pkg);
  if (!binding) throw new Error('UNREGISTERED_WECHAT_API_ACCOUNT');
  const script = path.join(WECHAT_ROOT, 'skills/aws-wechat-article-publish/scripts/publish.py');
  if (action === 'status' && !pkg.publishId) {
    const reader=path.join(WECHAT_ROOT,'skills/aws-wechat-article-publish/scripts/getdraft.py');
    const id=pkg.articleId||pkg.mediaId;
    if(id && (typeof id!=='string'||!/^[A-Za-z0-9_-]+$/.test(id)))throw new Error('INVALID_WECHAT_CONTENT_ID');
    const args=pkg.articleId?['article-get',pkg.articleId]:pkg.mediaId?['get',pkg.mediaId]:['published-list','-n','1'];
    args.push('--account',String(binding.slot));return {binding,command:'python3',args:[reader,...args],cwd:WECHAT_ROOT};
  }
  if (action === 'publish' || action === 'status') {
    const id = action === 'publish' ? pkg.mediaId : pkg.publishId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`${action === 'publish' ? 'mediaId' : 'publishId'} is required`);
    return { binding, command:'python3', args:[script,'--account',String(binding.slot),action,id], cwd:WECHAT_ROOT };
  }
  if (action === 'draft') {
    const articlePath = path.resolve(pkg.articlePath || '');
    if (!pkg.articlePath || !fs.statSync(articlePath).isFile()) throw new Error('articlePath must be an existing Markdown/HTML file');
    if (!['.md','.html','.htm'].includes(path.extname(articlePath).toLowerCase())) throw new Error('Unsupported article format');
    const args = [path.join(WECHAT_ROOT,'skills/baoyu-post-to-wechat/scripts/wechat-api.ts'),articlePath,'--account',binding.alias,'--keep-title'];
    if (pkg.title) args.push('--title',pkg.title);
    if (pkg.author) args.push('--author',pkg.author);
    if (pkg.summary) args.push('--summary',pkg.summary);
    if (pkg.coverPath) { const cover=path.resolve(pkg.coverPath); if(!fs.statSync(cover).isFile())throw new Error('Cover file missing'); args.push('--cover',cover); }
    return {binding,command:'bun',args,cwd:WECHAT_ROOT};
  }
  if (action !== 'check') throw new Error('Unsupported WeChat action');
  return {binding,command:'bun',args:['-e',credentialProbeCode(binding)],cwd:WECHAT_ROOT};
}
export async function runWechat(pkg, action, execute) {
  const declarationBlock=preflightWechatDeclaration(pkg,action);
  if(declarationBlock)return {...declarationBlock,backend:'wechat_api'};
  const result=await runWechatApi(pkg,action,execute);
  return {...result,originality:wechatOriginality(pkg,{reviewState:result.code==='WECHAT_ORIGINAL_REVIEW_FAILED'?'FAILED':null})};
}
async function runWechatApi(pkg, action, execute) {
  const plan=planWechat(pkg,action);
  const probe=await execute('bun',['-e',credentialProbeCode(plan.binding)],{cwd:WECHAT_ROOT});
  let check; try { check=JSON.parse(probe.stdout.trim().split(/\r?\n/).at(-1)); } catch { return {ok:false,status:'BLOCKED',code:'API_CREDENTIAL_PROBE_FAILED'}; }
  if(probe.code!==0||!check.ok) return {ok:false,status:'BLOCKED',code:check.code||'API_CREDENTIAL_PROBE_FAILED'};
  if(action==='check') return {ok:true,status:'CONFIGURED',backend:'wechat_api',...check,networkVerified:false};
  const r=await execute(plan.command,plan.args,{cwd:plan.cwd});
  const combined=r.stdout+'\n'+r.stderr;
  const e=[...combined.matchAll(/errcode['"]?\s*:\s*(\d+)/g)].find(x=>Number(x[1])!==0);
  if(r.code!==0||e) {
    const ip=combined.match(/invalid ip ([0-9.]+)/),id=combined.match(/publish_id['"]?\s*[:=]\s*['"]?([\w-]+)/);
    if(action==='publish'&&id)return {ok:false,status:'SUBMISSION_UNCERTAIN',code:'WECHAT_STATUS_UNVERIFIED',publishId:id[1],publicReadbackVerified:false};
    return {ok:false,status:'BLOCKED',code:e?.[1]==='40164'?'WECHAT_IP_WHITELIST_REQUIRED':e?'WECHAT_PLATFORM_ERROR':'WECHAT_BACKEND_FAILED',platformErrorCode:e?Number(e[1]):null,reportedExitIp:ip?.[1],backend:'wechat_api'};
  }
  // Only return parsed business IDs/status, never raw diagnostics/tokens.
  if(action==='draft') { const id=r.stdout.match(/"media_id"\s*:\s*"([\w-]+)"/); return {ok:!!id,status:id?'DRAFT_CREATED':'RESULT_UNVERIFIED',mediaId:id?.[1],backend:'wechat_api'}; }
  if(action==='publish') { const id=r.stdout.match(/publish_id[:=]\s*([\w-]+)/);return {ok:!!id,status:id?'SUBMITTED':'RESULT_UNVERIFIED',publishId:id?.[1],backend:'wechat_api',publicReadbackVerified:false}; }
  let status;try{const start=r.stdout.indexOf('{');status=JSON.parse(r.stdout.slice(start));}catch{}
  if(action==='status'&&!pkg.publishId){
    const exact=!!(pkg.articleId||pkg.mediaId);
    const valid=!!status && (!status.errcode||status.errcode===0) && (exact?Array.isArray(status.news_item)&&status.news_item.length>0:Array.isArray(status.item)&&Number.isSafeInteger(status.total_count));
    const articles=(status?.news_item||[]).map(x=>({...x,articleId:pkg.articleId,mediaId:pkg.mediaId}))
      .concat((status?.item||[]).flatMap(item=>(item.content?.news_item||[]).map((x,index)=>({...x,articleId:item.article_id,index,updatedAt:item.update_time}))));
    return {ok:valid,status:valid?'API_READ_VERIFIED':'RESULT_UNVERIFIED',backend:'wechat_api',networkVerified:valid,
      readOnly:true,platformReadbackVerified:valid,platformStatusVerified:valid&&!!pkg.articleId,
      statusEvidence:valid&&pkg.articleId?'wechat_freepublish_get_formal_article':null,
      source:pkg.articleId?'wechat_freepublish_get':pkg.mediaId?'wechat_draft_get':'wechat_freepublish_batchget',
      executionTransport:'wechat_official_api',checkedAt:new Date().toISOString(),
      identityVerification:'fixed_alias_slot_local_credential_crosswalk',remoteIdentityVerified:false,
      totalCount:status?.total_count,articleId:pkg.articleId,mediaId:pkg.mediaId,
      articles:valid?articles.map(x=>({title:x.title,digest:x.digest,url:x.url,articleId:x.articleId,mediaId:x.mediaId,index:x.index,updatedAt:x.updatedAt,originalityStatus:'UNKNOWN',originalityVerified:false})):[],
      metrics:null,metricsUpdatedAt:null,publicReadbackVerified:false};
  }
  const common={backend:'wechat_api',readOnly:true,publicReadbackVerified:false};
  if(!status||typeof status!=='object'||Array.isArray(status))return {...common,ok:false,status:'RESULT_UNVERIFIED'};
  if(status.errcode!==undefined&&status.errcode!==0)return {...common,ok:false,status:'BLOCKED',code:'WECHAT_PLATFORM_ERROR',platformErrorCode:status.errcode};
  const outcomes={0:['PUBLISHED',null,true],1:['PUBLISHING',null,true],2:['FAILED','WECHAT_ORIGINAL_REVIEW_FAILED',false],3:['FAILED','WECHAT_PUBLISH_FAILED',false],4:['REJECTED','WECHAT_REVIEW_REJECTED',false],5:['DELETED','WECHAT_ARTICLE_DELETED',false],6:['BANNED','WECHAT_ARTICLE_BANNED',false]};
  const n=status.publish_status,outcome=Number.isInteger(n)?outcomes[n]:null;
  if(!outcome)return {...common,ok:false,status:'RESULT_UNVERIFIED',code:'WECHAT_PUBLISH_STATUS_UNKNOWN',platformStatus:n};
  return {...common,ok:outcome[2],status:outcome[0],code:outcome[1],platformStatus:n,articleId:status.article_id,articleDetail:status.article_detail,platformStatusVerified:true};
}
