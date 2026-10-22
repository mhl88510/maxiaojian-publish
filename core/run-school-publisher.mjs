#!/usr/bin/env node
import {claimToutiaoGeoJuniorManagementResume,isPinnedToutiaoGeoJuniorManagementResumeRoute} from './lib/toutiao-legacy-continuation-a.mjs';
import {isToutiaoOptionsResume} from './lib/toutiao-options-resume.mjs';
import {claimToutiaoManagementPreflightResume,isPinnedToutiaoManagementPreflightResumeRoute} from './lib/toutiao-management-preflight-resume.mjs';
import {claimToutiaoGeoMilitaryManagementResume,isPinnedToutiaoGeoMilitaryManagementResumeRoute} from './lib/toutiao-legacy-continuation-b.mjs';
import {claimWeiboPreflightResume} from './lib/weibo-preflight-resume.mjs';
import {runChannelsExistingBlobResume} from './lib/channels-existing-blob-resume.mjs';
import {claimChannelsReadySourceProofPublishResume} from './lib/channels-ready-source-proof-resume.mjs';
import {claimDouyinPristinePreflightResume} from './lib/douyin-preflight-resume.mjs';
import {claimDouyinPersonalInspectFailureResume,writeDouyinPersonalInspectFailureResumeResult,DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_TYPE} from './lib/douyin-personal-inspect-failure-resume.mjs';
import {summarizeDouyinPersonalInspectResumeFailure} from './lib/douyin-personal-inspect-failure-diagnostics.mjs';
import {runDouyinPersonalInspectOnly} from './lib/douyin-personal-inspect-only.mjs';
import {createDouyinPersonalDispatchIdentityContinuation,douyinPersonalBeforeUploadIdentityPaths,createDouyinPersonalBeforeUploadIdentityContinuation,writeDouyinPersonalBeforeUploadIdentityResult,douyinPersonalPostResultLockedInitPathFailurePaths,runDouyinPersonalPostResultSurfaceRecovery,createDouyinPersonalPostResultDraftContinuation,writeDouyinPersonalPostResultDraftContinuationResult,createDouyinPersonalPostResultInitFailureContinuation,writeDouyinPersonalPostResultInitFailureContinuationResult,createDouyinPersonalPostResultLockedInitFailureContinuation,writeDouyinPersonalPostResultLockedInitFailureContinuationResult,createDouyinPersonalPostResultLockedInitPathFailureContinuation,writeDouyinPersonalPostResultLockedInitPathFailureContinuationResult,douyinPersonalPostResultLockedInitFailurePaths,DOUYIN_PERSONAL_POST_RESULT_DRAFT_TYPE,DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_TYPE,DOUYIN_PERSONAL_POST_RESULT_PIN} from './lib/douyin-personal-post-result-recovery.mjs';
import {claimDouyinPreparationScopeResume,claimDouyinKnownNoUploadSurfaceResume,releaseDouyinPreparationScopeResumeClaim} from './lib/douyin-preparation-scope-resume.mjs';
import {prepareDouyinInputMissingResumeContext,createDouyinInputMissingResumeClaim,writeDouyinInputMissingResumeResult,cleanupDouyinInputMissingResumeContext} from './lib/douyin-input-missing-resume.mjs';
import {prepareDouyinWindowBindingResumeContext,assertDouyinWindowBindingFreshProof,createDouyinWindowBindingResumeClaim,writeDouyinWindowBindingResumeResult,releaseDouyinWindowBindingResumeClaim,assertDouyinWindowBindingPreparedResult,DOUYIN_WINDOW_BINDING_RESUME_TYPE,DOUYIN_WINDOW_BINDING_RESUME_ENV} from './lib/douyin-window-binding-resume.mjs';
import {claimChannelsPreflightResume} from './lib/channels-preflight-resume.mjs';
import {runXhsEmptyInputResume} from './lib/xhs-empty-input-resume.mjs';
import {isKnownSohuPreExecuteRejection,isKnownSohuUploadedCoverBlock} from './lib/sohu-pre-execute-recovery.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readAccountMatrix,resolveAccountMatrixPath,resolveSchoolAccountBinding,schoolAccountStateRoot} from './lib/school-account.mjs';
import {buildIdentity} from './v2/lib/identity.mjs';
import {readPackage} from './lib/content-package.mjs';
import {runSchoolAccount,runEgoPreflight} from './run-school-account.mjs';
import {runWechat,preflightWechatDeclaration} from './lib/wechat-api-backend.mjs';
import {FORM_HOSTS,runEgoForm} from './lib/ego-form-backend.mjs';
import {SAU_CAPABILITIES,runSau} from './lib/sau-backend.mjs';
import {claimRightsPreflightResume} from './lib/video-rights-preflight-resume.mjs';
import {runVideoDraftResume} from './lib/video-draft-resume.mjs';
import {runVideoRelease} from './lib/video-release-backend.mjs';
import {registryTarget,resolveArticleContract,assertArticleMutationAllowed} from './lib/article-contracts.mjs';
import {runArticleReadback} from './lib/article-readback.mjs';
import {runArticleManagement} from './lib/article-management-readback.mjs';
import {runNativeArticle,validateSohuNativeVisualReview} from './lib/native-article-backend.mjs';
import {runWeiboText} from './lib/weibo-native-text.mjs';
import {runBaijiahaoTrial,isBaijiahaoSavedCoverResume,isBaijiahaoKnownViewportRejection} from './lib/baijiahao-native-trial.mjs';
import {assessBaijiahaoContent} from './lib/baijiahao-content-policy.mjs';
import {runVideoReadback} from './lib/opencli-video-readback.mjs';
import {validatePersonalDouyinWriteAdmission} from './lib/personal-write-admission.mjs';
export const SCOPE_PATH= process.env.MAXIAOJIAN_PLATFORM_SCOPE || fileURLToPath(new URL("../config/platform-scope.json", import.meta.url));
const VIDEO_PLATFORMS=new Set(['douyin','xiaohongshu','wechat_channels','bilibili','youtube']);
export function execute(command,args,{cwd,input,timeoutMs=180000,env}={}) {
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd,env:env||process.env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  child.on('error',error=>{clearTimeout(timer);reject(error);});child.stdin.on('error',()=>{});
  let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},timeoutMs);
  child.on('close',code=>{clearTimeout(timer);resolve({code:timedOut?124:code??1,stdout,stderr,timedOut});});child.stdin.end(input||'');
 });
}
export function parseArgs(argv) {
 if(argv.length===1&&argv[0]==='--list')return {list:true};
 if(argv[0]==='--account-status') {
  if(argv.length!==3)throw new Error('Usage: school-publisher --account-status <platform> <accountKey>');
  return {accountStatus:true,platform:argv[1],accountKey:argv[2]};
 }
 let action='check',file=null,executeWrites=false,rights=false,preparedState='',resumePreflightReceipt='',resumePostResultInitFailure='',resumePostResultLockedInitFailure='',resumePostResultLockedInitPathFailure='',resumePostResultBeforeUploadIdentityFailure='',resumePostResultDispatchIdentityFailure='';
 for(let i=0;i<argv.length;i++){
  const a=argv[i];if(a==='--resume-post-result-dispatch-identity-failure'){if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('--resume-post-result-dispatch-identity-failure requires a path');resumePostResultDispatchIdentityFailure=path.resolve(argv[++i]);}else if(a==='--resume-post-result-before-upload-identity-failure'){if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('--resume-post-result-before-upload-identity-failure requires a path');resumePostResultBeforeUploadIdentityFailure=path.resolve(argv[++i]);}else if(a==='--resume-preflight-receipt'){if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('--resume-preflight-receipt requires a path');resumePreflightReceipt=path.resolve(argv[++i]);}else if(a==='--resume-post-result-init-failure'){if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('--resume-post-result-init-failure requires a path');resumePostResultInitFailure=path.resolve(argv[++i]);}else if(a==='--resume-post-result-locked-init-failure'){if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('--resume-post-result-locked-init-failure requires a path');resumePostResultLockedInitFailure=path.resolve(argv[++i]);}else if(a==='--resume-post-result-locked-init-path-failure'){if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('--resume-post-result-locked-init-path-failure requires a path');resumePostResultLockedInitPathFailure=path.resolve(argv[++i]);}else if(a==='--action'){if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('--action requires a value');action=argv[++i];}else if(a==='--prepared-state'){if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('--prepared-state requires a path');preparedState=path.resolve(argv[++i]);}else if(a==='--execute')executeWrites=true;
  else if(a==='--confirm-original-rights')rights=true;else if(a.startsWith('--'))throw new Error('Unknown option '+a);
  else if(!file)file=path.resolve(a);else throw new Error('Only one package is accepted');
 }
 if(!file||!['check','draft','publish','status','inspect-only','surface-recovery'].includes(action))throw new Error('Usage: school-publisher <package.json> [--action check|draft|publish|status|inspect-only|surface-recovery] [--resume-preflight-receipt <path>] [--resume-post-result-init-failure <path>] [--resume-post-result-locked-init-failure <path>] [--resume-post-result-locked-init-path-failure <path>] [--resume-post-result-before-upload-identity-failure <path>] [--resume-post-result-dispatch-identity-failure <path>] [--execute]');
 if([resumePostResultInitFailure,resumePostResultLockedInitFailure,resumePostResultLockedInitPathFailure,resumePostResultBeforeUploadIdentityFailure,resumePostResultDispatchIdentityFailure].filter(Boolean).length>1)throw new Error('Only one post-result continuation may be selected');
 return {file,action,executeWrites,rights,preparedState,resumePreflightReceipt,resumePostResultInitFailure,resumePostResultLockedInitFailure,resumePostResultLockedInitPathFailure,resumePostResultBeforeUploadIdentityFailure,resumePostResultDispatchIdentityFailure};
}
export function accountFor(pkg,matrix) {
 const t=pkg.schoolAccount||{};const a=(matrix.platforms?.[t.platform]?.accounts||[]).filter(x=>x.key===t.accountKey);
 if(a.length!==1)throw new Error('ACCOUNT_BINDING_REQUIRED: '+(t.platform||'?')+'/'+(t.accountKey||'?'));
 if(t.accountName&&t.accountName!==a[0].name)throw new Error('ACCOUNT_NAME_MISMATCH');
 if(t.accountId&&String(t.accountId)!==String(a[0].id||''))throw new Error('ACCOUNT_ID_MISMATCH');
 return a[0];
}
export function fingerprintPackage(pkg) {
 const hash=crypto.createHash('sha256');
 const content={title:pkg.title||'',body:pkg.body||'',mediaId:pkg.mediaId||'',contentType:pkg.contentType||'',topics:pkg.topics||pkg.douyinTopics||[]};
 hash.update(JSON.stringify(content));
 const streamHash=(file,into)=>{const fd=fs.openSync(file,'r'),buf=Buffer.allocUnsafe(65536);try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null))>0)into.update(buf.subarray(0,n));}finally{fs.closeSync(fd);}return into;};
 for(const k of ['articlePath','videoPath','coverPath','douyinPortraitCoverPath','douyinLandscapeCoverPath'])if(pkg[k])streamHash(pkg[k],hash);
 const legacyKey=hash.digest('hex');
 const {schoolAccount,backend,pageContract,publicUrl,...payload}=pkg;
 const assets=new Map();
 const canonical=(value,key='')=>{
  if(typeof value==='string'&&value&&(/Path$/.test(key)||['images','imagesPaths'].includes(key))){
   const file=path.resolve(value);if(!assets.has(file))assets.set(file,{sha256:streamHash(file,crypto.createHash('sha256')).digest('hex'),size:fs.statSync(file).size});return assets.get(file);
  }
  if(Array.isArray(value))return value.map(x=>canonical(x,key));
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k],k)]));
  return value;
 };
 const contentHash=crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
 return {legacyKey,contentHash};
}
export function reserve(pkg,action,stateBase) {
 const t=pkg.schoolAccount,{legacyKey,contentHash}=fingerprintPackage(pkg);
 const safe=s=>{if(!/^[a-zA-Z0-9_-]+$/.test(s||''))throw new Error('Unsafe account/platform key');return s;};
 const dir=path.join(stateBase,safe(t.platform),safe(t.accountKey));fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const legacyPath=path.join(dir,action+'-'+legacyKey+'.json');
 if(fs.existsSync(legacyPath))return {duplicate:true,statePath:legacyPath};
 const statePath=path.join(dir,action+'-v2-'+contentHash+'.json');
 try {fs.writeFileSync(statePath,JSON.stringify({status:'SUBMISSION_RESERVED',platform:t.platform,accountKey:t.accountKey,action,contentHash,at:new Date().toISOString()}),{flag:'wx',mode:0o600});}
 catch(e){if(e.code==='EEXIST')return {duplicate:true,statePath};throw e;}
 return {statePath,contentHash,action,fingerprintVersion:2};
}
const DOUYIN_INPUT_MISSING_RESUME_ENV='EXCLUDED_CASE_INPUT';
const DOUYIN_INPUT_MISSING_TYPE='EXCLUDED_CASE_INPUT';
const DOUYIN_WINDOW_BINDING_PUBLISH_TYPE='EXCLUDED_CASE_WINDOW';
const DOUYIN_WINDOW_BINDING_RESULT_ENV='EXCLUDED_CASE_WINDOW';
function deniedCase(){throw Error('BUSINESS_CASE_CONTINUATION_EXCLUDED');}
const claimDouyinInputMissingResume=()=>null,claimDouyinWindowBindingResume=()=>null,
 finalizeDouyinWindowBindingResume=deniedCase,unusedPreparedArticleResume=deniedCase,
 unusedPreparedResume=deniedCase;

