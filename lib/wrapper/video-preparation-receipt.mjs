// Local byte lineage only. No processing, publishing, network, or approval.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
export const PREPARATION_SCHEMA='content-video-preparation/v1';
const HASH=/^[a-f0-9]{64}$/;
const fail=s=>{throw new Error('VIDEO_PREPARATION_'+s);};
const hash=file=>{const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),b=Buffer.allocUnsafe(65536);try{let n;while((n=fs.readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');};
function fileBinding(file,sha,size){
 if(typeof file!=='string'||!path.isAbsolute(file)||typeof sha!=='string'||!HASH.test(sha))fail('FILE_BINDING_INVALID');
 const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||fs.realpathSync(file)!==path.resolve(file))fail('FILE_NOT_REGULAR');
 if(size!==undefined&&(!Number.isSafeInteger(size)||size<0||s.size!==size))fail('SIZE_MISMATCH');
 if(hash(file)!==sha)fail('SHA256_MISMATCH');return {path:path.resolve(file),sha256:sha,size:s.size};
}
function subjectMatches(s,w){return s&&Object.keys(s).every(k=>['kind','key'].includes(k))&&['school','personal_ip'].includes(s.kind)&&/^[a-zA-Z0-9_-]+$/.test(s.key||'')&&s.kind===w?.kind&&s.key===w?.key;}
function group(value,label){if(!Array.isArray(value)||!value.length||value.length>64)fail(label+'_INVALID');return value;}
export function loadVideoPreparationReceipt(attachment,subject,bindings,contentId){
 if(!attachment||Array.isArray(attachment)||Object.keys(attachment).some(k=>!['path','sha256'].includes(k)))fail('ATTACHMENT_INVALID');
 const receipt=fileBinding(attachment.path,attachment.sha256);if(receipt.size>1024*1024)fail('RECEIPT_TOO_LARGE');
 const d=JSON.parse(fs.readFileSync(receipt.path,'utf8'));
 if(d.schema!==PREPARATION_SCHEMA||d.status!=='CANDIDATE')fail('NOT_CANDIDATE');
 if(!subjectMatches(d.subject,subject))fail('SUBJECT_MISMATCH');
 if(d.contentId!==contentId||typeof contentId!=='string'||!/^[a-zA-Z0-9_-]+$/.test(contentId))fail('CONTENT_ID_MISMATCH');
 if(d.review?.humanApproval!==false||d.review?.aesthetic!=='NOT_REVIEWED'||d.review?.publishing!=='NOT_AUTHORIZED')fail('REVIEW_STATE_INVALID');
 for(const k of ['sourceHashesStable','planHashStable','allRangesValid','mediaOutputsProbed','subtitleCueCountRecorded','outputsValidated','technicalOnly'])if(d.checks?.[k]!==true)fail('TECHNICAL_CHECK_INCOMPLETE');
 const plan=fileBinding(d.plan?.path,d.plan?.sha256),all=[receipt,plan];
 if(plan.size>2*1024*1024)fail('PLAN_TOO_LARGE');
 const planned=JSON.parse(fs.readFileSync(plan.path,'utf8'));
 if(planned.schema!=='content-video-preparation-plan/v1'||planned.contentId!==contentId||!subjectMatches(planned.subject,subject))fail('PLAN_SUBJECT_MISMATCH');
 const normalize=(rows,label)=>{const ids=new Set();return group(rows,label).map(x=>{
  if(typeof x.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(x.id)||ids.has(x.id))fail(label+'_ID_INVALID');ids.add(x.id);
  const f=fileBinding(x.path,x.sha256,x.sizeBytes);all.push(f);
  if(label==='SOURCE'&&(!['UNVERIFIED','REVIEWED','RESTRICTED'].includes(x.usageReview?.status)||typeof x.selectionReason!=='string'||!x.selectionReason.trim()))fail('SOURCE_REVIEW_MISSING');
  if(label==='OUTPUT'&&(typeof x.role!=='string'||!x.role.trim()||!['clip_candidate','reframed_video_candidate','subtitle_candidate','ducked_audio_candidate'].includes(x.role)||!['video/mp4','audio/wav','audio/mpeg','audio/mp4','text/x-ass','text/x-ssa','text/plain','application/json'].includes(x.mediaType)))fail('OUTPUT_ROLE_INVALID');
  return {id:x.id,...f,...(label==='SOURCE'?{usageReview:x.usageReview.status,selectionReason:x.selectionReason}:{role:x.role,mediaType:x.mediaType})};
 });};
 const sources=normalize(d.sources,'SOURCE'),outputs=normalize(d.outputs,'OUTPUT');
 const operations=group(d.operations,'OPERATIONS').map(o=>{
  if(typeof o.id!=='string'||typeof o.kind!=='string'||typeof o.why!=='string'||!o.why.trim())fail('OPERATION_INVALID');
  return {id:o.id,kind:o.kind,why:o.why};
 });
 const ps=group(planned.sources,'PLAN_SOURCES'),po=group(planned.operations,'PLAN_OPERATIONS');
 if(ps.length!==sources.length||po.length!==operations.length||outputs.length!==operations.length)fail('PLAN_CARDINALITY_MISMATCH');
 for(const source of sources) {
  const raw=ps.find(x=>x.id===source.id);
  if(!raw||raw.path!==source.path||raw.sha256!==source.sha256||raw.selectionReason!==source.selectionReason||raw.usageReview?.status!==source.usageReview)fail('PLAN_SOURCE_MISMATCH');
 }
 const seenOperations=new Set();
 for(const operation of operations) {
  const raw=po.find(x=>x.id===operation.id);
  if(seenOperations.has(operation.id)||!raw||raw.kind!==operation.kind||raw.why!==operation.why||!outputs.some(o=>o.id===operation.id))fail('PLAN_OPERATION_MISMATCH');seenOperations.add(operation.id);
 }
 for(const f of all)bindings.set(f.path,f);
 return {schema:PREPARATION_SCHEMA,receipt,plan,contentId,subject:{kind:subject.kind,key:subject.key},status:'CANDIDATE',sources,outputs,operations,review:{aesthetic:'NOT_REVIEWED',humanApproval:false,publishing:'NOT_AUTHORIZED'},scope:'source_plan_output_byte_lineage_only'};
}
// Shape before filesystem reads: fixed fields, not a recursive walk of user data.
export function preparationBindingPaths(value,subject,contentId){
 if(!value||value.schema!==PREPARATION_SCHEMA||value.status!=='CANDIDATE'||value.contentId!==contentId||!subjectMatches(value.subject,subject)||value.review?.humanApproval!==false||value.review?.aesthetic!=='NOT_REVIEWED'||value.review?.publishing!=='NOT_AUTHORIZED')fail('COMPILED_STATE_INVALID');
 const refs=[value.receipt,value.plan,...group(value.sources,'SOURCE'),...group(value.outputs,'OUTPUT')];
 if(refs.some(x=>!x||typeof x.path!=='string'||!path.isAbsolute(x.path)||!HASH.test(x.sha256||'')||!Number.isSafeInteger(x.size)||x.size<0))fail('COMPILED_BINDING_INVALID');
 return refs.map(x=>x.path);
}
// Narrow local verification bridge for the existing Python V2 consumer. stdin is
// data, never a command; importing this module does not execute the bridge.
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  if(process.argv.length!==2)fail('CLI_ARGUMENTS_INVALID');
  const bytes=fs.readFileSync(0);if(bytes.length>16384)fail('CLI_INPUT_TOO_LARGE');
  const input=JSON.parse(bytes.toString('utf8'));
  if(Object.keys(input).some(k=>!['receipt','subject','contentId'].includes(k)))fail('CLI_INPUT_INVALID');
  const result=loadVideoPreparationReceipt(input.receipt,input.subject,new Map(),input.contentId);
  const planned=JSON.parse(fs.readFileSync(result.plan.path,'utf8'));
  if(hash(result.plan.path)!==result.plan.sha256)fail('PLAN_CHANGED_DURING_READ');
  process.stdout.write(JSON.stringify({receipt:result,plannedOperations:planned.operations}));
 }catch(error){process.stderr.write(String(error.message)+'\n');process.exitCode=1;}
}
