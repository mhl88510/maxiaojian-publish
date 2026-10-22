import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const reject=()=>{const e=new Error('Only the exact original XHS draft missing-rights pre-browser rejection may resume.');e.code='RIGHTS_PREFLIGHT_RESUME_REJECTED';throw e;};
export function claimRightsPreflightResume(pkg,o,stateBase,fingerprintPackage){
 const t=pkg.schoolAccount||{};
 if(t.platform!=='xiaohongshu'||o.action!=='draft'||o.rights!==true||o.preparedState||(pkg.backend&&pkg.backend!=='ego_video')||!/^[a-zA-Z0-9_-]+$/.test(t.accountKey||''))reject();
 const {contentHash}=fingerprintPackage(pkg),statePath=path.resolve(o.resumePreflightReceipt||'');
 if(statePath!==path.resolve(stateBase,t.platform,t.accountKey,'draft-v2-'+contentHash+'.json'))reject();
 const stat=fs.lstatSync(statePath);if(!stat.isFile()||stat.isSymbolicLink())reject();
 const priorRaw=fs.readFileSync(statePath,'utf8'),priorReceipt=JSON.parse(priorRaw);
 const allowed=new Set(['contentHash','fingerprintVersion','action','ok','code','message','platform','accountKey','accountName','backend','at','publicReadbackVerified']);
 if(Object.keys(priorReceipt).some(k=>!allowed.has(k))||priorReceipt.ok!==false||priorReceipt.code!=='ORIGINAL_RIGHTS_CONFIRMATION_REQUIRED'||priorReceipt.contentHash!==contentHash||priorReceipt.fingerprintVersion!==2||priorReceipt.action!=='draft'||priorReceipt.platform!==t.platform||priorReceipt.accountKey!==t.accountKey||priorReceipt.backend!=='ego_video'||priorReceipt.publicReadbackVerified!==false)reject();
 const resumeResultPath=statePath+'.resume-result.json',claimPath=statePath+'.resume-claim',claimToken=crypto.randomBytes(16).toString('hex');
 if(fs.existsSync(resumeResultPath))reject();
 let fd;try{fd=fs.openSync(claimPath,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({token:claimToken,contentHash,action:'draft',at:new Date().toISOString()}));fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}
 try{if(fs.readFileSync(statePath,'utf8')!==priorRaw||fs.existsSync(resumeResultPath))reject();}catch(e){fs.unlinkSync(claimPath);throw e;}
 return {statePath,resumeResultPath,claimPath,claimToken,contentHash,action:'draft',fingerprintVersion:2,resume:true,priorReceipt,priorRaw};
}