function preparedResumeError(code,message){const e=new Error(message);e.code=code;return e;}
function writePreparedResumeReceipt(reservation,record) {
 const tmpPath=path.join(path.dirname(reservation.resumeResultPath),'.receipt-'+reservation.claimToken+'.tmp');let fd;
 try{
  if(fs.readFileSync(reservation.statePath,'utf8')!==reservation.priorRaw)throw preparedResumeError('PREPARED_STATE_RECEIPT_CHANGED','Original prepared-state receipt changed while the native resume was running.');
  if(reservation.managementReceiptGuard&&fs.readFileSync(reservation.managementReceiptGuard.path,'utf8')!==reservation.managementReceiptGuard.raw)throw preparedResumeError('PREPARED_STATE_RECEIPT_CHANGED','The original Sohu management-readback receipt changed while the native resume was running.');
  fd=fs.openSync(tmpPath,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(record,null,2)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  if(fs.existsSync(reservation.resumeResultPath))throw preparedResumeError('PREPARED_STATE_RESUME_ALREADY_COMPLETED','A continuation result already exists for this job.');
  fs.linkSync(tmpPath,reservation.resumeResultPath);
  try{fs.unlinkSync(tmpPath);}catch{}
 }catch(error){
  if(fd!==undefined)try{fs.closeSync(fd);}catch{}
  try{fs.unlinkSync(tmpPath);}catch{}
  throw error;
 }
}
function releasePreparedResumeClaim(reservation) {
 if(reservation.preserveClaimMarker===true)return;
 try{
  const claim=JSON.parse(fs.readFileSync(reservation.claimPath,'utf8'));
  if(claim.token===reservation.claimToken)fs.unlinkSync(reservation.claimPath);
 }catch{}
}

export function claimPreparedSohuResume(pkg,action,stateBase,preparedState,matrix) {
 const t=pkg.schoolAccount||{};
 if(!['sohu','toutiao'].includes(t.platform)||action!=='publish'||(pkg.backend&&pkg.backend!=='ego_article'))throw preparedResumeError('PREPARED_STATE_RESUME_NOT_ALLOWED','Only typed pre-submit native article receipts may continue.');
 for(const key of [t.platform,t.accountKey])if(!/^[a-zA-Z0-9_-]+$/.test(key||''))throw Error('PREPARED_STATE_PATH_MISMATCH');
 const {contentHash}=fingerprintPackage(pkg),statePath=path.resolve(preparedState||''),expected=path.resolve(stateBase,t.platform,t.accountKey,'publish-v2-'+contentHash+'.json');
 if(statePath!==expected)throw Error('PREPARED_STATE_PATH_MISMATCH');
 const stat=fs.lstatSync(statePath);if(!stat.isFile()||stat.isSymbolicLink())throw Error('PREPARED_STATE_RECEIPT_INVALID');
 const priorRaw=fs.readFileSync(statePath,'utf8'),priorReceipt=JSON.parse(priorRaw);
 if(priorReceipt.ok!==false||priorReceipt.status!=='PREPARATION_BLOCKED'||!['content-preparation','visual-review'].includes(priorReceipt.stage)||priorReceipt.submitted!==false||priorReceipt.submitAttempted!==false||priorReceipt.publicationPerformed===true||priorReceipt.contentHash!==contentHash||priorReceipt.fingerprintVersion!==2||priorReceipt.action!==action||priorReceipt.platform!==t.platform||priorReceipt.accountKey!==t.accountKey||priorReceipt.backend!=='ego_article')throw Error('PREPARED_STATE_RESUME_INELIGIBLE');
 const visualReview=priorReceipt.stage==='visual-review'?validateSohuNativeVisualReview({pkg,matrix,statePath,priorRaw,priorReceipt}):null;
 const resumeResultPath=statePath+'.resume-result.json',claimPath=statePath+'.resume-claim',claimToken=crypto.randomBytes(16).toString('hex');
 if(fs.existsSync(resumeResultPath))throw Error('PREPARED_STATE_RESUME_ALREADY_COMPLETED');
 const fd=fs.openSync(claimPath,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({token:claimToken,contentHash,action,at:new Date().toISOString()}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{if(fs.readFileSync(statePath,'utf8')!==priorRaw||fs.existsSync(resumeResultPath))throw Error('PREPARED_STATE_RECEIPT_CHANGED');}catch(e){fs.unlinkSync(claimPath);throw e;}
 return {statePath,resumeResultPath,claimPath,claimToken,contentHash,action,fingerprintVersion:2,resume:true,priorReceipt,priorRaw,visualReview};
}

async function dispatchInternal(argv,deps) {
 const o=parseArgs(argv);
 if(Object.entries(o).some(([key,value])=>key.startsWith('resumePostResult')&&value)||['surface-recovery','inspect-only'].includes(o.action))throw Error('BUSINESS_CASE_CONTINUATION_EXCLUDED');
 const matrix=deps.matrix||readAccountMatrix(resolveAccountMatrixPath());
 if(o.list){const scope=JSON.parse(fs.readFileSync(deps.scopePath||SCOPE_PATH,'utf8'));return {ok:true,status:'CAPABILITY_LIST',platforms:scope.platforms.map(p=>({...p,accounts:matrix.platforms?.[p.key]?.accounts||[],sauCapabilities:SAU_CAPABILITIES[p.key]||[],requiresAccountBinding:!matrix.platforms?.[p.key]?.accounts?.length})),note:scope.note};}
 if(o.accountStatus){
  const target={platform:o.platform,accountKey:o.accountKey},account=accountFor({schoolAccount:target},matrix);
  if(FORM_HOSTS[o.platform]&&o.platform!=='zhihu'){
   const result=await (deps.runArticleManagement||runArticleManagement)({schoolAccount:target},matrix,deps.execute||execute);
   return {...result,platform:o.platform,accountKey:account.key,accountName:account.name,backend:'ego_article',uploadVerified:false};
  }
  const binding=resolveSchoolAccountBinding(target,matrix);
  const result=await (deps.runAccountPreflight||runEgoPreflight)(binding);
  return {...result,status:result.ok?'LOGIN_IDENTITY_VERIFIED':'BLOCKED',platform:o.platform,accountKey:account.key,accountName:account.name,accountId:binding.accountId,egoProfileId:binding.egoProfileId,readOnly:true,uploadVerified:false,publicReadbackVerified:false};
 }
 let pkg=JSON.parse(fs.readFileSync(o.file,'utf8'));
 if(pkg.platform&&!pkg.schoolAccount?.platform)throw new Error('Use schoolAccount.platform, not a second ambiguous platform');
 const account=accountFor(pkg,matrix),platform=pkg.schoolAccount.platform;
 if(o.action==='surface-recovery'){
  if(!o.executeWrites||platform!=='douyin'||account.key!=='reserved_personal_route'||(pkg.backend||'ego_video')!=='ego_video'){
   return {ok:false,status:'BLOCKED',code:'DOUYIN_PERSONAL_POST_RESULT_SURFACE_SCOPE_REJECTED',platform,accountKey:account.key,action:o.action,readOnly:true,contentWriteEnabled:false,uploadAttempted:false,draftCreated:false,publicationPerformed:false,finalPublishClicked:false};
  }
  const stateBase=deps.stateBase||path.join(os.homedir(),'.maxiaojian-publish','jobs');
  const nativeStateBase=deps.douyinResumeOptions?.nativeStateBase||deps.videoDependencies?.nativeStateBase||path.join(os.homedir(),'.maxiaojian-publish','school-accounts');
  const result=await (deps.runDouyinPersonalPostResultSurfaceRecovery||runDouyinPersonalPostResultSurfaceRecovery)(
   {file:o.file,pkg,matrix,o,stateBase,nativeStateBase,execute:deps.execute||execute},
   {readPackage,buildIdentity,acquireLock:deps.acquirePublisherLock,publisherLockDirectory:deps.publisherLockDirectory,...(deps.postResultSurfaceDependencies||{})},
  );
  return {...result,platform,accountKey:account.key,accountName:account.name,backend:'ego_video',action:o.action,readOnly:true,contentWriteEnabled:false};
 }
 if(o.action==='inspect-only'){
  if(o.executeWrites||o.rights||o.preparedState||platform!=='douyin'||account.key!=='reserved_personal_route'||(pkg.backend||'ego_video')!=='ego_video'||!o.resumePreflightReceipt){
   return {ok:false,status:'BLOCKED',code:'DOUYIN_PERSONAL_INSPECT_ONLY_SCOPE_REJECTED',platform,accountKey:account.key,action:o.action,readOnly:true,publicationPerformed:false,uploadAttempted:false,draftCreated:false,fieldsEdited:false,finalPublishClicked:false};
  }
  const stateBase=deps.stateBase||path.join(os.homedir(),'.maxiaojian-publish','jobs');
  const nativeStateBase=deps.douyinResumeOptions?.nativeStateBase||deps.videoDependencies?.nativeStateBase||path.join(os.homedir(),'.maxiaojian-publish','school-accounts');
  const result=await (deps.runDouyinPersonalInspectOnly||runDouyinPersonalInspectOnly)(
   {file:o.file,pkg,matrix,o,stateBase,nativeStateBase,execute:deps.execute||execute},
   {fingerprintPackage:deps.fingerprintPackage||fingerprintPackage,...(deps.inspectOnlyDependencies||{})},
  );
  return {...result,platform,accountKey:account.key,accountName:account.name,backend:'ego_video',action:'inspect-only',readOnly:true};
 }
 if(o.resumePostResultInitFailure){
  const expectedOldResult=path.join(os.homedir(),'.maxiaojian-publish','personal-post-result-recovery',`${DOUYIN_PERSONAL_POST_RESULT_PIN.jobId}-${DOUYIN_PERSONAL_POST_RESULT_PIN.priorResultSha256.slice(0,20)}.draft.result.json`);
  const exactArgs=argv.length===6&&argv[0]===DOUYIN_PERSONAL_POST_RESULT_PIN.packagePath
   &&argv[1]==='--action'&&argv[2]==='draft'&&argv[3]==='--execute'
   &&argv[4]==='--resume-post-result-init-failure'&&path.resolve(argv[5]||'')===path.resolve(expectedOldResult);
  if(!exactArgs||o.file!==DOUYIN_PERSONAL_POST_RESULT_PIN.packagePath||path.resolve(o.resumePostResultInitFailure)!==path.resolve(expectedOldResult)
      ||o.action!=='draft'||!o.executeWrites||o.rights||o.preparedState||o.resumePreflightReceipt
      ||platform!=='douyin'||account.key!=='reserved_personal_route'||(pkg.backend||'ego_video')!=='ego_video'){
   return {ok:false,status:'BLOCKED',code:'DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_SCOPE_REJECTED',platform,accountKey:account.key,action:o.action,readOnly:true,publicationPerformed:false,finalPublishClicked:false};
  }
 }
 if(o.resumePostResultLockedInitFailure){
  const expectedPriorFailureResult=path.join(os.homedir(),'.maxiaojian-publish','personal-post-result-recovery',`${DOUYIN_PERSONAL_POST_RESULT_PIN.jobId}-${DOUYIN_PERSONAL_POST_RESULT_PIN.priorResultSha256.slice(0,20)}.draft.init-failure.result.json`);
  const exactArgs=argv.length===6&&argv[0]===DOUYIN_PERSONAL_POST_RESULT_PIN.packagePath
   &&argv[1]==='--action'&&argv[2]==='draft'&&argv[3]==='--execute'
   &&argv[4]==='--resume-post-result-locked-init-failure'&&path.resolve(argv[5]||'')===path.resolve(expectedPriorFailureResult);
  if(!exactArgs||o.file!==DOUYIN_PERSONAL_POST_RESULT_PIN.packagePath||path.resolve(o.resumePostResultLockedInitFailure)!==path.resolve(expectedPriorFailureResult)
      ||o.action!=='draft'||!o.executeWrites||o.rights||o.preparedState||o.resumePreflightReceipt||o.resumePostResultInitFailure
      ||platform!=='douyin'||account.key!=='reserved_personal_route'||(pkg.backend||'ego_video')!=='ego_video'){
   return {ok:false,status:'BLOCKED',code:'DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_FAILURE_SCOPE_REJECTED',platform,accountKey:account.key,action:o.action,readOnly:true,publicationPerformed:false,finalPublishClicked:false};
  }
 }
 if(o.resumePostResultLockedInitPathFailure){
  const recoveryRoot=path.join(os.homedir(),'.maxiaojian-publish','personal-post-result-recovery');
  const expectedPriorFailureResult=douyinPersonalPostResultLockedInitFailurePaths(recoveryRoot,DOUYIN_PERSONAL_POST_RESULT_PIN).resultPath;
  const exactArgs=argv.length===6&&argv[0]===DOUYIN_PERSONAL_POST_RESULT_PIN.packagePath
   &&argv[1]==='--action'&&argv[2]==='draft'&&argv[3]==='--execute'
   &&argv[4]==='--resume-post-result-locked-init-path-failure'&&path.resolve(argv[5]||'')===path.resolve(expectedPriorFailureResult);
  if(!exactArgs||o.file!==DOUYIN_PERSONAL_POST_RESULT_PIN.packagePath
      ||path.resolve(o.resumePostResultLockedInitPathFailure)!==path.resolve(expectedPriorFailureResult)
      ||o.action!=='draft'||!o.executeWrites||o.rights||o.preparedState||o.resumePreflightReceipt
      ||o.resumePostResultInitFailure||o.resumePostResultLockedInitFailure
      ||platform!=='douyin'||account.key!=='reserved_personal_route'||(pkg.backend||'ego_video')!=='ego_video'){
   return {ok:false,status:'BLOCKED',code:'DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_SCOPE_REJECTED',platform,accountKey:account.key,action:o.action,readOnly:true,publicationPerformed:false,finalPublishClicked:false};
  }
 }
 let personalDouyinAdmission=null;
 if(account.key==='reserved_personal_route'&&['draft','publish'].includes(o.action)){
  const checked=deps.personalDouyinAdmission
   ?(deps.validatePersonalDouyinWriteAdmission||validatePersonalDouyinWriteAdmission)({admission:deps.personalDouyinAdmission,packagePath:o.file,pkg,action:o.action,account})
   :{ok:false,code:'PERSONAL_DOUYIN_ROUTE_READ_ONLY_ONLY'};
  if(!checked.ok)return {
   ok:false,status:'BLOCKED',code:checked.code||'PERSONAL_DOUYIN_ROUTE_READ_ONLY_ONLY',platform,accountKey:account.key,
   accountName:account.name,readOnly:true,contentWriteEnabled:false,uploadVerified:false,draftCreated:false,
   publicationPerformed:false,publicReadbackVerified:false,contentReviewVerified:false,
   message:'个人抖音写入必须携带同一封存包的复核适配凭据、只读身份绑定和新鲜 Ego 原生身份预检；缺一项均不写入。',
  };
  personalDouyinAdmission=deps.personalDouyinAdmission;
 }
 if(o.resumePostResultBeforeUploadIdentityFailure){
  const expected=douyinPersonalPostResultLockedInitPathFailurePaths(path.join(os.homedir(),'.maxiaojian-publish','personal-post-result-recovery'),DOUYIN_PERSONAL_POST_RESULT_PIN).resultPath;
  const exact=argv.length===6&&argv[0]===DOUYIN_PERSONAL_POST_RESULT_PIN.packagePath&&argv[1]==='--action'&&argv[2]==='draft'&&argv[3]==='--execute'&&argv[4]==='--resume-post-result-before-upload-identity-failure'&&path.resolve(argv[5]||'')===expected;
  if(!exact||o.action!=='draft'||!o.executeWrites||o.rights||o.preparedState||o.resumePreflightReceipt||platform!=='douyin'||account.key!=='reserved_personal_route'||pkg.backend!=='ego_video')return {ok:false,status:'BLOCKED',code:'DOUYIN_PERSONAL_BEFORE_UPLOAD_SCOPE_REJECTED',publicationPerformed:false,readOnly:true};
 }
 if(o.resumePostResultDispatchIdentityFailure){
  const expected=douyinPersonalBeforeUploadIdentityPaths(path.join(os.homedir(),'.maxiaojian-publish','personal-post-result-recovery'),DOUYIN_PERSONAL_POST_RESULT_PIN).resultPath;
  const exact=argv.length===6&&argv[0]===DOUYIN_PERSONAL_POST_RESULT_PIN.packagePath&&argv[1]==='--action'&&argv[2]==='draft'&&argv[3]==='--execute'&&argv[4]==='--resume-post-result-dispatch-identity-failure'&&path.resolve(argv[5]||'')===expected;
  if(!exact||o.action!=='draft'||!o.executeWrites||o.rights||o.preparedState||o.resumePreflightReceipt||platform!=='douyin'||account.key!=='reserved_personal_route'||pkg.backend!=='ego_video')return {ok:false,status:'BLOCKED',code:'DOUYIN_PERSONAL_DISPATCH_SCOPE_REJECTED',publicationPerformed:false,readOnly:true};
 }
 let personalDouyinPostResultDraftContinuation=null;
 let personalDouyinPostResultInitFailureContinuation=null;
 let personalDouyinPostResultLockedInitFailureContinuation=null;
 let personalDouyinPostResultLockedInitPathFailureContinuation=null;
 if(platform==='douyin'&&account.key==='reserved_personal_route'&&o.action==='draft'&&o.preparedState){
  try{
   const stateBase=deps.stateBase||path.join(os.homedir(),'.maxiaojian-publish','jobs');
   const nativeStateBase=deps.douyinResumeOptions?.nativeStateBase||deps.videoDependencies?.nativeStateBase||path.join(os.homedir(),'.maxiaojian-publish','school-accounts');
   personalDouyinPostResultDraftContinuation=await (deps.createDouyinPersonalPostResultDraftContinuation||createDouyinPersonalPostResultDraftContinuation)(
    {surfaceResultPath:o.preparedState,matrix,outerStateBase:stateBase,nativeStateBase},
    {pkg,readPackage,buildIdentity,...(deps.postResultSurfaceDependencies||{})},
   );
  }catch(error){
   return {ok:false,status:'BLOCKED',code:error?.code||'DOUYIN_PERSONAL_POST_RESULT_DRAFT_PREPARE_REJECTED',platform,accountKey:account.key,accountName:account.name,action:o.action,preparedState:o.preparedState,readOnly:true,publicationPerformed:false,finalPublishClicked:false,contentWriteEnabled:false,message:String(error?.message||error).slice(0,300)};
  }
 }
 if(platform!=='wechat_official')pkg=registryTarget(pkg,account);
 const backend=pkg.backend|| (platform==='wechat_official'?'wechat_api':FORM_HOSTS[platform]?'ego_article':VIDEO_PLATFORMS.has(platform)?'ego_video':'sau');
 if(['draft','publish'].includes(o.action)&&!o.executeWrites)return {ok:false,status:'EXECUTION_OPT_IN_REQUIRED',platform,accountKey:account.key,backend,action:o.action};
 if(o.resumePostResultInitFailure){
  try{
   const stateBase=deps.stateBase||path.join(os.homedir(),'.maxiaojian-publish','jobs');
   const nativeStateBase=deps.douyinResumeOptions?.nativeStateBase||deps.videoDependencies?.nativeStateBase||path.join(os.homedir(),'.maxiaojian-publish','school-accounts');
   personalDouyinPostResultInitFailureContinuation=await (deps.createDouyinPersonalPostResultInitFailureContinuation||createDouyinPersonalPostResultInitFailureContinuation)(
    {oldResultPath:o.resumePostResultInitFailure,packagePath:o.file,pkg,matrix,outerStateBase:stateBase,nativeStateBase},
    {readPackage,buildIdentity,...(deps.postResultSurfaceDependencies||{})},
   );
   personalDouyinPostResultDraftContinuation=personalDouyinPostResultInitFailureContinuation.legacyContinuation;
  }catch(error){
   return {ok:false,status:'BLOCKED',code:error?.code||'DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_PREPARE_REJECTED',platform,accountKey:account.key,accountName:account.name,action:o.action,readOnly:true,publicationPerformed:false,finalPublishClicked:false,contentWriteEnabled:false,message:String(error?.message||error).slice(0,300)};
  }
 }
 if(o.resumePostResultLockedInitFailure){
  try{
   const stateBase=deps.stateBase||path.join(os.homedir(),'.maxiaojian-publish','jobs');
   const nativeStateBase=deps.douyinResumeOptions?.nativeStateBase||deps.videoDependencies?.nativeStateBase||path.join(os.homedir(),'.maxiaojian-publish','school-accounts');
   personalDouyinPostResultLockedInitFailureContinuation=await (deps.createDouyinPersonalPostResultLockedInitFailureContinuation||createDouyinPersonalPostResultLockedInitFailureContinuation)(
    {oldResultPath:o.resumePostResultLockedInitFailure,packagePath:o.file,pkg,matrix,outerStateBase:stateBase,nativeStateBase},
    {readPackage,buildIdentity,...(deps.postResultSurfaceDependencies||{})},
   );
   personalDouyinPostResultDraftContinuation=personalDouyinPostResultLockedInitFailureContinuation.legacyContinuation;
  }catch(error){
   return {ok:false,status:'BLOCKED',code:error?.code||'DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_FAILURE_PREPARE_REJECTED',platform,accountKey:account.key,accountName:account.name,action:o.action,readOnly:true,publicationPerformed:false,finalPublishClicked:false,contentWriteEnabled:false,message:String(error?.message||error).slice(0,300)};
  }
 }
 if(o.resumePostResultLockedInitPathFailure){
  try{
   const stateBase=deps.stateBase||path.join(os.homedir(),'.maxiaojian-publish','jobs');
   const nativeStateBase=deps.douyinResumeOptions?.nativeStateBase||deps.videoDependencies?.nativeStateBase||path.join(os.homedir(),'.maxiaojian-publish','school-accounts');
   personalDouyinPostResultLockedInitPathFailureContinuation=await (deps.createDouyinPersonalPostResultLockedInitPathFailureContinuation||createDouyinPersonalPostResultLockedInitPathFailureContinuation)(
    {oldResultPath:o.resumePostResultLockedInitPathFailure,packagePath:o.file,pkg,matrix,outerStateBase:stateBase,nativeStateBase},
    {readPackage,buildIdentity,...(deps.postResultSurfaceDependencies||{})},
   );
   personalDouyinPostResultDraftContinuation=personalDouyinPostResultLockedInitPathFailureContinuation.legacyContinuation;
  }catch(error){
   return {ok:false,status:'BLOCKED',code:error?.code||'DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_PREPARE_REJECTED',platform,accountKey:account.key,accountName:account.name,action:o.action,readOnly:true,publicationPerformed:false,finalPublishClicked:false,contentWriteEnabled:false,message:String(error?.message||error).slice(0,300)};
  }
 }
 if(o.resumePostResultBeforeUploadIdentityFailure){
  try {
   personalDouyinPostResultDraftContinuation=await (deps.createDouyinPersonalBeforeUploadIdentityContinuation||createDouyinPersonalBeforeUploadIdentityContinuation)({
    oldResultPath:o.resumePostResultBeforeUploadIdentityFailure,packagePath:o.file,matrix,
    outerStateBase:deps.stateBase||path.join(os.homedir(),'.maxiaojian-publish','jobs'),
    nativeStateBase:deps.douyinResumeOptions?.nativeStateBase||deps.videoDependencies?.nativeStateBase||path.join(os.homedir(),'.maxiaojian-publish','school-accounts')},deps.postResultSurfaceDependencies||{});
  } catch(error) { return {ok:false,status:'BLOCKED',code:error.code||'DOUYIN_PERSONAL_BEFORE_UPLOAD_PREPARE_REJECTED',message:String(error.message).slice(0,300),publicationPerformed:false,readOnly:true}; }
 }
 if(o.resumePostResultDispatchIdentityFailure){
  try {
   personalDouyinPostResultDraftContinuation=await (deps.createDouyinPersonalDispatchIdentityContinuation||createDouyinPersonalDispatchIdentityContinuation)({
    oldResultPath:o.resumePostResultDispatchIdentityFailure,packagePath:o.file,matrix,
    outerStateBase:deps.stateBase||path.join(os.homedir(),'.maxiaojian-publish','jobs'),
    nativeStateBase:deps.douyinResumeOptions?.nativeStateBase||deps.videoDependencies?.nativeStateBase||path.join(os.homedir(),'.maxiaojian-publish','school-accounts')},deps.postResultSurfaceDependencies||{});
  } catch(error) { return {ok:false,status:'BLOCKED',code:error.code||'DOUYIN_PERSONAL_DISPATCH_PREPARE_REJECTED',message:String(error.message).slice(0,300),publicationPerformed:false,readOnly:true}; }
 }
 if(platform==='wechat_official'){
  const declarationBlock=preflightWechatDeclaration(pkg,o.action);
  if(declarationBlock)return {...declarationBlock,platform,accountKey:account.key,accountName:account.name,backend,readOnly:true};
  if(backend!=='wechat_api')return {ok:false,status:'BLOCKED',code:'WECHAT_API_BACKEND_REQUIRED',platform,accountKey:account.key,backend,readOnly:true,publicationPerformed:false};
 }
 if(platform==='baijiahao'&&['check','draft','publish'].includes(o.action)){
  const policy=assessBaijiahaoContent(pkg);
  if(!policy.ok||o.action==='check')return {...policy,platform,accountKey:account.key,accountName:account.name,backend,readOnly:true,publicationPerformed:false,accountStatusChecked:false,formPreflightVerified:false};
 }
 if(['draft','publish'].includes(o.action)&&backend==='ego_article'&&['baijiahao','netease'].includes(platform)&&!(platform==='baijiahao'&&pkg.nativeTrialContract?.version===1)){
  const current=await (deps.runArticleManagement||runArticleManagement)(pkg,matrix,deps.execute||execute);
  return {...current,ok:false,status:current.ok?'BLOCKED':current.status,code:current.ok?'ARTICLE_WRITE_PATH_NOT_VERIFIED':current.code,platform,accountKey:account.key,accountName:account.name,backend,readOnly:true};
 }
 if(backend==='ego_video'&&o.action==='draft'&&['xiaohongshu','bilibili','wechat_channels'].includes(platform)&&!o.rights)return {ok:false,code:'ORIGINAL_RIGHTS_CONFIRMATION_REQUIRED',platform,accountKey:account.key,backend,readOnly:true,publicationPerformed:false,message:'草稿准备需显式权利确认；此检查发生在预约和浏览器操作前，不设置平台原创。'};
 if(backend==='ego_video'&&o.action==='draft'&&o.preparedState&&!personalDouyinPostResultDraftContinuation){
  const resumeRunner=platform==='wechat_channels'?(deps.runChannelsExistingBlobResume||runChannelsExistingBlobResume):platform==='xiaohongshu'?(deps.runXhsEmptyInputResume||runXhsEmptyInputResume):(deps.runVideoDraftResume||runVideoDraftResume);
  const result=await resumeRunner(o.file,o.preparedState,matrix,deps.execute||execute,deps.videoResumeOptions||{});
  return {...result,platform,accountKey:account.key,accountName:account.name,backend};
 }
 let reservation;
 if(['draft','publish'].includes(o.action)){
  const stateBase=deps.stateBase||path.join(os.homedir(),'.maxiaojian-publish','jobs');
  if(o.resumePreflightReceipt&&!personalDouyinPostResultDraftContinuation){
   try{
    if(platform==='douyin'&&backend==='ego_video'&&o.action==='draft'&&account.key==='reserved_personal_route'){
     reservation=await claimDouyinPersonalInspectFailureResume(pkg,o,stateBase,fingerprintPackage,matrix,{nativeStateBase:deps.douyinResumeOptions?.nativeStateBase||deps.videoDependencies?.nativeStateBase});
    }
    if(reservation){}
    else if(platform==='douyin'&&backend==='ego_video'&&o.action==='draft'){
     reservation=await claimDouyinWindowBindingResume({file:o.file,pkg,matrix,o,deps,stateBase,execute:deps.execute||execute});
    }
    if(reservation){}
    else if(platform==='douyin'&&backend==='ego_video'&&o.action==='draft'){
     reservation=await claimDouyinInputMissingResume({file:o.file,pkg,matrix,o,deps,stateBase,execute:deps.execute||execute});
    }
    if(reservation){}
    else if(platform==='douyin'&&backend==='ego_video'&&o.action==='draft'){
     reservation=null; // Historical single-job surface exception is not a generic retry.
    }
    if(reservation){}
    else if(platform==='wechat_channels')reservation=await claimChannelsPreflightResume(pkg,o,stateBase,fingerprintPackage,matrix,deps.channelsResumeOptions||{});
    else if(platform==='douyin'&&backend==='ego_video'&&o.action==='draft'){
     const nativeStateBase=deps.douyinResumeOptions?.nativeStateBase||deps.videoDependencies?.nativeStateBase;
     const priorScopeResult=`${path.resolve(o.resumePreflightReceipt)}.resume-result.json`;
     // The initial pristine-resume receipt remains handled by the original
     // contract. Only its exact already-produced result can enter this narrower
     // same-job, pre-upload scope recovery.
     reservation=fs.existsSync(priorScopeResult)
      ?await claimDouyinPreparationScopeResume(pkg,o,stateBase,fingerprintPackage,matrix,{nativeStateBase})
      :await claimDouyinPristinePreflightResume(pkg,o,stateBase,fingerprintPackage,matrix,{nativeStateBase});
    }else if(platform==='toutiao'&&backend==='ego_article'&&o.action==='publish'&&isPinnedToutiaoGeoJuniorManagementResumeRoute(o.file,o.resumePreflightReceipt)){
     reservation=await (deps.claimToutiaoGeoJuniorManagementResume||claimToutiaoGeoJuniorManagementResume)({pkg,o,argv,packagePath:o.file,stateBase,matrix,fingerprintPackage});
    }else if(platform==='toutiao'&&backend==='ego_article'&&o.action==='publish'&&isPinnedToutiaoGeoMilitaryManagementResumeRoute(o.file,o.resumePreflightReceipt)){
     reservation=await (deps.claimToutiaoGeoMilitaryManagementResume||claimToutiaoGeoMilitaryManagementResume)({pkg,o,argv,packagePath:o.file,stateBase,matrix,fingerprintPackage});
    }else if(platform==='toutiao'&&backend==='ego_article'&&o.action==='publish'&&isPinnedToutiaoManagementPreflightResumeRoute(o.file,o.resumePreflightReceipt)){
     reservation=await (deps.claimToutiaoManagementPreflightResume||claimToutiaoManagementPreflightResume)({pkg,o,argv,packagePath:o.file,stateBase,matrix,fingerprintPackage});
    }else if(platform==='weibo'&&backend==='ego_weibo_text')reservation=claimWeiboPreflightResume(pkg,o,stateBase,fingerprintPackage);
    else reservation=claimRightsPreflightResume(pkg,o,stateBase,fingerprintPackage);
   }
   catch(error){return {ok:false,status:'BLOCKED',code:error.code||'PREFLIGHT_RESUME_REJECTED',message:error.message,readOnly:true,publicationPerformed:false};}
  }else if(!personalDouyinPostResultDraftContinuation&&(platform==='sohu'||platform==='toutiao'||(platform==='baijiahao'&&pkg.nativeTrialContract?.version===1))&&o.preparedState){
   try{reservation=claimPreparedSohuResume(pkg,o.action,stateBase,o.preparedState,matrix);}
   catch(error){return {ok:false,status:'BLOCKED',code:error.code||'PREPARED_STATE_RESUME_REJECTED',platform,accountKey:account.key,accountName:account.name,backend,action:o.action,receiptPath:o.preparedState,publicationPerformed:false,readOnly:true,message:String(error.message)};}
  }else if(!personalDouyinPostResultDraftContinuation&&platform==='douyin'&&backend==='ego_video'&&o.action==='publish'&&o.preparedState&&path.resolve(o.preparedState).endsWith('.window-binding-resume.result.json')){
   try{
    const suffix='.window-binding-resume.result.json',sidecar=path.resolve(o.preparedState);
    if(!sidecar.endsWith(suffix))throw preparedResumeError('DOUYIN_WINDOW_BINDING_PREPARED_RESULT_PATH_INVALID','Final release requires the exact hash-bound PREPARED migration sidecar.');
    const nativeStatePath=sidecar.slice(0,-suffix.length);
    const preparedContext=await (deps.assertDouyinWindowBindingPreparedResult||assertDouyinWindowBindingPreparedResult)({
     resultPath:sidecar,packagePath:path.resolve(o.file),statePath:nativeStatePath,
     outerReceiptPath:'EXCLUDED_CASE_DATA',matrix,
    });
    if(preparedContext?.ok!==true||preparedContext.status!=='PREPARED'||preparedContext.resultPath!==sidecar
     ||preparedContext.statePath!==nativeStatePath||preparedContext.publicationPerformed!==false
     ||preparedContext.executionBinding?.spaceId!==3||preparedContext.executionBinding?.targetId!=='EXCLUDED_CASE_FINGERPRINT')
     throw preparedResumeError('DOUYIN_WINDOW_BINDING_PREPARED_CONTEXT_INVALID','The exact typed PREPARED migration result did not verify.');
    reservation={resumeType:DOUYIN_WINDOW_BINDING_PUBLISH_TYPE,nativeStatePath,windowBindingPrepared:preparedContext};
   }catch(error){return {ok:false,status:'BLOCKED',code:error.code||'DOUYIN_WINDOW_BINDING_PREPARED_RESULT_REJECTED',message:String(error.message||error),publicationPerformed:false,readOnly:true};}
  }else if(!personalDouyinPostResultDraftContinuation) {
   reservation=reserve(pkg,o.action,stateBase);
   if(reservation.duplicate&&platform==='wechat_channels'&&o.action==='publish'&&o.preparedState){
    try{reservation=await claimChannelsReadySourceProofPublishResume(o.file,pkg,o.action,stateBase,o.preparedState,matrix,fingerprintPackage,deps.videoResumeOptions?.stateBase);}
    catch(error){return {ok:false,status:'DUPLICATE_OR_UNCERTAIN_SUBMISSION',code:error.code||'CHANNELS_READY_SOURCE_PUBLISH_RESUME_REJECTED',message:String(error.message),platform,accountKey:account.key,accountName:account.name,backend,action:o.action,receiptPath:reservation.statePath,publicationPerformed:false,readOnly:true};}
   }
  }
  if(reservation?.duplicate)return {ok:false,status:'DUPLICATE_OR_UNCERTAIN_SUBMISSION',receiptPath:reservation.statePath,message:'先回读已有内容，不换后端重发。'};
 }
 let result;
 try{
  if(backend==='ego_weibo_text'&&platform==='weibo')result=await (deps.runWeiboText||runWeiboText)(pkg,account,o.action,deps.execute||execute);
  else if(backend==='wechat_api'&&platform==='wechat_official')result=await (deps.runWechat||runWechat)(pkg,o.action,deps.execute||execute);
  else if(backend==='ego_article'&&FORM_HOSTS[platform]){
   if(o.action==='status'&&pkg.publicUrl)result=await (deps.runArticleReadback||runArticleReadback)(pkg,matrix,deps.execute||execute);
   else if(o.action==='status'&&platform!=='zhihu')result=await (deps.runArticleManagement||runArticleManagement)(pkg,matrix,deps.execute||execute);
   else if(platform==='baijiahao'&&pkg.nativeTrialContract?.version===1)result=await (deps.runBaijiahaoTrial||runBaijiahaoTrial)(pkg,matrix,o.action,deps.execute||execute,{resumePreparation:reservation?.resume&&!reservation.pristineBaijiahaoRouteRetry?{receiptPath:reservation.statePath,priorReceipt:reservation.priorReceipt,baijiahaoCoverUploadTimeoutRecovery:reservation.baijiahaoCoverUploadTimeoutRecovery===true,nativeDraftProof:reservation.nativeDraftProof||null}:null});
   else if(['sohu','toutiao'].includes(platform)){
    const nativeArticle=deps.runNativeArticle||runNativeArticle;
    const hasSohuInlineImages=(Array.isArray(pkg.inlineImages)&&pkg.inlineImages.length>0)||(Array.isArray(pkg.images)&&pkg.images.length>0)||(Array.isArray(pkg.studio?.articleImages?.references)&&pkg.studio.articleImages.references.length>0);
    const reviewReceiptPath=reservation?.visualReview?reservation.statePath:reservation?.resume?reservation.resumeResultPath:reservation?.statePath;
    const nativeVisualReviewBasePath=reviewReceiptPath&&platform==='sohu'&&o.action==='publish'&&hasSohuInlineImages?`${reviewReceiptPath}.native-visual-review`:null;
    result=reservation?.zeroImageNoCoverEvidence
     ?await nativeArticle(pkg,matrix,o.action,deps.execute||execute,{zeroImageNoCoverEvidence:reservation.zeroImageNoCoverEvidence})
     :reservation?.resume&&!reservation.managementPrereadResume
     ?await nativeArticle(pkg,matrix,o.action,deps.execute||execute,{nativeVisualReviewBasePath,resumePreparation:{receiptPath:reservation.statePath,priorReceipt:JSON.parse(JSON.stringify(reservation.priorReceipt)),...(reservation.toutiaoOptionsResume?{toutiaoOptionsResume:true}:{}),...(reservation.toutiaoDraftResume?{toutiaoDraftResume:true,contentHash:reservation.contentHash,toutiaoRecoveryReceipt:reservation.toutiaoResumeRecovery||null}:{}),...(reservation.toutiaoNoCoverResume?{toutiaoNoCoverResume:true,baselineIds:reservation.baselineIds,baselineIdsKnown:reservation.baselineIdsKnown===true,baselineInventoryPath:reservation.baselineInventoryPath,baselineInventorySha256:reservation.baselineInventorySha256}:{}),...(reservation.visualReview?{resumeExistingCount:reservation.visualReview.resumeExistingCount,visualReviewProofPath:reservation.visualReview.proofPath,baselineIds:reservation.visualReview.baselineIds,baselineIdsKnown:true}: {})}})
     :nativeVisualReviewBasePath
      ?await nativeArticle(pkg,matrix,o.action,deps.execute||execute,{nativeVisualReviewBasePath})
      :await nativeArticle(pkg,matrix,o.action,deps.execute||execute);
   }
   else {pkg=await (deps.resolveArticleContract||resolveArticleContract)(pkg,o.action,deps.execute||execute);assertArticleMutationAllowed(pkg,account,o.action);result=await (deps.runEgoForm||runEgoForm)(pkg,matrix,o.action,deps.execute||execute);}
  }
  else if(backend==='ego_video'&&VIDEO_PLATFORMS.has(platform)){
   if(o.action==='publish')result=await (deps.runVideoRelease||runVideoRelease)(o.file,
    reservation?.resumeType===DOUYIN_WINDOW_BINDING_PUBLISH_TYPE?reservation.nativeStatePath:o.preparedState,
    matrix,deps.execute||execute,
    reservation?.resumeType===DOUYIN_WINDOW_BINDING_PUBLISH_TYPE?{douyinWindowBindingPrepared:reservation.windowBindingPrepared,preflight:deps.videoReleasePreflight}:reservation?.resumeType==='channels_ready_source_proof'?{channelsReadySourceProofResume:reservation,sourceStateBase:deps.videoResumeOptions?.stateBase}:personalDouyinAdmission?{personalDouyinAdmission}:{});
   else if(o.action==='status')result=await (deps.runVideoReadback||runVideoReadback)(pkg,matrix,deps.execute||execute,deps.videoReadbackOptions||{});
   else result=await (deps.runVideo||runSchoolAccount)([o.file,...(o.action==='draft'?['--prepare-draft']:[]),...(o.rights?['--confirm-original-rights']:[])],{...(deps.videoDependencies||{}),...(personalDouyinAdmission?{personalDouyinAdmission}:{}),...(personalDouyinPostResultDraftContinuation?{douyinPersonalPostResultDraftContinuation:personalDouyinPostResultDraftContinuation,nativeStateBase:personalDouyinPostResultDraftContinuation.nativeStateBase,fingerprintPackage}:{}),...(personalDouyinPostResultInitFailureContinuation?{douyinPersonalPostResultInitFailureContinuation:personalDouyinPostResultInitFailureContinuation}:{}),...(personalDouyinPostResultLockedInitFailureContinuation?{douyinPersonalPostResultLockedInitFailureContinuation:personalDouyinPostResultLockedInitFailureContinuation}:{}),...(personalDouyinPostResultLockedInitPathFailureContinuation?{douyinPersonalPostResultLockedInitPathFailureContinuation:personalDouyinPostResultLockedInitPathFailureContinuation}:{}),...(reservation?.channelsContract?{channelsPreflightResume:reservation.channelsContract}:{}),...(reservation?.douyinPreflightContract?{douyinPreflightResume:reservation.douyinPreflightContract,nativeStateBase:reservation.nativeStateBase,fingerprintPackage}:{}),...(reservation?.resumeType===DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_TYPE?{douyinPersonalInspectFailureResume:reservation.personalInspectFailureResumeContract,nativeStateBase:reservation.personalInspectFailureResumeContract.nativeStateBase,fingerprintPackage}:{}),...(['douyin_preparation_scope_error_first_upload','douyin_preparation_scope_manage_inspect_first_upload','douyin_preparation_scope_known_no_upload_first_attempt'].includes(reservation?.resumeType)?{douyinPreparationScopeResume:reservation.douyinPreparationScopeResumeContract,nativeStateBase:reservation.douyinPreparationScopeResumeContract.nativeStateBase,fingerprintPackage}:{}),...(reservation?.resumeType===DOUYIN_INPUT_MISSING_TYPE?{douyinInputMissingResume:reservation.inputMissingContext.contract,nativeStateBase:reservation.inputMissingContext.contract.stateBase,fingerprintPackage}:{}),...(reservation?.resumeType===DOUYIN_WINDOW_BINDING_RESUME_TYPE?{douyinWindowBindingResume:reservation.windowBindingContext.contract,nativeStateBase:reservation.windowBindingContext.nativeStateBase,fingerprintPackage}: {})});
  } else if(backend==='sau')result=await (deps.runSau||runSau)(pkg);
  else result={ok:false,status:'BLOCKED',code:'PLATFORM_BACKEND_NOT_IMPLEMENTED'};
 }catch(error){result={ok:false,status:['draft','publish'].includes(o.action)?'SUBMISSION_UNCERTAIN':'BLOCKED',code:'BACKEND_ERROR',message:String(error.message)};}
 result={...result,platform,accountKey:account.key,accountName:account.name,backend};
 if(personalDouyinPostResultDraftContinuation?.beforeUploadIdentityRecovery){
  try {
   const finalized=(deps.writeDouyinPersonalBeforeUploadIdentityResult||writeDouyinPersonalBeforeUploadIdentityResult)(personalDouyinPostResultDraftContinuation,result,deps.postResultSurfaceDependencies||{});
   result={...result,...finalized,douyinPersonalBeforeUploadIdentityResultPath:finalized.resultPath,publicationPerformed:false};
  } catch(error) { result={...result,ok:false,status:'BLOCKED',code:error.code||'DOUYIN_PERSONAL_BEFORE_UPLOAD_RESULT_WRITE_FAILED',message:String(error.message).slice(0,300),attemptRetained:true,publicationPerformed:false}; }
 }else if(personalDouyinPostResultLockedInitPathFailureContinuation){
  try{
   const finalized=(deps.writeDouyinPersonalPostResultLockedInitPathFailureContinuationResult||writeDouyinPersonalPostResultLockedInitPathFailureContinuationResult)(personalDouyinPostResultLockedInitPathFailureContinuation,result,deps.postResultSurfaceDependencies||{});
   result={...result,...finalized,douyinPersonalPostResultLockedInitPathFailureContinuationResultPath:finalized.resultPath,publicationPerformed:false,finalPublishClicked:finalized.finalPublishClicked??null};
  }catch(error){
   result={...result,ok:false,status:'BLOCKED',code:error?.code||'DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_RESULT_WRITE_FAILED',message:String(error?.message||error).slice(0,300),attemptRetained:true,publicationPerformed:false,finalPublishClicked:false};
  }
 }else if(personalDouyinPostResultLockedInitFailureContinuation){
  try{
   const finalized=(deps.writeDouyinPersonalPostResultLockedInitFailureContinuationResult||writeDouyinPersonalPostResultLockedInitFailureContinuationResult)(personalDouyinPostResultLockedInitFailureContinuation,result,deps.postResultSurfaceDependencies||{});
   result={...result,...finalized,douyinPersonalPostResultLockedInitFailureContinuationResultPath:finalized.resultPath,publicationPerformed:false,finalPublishClicked:finalized.finalPublishClicked??null};
  }catch(error){
   result={...result,ok:false,status:'BLOCKED',code:error?.code||'DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_FAILURE_RESULT_WRITE_FAILED',message:String(error?.message||error).slice(0,300),attemptRetained:true,publicationPerformed:false,finalPublishClicked:false};
  }
 }else if(personalDouyinPostResultInitFailureContinuation){
  try{
   const finalized=(deps.writeDouyinPersonalPostResultInitFailureContinuationResult||writeDouyinPersonalPostResultInitFailureContinuationResult)(personalDouyinPostResultInitFailureContinuation,result,deps.postResultSurfaceDependencies||{});
   result={...result,...finalized,douyinPersonalPostResultInitFailureContinuationResultPath:finalized.resultPath,publicationPerformed:false,finalPublishClicked:finalized.finalPublishClicked??null};
  }catch(error){
   result={...result,ok:false,status:'BLOCKED',code:error?.code||'DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_RESULT_WRITE_FAILED',message:String(error?.message||error).slice(0,300),attemptRetained:true,publicationPerformed:false,finalPublishClicked:false};
  }
 }else if(personalDouyinPostResultDraftContinuation){
  try{
   const finalized=(deps.writeDouyinPersonalPostResultDraftContinuationResult||writeDouyinPersonalPostResultDraftContinuationResult)(personalDouyinPostResultDraftContinuation,result);
   result={...result,...finalized,douyinPersonalPostResultDraftContinuationResultPath:finalized.resultPath,publicationPerformed:false,finalPublishClicked:finalized.finalPublishClicked??null};
  }catch(error){
   result={...result,ok:false,status:'BLOCKED',code:error?.code||'DOUYIN_PERSONAL_POST_RESULT_DRAFT_RESULT_WRITE_FAILED',message:String(error?.message||error).slice(0,300),claimRetained:true,publicationPerformed:false,finalPublishClicked:false};
  }
 }else if(reservation?.resumeType===DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_TYPE){
  try{
   const finalized=writeDouyinPersonalInspectFailureResumeResult(reservation,result);
   result={...result,douyinPersonalInspectFailureResumeResultPath:finalized.resultPath,originalReceiptPath:reservation.personalInspectFailureResumeContract.receiptPath,preparedStatePath:reservation.personalInspectFailureResumeContract.statePath,publicationPerformed:false,finalPublishClicked:false};
  }catch(error){
   const diagnostic=summarizeDouyinPersonalInspectResumeFailure(result,error);
   result={...result,ok:false,status:'BLOCKED',code:error?.code||'DOUYIN_PERSONAL_INSPECT_RESUME_RESULT_WRITE_FAILED',message:String(error?.message||error).slice(0,300),recoveryDiagnostic:diagnostic,claimRetained:true,publicationPerformed:false,finalPublishClicked:false};
  }
 }else if(reservation?.resumeType===DOUYIN_INPUT_MISSING_TYPE){
  try{
   const context=reservation.inputMissingContext;
   const outer=reservation.outerReceipt;
   if(fs.readFileSync(outer.path,'utf8')!==outer.raw||digest(fs.readFileSync(outer.path,'utf8'))!==outer.sha256)throw preparedResumeError('DOUYIN_INPUT_MISSING_OUTER_RECEIPT_CHANGED','The original outer receipt changed while the same-job continuation was running.');
   const sanitized={
    ok:result.ok===true,
    status:String(result.status||(result.ok===true?'DRAFT_PREPARATION_COMPLETE':'DRAFT_PREPARATION_NOT_READY')).slice(0,100),
    ...(result.ok===true?{}:{code:String(result.preparationFailure?.code||result.code||'DOUYIN_INPUT_MISSING_V2_NOT_READY').slice(0,120)}),
    jobId:context.contract.jobId,
    fingerprint:context.contract.fingerprint,
    preparedStatePath:context.statePath,
    publicationPerformed:false,
    reuploaded:false,
   };
   result.douyinInputMissingResumeResultPath=writeDouyinInputMissingResumeResult(context,reservation.inputMissingClaimInfo,sanitized);
   result.preparedStatePath=context.statePath;
   result.receiptPath=outer.path;
   result.readOnlyAdmission=false;
   result.publicationPerformed=false;
  }catch(error){
   result={...result,ok:false,status:'BLOCKED',code:error?.code||'DOUYIN_INPUT_MISSING_RESULT_WRITE_FAILED',message:String(error?.message||'DOUYIN_INPUT_MISSING_RESULT_WRITE_FAILED').slice(0,300),publicationPerformed:false};
  }finally{cleanupDouyinInputMissingResumeContext(reservation.inputMissingContext);}
 }else if(reservation?.resumeType===DOUYIN_WINDOW_BINDING_RESUME_TYPE){
  try{
   const finalized=await finalizeDouyinWindowBindingResume(reservation,result,{...(deps.douyinWindowBindingResumeAdapter||{}),matrix});
   result={...result,douyinWindowBindingResumeStatus:finalized.status,douyinWindowBindingResumeResultPath:finalized.resultPath||null,claimReleased:finalized.claimReleased===true,claimRetained:finalized.claimRetained===true,publicationPerformed:false};
   if(finalized.status==='PREPARED'){
    result.preparedStatePath=reservation.windowBindingContext.contract.statePath;
    result.receiptPath=reservation.windowBindingContext.contract.outerReceipt.path;
    result.readOnlyAdmission=false;
   }
  }catch(error){
   result={...result,ok:false,status:'DRAFT_PREPARATION_NOT_READY',code:error?.code||'DOUYIN_WINDOW_BINDING_FINALIZE_FAILED',message:String(error?.message||error).slice(0,300),claimRetained:true,publicationPerformed:false};
  }
 }else if(['douyin_preparation_scope_manage_inspect_first_upload','douyin_preparation_scope_known_no_upload_first_attempt'].includes(reservation?.resumeType)){
  // This mode is a one-shot, typed continuation from the exact persisted manage-page
  // inspect. Keep its result beside native state; never overwrite the original
  // outer pristine-resume result or leave a generic retry receipt.
  let saved=false;
  try{
   const nativePath=path.resolve(reservation.nativePath||'');
   const scopeResultPath=path.resolve(reservation.scopeResultPath||'');
   const claimPath=path.resolve(reservation.claimPath||reservation.scopeClaimPath||'');
   if(!nativePath||nativePath===path.resolve('.')||scopeResultPath!==`${nativePath}.scope-resume-result.json`||claimPath!==`${nativePath}.scope-resume-claim`)throw Object.assign(new Error('DOUYIN_SCOPE_RESUME_RESULT_PATH_INVALID'),{code:'DOUYIN_SCOPE_RESUME_RESULT_PATH_INVALID'});
   const claimStat=fs.lstatSync(claimPath);
   if(!claimStat.isFile()||claimStat.isSymbolicLink())throw Object.assign(new Error('DOUYIN_SCOPE_RESUME_CLAIM_INVALID'),{code:'DOUYIN_SCOPE_RESUME_CLAIM_INVALID'});
   const claim=JSON.parse(fs.readFileSync(claimPath,'utf8'));
   if(claim.token!==reservation.claimToken||claim.platform!=='douyin'||claim.jobId!==reservation.jobId||claim.fingerprint!==reservation.fingerprint||claim.contentHash!==reservation.contentHash||claim.receiptSha256!==reservation.receiptSha256||claim.outerResultSha256!==reservation.outerResultSha256||claim.stateSha256!==(reservation.originalStateSha256||reservation.stateSha256))throw Object.assign(new Error('DOUYIN_SCOPE_RESUME_CLAIM_MISMATCH'),{code:'DOUYIN_SCOPE_RESUME_CLAIM_MISMATCH'});
   if(reservation.resumeType==='douyin_preparation_scope_known_no_upload_first_attempt'
      &&digest(fs.readFileSync(reservation.receiptPath,'utf8'))!==reservation.receiptSha256)throw Object.assign(new Error('DOUYIN_KNOWN_PREUPLOAD_OUTER_RECEIPT_CHANGED'),{code:'DOUYIN_KNOWN_PREUPLOAD_OUTER_RECEIPT_CHANGED'});
   let state=null;try{const stat=fs.lstatSync(nativePath);if(stat.isFile()&&!stat.isSymbolicLink())state=JSON.parse(fs.readFileSync(nativePath,'utf8'));}catch{}
   const failure=result.preparationFailure&&typeof result.preparationFailure==='object'?result.preparationFailure:null;
   const lastEvidencePath=typeof failure?.lastEvidencePath==='string'?failure.lastEvidencePath:(typeof state?.platforms?.douyin?.lastEvidencePath==='string'?state.platforms.douyin.lastEvidencePath:null);
   let lastEvidenceSha256=null;
   if(lastEvidencePath){try{const resolvedEvidence=path.resolve(lastEvidencePath),evidenceRoot=`${path.dirname(nativePath)}${path.sep}evidence${path.sep}`;if(resolvedEvidence.startsWith(evidenceRoot)){const stat=fs.lstatSync(resolvedEvidence);if(stat.isFile()&&!stat.isSymbolicLink())lastEvidenceSha256=crypto.createHash('sha256').update(fs.readFileSync(resolvedEvidence)).digest('hex');}}catch{}}
   const record={
    schemaVersion:1,
    mode:reservation.mode,
    platform:'douyin',
    accountKey:account.key,
    contentHash:reservation.contentHash,
    fingerprint:reservation.fingerprint,
    jobId:reservation.jobId,
    ok:result.ok===true,
    status:result.ok===true?(result.status||'DRAFT_PREPARATION_COMPLETE'):'DOUYIN_SCOPE_RESUME_BLOCKED_BEFORE_UPLOAD',
    stage:String(failure?.stage|| (result.ok===true?'complete':'execution')).slice(0,80),
    code:String(failure?.code||result.code|| (result.ok===true?'':'DOUYIN_SCOPE_RESUME_EXECUTION_NOT_READY')).slice(0,120),
    message:String(failure?.reason||result.message||'').slice(0,400),
    detail:failure?.detail&&typeof failure.detail==='object'?failure.detail:(typeof failure?.detail==='string'?failure.detail.slice(0,400):null),
    lastEvidencePath,
    lastEvidenceSha256,
    originalStateSha256:reservation.originalStateSha256||reservation.stateSha256,
    originalBackupSha256:reservation.backupSha256,
    receiptSha256:reservation.receiptSha256,
    outerResultSha256:reservation.outerResultSha256,
    at:new Date().toISOString(),
   };
   const fd=fs.openSync(scopeResultPath,'wx',0o600);
   try{fs.writeFileSync(fd,JSON.stringify(record,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   saved=true;
   result.scopeResultPath=scopeResultPath;
   result.receiptPath=scopeResultPath;
   result.preparedStateReceiptPath=reservation.receiptPath;
   result.scopeResultStatus=record.status;
   releaseDouyinPreparationScopeResumeClaim(reservation);
  }catch(error){
   result={...result,ok:false,status:'BLOCKED',code:error?.code||'DOUYIN_SCOPE_RESUME_RESULT_WRITE_FAILED',message:String(error?.message||'DOUYIN_SCOPE_RESUME_RESULT_WRITE_FAILED').slice(0,300),scopeResultPath:reservation.scopeResultPath||null};
   if(saved)result.scopeResultWritten=true;
  }
 }else if(reservation?.resumeType==='douyin_preparation_scope_error_first_upload'){
  // This is a native preparation-scope continuation, not an outer receipt
  // resume. The original pristine-resume result is immutable and is never
  // replaced by a generic .resume-result.json record.
  result.receiptPath=reservation.receiptPath;
  result.preparedStateReceiptPath=reservation.receiptPath;
  releaseDouyinPreparationScopeResumeClaim(reservation);
 }else if(reservation?.resumeType===DOUYIN_WINDOW_BINDING_PUBLISH_TYPE){
  result.preparedStatePath=reservation.nativeStatePath;
  result.receiptPath=reservation.windowBindingPrepared.resultPath;
  result.publicationPerformed=result.status==='PUBLISHED';
  result.readOnlyAdmission=false;
 }else if(reservation){
  const record=reservation.resume
   ?{...result,contentHash:reservation.contentHash,fingerprintVersion:reservation.fingerprintVersion,action:reservation.action,
     history:[...(Array.isArray(reservation.priorReceipt.history)?reservation.priorReceipt.history:[]),Object.fromEntries(Object.entries(reservation.priorReceipt).filter(([key])=>key!=='history'))],
     platform,accountKey:account.key,accountName:account.name,backend,preparedStateReceiptPath:reservation.statePath,receiptPath:reservation.resumeResultPath,
     ...(reservation.resumeType==='channels_ready_source_proof'?{v2PreparedStatePath:reservation.preparedStatePath,sourceProofResultPath:reservation.sourceProofResultPath}:{}),
     at:new Date().toISOString(),publicReadbackVerified:result.publicReadbackVerified===true}
   :{contentHash:reservation.contentHash,fingerprintVersion:reservation.fingerprintVersion,action:reservation.action,...result,at:new Date().toISOString(),publicReadbackVerified:result.publicReadbackVerified===true};
  // Preserve every execution reservation, including failures. Review the receipt before any retry; never delete uncertain submissions automatically.
  if(reservation.resume)writePreparedResumeReceipt(reservation,record);
  else fs.writeFileSync(reservation.statePath,JSON.stringify(record,null,2)+'\n',{mode:0o600});
  result.receiptPath=reservation.resume?reservation.resumeResultPath:reservation.statePath;
  if(reservation.resume)result.preparedStateReceiptPath=reservation.statePath;
  if(reservation.resume)releasePreparedResumeClaim(reservation);
 }
 return result;
}
// Native execution retains the original opt-in, identity and submission guards.
export async function runSchoolPublisher(argv=process.argv.slice(2),deps={}){return dispatchInternal(argv,deps);}
export async function dispatchOfflineFixture(file,options={}){
 if(typeof file!=='string'||!options||typeof options!=='object'||Array.isArray(options)
   ||Object.keys(options).some(k=>!['stateRoot','action','scenario','execute'].includes(k))
   ||Object.entries(options).some(([k,v])=>k==='execute'?typeof v!=='boolean':typeof v!=='string'))throw Error('OFFLINE_SERIALIZED_OPTIONS_ONLY');
 const {runMockSession}=await import('../lib/offline-session.mjs');
 return runMockSession(file,options,dispatchInternal);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const r=await runSchoolPublisher();console.log(JSON.stringify(r,null,2));if(!r.ok)process.exitCode=2;}
 catch(error){console.log(JSON.stringify({ok:false,status:'BLOCKED',message:String(error.message)}));process.exitCode=2;}
}
