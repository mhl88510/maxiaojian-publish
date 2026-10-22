import fs from 'node:fs';
import path from 'node:path';
import {releaseContext,buildVideoReleaseScript,buildVideoReleaseFinale} from './video-release-backend.mjs';
import {runEgoPreflight} from '../run-school-account.mjs';
import {requiredGates} from '../v2/lib/model.mjs';

// Native AX controls can be visible to Ego while absent from the page DOM.
// Only recover a proved pre-click rejection, never a sent/uncertain submission.
export function nativeXhsFinal(snapshot) {
 const lines=String(snapshot||'').split(/\r?\n/),refs=[];
 for(let i=0;i<lines.length;i++){
  const m=lines[i].match(/^(\s*)button(?: "([^"]*)")? \[ref=(\d+)([^\]]*)\]/);
  if(!m||/disabled/i.test(m[4]))continue;
  let texts=m[2]?[m[2]]:[];
  if(!texts.length)for(let j=i+1;j<lines.length;j++){
   if(lines[j].trim()&&lines[j].match(/^\s*/)[0].length<=m[1].length)break;
   const t=lines[j].match(/^\s+text "([^"]*)"$/);if(t)texts.push(t[1]);
  }
  if(texts.join(' ').trim()==='发布')refs.push('@'+m[3]);
 }
 return refs.length===1?{ok:true,ref:refs[0]}:{ok:false,count:refs.length};
}
export function canRecoverXhsMarker(marker,fingerprint){
 return marker?.status==='BLOCKED_AT_FINAL_BOUNDARY'&&marker?.ok===false
  &&marker?.code==='FINAL_BUTTON_AMBIGUOUS'&&marker?.fingerprint===fingerprint
  &&marker?.platform==='xiaohongshu'&&!marker?.clickCount&&!marker?.recoveryCount;
}
export function claimXhsRecovery(lockPath,markerPath,expectedRaw){
 const fd=fs.openSync(lockPath,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify({status:'ONE_NATIVE_RECOVERY_CLAIMED',at:new Date().toISOString()}));}finally{fs.closeSync(fd);}
 // Keep the claim even on failure. A second process cannot cross the boundary.
 if(fs.readFileSync(markerPath,'utf8')!==expectedRaw)throw new Error('FINAL_MARKER_CHANGED');
 return true;
}
export function buildXhsRecoveryScript(c){
 const mark=path.join(path.dirname(c.statePath),'school-final-xiaohongshu-'+c.identity.fingerprint+'.json');
 const finale=`
const nativeXhsFinal=${nativeXhsFinal.toString()};
const canRecoverXhsMarker=${canRecoverXhsMarker.toString()};
const claimXhsRecovery=${claimXhsRecovery.toString()};
const markerPath=${JSON.stringify(mark)},recoveryPrefix='SCHOOL_XHS_SAFE_RECOVERY:';
const prepared=await preparePlatform();
let result={ok:false,status:'BLOCKED',code:'TARGET_UNAVAILABLE'};
if(prepared.selected.ok){
 const current=await runPlatformPhase(),guard=await inspectFinalPublishGuard();
 const missing=${JSON.stringify(requiredGates('xiaohongshu').filter(g=>g!=='safety'))}.filter(g=>current.gates?.[g]?.ok!==true);
 const oldRaw=fs.readFileSync(markerPath,'utf8'),old=JSON.parse(oldRaw);
 const native=nativeXhsFinal(await boundPage().snapshot({scope:'full_page'}));
 if(current.blocker||missing.length||!guard.armed||guard.blockedAttempts||!native.ok||!canRecoverXhsMarker(old,jobFingerprint)){
  result={ok:false,status:'BLOCKED',code:'SAFE_RECOVERY_PREFLIGHT_FAILED',missing,native,guard:{armed:guard.armed,blockedAttempts:guard.blockedAttempts}};
 }else{
  claimXhsRecovery(markerPath+'.native-recovery.lock',markerPath,oldRaw);
  const reserved={status:'FINAL_CLICK_RESERVED',platform,accountKey:pkg.schoolAccount.accountKey,fingerprint:jobFingerprint,recoveryCount:1,history:[old],at:new Date().toISOString()};
  fs.writeFileSync(markerPath,JSON.stringify(reserved,null,2),{mode:0o600});
  const boundary=await js(String.raw\`((binding,key)=>{
   if(!binding.platformHosts.includes(location.hostname))return {ok:false,code:'PLATFORM_CHANGED_BEFORE_CLICK'};
   const header=document.querySelector('.d-topbar .name-box')?.innerText||'';
   if(!header.includes(binding.accountName))return {ok:false,code:'ACCOUNT_CHANGED_BEFORE_CLICK'};
   if(binding.knownAccounts.some(a=>a.key!==binding.accountKey&&((a.id&&header.includes(a.id))||(a.name&&header.includes(a.name)))))return {ok:false,code:'CONFLICTING_ACCOUNT_BEFORE_CLICK'};
   const guard=window[key];if(!guard?.armed||guard.blockedAttempts.length)return {ok:false,code:'FINAL_GUARD_UNCLEAN'};
   return guard.releaseForConfirmedPublish();
  })(${JSON.stringify(c.binding)},'__VIDEO_PUBLISHER_FINAL_GUARD__')\`);
  if(!boundary.ok){result={ok:false,status:'BLOCKED_AT_FINAL_BOUNDARY',code:boundary.code||'FINAL_GUARD_RELEASE_FAILED'};}
  else{
   try{await boundPage().click(native.ref,{label:'publish approved xhs video'});result={ok:true,status:'SUBMITTED',clickCount:1};}
   catch(error){result={ok:false,status:'SUBMISSION_UNCERTAIN',code:'NATIVE_FINAL_CLICK_UNCERTAIN',message:String(error.message).slice(0,300)};}
  }
  fs.writeFileSync(markerPath,JSON.stringify({...reserved,...result,status:result.ok?'FINAL_CLICK_SENT':result.status,at:new Date().toISOString()},null,2),{mode:0o600});
 }
}
console.log(recoveryPrefix+JSON.stringify({...result,platform,accountKey:pkg.schoolAccount.accountKey,markerPath,publicReadbackVerified:false}));
`;
 return buildVideoReleaseScript(c).replace(buildVideoReleaseFinale(c),finale);
}
export async function runXhsSafeFinalRecovery(file,statePath,matrix,execute){


 const c=await releaseContext(file,statePath,matrix);
 if(c.binding.platform!=='xiaohongshu')throw new Error('XHS_RECOVERY_ONLY');
 const markerPath=path.join(path.dirname(c.statePath),'school-final-xiaohongshu-'+c.identity.fingerprint+'.json');
 if(!canRecoverXhsMarker(JSON.parse(fs.readFileSync(markerPath,'utf8')),c.identity.fingerprint))throw new Error('NOT_A_PROVED_PRE_CLICK_XHS_BLOCK');
 const pre=await runEgoPreflight(c.binding);if(!pre.ok)return {ok:false,status:'BLOCKED',code:pre.code};
 const r=await execute('ego-browser',['nodejs'],{input:buildXhsRecoveryScript(c)});
 const line=(r.stdout+'\n'+r.stderr).split(/\r?\n/).find(x=>x.startsWith('SCHOOL_XHS_SAFE_RECOVERY:'));
 if(r.code!==0||!line)return {ok:false,status:'SUBMISSION_UNCERTAIN',code:'RECOVERY_RESULT_UNAVAILABLE'};
 return JSON.parse(line.slice('SCHOOL_XHS_SAFE_RECOVERY:'.length));
}
