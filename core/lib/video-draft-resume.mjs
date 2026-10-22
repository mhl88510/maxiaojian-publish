import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {readPackage} from "./content-package.mjs";
import {resolveSchoolAccountBinding,schoolAccountStateRoot} from "./school-account.mjs";
import {buildIdentity} from "../v2/lib/identity.mjs";
const SCRIPTS=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
export function isKnownUploadedIdentityProofContinuation(){return false;}
export function hasPermissionUploadInterruption(item) {
 return (item?.history||[]).some(h=>h.phase==='upload_start' && (h.blocker?.code==='BROWSER_PERMISSION_REQUIRED'||/browser permission prompt/i.test(h.blocker?.evidence?.detail||'')));
}
export function assertPermissionResumeState(state,binding,statePath,stateBase=path.join(os.homedir(),'.maxiaojian-publish','school-accounts')) {
 const fail=code=>{throw new Error(code)};
 const item=state.platforms?.douyin;
 const uidPinned=binding.apiUid!==undefined&&binding.apiUid!==null&&binding.apiUid!=='';
 const uidPinValid=!uidPinned||(typeof binding.apiUid==='string'&&/^\d+$/.test(binding.apiUid));
 if(binding.platform!=='douyin'||typeof binding.accountId!=='string'||!/^\d+$/.test(binding.accountId)
  ||typeof binding.accountName!=='string'||!binding.accountName.trim()
  ||typeof binding.targetId!=='string'||!binding.targetId.trim()
  ||typeof binding.egoProfileId!=='string'||!binding.egoProfileId.trim())fail('VIDEO_RESUME_EXACT_BINDING_REQUIRED');
 if(!uidPinValid)fail('VIDEO_RESUME_API_UID_BINDING_INVALID');
 if(!/^[a-f0-9]{16}$/.test(state.jobId||'')||state.jobId!==state.fingerprint?.slice(0,16))fail('VIDEO_RESUME_JOB_ID_MISMATCH');
 const expected=path.join(schoolAccountStateRoot(stateBase,binding),state.jobId,'state.json');
 if(path.resolve(statePath)!==expected||fs.lstatSync(statePath).isSymbolicLink()||!fs.lstatSync(statePath).isFile())fail('VIDEO_RESUME_STATE_PATH_MISMATCH');
 if(Number(item?.taskSpaceId)!==binding.taskSpaceId||item?.taskSpaceName!==binding.taskSpaceName||state.taskSuffix!==`school-${binding.accountKey}`)fail('VIDEO_RESUME_TARGET_MISMATCH');
 if(state.status==='ready'||item?.status==='ready')fail('VIDEO_RESUME_ALREADY_READY');
 const permission=hasPermissionUploadInterruption(item);
 if(!permission&&!isKnownUploadedIdentityProofContinuation(state,binding,statePath))fail('VIDEO_RESUME_PERMISSION_HISTORY_REQUIRED');
 if(fs.readdirSync(path.dirname(expected)).some(x=>/^school-final-/.test(x)))fail('VIDEO_RESUME_FINAL_MARKER_PRESENT');
 if(item?.videoReceipt && !(item.videoReceipt.mode==='recovered_original_file' && item.videoReceipt.fingerprint===state.fingerprint && Number(item.videoReceipt.taskSpaceId)===binding.taskSpaceId && item.videoReceipt.nativeMedia?.sha256===state.video?.sha256 && item.videoReceipt.nativeMedia?.size===state.video?.size && item.videoReceipt.nativeMedia?.vid))fail('VIDEO_RESUME_RECEIPT_ALREADY_PRESENT');
 if(!state.video?.sha256||!state.video?.size)fail('VIDEO_RESUME_MEDIA_IDENTITY_REQUIRED');
 return {statePath:expected,stateRoot:path.dirname(path.dirname(expected)),item};
}

