import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPackage} from './content-package.mjs';
import {resolveSchoolAccountBinding,schoolAccountStateRoot} from './school-account.mjs';
import {buildIdentity} from '../v2/lib/identity.mjs';
const SCRIPTS=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fail=c=>{throw new Error(c)};
export function assertXhsEmptyInputState(state,binding,statePath,stateBase=path.join(os.homedir(),'.maxiaojian-publish/school-accounts')){
 const i=state.platforms?.xiaohongshu;
 if(binding.platform!=='xiaohongshu'||!binding.targetId||!binding.egoProfileId)fail('XHS_EMPTY_RESUME_BINDING_REQUIRED');
 const expected=path.join(schoolAccountStateRoot(stateBase,binding),state.jobId||'','state.json');
 if(!/^[a-f0-9]{16}$/.test(state.jobId||'')||state.jobId!==state.fingerprint?.slice(0,16)||path.resolve(statePath)!==expected||fs.lstatSync(statePath).isSymbolicLink())fail('XHS_EMPTY_RESUME_PATH_MISMATCH');
 if(state.status!=='blocked'||i?.status!=='blocked'||i.taskSpaceId!==binding.taskSpaceId||i.taskSpaceName!==binding.taskSpaceName||state.taskSuffix!==`school-${binding.accountKey}`||i.videoReceipt||Object.keys(i.receipts||{}).length)fail('XHS_EMPTY_RESUME_STATE_REJECTED');
 if(i.history?.length!==2||i.history[0].phase!=='inspect'||i.history[1].phase!=='upload_start'||i.history[1].blocker?.code!=='SELECTOR_DRIFT'||i.history[1].blocker?.message!=='xiaohongshu video input missing')fail('XHS_EMPTY_RESUME_HISTORY_REJECTED');
 if(fs.readdirSync(path.dirname(statePath)).some(x=>/^school-final-/.test(x)))fail('XHS_EMPTY_RESUME_FINAL_MARKER');
 for(const h of i.history){
  const ep=path.resolve(h.evidencePath||'');if(!ep.startsWith(path.join(path.dirname(statePath),'evidence')+path.sep)||fs.lstatSync(ep).isSymbolicLink())fail('XHS_EMPTY_RESUME_EVIDENCE_PATH');
  const o=JSON.parse(fs.readFileSync(ep,'utf8')).observation,g=o?.gates;
  if(o.platform!=='xiaohongshu'||o.phase!==h.phase||o.taskSpaceId!==binding.taskSpaceId||o.finalPublishClicked!==false||g?.safety?.ok!==true||g.safety.evidence.guardArmed!==true||g.safety.evidence.blockedAttempts!==0||g.video?.ok!==false||g.video.evidence?.uploaded!==false||g.video.evidence?.uploading!==false||g.draftIdentity?.ok!==true||g.authenticated?.ok!==true||o.actions?.upload||o.receipts?.uploadStart)fail('XHS_EMPTY_RESUME_UPLOAD_UNCERTAIN');
  if(h.phase==='upload_start'&&(o.blocker?.code!=='SELECTOR_DRIFT'||o.blocker?.message!=='xiaohongshu video input missing'))fail('XHS_EMPTY_RESUME_EVIDENCE_MISMATCH');
 }
 return {stateRoot:path.dirname(path.dirname(statePath)),item:i};
}
export function assertXhsInjectedBodyState(state,binding,statePath,stateBase=path.join(os.homedir(),'.maxiaojian-publish/school-accounts')){
 const i=state.platforms?.xiaohongshu;
 if(binding.platform!=='xiaohongshu'||!binding.targetId||!binding.egoProfileId||!/^[a-f0-9]{16}$/.test(state.jobId||'')||state.jobId!==state.fingerprint?.slice(0,16)||path.resolve(statePath)!==path.join(schoolAccountStateRoot(stateBase,binding),state.jobId,'state.json')||fs.lstatSync(statePath).isSymbolicLink())fail('XHS_BODY_RESUME_BINDING_PATH_REJECTED');
 if(state.status!=='blocked'||i?.status!=='blocked'||i.taskSpaceId!==binding.taskSpaceId||i.taskSpaceName!==binding.taskSpaceName||state.taskSuffix!==`school-${binding.accountKey}`||(i.videoReceipt&&(i.videoReceipt.fingerprint!==state.fingerprint||Number(i.videoReceipt.taskSpaceId)!==binding.taskSpaceId||i.videoReceipt.mode!=='resume_existing'))||fs.readdirSync(path.dirname(statePath)).some(x=>/^school-final-/.test(x)))fail('XHS_BODY_RESUME_STATE_REJECTED');
 const resumedEmpty=i.history?.length>=5&&i.history.slice(0,5).map(h=>h.phase).join(',')==='inspect,upload_start,inspect,upload_start,prefill';
 const prefix=resumedEmpty?5:3,injectionIndex=resumedEmpty?3:1,prefillIndex=prefix-1;
 if(resumedEmpty){
  // Validate the exact historical no-input failure, not just its displayed message.
  const old={...state,platforms:{xiaohongshu:{...i,history:i.history.slice(0,2),videoReceipt:null,receipts:{}}}};
  assertXhsEmptyInputState(old,binding,statePath,stateBase);
 }
 const b=i.history?.[prefillIndex]?.blocker;
 if(i.history?.length<prefix||i.history.slice(resumedEmpty?2:0,prefix).map(h=>h.phase).join(',')!=='inspect,upload_start,prefill'||b?.code!=='ACTION_FAILED'||(resumedEmpty?b.message!=='xiaohongshu exact topics did not commit; stopped without repeating whole-set rebuild':b.message!=='xhs description did not persist before topic rebuild'))fail('XHS_BODY_RESUME_HISTORY_REJECTED');
 const read=h=>{const p=path.resolve(h.evidencePath||'');if(!p.startsWith(path.join(path.dirname(statePath),'evidence')+path.sep)||fs.lstatSync(p).isSymbolicLink())fail('XHS_BODY_RESUME_EVIDENCE_PATH');return JSON.parse(fs.readFileSync(p,'utf8')).observation;};
 const observations=i.history.map(read);
 if(observations.some((o,n)=>o.phase!==i.history[n].phase)||observations[prefillIndex].blocker?.code!==b.code||observations[prefillIndex].blocker?.message!==b.message)fail('XHS_BODY_RESUME_EVIDENCE_HISTORY_MISMATCH');
 if(resumedEmpty){const v=observations[2].gates?.video;if(v?.ok!==false||v.evidence?.uploaded!==false||v.evidence?.uploading!==false||observations[2].actions?.upload)fail('XHS_BODY_EMPTY_TRANSITION_UNCERTAIN');}
 if(i.history.slice(prefix).some(h=>!['inspect','mutate','verify'].includes(h.phase)))fail('XHS_BODY_RESUME_LATER_UPLOAD_REJECTED');
 for(const o of observations)if(o.taskSpaceId!==binding.taskSpaceId||o.platform!=='xiaohongshu'||o.finalPublishClicked!==false||o.gates?.safety?.ok!==true||o.gates.safety.evidence.guardArmed!==true||o.gates.safety.evidence.blockedAttempts!==0)fail('XHS_BODY_RESUME_GUARD_REJECTED');
 if(observations[injectionIndex].actions?.upload?.mode!=='injected'||observations[injectionIndex].actions.upload.stage!=='editable_uploading'||observations[prefillIndex].gates.video?.ok!==true||observations[prefillIndex].gates.title?.ok!==true||observations[prefillIndex].gates.draftIdentity?.ok!==true)fail('XHS_BODY_RESUME_SOURCE_INJECTION_UNPROVED');
 return {stateRoot:path.dirname(path.dirname(statePath)),item:i,injectionEvidencePath:i.history[injectionIndex].evidencePath};
}
export async function runXhsEmptyInputResume(file,statePath,matrix,execute,options={}){
 let dir;try{
  const binding=resolveSchoolAccountBinding(JSON.parse(fs.readFileSync(file,'utf8')).schoolAccount,matrix),state=JSON.parse(fs.readFileSync(statePath,'utf8'));
  const mode=state.platforms?.xiaohongshu?.history?.length>=3?'injected_body':'empty_input';
  const scope=mode==='injected_body'?assertXhsInjectedBodyState(state,binding,statePath,options.stateBase):assertXhsEmptyInputState(state,binding,statePath,options.stateBase);
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhs-empty-resume-'));fs.chmodSync(dir,0o700);const normalized=path.join(dir,'package.json');fs.writeFileSync(normalized,JSON.stringify({...readPackage(file),schoolAccount:binding}),{mode:0o600});
  const id=await buildIdentity(readPackage(normalized));if(id.fingerprint!==state.fingerprint||id.video.sha256!==state.video.sha256||id.video.size!==state.video.size)fail('XHS_EMPTY_RESUME_PACKAGE_CHANGED');
  const contract={version:1,mode,injectionEvidencePath:scope.injectionEvidencePath||null,jobId:state.jobId,fingerprint:state.fingerprint,binding,statePath:path.resolve(statePath),stateBase:options.stateBase||path.join(os.homedir(),'.maxiaojian-publish/school-accounts')};
  const r=await execute(process.execPath,[path.join(SCRIPTS,'v2/publisher.mjs'),'--package',normalized,'--platform','xiaohongshu','--job-id',state.jobId,'--task-suffix',state.taskSuffix,'--operation','resume','--space-name',binding.taskSpaceName,'--reuse-space','--keep-space','--no-cleanup-stale-spaces','--state-root',scope.stateRoot,'--confirm-original-rights'],{timeoutMs:300000,env:{...process.env,VIDEO_PUBLISHER_EMPTY_INPUT_RESUME:JSON.stringify(contract)}});
  let summary;try{summary=JSON.parse(r.stdout.trim())}catch{}
  const after=JSON.parse(fs.readFileSync(statePath,'utf8')),i=after.platforms?.xiaohongshu;const injected=(i?.history||[]).filter(h=>h.phase==='upload_start').some(h=>{try{const o=JSON.parse(fs.readFileSync(h.evidencePath,'utf8')).observation;return o?.actions?.upload?.mode==='injected'&&o.taskSpaceId===binding.taskSpaceId&&o.finalPublishClicked===false;}catch{return false}});const ok=injected&&r.code===0&&summary?.ready===true&&summary.jobId===state.jobId&&after.fingerprint===state.fingerprint&&i?.verdict?.ready===true&&i.videoReceipt?.fingerprint===state.fingerprint&&Number(i.videoReceipt.taskSpaceId)===binding.taskSpaceId&&!fs.readdirSync(path.dirname(statePath)).some(x=>/^school-final-/.test(x));
  return {ok,status:ok?'DRAFT_PREPARATION_COMPLETE':'DRAFT_RESUME_BLOCKED',jobId:state.jobId,preparedStatePath:statePath,publicationPerformed:false,summary};
 }catch(e){return {ok:false,status:'BLOCKED',code:e.message,publicationPerformed:false};}finally{if(dir)fs.rmSync(dir,{recursive:true,force:true})}
}
