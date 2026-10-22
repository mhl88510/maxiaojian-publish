import {validateDocument} from './schemas.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fingerprintPackage} from '../core/run-school-publisher.mjs';
import {resolveSchoolAccountBinding} from '../core/lib/school-account.mjs';
import {readFixture,confined,regular,hash,systemCanonical} from './fixture.mjs';
import {admit,consume} from './publication-guard.mjs';
export {createFixture} from './fixture.mjs';
export const SCENARIOS=['success','submitted','uncertain','identity-mismatch','user-owned','target-mismatch','stale-identity','result-account-mismatch','result-id-mismatch'];
export const demoMatrix={platforms:{douyin:{accounts:[{key:'demo',name:'虚构作者',id:'000001',ego:{profileId:'Offline Profile',taskSpaceId:1,taskSpaceName:'Offline Demo',pageLabel:'p1',targetId:'offline-target',apiUid:'000002'}}]}}};
export function validateDemo(pkg){
 if(!pkg||typeof pkg!=='object'||Array.isArray(pkg))throw Error('PACKAGE_OBJECT_REQUIRED');
 if(!validateDocument('compiled',pkg).ok)throw Error('SCHEMA_VALIDATION_FAILED');
 if(pkg.schoolAccount?.platform!=='douyin'||pkg.schoolAccount?.accountKey!=='demo')throw Error('OFFLINE_DEMO_ACCOUNT_ONLY');
 if(Object.keys(pkg.schoolAccount).some(k=>!['platform','accountKey'].includes(k)))throw Error('OFFLINE_ACCOUNT_FIELD_UNSUPPORTED');
 if(pkg.backend!=='ego_video'||pkg.contentType!=='video'||pkg.studio?.schema!=='school-content-publish/v1')throw Error('COMPILED_DEMO_PACKAGE_REQUIRED');
 if(typeof pkg.title!=='string'||!pkg.title.trim())throw Error('TITLE_REQUIRED');
 if(Object.keys(pkg).some(k=>/resume|prepared|personal|contract|schedule/i.test(k)))throw Error('OFFLINE_ADVANCED_ROUTE_DISABLED');
 return pkg;
}
export function mockObservation(scenario='success'){
 return {observedAt:scenario==='stale-identity'?Date.now()-120_000:Date.now(),space:{id:1,name:'Offline Demo',profileId:'Offline Profile',ownership:scenario==='user-owned'?'user':'agent'},page:{label:'p1',targetId:scenario==='target-mismatch'?'wrong-target':'offline-target',url:'https://creator.douyin.com/creator-micro/content/manage'},header:'虚构作者',identity:{status:200,uid:scenario==='identity-mismatch'?'000003':'000002',nickname:'虚构作者',unique_id:'000001'}};
}
function mkdirInside(root,dir){
 const rel=path.relative(root,dir);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('STATE_ROOT_OUTSIDE_FIXTURE');
 let current=root;for(const part of rel.split(path.sep).filter(Boolean)){current=path.join(current,part);try{const s=fs.lstatSync(current);if(!s.isDirectory()||s.isSymbolicLink())throw Error('STATE_DIRECTORY_UNSAFE');}catch(e){if(e.code!=='ENOENT')throw e;fs.mkdirSync(current,{mode:0o700});}}
 return dir;
}
function privateJson(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
function readJson(root,file){confined(root,file);return JSON.parse(fs.readFileSync(file,'utf8'));}
function blocked(error,calls=0){return {ok:false,status:'BLOCKED',code:String(error.message).split(':')[0],offline:true,publicationPerformed:false,publicReadbackVerified:false,adapterCalls:calls};}
export async function runMockSession(file,{stateRoot,action='publish',scenario='success',execute=false}={},dispatch){
 if(!stateRoot)throw Error('EXPLICIT_OFFLINE_STATE_ROOT_REQUIRED');
 if(!['check','draft','publish','status'].includes(action))throw Error('UNSUPPORTED_ACTION');
 if(!SCENARIOS.includes(scenario))throw Error('UNSUPPORTED_SCENARIO');
 const snapshot=readFixture(file);validateDemo(snapshot.pkg);
 const binding=resolveSchoolAccountBinding(snapshot.pkg.schoolAccount,demoMatrix);
 const requested=systemCanonical(stateRoot),rel=path.relative(snapshot.root,requested);
 if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('STATE_ROOT_OUTSIDE_FIXTURE');
 const state=path.join(requested,'.offline-state');
 // Status reads only the sealed job index and synthetic remote. It does not
 // need to reopen changed/missing media in order to reconcile an uncertain job.
 if(action==='status')return reconcile(snapshot,state,binding);
 if(['draft','publish'].includes(action)&&!execute)return {ok:false,status:'EXECUTION_OPT_IN_REQUIRED',offline:true,publicationPerformed:false,adapterCalls:0};
 let token;
 try{token=admit(snapshot,action,binding,mockObservation(scenario));}catch(e){return blocked(e);}
 mkdirInside(snapshot.root,state);
 const snapshots=mkdirInside(snapshot.root,path.join(state,'packages'));
 const sealed=path.join(snapshots,snapshot.sha256+'.json');
 if(fs.existsSync(sealed)){confined(snapshot.root,sealed);if(hash(fs.readFileSync(sealed))!==snapshot.sha256)throw Error('SEALED_PACKAGE_CHANGED');}
 else fs.writeFileSync(sealed,snapshot.bytes,{flag:'wx',mode:0o600});
 const stateBase=mkdirInside(snapshot.root,path.join(state,'dispatch'));
 // reserve() writes two nested account directories; fence those before dispatch.
 mkdirInside(snapshot.root,path.join(stateBase,'douyin','demo'));
 const contentHash=fingerprintPackage(snapshot.pkg).contentHash;
 const remoteDir=mkdirInside(snapshot.root,path.join(state,'remote'));
 const indexDir=mkdirInside(snapshot.root,path.join(state,'index'));
 const remoteFile=path.join(remoteDir,contentHash+'.json');
 const expectedId='mock-'+contentHash.slice(0,16);let calls=0;
 const adapter=async()=>{
  consume(token,{snapshot,action,binding,observation:mockObservation(scenario)});
  if(hash(fs.readFileSync(sealed))!==snapshot.sha256)throw Error('SEALED_PACKAGE_CHANGED');
  calls++;
  if(action==='check')return {ok:true,status:'MOCK_PREFLIGHT_PASSED',publicationPerformed:false};
  if(action==='draft')return {ok:true,status:'MOCK_PREPARED',publicationPerformed:false};
  const row={schema:'offline-native-record/v1',platform:'douyin',accountKey:'demo',creatorUid:binding.apiUid,contentHash,packageSha256:snapshot.sha256,contentId:expectedId,status:scenario==='submitted'?'SUBMITTED':'PUBLISHED'};
  if(scenario==='result-account-mismatch')row.creatorUid='000003';
  if(scenario==='result-id-mismatch')row.contentId='wrong-id';
  privateJson(remoteFile,{rows:[row]});
  if(scenario==='uncertain')throw Error('SIMULATED_RESULT_LOST_AFTER_SUBMISSION');
  if(row.creatorUid!==binding.apiUid||row.contentId!==expectedId)throw Error('EXACT_ID_READBACK_MISMATCH');
  return {ok:true,status:row.status==='SUBMITTED'?'MOCK_SUBMITTED':'MOCK_PUBLISHED',platformContentId:expectedId,publicationPerformed:false,publicReadbackVerified:false};
 };
 const result=await dispatch([sealed,'--action',action,...(execute?['--execute']:[])],{matrix:demoMatrix,stateBase,runVideo:adapter,runVideoRelease:adapter,execute:()=>{throw Error('EXTERNAL_EXECUTION_FORBIDDEN');}});
 if(result.receiptPath){
  const receiptName=path.basename(result.receiptPath);
  const index={schema:'offline-job-index/v1',receiptSha256:hash(fs.readFileSync(confined(snapshot.root,result.receiptPath))),packageSha256:snapshot.sha256,contentHash,action,platform:'douyin',accountKey:'demo',receiptName,expectedId};
  const indexFile=path.join(indexDir,snapshot.sha256+'-'+action+'.json');
  if(!fs.existsSync(indexFile))privateJson(indexFile,index);
  else if(JSON.stringify(readJson(snapshot.root,indexFile))!==JSON.stringify(index))throw Error('JOB_INDEX_CHANGED');
 }
 return {...result,offline:true,publicationPerformed:false,publicReadbackVerified:false,adapterCalls:calls,reviewAssurance:'synthetic contract only; no real facts, pixels, accounts or publication verified'};
}
function reconcile(snapshot,state,binding){
 const result=(status,extra={})=>({ok:status==='MOCK_RECONCILED_PUBLISHED'||status==='MOCK_RECONCILED_SUBMITTED',status,retryAllowed:false,offline:true,publicationPerformed:false,publicReadbackVerified:false,adapterCalls:0,...extra});
 const indexFile=path.join(state,'index',snapshot.sha256+'-publish.json');if(!fs.existsSync(indexFile))return result('NO_MOCK_RECEIPT');
 let index,receipt,remote;
 try{
  index=readJson(snapshot.root,indexFile);
  if(index.schema!=='offline-job-index/v1'||index.packageSha256!==snapshot.sha256||index.action!=='publish'||index.platform!==binding.platform||index.accountKey!==binding.accountKey||!/^[a-f0-9]{64}$/.test(index.contentHash)||index.receiptName!=='publish-v2-'+index.contentHash+'.json'||index.expectedId!=='mock-'+index.contentHash.slice(0,16))throw Error('INDEX_BINDING_MISMATCH');
  const receiptFile=path.join(state,'dispatch','douyin','demo',index.receiptName);
  confined(snapshot.root,receiptFile);if(hash(fs.readFileSync(receiptFile))!==index.receiptSha256)throw Error('ORIGINAL_RECEIPT_CHANGED');
  receipt=readJson(snapshot.root,receiptFile);
  if(receipt.contentHash!==index.contentHash||receipt.action!=='publish'||receipt.platform!==binding.platform||receipt.accountKey!==binding.accountKey||receipt.backend!=='ego_video'||(receipt.platformContentId&&receipt.platformContentId!==index.expectedId))throw Error('RECEIPT_BINDING_MISMATCH');
  remote=readJson(snapshot.root,path.join(state,'remote',index.contentHash+'.json'));
  if(!Array.isArray(remote.rows))throw Error('INVENTORY_SHAPE_INVALID');
  const rows=remote.rows.filter(x=>x.schema==='offline-native-record/v1'&&x.platform===binding.platform&&x.accountKey===binding.accountKey&&x.creatorUid===binding.apiUid&&x.contentHash===index.contentHash&&x.packageSha256===snapshot.sha256&&x.contentId===index.expectedId);
  if(rows.length!==1||remote.rows.length!==1)throw Error('EXACT_ID_RECONCILIATION_AMBIGUOUS');
  if(!['PUBLISHED','SUBMITTED'].includes(rows[0].status))throw Error('STATUS_UNKNOWN');
  const status=rows[0].status==='PUBLISHED'?'MOCK_RECONCILED_PUBLISHED':'MOCK_RECONCILED_SUBMITTED';
  // Append separate evidence; original uncertain receipt/reservation is retained.
  const evidenceDir=mkdirInside(snapshot.root,path.join(state,'reconciliation'));
  const record={schema:'offline-reconciliation/v1',packageSha256:snapshot.sha256,contentHash:index.contentHash,platform:'douyin',accountKey:'demo',contentId:index.expectedId,status,retryAllowed:false};
  const evidence=path.join(evidenceDir,index.contentHash+'-'+status+'.json');if(!fs.existsSync(evidence))privateJson(evidence,record);else if(JSON.stringify(readJson(snapshot.root,evidence))!==JSON.stringify(record))throw Error('RECONCILIATION_EVIDENCE_CHANGED');
  return result(status,{platformContentId:index.expectedId,originalStatus:receipt.status});
 }catch(e){return result('MOCK_RECONCILIATION_UNKNOWN',{code:String(e.message).split(':')[0]});}
}