export async function prepareVideoResumeContext(file,statePath,matrix,options={}) {
 const binding=resolveSchoolAccountBinding(JSON.parse(fs.readFileSync(file,'utf8')).schoolAccount,matrix);
 const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
 const scope=assertPermissionResumeState(state,binding,statePath,options.stateBase);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'school-video-resume-'));fs.chmodSync(directory,0o700);
 const packagePath=path.join(directory,'package.json');
 try {
  let pkg={...readPackage(file),schoolAccount:binding};
  fs.writeFileSync(packagePath,JSON.stringify(pkg),{mode:0o600});
  let id=await buildIdentity(readPackage(packagePath));
  if(id.fingerprint!==state.fingerprint)throw new Error('VIDEO_RESUME_PACKAGE_FINGERPRINT_MISMATCH');
  if(id.video.sha256!==state.video.sha256||id.video.size!==state.video.size||id.video.path!==state.video.path)throw new Error('VIDEO_RESUME_MEDIA_CHANGED');
  const contract={version:1,jobId:state.jobId,fingerprint:state.fingerprint,binding,video:{...state.video,name:path.basename(state.video.path)},nativeVideoId:scope.item.videoReceipt?.nativeMedia?.vid||'',nativeMedia:scope.item.videoReceipt?.nativeMedia||null,neverInject:true};
  return {...scope,state,binding,packagePath,directory,contract};
 }catch(error){fs.rmSync(directory,{recursive:true,force:true});throw error;}
}
export async function runVideoDraftResume(file,statePath,matrix,execute,options={}) {
 let c;
 try {
  c=await prepareVideoResumeContext(file,statePath,matrix,options);
  const args=['--package',c.packagePath,'--platform','douyin','--job-id',c.state.jobId,'--task-suffix',c.state.taskSuffix,'--operation','resume','--space-name',c.binding.taskSpaceName,'--reuse-space','--no-cleanup-stale-spaces','--state-root',c.stateRoot,'--keep-space'];
  const r=await execute(process.execPath,[path.join(SCRIPTS,'v2','publisher.mjs'),...args],{timeoutMs:300000,env:{...process.env,VIDEO_PUBLISHER_NATIVE_RECOVERY:JSON.stringify(c.contract)}});
  let summary;try{summary=JSON.parse(r.stdout.trim());}catch{}
  const after=JSON.parse(fs.readFileSync(c.statePath,'utf8')),item=after.platforms?.douyin;
  const receiptVerified=after.fingerprint===c.state.fingerprint && item?.status==='ready' && item?.verdict?.ready===true && item?.videoReceipt?.mode==='recovered_original_file' && item.videoReceipt.fingerprint===c.state.fingerprint && Number(item.videoReceipt.taskSpaceId)===c.binding.taskSpaceId && item.videoReceipt.nativeMedia?.sha256===c.state.video.sha256 && item.videoReceipt.nativeMedia?.size===c.state.video.size && !!item.videoReceipt.nativeMedia?.vid && !fs.readdirSync(path.dirname(c.statePath)).some(x=>/^school-final-/.test(x));
  const ok=r.code===0&&summary?.ready===true&&summary.jobId===c.state.jobId&&summary.statePath===c.statePath&&receiptVerified;
  // This command only prepares the original page. Final submission is a separate explicit action.
  return {ok,status:ok?'DRAFT_PREPARATION_COMPLETE':'DRAFT_RESUME_BLOCKED',code:ok?undefined:summary?.platforms?.douyin?.blocker?.code||(summary?.ready?'VIDEO_RESUME_RECEIPT_NOT_CONFIRMED':'VIDEO_RESUME_RESULT_UNAVAILABLE'),jobId:c.state.jobId,preparedStatePath:c.statePath,publicationPerformed:false,reuploaded:false,summary,...(!summary?{runnerExitCode:r.code,runnerError:String(r.stderr||'').slice(-4000)}:{})};
 }catch(error){return {ok:false,status:'BLOCKED',code:String(error.message),publicationPerformed:false,reuploaded:false};}
 finally{if(c)fs.rmSync(c.directory,{recursive:true,force:true});}
}
