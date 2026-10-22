import {buildPersonalCoverVisualRuntimePrefix} from './douyin-personal-native-visual-reconciliation.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readPackage,coverForPlatform,validateDouyinScheduleIntent} from './content-package.mjs';
import {resolveSchoolAccountBinding} from './school-account.mjs';
import {buildIdentity} from '../v2/lib/identity.mjs';
import {nativeVideoRecoveryProof,ensureNativeVideoRecoveryPreview} from '../v2/ego/native-video-recovery.mjs';
import {requiredGates} from '../v2/lib/model.mjs';
import {runEgoPreflight} from '../run-school-account.mjs';
import {assertChannelsReadySourceProofReleaseContext} from './channels-ready-source-proof-resume.mjs';
import {assertDouyinWindowBindingPreparedResult} from './douyin-window-binding-resume.mjs';
import {needsDouyinCreatorReader,douyinCreatorReaderFragment} from './douyin-creator-reader-fragment.mjs';
import {executeNativeCreatorReadback,verifyDouyinScheduleReadback} from './ego-creator-readback.mjs';
import {DOUYIN_POI_NATIVE_CONTRACT,probeDouyinPoiMounted,validateDouyinPoiReceipt} from './douyin-poi-native.mjs';
import {validatePersonalDouyinWriteAdmission} from './personal-write-admission.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../v2');
const FILES={douyin:'douyin.mjs',xiaohongshu:'xiaohongshu.mjs',wechat_channels:'wechat-channels.mjs',bilibili:'bilibili.mjs'};
function stable(value){if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;return JSON.stringify(value);}
const DOUYIN_WINDOW_SAFE_IDENTITY=Object.freeze({});
const DOUYIN_WINDOW_OLD_BINDING=Object.freeze({});
export function selectNewDouyinContentId(candidates,before=[]){
 const valid=values=>[...new Set((Array.isArray(values)?values:[]).filter(value=>typeof value==='string'&&/^\d{15,22}$/.test(value)))];
 const old=new Set(valid(before)),fresh=valid(candidates).filter(value=>!old.has(value));
 return fresh.length===1?fresh[0]:null;
}
export function isDouyinScheduledRowMatch(row,{expectedTitle,expectedDescription,expectedPublicTimeSeconds,ownerUid}={}){
 const compact=value=>String(value??'').normalize('NFC').replace(/\s+/g,' ').trim();
 if(typeof row?.id!=='string'||!/^\d{15,22}$/.test(row.id)||typeof ownerUid!=='string'||!/^\d+$/.test(ownerUid)
  ||row.ownerUid!==ownerUid||row.publicTimeSeconds!==expectedPublicTimeSeconds)return false;
 const actual=compact(row.title),title=compact(expectedTitle),description=compact(expectedDescription);
 return Boolean(actual&&(actual===title||(description&&actual.includes(description))));
}
export function readDouyinNativeScheduledCardsInPage({expectedTitle,expectedPublicTimeSeconds}={}){
 const compact=value=>String(value??'').normalize('NFC').replace(/\s+/g,' ').trim();
 try{
  if(typeof expectedTitle!=='string'||!expectedTitle.trim()||!Number.isSafeInteger(expectedPublicTimeSeconds))return {ok:false,code:'DOUYIN_NATIVE_SCHEDULE_EXPECTATION_INVALID',rows:[]};
  const date=new Date((expectedPublicTimeSeconds+8*60*60)*1000);
  if(!Number.isFinite(date.getTime()))return {ok:false,code:'DOUYIN_NATIVE_SCHEDULE_EXPECTATION_INVALID',rows:[]};
  const pad=value=>String(value).padStart(2,'0');
  const localDateText=`${date.getUTCFullYear()}年${pad(date.getUTCMonth()+1)}月${pad(date.getUTCDate())}日${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  const visible=element=>{if(!element)return false;const rect=element.getBoundingClientRect(),style=getComputedStyle(element);return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)>0;};
  const titles=[...document.querySelectorAll('.info-title-text-Zob9RV')].filter(element=>visible(element)&&compact(element.innerText||element.textContent)===compact(expectedTitle));
  if(titles.length>50)return {ok:false,code:'DOUYIN_NATIVE_SCHEDULE_CARD_LIMIT',rows:[]};
  const rows=[];
  for(const element of titles){
   const fiberKeys=Object.keys(element).filter(key=>key.startsWith('__reactFiber$'));
   if(fiberKeys.length!==1)return {ok:false,code:'DOUYIN_NATIVE_SCHEDULE_FIBER_AMBIGUOUS',rows:[]};
   let fiber=element[fiberKeys[0]];
   for(let depth=0;depth<6;depth++)fiber=fiber?.return;
   const record=fiber?.memoizedProps?.data;
   if(!record||typeof record!=='object'||Array.isArray(record)||!record.timer||typeof record.timer!=='object')return {ok:false,code:'DOUYIN_NATIVE_SCHEDULE_RECORD_MISSING',rows:[]};
   let cardText='',fallbackCardText='';let parent=element;
   for(let depth=0;depth<8&&parent;depth++,parent=parent.parentElement){
    const text=String(parent.innerText||parent.textContent||''),flattened=text.replace(/\s+/g,'');
    if(compact(text).includes(compact(expectedTitle))){fallbackCardText=text;if(flattened.includes(localDateText)&&flattened.includes('审核中')){cardText=text;break;}}
   }
   if(!cardText)cardText=fallbackCardText;
   if(!cardText)return {ok:false,code:'DOUYIN_NATIVE_SCHEDULE_CARD_TEXT_MISSING',rows:[]};
   const authorUid=typeof record.author?.uid==='string'&&/^\d+$/.test(record.author.uid)?record.author.uid:(typeof record.author_user_id==='number'&&Number.isSafeInteger(record.author_user_id)&&record.author_user_id>=0?String(record.author_user_id):null);
   rows.push({domTitle:compact(element.innerText||element.textContent),cardText,
    awemeId:record.aweme_id,authorUid,itemTitle:record.item_title,description:record.desc,
    timerPublicTime:record.timer.public_time,timerStatus:record.timer.status,statusValue:record.status_value});
  }
  return {ok:true,rows};
 }catch{return {ok:false,code:'DOUYIN_NATIVE_SCHEDULE_DOM_UNAVAILABLE',rows:[]};}
}
export function validateDouyinNativeScheduledCard(row,{expectedTitle,expectedDescription,expectedPublicTimeSeconds,ownerUid}={}){
 const compact=value=>String(value??'').normalize('NFC').replace(/\s+/g,' ').trim();
 const id=row?.awemeId,actualOwner=typeof row?.authorUid==='string'&&/^\d+$/.test(row.authorUid)?row.authorUid:null,description=compact(row?.description),expectedBody=compact(expectedDescription);
 const expectedDate=new Date((Number(expectedPublicTimeSeconds)+8*60*60)*1000),pad=value=>String(value).padStart(2,'0');
 const displayTime=Number.isFinite(expectedDate.getTime())?`${expectedDate.getUTCFullYear()}年${pad(expectedDate.getUTCMonth()+1)}月${pad(expectedDate.getUTCDate())}日${pad(expectedDate.getUTCHours())}:${pad(expectedDate.getUTCMinutes())}`:'';
 const visibleText=String(row?.cardText??'').normalize('NFC').replace(/\s+/g,'');
 if(typeof id!=='string'||!/^\d{15,22}$/.test(id)||actualOwner!==ownerUid||typeof ownerUid!=='string'||!/^\d+$/.test(ownerUid)
  ||compact(row?.domTitle)!==compact(expectedTitle)||compact(row?.itemTitle)!==compact(expectedTitle)
  ||!expectedBody||!description.includes(expectedBody)||row?.timerPublicTime!==expectedPublicTimeSeconds||row?.timerStatus!==0||row?.statusValue!==141
  ||!displayTime||!visibleText.includes(displayTime)||!visibleText.includes('审核中'))return {ok:false,code:'DOUYIN_NATIVE_SCHEDULE_CARD_MISMATCH'};
 return {ok:true,row:{id,title:description,ownerUid:actualOwner,publicTimeSeconds:row.timerPublicTime,source:'ego_native_management_react_props',nativeStatus:'审核中',nativeStatusValue:row.statusValue,timerStatus:row.timerStatus,domTitle:compact(row.domTitle),itemTitle:compact(row.itemTitle),description,cardText:compact(row.cardText),nativeCardEvidence:row}};
}
function readPinnedDouyinUid(){throw Error('BUSINESS_CASE_CONTINUATION_EXCLUDED');}
function performanceLearningSeal(file,platform,accountKey,pkg={}){
 const runDir=path.basename(path.dirname(file))==='packages_ready'?path.dirname(path.dirname(file)):path.dirname(file);
 const learningPath=path.join(runDir,'PERFORMANCE_LEARNING.json'),sealPath=path.join(runDir,'PERFORMANCE_LEARNING.SEAL.json');
 let raw,sealRaw,value,seal;
 try{raw=fs.readFileSync(learningPath);value=JSON.parse(raw.toString('utf8'));sealRaw=fs.readFileSync(sealPath);seal=JSON.parse(sealRaw.toString('utf8'));}
 catch{throw new Error('PERFORMANCE_LEARNING_NOT_SEALED_FOR_FIRST_PUBLISH');}
 const staticPart=Object.fromEntries(['schema','schemaVersion','caseId','deliveryRunPath','target','package','forecast','reviewRef','windowHours'].map(key=>[key,value[key]]));
 if(value?.schema!=='own-performance-learning/v1'||value.schemaVersion!==1||seal?.schema!=='own-learning-seal/v1'
  ||seal.staticSha256!==crypto.createHash('sha256').update(stable(staticPart)).digest('hex')
  ||value.deliveryRunPath!==runDir||value.target?.platform!==platform||value.target?.accountKey!==accountKey
  ||value.target?.subjectKey!==pkg.subject?.key||value.target?.mediaType!=='video'
  ||value.package?.kind!=='publisher_package'||value.forecast?.recordedBeforeFirstPublish!==true
  ||typeof value.forecast?.hypothesis!=='string'||!value.forecast.hypothesis.trim()
  ||typeof value.forecast?.primaryVariable!=='string'||!value.forecast.primaryVariable.trim()
  ||typeof value.forecast?.primaryNativeMetric!=='string'||!value.forecast.primaryNativeMetric.trim()
  ||value.publication?.state!=='NOT_PUBLISHED'||value.publication?.platformContentId!==null)throw new Error('PERFORMANCE_LEARNING_NOT_SEALED_FOR_FIRST_PUBLISH');
 const ref=value.package?.manifestRef;
 if(!ref?.path||path.resolve(ref.path)!==path.resolve(file)||!/^([a-f0-9]{64})$/.test(ref.sha256||''))throw new Error('PERFORMANCE_LEARNING_PACKAGE_PIN_REQUIRED');
 const packageBytes=fs.readFileSync(ref.path);
 if(crypto.createHash('sha256').update(packageBytes).digest('hex')!==ref.sha256)throw new Error('PERFORMANCE_LEARNING_PACKAGE_PIN_CHANGED');
 return {path:learningPath,sha256:crypto.createHash('sha256').update(raw).digest('hex'),sealPath,sealSha256:crypto.createHash('sha256').update(fs.readFileSync(sealPath)).digest('hex'),staticSha256:seal.staticSha256,runDir};
}
export function assertPublicationNotHeld(statePath,identity,binding) {
 const file=path.join(path.dirname(path.resolve(statePath)),'school-content-hold.json');
 if(!fs.existsSync(file))return {ok:true};
 let hold;try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw new Error();hold=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('CONTENT_HOLD_RECORD_INVALID')}
 if(hold.schema!=='school-content-hold/v1'||hold.jobFingerprint!==identity.fingerprint||hold.platform!==binding.platform||hold.accountKey!==binding.accountKey||hold.status!=='QUALITY_RETURN'||typeof hold.reason!=='string'||!hold.reason.trim())throw new Error('CONTENT_HOLD_RECORD_INVALID');
 throw new Error('CONTENT_QUALITY_RETURN_DO_NOT_PUBLISH');
}
export async function releaseContext(file,statePath,matrix,{read=readPackage,identity=buildIdentity,channelsReadySourceProofResume=null,sourceStateBase,douyinWindowBindingPrepared=null,assertDouyinWindowBindingPreparedResult:verifyPreparedResult=assertDouyinWindowBindingPreparedResult}={}) {
 if(!statePath)throw new Error('PREPARED_VIDEO_STATE_REQUIRED');
 const raw=JSON.parse(fs.readFileSync(file,'utf8')),b=resolveSchoolAccountBinding(raw.schoolAccount,matrix);
 if(!FILES[b.platform])throw new Error('VIDEO_RELEASE_PLATFORM_NOT_IMPLEMENTED');
 let pkg={...read(file),schoolAccount:b},id=await identity(pkg);
 if(b.platform==='douyin'&&Object.prototype.hasOwnProperty.call(pkg,'douyinSchedule')){
  const schedule=validateDouyinScheduleIntent(pkg.douyinSchedule);
  if(!schedule.ok)throw new Error(`DOUYIN_SCHEDULE_INTENT_INVALID:${schedule.errors.join('; ')}`);
  if(typeof b.apiUid!=='string'||!/^\d+$/.test(b.apiUid))throw new Error('DOUYIN_SCHEDULE_NATIVE_READBACK_BINDING_REQUIRED');
 }
 let releaseBinding=b,learningSeal=null,verifiedWindowBindingPrepared=null;
 if(douyinWindowBindingPrepared){
  if(b.platform!=='douyin'||douyinWindowBindingPrepared.status!=='PREPARED'
   ||path.resolve(douyinWindowBindingPrepared.statePath||'')!==path.resolve(statePath)
   ||!douyinWindowBindingPrepared.resultPath)throw new Error('DOUYIN_WINDOW_BINDING_PREPARED_CONTEXT_REQUIRED');
  const verified=await verifyPreparedResult({
   resultPath:douyinWindowBindingPrepared.resultPath,packagePath:path.resolve(file),statePath:path.resolve(statePath),
   outerReceiptPath:'EXCLUDED_CASE_DATA',matrix,
  });
  if(verified?.ok!==true||verified.status!=='PREPARED'||verified.preparedStateSha256!==douyinWindowBindingPrepared.preparedStateSha256
   ||verified.jobId!==douyinWindowBindingPrepared.jobId||verified.fingerprint!==id.fingerprint
   ||JSON.stringify(verified.executionBinding)!==JSON.stringify(douyinWindowBindingPrepared.executionBinding))throw new Error('DOUYIN_WINDOW_BINDING_PREPARED_SIDECAR_CHANGED');
  const preparedResultStat=fs.lstatSync(verified.resultPath);
  if(!preparedResultStat.isFile()||preparedResultStat.isSymbolicLink())throw new Error('DOUYIN_WINDOW_BINDING_PREPARED_RESULT_FILE_INVALID');
  verified.resultFileSha256=crypto.createHash('sha256').update(fs.readFileSync(verified.resultPath)).digest('hex');
  verifiedWindowBindingPrepared=verified;
  const execution=verified.executionBinding;
  releaseBinding={...b,egoProfileId:execution.profileId,taskSpaceId:execution.spaceId,taskSpaceName:execution.spaceName,pageLabel:execution.pageLabel,targetId:execution.targetId};
  pkg={...pkg,schoolAccount:releaseBinding};
  learningSeal=performanceLearningSeal(path.resolve(file),b.platform,b.accountKey,pkg);
 }
 const stateBytes=fs.readFileSync(statePath),state=JSON.parse(stateBytes.toString('utf8')),item=state.platforms?.[b.platform],preparedStateSha256=crypto.createHash('sha256').update(stateBytes).digest('hex');
 if(state.fingerprint!==id.fingerprint&&b.platform!=='youtube'&&pkg.youtubeAlteredContentExplicit===false&&typeof pkg.youtubeAlteredContent==='boolean'){
  // Legacy draft preparation serializes the normalized package, so V2 reads this irrelevant YouTube default twice. Accept only its exact matching fingerprint.
  const candidate={...pkg,youtubeAlteredContentExplicit:true},candidateId=await identity(candidate);
  if(state.fingerprint===candidateId.fingerprint){pkg=candidate;id=candidateId;}
 }
 if(state.fingerprint!==id.fingerprint)throw new Error('PREPARED_CONTENT_FINGERPRINT_MISMATCH');
 assertPublicationNotHeld(statePath,id,b);
 if(!item?.verdict?.ready||item.status!=='ready')throw new Error('PREPARED_VIDEO_NOT_READY');
 if(Number(item.taskSpaceId)!==releaseBinding.taskSpaceId||item.taskSpaceName!==releaseBinding.taskSpaceName)throw new Error('PREPARED_TARGET_MISMATCH');
 if(item.videoReceipt?.fingerprint!==id.fingerprint||Number(item.videoReceipt.taskSpaceId)!==releaseBinding.taskSpaceId)throw new Error('PREPARED_VIDEO_UPLOAD_RECEIPT_REQUIRED');
 let sourceProofReleaseLock=null;
 const sourceProofClaimMarker=path.join(path.dirname(path.resolve(statePath)),'channels-ready-source-proof-resume.claim');
 const historyShape=item.history?.map(row=>row.phase).join();
 const sourceProofOriginalHistoryShape=historyShape==='inspect,inspect,upload_start,prefill,mutate,verify,inspect,verify';
 const sourceProofSafetyRetryHistoryShape=historyShape==='inspect,inspect,upload_start,prefill,mutate,verify,inspect,verify,inspect,verify';
 const sourceProofHistoryShape=sourceProofOriginalHistoryShape||sourceProofSafetyRetryHistoryShape;
 const sourceProofIntent=b.platform==='wechat_channels'&&(channelsReadySourceProofResume?.resumeType==='channels_ready_source_proof'
  ||sourceProofHistoryShape||fs.existsSync(sourceProofClaimMarker)||fs.existsSync(`${sourceProofClaimMarker}.result.json`)
  ||item.videoReceipt?.nativeMedia?.recoveryMode==='ready_source_proof');
 let sourceProofEvidenceRecorded=false;
 if(b.platform==='wechat_channels'){
  for(const row of item.history||[]){
   const evidencePath=path.resolve(row.evidencePath||'');
   if(!evidencePath.startsWith(path.join(path.dirname(path.resolve(statePath)),'evidence')+path.sep)||!fs.existsSync(evidencePath)){
    if(sourceProofIntent)throw new Error('CHANNELS_READY_SOURCE_EVIDENCE_PATH_REJECTED');
    continue;
   }
   const stat=fs.lstatSync(evidencePath);
   if(!stat.isFile()||stat.isSymbolicLink()){
    if(sourceProofIntent)throw new Error('CHANNELS_READY_SOURCE_EVIDENCE_FILE_INVALID');
    continue;
   }
   try{
    const evidence=JSON.parse(fs.readFileSync(evidencePath,'utf8'));
    if(sourceProofIntent&&(evidence.observation?.platform!=='wechat_channels'||evidence.observation?.phase!==row.phase))throw new Error('CHANNELS_READY_SOURCE_EVIDENCE_HISTORY_MISMATCH');
    if(evidence.observation?.actions?.upload?.proof?.recoveryMode==='ready_source_proof')sourceProofEvidenceRecorded=true;
   }catch(error){
    if(sourceProofIntent)throw new Error(error.message==='CHANNELS_READY_SOURCE_EVIDENCE_HISTORY_MISMATCH'?error.message:'CHANNELS_READY_SOURCE_EVIDENCE_INVALID');
   }
  }
 }
 const sourceProofWasRecorded=sourceProofIntent||sourceProofEvidenceRecorded;
 if(b.platform==='wechat_channels'&&(channelsReadySourceProofResume?.resumeType==='channels_ready_source_proof'||sourceProofWasRecorded||item.videoReceipt?.nativeMedia?.recoveryMode==='ready_source_proof')){
  sourceProofReleaseLock=assertChannelsReadySourceProofReleaseContext({preparedStatePath:statePath,sourceStateBase:sourceStateBase||channelsReadySourceProofResume?.sourceStateBase,binding:b,resume:channelsReadySourceProofResume,identity:id});
 }
 return {pkg,binding:releaseBinding,originalBinding:b,identity:id,state,item,statePath:path.resolve(statePath),preparedStateSha256,sourceProofReleaseLock,douyinWindowBindingPrepared:verifiedWindowBindingPrepared,performanceLearningSeal:learningSeal};
}
export function buildVideoReleaseScript(c) {
 const {pkg,binding:b,identity:id,item,statePath}=c;
 const markerPath=path.join(path.dirname(statePath),'school-final-'+b.platform+'-'+id.fingerprint+'.json');
 const creatorReader=needsDouyinCreatorReader(b.platform,pkg)?douyinCreatorReaderFragment(b.platform,pkg):'';
 const poiNativeModulePath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'douyin-poi-native.mjs');
 const header=buildPersonalCoverVisualRuntimePrefix(c)+`import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
${b.platform==='douyin'?`import {DOUYIN_POI_NATIVE_CONTRACT,validateDouyinPoiReceipt,probeDouyinPoiMounted} from ${JSON.stringify(poiNativeModulePath)};`:''}
const platform=${JSON.stringify(b.platform)},phase='verify',taskName=${JSON.stringify(b.taskSpaceName)},taskSpaceRef=${JSON.stringify(String(b.taskSpaceId))};
const pkg=${JSON.stringify({...pkg,cover:coverForPlatform(pkg,b.platform)})};
const recoveryProbe=${nativeVideoRecoveryProof.toString()};
const recoveryPreview=${ensureNativeVideoRecoveryPreview.toString()};
const channelsBlobRecovery=${JSON.stringify(item.videoReceipt?.mode==='recovered_original_blob'?{version:1,neverInject:true,video:id.video,binding:b}:null)};
const nativeRecovery=${JSON.stringify(item.videoReceipt?.mode==='recovered_original_file'?{version:1,neverInject:true,fingerprint:id.fingerprint,binding:b,video:{...id.video,name:path.basename(id.video.path)},nativeVideoId:item.videoReceipt.nativeMedia?.vid,nativeMedia:item.videoReceipt.nativeMedia}:null)};
const sourceProofReleaseLock=${JSON.stringify(c.sourceProofReleaseLock||null)};
const videoPath=${JSON.stringify(path.resolve(pkg.videoPath))},packagePath='',expectedReceipts=${JSON.stringify(item.receipts||{})},expectedVideoReceipt=${JSON.stringify(item.videoReceipt)},receiptCheckpointPath='',jobFingerprint=${JSON.stringify(id.fingerprint)};
`;
 const finale=buildVideoReleaseFinale(c);
 return [header,creatorReader,fs.readFileSync(path.join(ROOT,'ego/school-runtime.mjs'),'utf8'),fs.readFileSync(path.join(ROOT,'ego/core.mjs'),'utf8'),fs.readFileSync(path.join(ROOT,'platforms',FILES[b.platform]),'utf8'),finale].filter(Boolean).join('\n\n');
}
export function buildDouyinPoiFinalClickGuard({pkg,receipt,jobFingerprint,binding,nativeContract=DOUYIN_POI_NATIVE_CONTRACT}={}) {
 if(!pkg?.douyinPoi)return '';
 const validation=validateDouyinPoiReceipt({pkg,receipt,jobFingerprint,binding,nativeContract});
 const mountedProbe=`(${probeDouyinPoiMounted.toString()})(${JSON.stringify(pkg.douyinPoi)},${JSON.stringify(receipt||null)},${JSON.stringify(nativeContract)})`;
 return `
    const poiReceiptValidation=${JSON.stringify(validation)};
    if(poiReceiptValidation.ok!==true)return {ok:false,clickCount:0,code:poiReceiptValidation.code||'DOUYIN_POI_RECEIPT_INVALID'};
    const poiMountedAtFinalClick=${mountedProbe};
    if(poiMountedAtFinalClick?.ok!==true)return {ok:false,clickCount:0,code:poiMountedAtFinalClick?.code||'DOUYIN_POI_FINAL_MOUNT_CHECK_FAILED'};
 `;
}
export function buildDouyinScheduleFinalClickGuard({pkg}={}) {
 if(pkg?.schoolAccount?.platform!=='douyin')return '';
 const requested=Object.prototype.hasOwnProperty.call(pkg,'douyinSchedule');
 let expectedLocal='';
 if(requested){
  const checked=validateDouyinScheduleIntent(pkg.douyinSchedule);
  if(!checked.ok)return `const douyinScheduleFinalState={ok:false,reason:'schedule_intent_invalid'};if(!douyinScheduleFinalState.ok)return {ok:false,clickCount:0,code:'DOUYIN_SCHEDULE_INTENT_INVALID'};`;
  expectedLocal=checked.localDateTime;
 }
 return `
    const douyinScheduleFinalState=(()=>{
      const compact=value=>String(value||'').replace(/\\s+/g,' ').trim();
      const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0;};
      const labels=[...document.querySelectorAll('label.radio-d4zkru.one-line-pe7juM')].map(el=>({text:compact(el.innerText||el.textContent),checked:el.getAttribute('data-checked')==='true',inputs:[...el.querySelectorAll('input[type="checkbox"]')]}));
      const timed=labels.filter(x=>x.text==='定时发布'),immediate=labels.filter(x=>x.text==='立即发布');
      if(timed.length!==1||immediate.length!==1||timed[0].inputs.length!==1||immediate[0].inputs.length!==1)return {ok:false,reason:'native_mode_controls_not_unique'};
      const timedOn=timed[0].checked&&timed[0].inputs[0].checked===true&&timed[0].inputs[0].value==='1';
      const immediateOn=immediate[0].checked&&immediate[0].inputs[0].checked===true&&immediate[0].inputs[0].value==='0';
      if(!${JSON.stringify(requested)})return {ok:immediateOn&&!timedOn,reason:immediateOn&&!timedOn?null:'immediate_mode_changed',mode:'immediate'};
      const dates=[...document.querySelectorAll('input[placeholder="日期和时间"]')];
      if(!timedOn||immediateOn||dates.length!==1||!visible(dates[0])||dates[0].getAttribute('format')!=='yyyy-MM-dd HH:mm')return {ok:false,reason:'native_scheduled_controls_changed',timedOn,immediateOn,dateCount:dates.length};
      const actual=String(dates[0].value||''),expected=${JSON.stringify(expectedLocal)};
      const epoch=Date.parse(expected.replace(' ','T')+':00+08:00'),now=Date.now();
      const inWindow=Number.isFinite(epoch)&&epoch>=now+2*60*60*1000&&epoch<=now+14*24*60*60*1000;
      return {ok:actual===expected&&inWindow,reason:actual!==expected?'scheduled_datetime_changed':!inWindow?'schedule_window_expired':null,mode:'scheduled',actual,expected,inWindow};
    })();
    if(douyinScheduleFinalState.ok!==true)return {ok:false,clickCount:0,code:'DOUYIN_SCHEDULE_FINAL_STATE_MISMATCH',evidence:douyinScheduleFinalState};
 `;
}
export function buildVideoReleaseFinale(c) {
 const {pkg,binding:b,identity:id,statePath,item}=c;
 const markerPath=path.join(path.dirname(statePath),'school-final-'+b.platform+'-'+id.fingerprint+'.json');
 const personalR3Final=c.personalR3FinalAdmission===true;
 if(personalR3Final&&(b.platform!=='douyin'||b.accountKey!=='reserved_personal_route'||b.accountId!=='EXCLUDED_PUBLIC_ACCOUNT_ID'||b.apiUid!=='EXCLUDED_API_UID'||b.egoProfileId!=='Excluded Profile'||b.taskSpaceId!==79||b.pageLabel!=='p1'||b.targetId!=='EXCLUDED_CASE_FINGERPRINT'||id.fingerprint!=='EXCLUDED_CASE_FINGERPRINT'||!c.personalFinalBoundFiles?.length||!c.personalCoverVisualContract))throw Error('PERSONAL_R3_FINAL_EXACT_CONTEXT_REQUIRED');
 const douyinApiBound=b.platform==='douyin'&&(Boolean(b.accountId)||Boolean(b.apiUid));
 const douyinSchoolImmediateProofRequested=b.platform==='douyin'&&!Object.prototype.hasOwnProperty.call(pkg,'douyinSchedule')&&b.accountKey!=='reserved_personal_route'&&!c.douyinWindowBindingPrepared;
 const douyinWindowBindingPrepared=JSON.stringify(c.douyinWindowBindingPrepared||null);
 const performanceLearningSeal=JSON.stringify(c.performanceLearningSeal||null);
 const douyinWindowOldBinding=JSON.stringify(c.douyinWindowBindingPrepared?DOUYIN_WINDOW_OLD_BINDING:null);
 const douyinWindowExpectedUid=c.douyinWindowBindingPrepared?`(()=>{const pin=${JSON.stringify(DOUYIN_WINDOW_SAFE_IDENTITY)};const raw=fs.readFileSync(pin.path);if(crypto.createHash('sha256').update(raw).digest('hex')!==pin.sha256)throw new Error('DOUYIN_WINDOW_BINDING_SAFE_IDENTITY_HASH_CHANGED');const value=JSON.parse(raw.toString('utf8'));if(value.spaceId!==3||value.targetId!=='EXCLUDED_CASE_FINGERPRINT'||!/^\\d+$/.test(value.identity?.uid||''))throw new Error('DOUYIN_WINDOW_BINDING_SAFE_IDENTITY_SCOPE_REJECTED');return value.identity.uid;})()`:JSON.stringify('');
const douyinIdentityReader=douyinApiBound?`
const expectedDouyinBinding=${JSON.stringify({spaceId:b.taskSpaceId,spaceName:b.taskSpaceName,profileId:b.egoProfileId,pageLabel:b.pageLabel,targetId:b.targetId,uploadUrl:'https://creator.douyin.com/creator-micro/content/upload'})};
const isDouyinScheduledRowMatch=${isDouyinScheduledRowMatch.toString()};
const readDouyinNativeScheduledCardsInPage=${readDouyinNativeScheduledCardsInPage.toString()};
const validateDouyinNativeScheduledCard=${validateDouyinNativeScheduledCard.toString()};
const captureDouyinBinding=async()=>{
 try{
  const listed=await listTaskSpaces();
  const oldMatches=douyinWindowBindingPrepared?(listed||[]).filter(s=>Number(s?.id)===douyinWindowOldBinding.spaceId||String(s?.name||'')===douyinWindowOldBinding.spaceName):[];
  if(oldMatches.length)return {ok:false,code:'DOUYIN_WINDOW_BINDING_OLD_SPACE_STILL_PRESENT'};
  const matches=(listed||[]).filter(s=>Number(s?.id)===expectedDouyinBinding.spaceId&&String(s?.name||'')===expectedDouyinBinding.spaceName);
  if(matches.length!==1||matches[0]?.ownership!=='agent'||matches[0]?.profileId!==expectedDouyinBinding.profileId)return {ok:false,code:'ACCOUNT_BINDING_CHANGED_BEFORE_CLICK'};
  const task=await taskSpace(expectedDouyinBinding.spaceId);
  if(Number(task?.spaceId)!==expectedDouyinBinding.spaceId||String(task?.name||'')!==expectedDouyinBinding.spaceName||task?.ownership!=='agent')return {ok:false,code:'ACCOUNT_BINDING_CHANGED_BEFORE_CLICK'};
  const tabs=await task.tabs(),pages=(tabs||[]).filter(t=>t?.label===expectedDouyinBinding.pageLabel);
  if(pages.length!==1||String(pages[0]?.targetId||'')!==expectedDouyinBinding.targetId)return {ok:false,code:'ACCOUNT_BINDING_CHANGED_BEFORE_CLICK'};
  const url=await task.page(expectedDouyinBinding.pageLabel).url();
  if(url!==pages[0]?.url||new URL(url).origin!=='https://creator.douyin.com'||(douyinWindowBindingPrepared&&url!==expectedDouyinBinding.uploadUrl))return {ok:false,code:'ACCOUNT_BINDING_CHANGED_BEFORE_CLICK'};
  return {ok:true,oldSpaceAbsent:oldMatches.length===0,spaceId:expectedDouyinBinding.spaceId,spaceName:expectedDouyinBinding.spaceName,profileId:expectedDouyinBinding.profileId,pageLabel:expectedDouyinBinding.pageLabel,targetId:expectedDouyinBinding.targetId,url};
 }catch{return {ok:false,code:'ACCOUNT_BINDING_CHANGED_BEFORE_CLICK'};}
};
const readDouyinPublishedRows=async(allowPostClickUploadToManageTransition=false)=>{
 try{
  const sameBinding=(before,after)=>{
   if(!before?.ok||!after?.ok)return false;
   const stableKeys=['oldSpaceAbsent','spaceId','spaceName','profileId','pageLabel','targetId'];
   if(!stableKeys.every(key=>before[key]===after[key]))return false;
   if(before.url===after.url)return true;
   if(!allowPostClickUploadToManageTransition||!${JSON.stringify(douyinSchoolImmediateProofRequested)})return false;
   try{
    const from=new URL(before.url),to=new URL(after.url),upload=new URL(expectedDouyinBinding.uploadUrl);
    const allowedInitialUrls=new Set([upload.href,'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page']);
    return from.origin==='https://creator.douyin.com'&&to.origin===from.origin
      &&allowedInitialUrls.has(from.href)&&to.pathname==='/creator-micro/content/manage'
      &&to.search==='?enter_from=publish'&&!to.hash;
   }catch{return false;}
  };
  const before=await captureDouyinBinding();if(!before.ok)return {ok:false,code:before.code||'DOUYIN_PUBLISHED_LIST_BINDING_CHANGED'};
  const task=await taskSpace(expectedDouyinBinding.spaceId),page=task.page(expectedDouyinBinding.pageLabel);
  if(!${JSON.stringify(douyinSchoolImmediateProofRequested)}){
   const data=await creatorGet(page,'https://creator.douyin.com/janus/douyin/creator/pc/work_list?page_size=50&status=1');
   const after=await captureDouyinBinding();if(!sameBinding(before,after))return {ok:false,code:after.code||'DOUYIN_PUBLISHED_LIST_BINDING_CHANGED'};
   const rows=data?.work_list??data?.aweme_list;
   if(!Array.isArray(rows)||('has_more'in data&&![false,true,0,1].includes(data.has_more)))return {ok:false,code:'DOUYIN_PUBLISHED_LIST_SHAPE_INVALID'};
   const ids=[];for(const row of rows){const value=row?.aweme_id;if(typeof value!=='string'||!/^\\d{15,22}$/.test(value))return {ok:false,code:'DOUYIN_PUBLISHED_LIST_ID_INVALID'};ids.push({id:value,title:typeof row?.desc==='string'?row.desc:''});}
   if(new Set(ids.map(x=>x.id)).size!==ids.length)return {ok:false,code:'DOUYIN_PUBLISHED_LIST_DUPLICATE_ID'};
   return {ok:true,rows:ids};
  }
 const exactId=value=>typeof value==='string'&&/^\\d+$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):null;
  const readIdentity=async()=>{
   const response=await creatorGet(page,'https://creator.douyin.com/web/api/media/user/info/?aid=1128');
   if('bizstatus'in response&&response.bizstatus!==0)return null;
   const user=response?.user_info||response?.user,uid=exactId(user?.uid),accountId=exactId(user?.unique_id);
   const expectedUid=typeof pkg.schoolAccount.apiUid==='string'&&/^\\d+$/.test(pkg.schoolAccount.apiUid)?pkg.schoolAccount.apiUid:null;
   return uid&&(!expectedUid||uid===expectedUid)&&accountId===String(pkg.schoolAccount.accountId)&&String(user?.nickname||'').normalize('NFC')===String(pkg.schoolAccount.accountName||'').normalize('NFC')?{uid,accountId,nickname:user.nickname}:null;
  };
  const identityBefore=await readIdentity();if(!identityBefore)return {ok:false,code:'DOUYIN_PUBLISHED_LIST_ACCOUNT_IDENTITY_MISMATCH'};
  const ids=[],seenIds=new Set(),seenCursors=new Set();let cursor=null,complete=false;
  for(let hop=0;hop<20;hop++){
   const query=new URLSearchParams({page_size:'50',status:'1'});if(cursor!==null)query.set('max_cursor',cursor);
   const data=await creatorGet(page,'https://creator.douyin.com/janus/douyin/creator/pc/work_list?'+query.toString());
   const rows=data?.work_list??data?.aweme_list;
   if(!Array.isArray(rows)||![false,true,0,1].includes(data?.has_more))return {ok:false,code:'DOUYIN_PUBLISHED_LIST_SHAPE_INVALID'};
   for(const row of rows){
    const value=row?.aweme_id,owner=exactId(row?.author?.uid??row?.author_user_id);
    if(typeof value!=='string'||!/^\\d{15,22}$/.test(value)||owner!==identityBefore.uid)return {ok:false,code:'DOUYIN_PUBLISHED_LIST_ID_OR_OWNER_INVALID'};
    if(seenIds.has(value))return {ok:false,code:'DOUYIN_PUBLISHED_LIST_DUPLICATE_ID'};
    seenIds.add(value);ids.push({id:value,title:typeof row?.desc==='string'?row.desc:'',ownerUid:owner});
   }
   if(!data.has_more){complete=true;break;}
   const next=data.max_cursor===undefined||data.max_cursor===null?'':String(data.max_cursor);
   if(!next||next===String(cursor)||seenCursors.has(next))return {ok:false,code:'DOUYIN_PUBLISHED_LIST_CURSOR_STALLED'};
   cursor=next;seenCursors.add(next);
  }
  if(!complete)return {ok:false,code:'DOUYIN_PUBLISHED_LIST_WINDOW_INCOMPLETE'};
  const identityAfter=await readIdentity();if(!identityAfter||JSON.stringify(identityBefore)!==JSON.stringify(identityAfter))return {ok:false,code:'DOUYIN_PUBLISHED_LIST_ACCOUNT_IDENTITY_CHANGED'};
  const after=await captureDouyinBinding();if(!sameBinding(before,after))return {ok:false,code:after.code||'DOUYIN_PUBLISHED_LIST_BINDING_CHANGED'};
  const snapshotRows=ids.slice().sort((a,b)=>a.id.localeCompare(b.id));
  const snapshotSha256=crypto.createHash('sha256').update(JSON.stringify(snapshotRows)).digest('hex');
  return {ok:true,rows:ids,ownerUid:identityBefore.uid,identityVerified:true,complete:true,snapshotSha256};
 }catch(error){return {ok:false,code:String(error?.message||'DOUYIN_PUBLISHED_LIST_UNAVAILABLE').startsWith('CREATOR_')?'DOUYIN_PUBLISHED_LIST_UNAVAILABLE':'DOUYIN_PUBLISHED_LIST_UNAVAILABLE'};}
};
const readDouyinScheduleRows=async()=>{
 try{
  const before=await captureDouyinBinding();if(!before.ok)return {ok:false,code:before.code||'DOUYIN_SCHEDULE_LIST_BINDING_CHANGED'};
  const task=await taskSpace(expectedDouyinBinding.spaceId),page=task.page(expectedDouyinBinding.pageLabel);
  const identityResponse=await creatorGet(page,'https://creator.douyin.com/web/api/media/user/info/?aid=1128'),user=identityResponse?.user_info||identityResponse?.user;
  const exactId=value=>typeof value==='string'&&/^\\d+$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):null;
  const creatorUid=exactId(user?.uid),pinnedUid=typeof pkg.schoolAccount.apiUid==='string'&&/^\\d+$/.test(pkg.schoolAccount.apiUid)?pkg.schoolAccount.apiUid:creatorUid;if(!creatorUid||creatorUid!==pinnedUid||String(user?.nickname||'').normalize('NFC')!==pkg.schoolAccount.accountName.normalize('NFC')||exactId(user?.unique_id)!==pkg.schoolAccount.accountId)return {ok:false,code:'DOUYIN_SCHEDULE_LIST_ACCOUNT_IDENTITY_MISMATCH'};
  const data=await creatorGet(page,'https://creator.douyin.com/janus/douyin/creator/pc/work_list?page_size=50&status=0');
  const expectedTitle=String(pkg.douyinTitle||pkg.platformTitle?.douyin||pkg.title||'').normalize('NFC').replace(/\\s+/g,' ').trim(),expectedDescription=String(pkg.douyinDescription||pkg.description||'').normalize('NFC').replace(/\\s+/g,' ').trim(),expectedPublicTimeSeconds=Date.parse(pkg.douyinSchedule?.publishAt)/1000;
  if(!expectedTitle||!expectedDescription||!Number.isSafeInteger(expectedPublicTimeSeconds))return {ok:false,code:'DOUYIN_SCHEDULE_LIST_EXPECTATION_INVALID'};
  const nativeCapture=await page.evaluate('('+readDouyinNativeScheduledCardsInPage.toString()+')('+JSON.stringify({expectedTitle,expectedPublicTimeSeconds})+')');
  if(!nativeCapture||nativeCapture.ok!==true||!Array.isArray(nativeCapture.rows))return {ok:false,code:nativeCapture?.code||'DOUYIN_NATIVE_SCHEDULE_LIST_INVALID'};
  const after=await captureDouyinBinding();if(!after.ok||JSON.stringify(before)!==JSON.stringify(after))return {ok:false,code:after.code||'DOUYIN_SCHEDULE_LIST_BINDING_CHANGED'};
  const rows=data?.work_list??data?.aweme_list;
  if(!Array.isArray(rows)||('has_more'in data&&![false,true,0,1].includes(data.has_more)))return {ok:false,code:'DOUYIN_SCHEDULE_LIST_SHAPE_INVALID'};
  const ids=[];for(const row of rows){const value=row?.aweme_id,ownerValue=row?.author?.uid??row?.author_user_id,owner=typeof ownerValue==='string'&&/^\\d+$/.test(ownerValue)?ownerValue:typeof ownerValue==='number'&&Number.isSafeInteger(ownerValue)&&ownerValue>=0?String(ownerValue):null,rawTime=row?.public_time;
   if(typeof value!=='string'||!/^\\d{15,22}$/.test(value)||owner!==creatorUid)return {ok:false,code:'DOUYIN_SCHEDULE_LIST_ID_OR_OWNER_INVALID'};
   const seconds=(typeof rawTime==='number'&&Number.isSafeInteger(rawTime))?rawTime:(typeof rawTime==='string'&&/^\\d{1,12}$/.test(rawTime)?Number(rawTime):null);
   ids.push({id:value,title:typeof row?.desc==='string'?row.desc:'',ownerUid:owner,publicTimeSeconds:Number.isSafeInteger(seconds)?seconds:null,source:'ego_creator_work_list_status_0'});}
  const nativeIds=new Set();for(const raw of nativeCapture.rows){const validated=validateDouyinNativeScheduledCard(raw,{expectedTitle,expectedDescription,expectedPublicTimeSeconds,ownerUid:pinnedUid});if(!validated.ok)continue;if(nativeIds.has(validated.row.id))return {ok:false,code:'DOUYIN_NATIVE_SCHEDULE_DUPLICATE_ID'};nativeIds.add(validated.row.id);ids.push(validated.row);}
  const apiRows=ids.filter(row=>row.source!=='ego_native_management_react_props');if(new Set(apiRows.map(row=>row.id)).size!==apiRows.length)return {ok:false,code:'DOUYIN_SCHEDULE_LIST_DUPLICATE_ID'};
  const byId=new Map();for(const row of ids){const old=byId.get(row.id);if(!old||row.source==='ego_native_management_react_props')byId.set(row.id,row);}
  return {ok:true,rows:[...byId.values()]};
 }catch{return {ok:false,code:'DOUYIN_SCHEDULE_LIST_UNAVAILABLE'};}
};
const readDouyinApiIdentityAtClick=async()=>{
 try{
  const before=await captureDouyinBinding();if(!before.ok)return before;
  const page=(await taskSpace(expectedDouyinBinding.spaceId)).page(expectedDouyinBinding.pageLabel);
  const data=await creatorGet(page,'https://creator.douyin.com/web/api/media/user/info/?aid=1128');
  if('bizstatus'in data&&data.bizstatus!==0)return {ok:false,code:'ACCOUNT_IDENTITY_API_ERROR_BEFORE_CLICK'};
  const user=data?.user_info||data?.user;
  const exactId=value=>typeof value==='string'&&/^\\d+$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):null;
  const identity={status:200,uid:exactId(user?.uid),nickname:typeof user?.nickname==='string'?user.nickname:'',publicId:exactId(user?.unique_id)};
  if(${personalR3Final}&&user?.unique_id===''&&exactId(user?.short_id)==='EXCLUDED_PUBLIC_ACCOUNT_ID'&&identity.uid==='EXCLUDED_API_UID'&&identity.nickname==='示例作者')identity.publicId='EXCLUDED_PUBLIC_ACCOUNT_ID';
  const uidPinPresent=pkg.schoolAccount.apiUid!==undefined&&pkg.schoolAccount.apiUid!==null&&pkg.schoolAccount.apiUid!=='';
  const uidPinValid=!uidPinPresent||(typeof pkg.schoolAccount.apiUid==='string'&&/^\\d+$/.test(pkg.schoolAccount.apiUid)&&identity.uid===pkg.schoolAccount.apiUid);
  if(!/^\\d+$/.test(identity.uid||'')||!uidPinValid||(douyinWindowBindingPrepared&&identity.uid!==douyinWindowExpectedUid)||identity.nickname.normalize('NFC')!==pkg.schoolAccount.accountName.normalize('NFC')||identity.publicId!==pkg.schoolAccount.accountId)return {ok:false,code:'ACCOUNT_CHANGED_BEFORE_CLICK'};
  const after=await captureDouyinBinding();
  if(!after.ok||JSON.stringify(before)!==JSON.stringify(after))return {ok:false,code:after.code||'ACCOUNT_BINDING_CHANGED_BEFORE_CLICK'};
  // Keep the raw creator UID inside this host-side comparison only. The page
  // click script needs the result of the identity checks, not the identifier.
  return {ok:true,uidMatched:true,nicknameMatched:true,publicIdMatched:true,...after};
 }catch(error){return {ok:false,code:String(error?.message||'').startsWith('CREATOR_API_ERROR')?'ACCOUNT_IDENTITY_API_ERROR_BEFORE_CLICK':'ACCOUNT_IDENTITY_UNAVAILABLE_BEFORE_CLICK'};}
};` : '';
 const identityReadLine=douyinApiBound?'  const identityAtClick=await readDouyinApiIdentityAtClick();':'  const identityAtClick=null;';
 const identityArgument=douyinApiBound?',${JSON.stringify(identityAtClick)}':'';
 const migrationRelease=Boolean(c.douyinWindowBindingPrepared);
 const douyinPoiFinalClickGuard=b.platform==='douyin'?buildDouyinPoiFinalClickGuard({pkg,receipt:item?.receipts?.poi,jobFingerprint:id.fingerprint,binding:b}):'';
 const douyinScheduleRequested=b.platform==='douyin'&&Object.prototype.hasOwnProperty.call(pkg,'douyinSchedule');
 const douyinScheduleFinalClickGuard=b.platform==='douyin'?buildDouyinScheduleFinalClickGuard({pkg}):'';
 const douyinPublishedInventoryRequested=b.platform==='douyin'&&!douyinScheduleRequested&&(Boolean(c.douyinWindowBindingPrepared)||personalR3Final||(b.accountKey!=='reserved_personal_route'&&douyinApiBound));
 const douyinPostClickReadbackMaxMs=Number.isSafeInteger(c.douyinPostClickReadbackMaxMs)&&c.douyinPostClickReadbackMaxMs>=0?c.douyinPostClickReadbackMaxMs:90000;
 const douyinPostClickReadbackIntervalMs=Number.isSafeInteger(c.douyinPostClickReadbackIntervalMs)&&c.douyinPostClickReadbackIntervalMs>=0?c.douyinPostClickReadbackIntervalMs:2500;
 return `
const releaseMarker='SCHOOL_VIDEO_RELEASE:';
const nativeJobId=${JSON.stringify(c.state?.jobId||'')};
const douyinWindowBindingPrepared=${douyinWindowBindingPrepared},performanceLearningSeal=${performanceLearningSeal},douyinWindowOldBinding=${douyinWindowOldBinding},douyinWindowExpectedUid=${douyinWindowExpectedUid};
${douyinIdentityReader}
const checkSourceProofReleaseLock=()=>{
 const l=sourceProofReleaseLock;if(!l)return {ok:true};
 const hashFile=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 try{
  if(hashFile(l.preparedStatePath)!==l.preparedStateSha256||hashFile(l.outerClaimPath)!==l.outerClaimSha256||hashFile(l.sourceProofClaimPath)!==l.sourceProofClaimSha256||hashFile(l.sourceProofResultPath)!==l.sourceProofResultSha256||hashFile(l.originalReservationPath)!==l.originalReservationSha256)return {ok:false,code:'CHANNELS_READY_SOURCE_RELEASE_LINEAGE_CHANGED'};
  if(fs.existsSync(l.resumeResultPath))return {ok:false,code:'CHANNELS_READY_SOURCE_PUBLISH_ALREADY_RESUMED'};
  const state=JSON.parse(fs.readFileSync(l.preparedStatePath,'utf8')),item=state.platforms?.wechat_channels,outer=JSON.parse(fs.readFileSync(l.outerClaimPath,'utf8')),proofClaim=JSON.parse(fs.readFileSync(l.sourceProofClaimPath,'utf8')),proofResult=JSON.parse(fs.readFileSync(l.sourceProofResultPath,'utf8')),media=item?.videoReceipt?.nativeMedia;
  if(state.status!=='ready'||state.fingerprint!==l.fingerprint||item?.status!=='ready'||item.taskSpaceId!==l.taskSpaceId||item.videoReceipt?.fingerprint!==l.fingerprint||item.videoReceipt?.taskSpaceId!==l.taskSpaceId||item.videoReceipt?.mode!=='recovered_original_blob'||media?.recoveryMode!=='ready_source_proof'||media.sha256!==l.sourceSha256||media.size!==l.sourceSize)return {ok:false,code:'CHANNELS_READY_SOURCE_RELEASE_STATE_CHANGED'};
  if(outer.status!=='SOURCE_PROOF_PUBLISH_RESUME_CLAIMED'||outer.token!==l.outerClaimToken||outer.contentHash!==l.contentHash||outer.platform!==l.platform||outer.accountKey!==l.accountKey||outer.action!=='publish'||outer.preparedState!==l.preparedStatePath||outer.preparedStateSha256!==l.preparedStateSha256||outer.sourceProofClaimToken!==l.sourceProofClaimToken||outer.sourceProofSha256!==l.sourceSha256||outer.sourceProofStateSha256!==l.preparedStateSha256||outer.sourceProofResultPath!==l.sourceProofResultPath||outer.sourceProofResultSha256!==l.sourceProofResultSha256||outer.sourceProofClaimSha256!==l.sourceProofClaimSha256||outer.originalReservationSha256!==l.originalReservationSha256)return {ok:false,code:'CHANNELS_READY_SOURCE_OUTER_CLAIM_CHANGED'};
  if(proofClaim.mode!=='ready_source_proof'||proofClaim.claimToken!==l.sourceProofClaimToken||proofClaim.statePath!==l.preparedStatePath||proofClaim.fingerprint!==l.fingerprint||proofResult.ok!==true||proofResult.status!=='READY_SOURCE_PROOF_COMPLETE'||proofResult.claimToken!==l.sourceProofClaimToken||proofResult.finalStateSha!==l.preparedStateSha256||proofResult.sourceSha256!==l.sourceSha256||proofResult.sourceSize!==l.sourceSize||proofResult.publicationPerformed!==false||proofResult.reuploaded!==false)return {ok:false,code:'CHANNELS_READY_SOURCE_PROOF_SIDECAR_CHANGED'};
  for(const row of l.sourceProofEvidenceHashes||[])if(hashFile(row.path)!==row.sha256)return {ok:false,code:'CHANNELS_READY_SOURCE_PROOF_EVIDENCE_CHANGED'};
  return {ok:true};
 }catch{return {ok:false,code:'CHANNELS_READY_SOURCE_RELEASE_LINEAGE_UNAVAILABLE'};}
};
const hashFile=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const checkDouyinWindowFinalLock=()=>{
 if(!douyinWindowBindingPrepared)return {ok:true};
 try{
  if(!performanceLearningSeal||!douyinWindowOldBinding||douyinWindowOldBinding.spaceId!==34||douyinWindowOldBinding.profileId!=='Excluded Profile'
   ||douyinWindowBindingPrepared.status!=='PREPARED'||douyinWindowBindingPrepared.statePath!==${JSON.stringify(statePath)}
   ||hashFile(douyinWindowBindingPrepared.resultPath)!==douyinWindowBindingPrepared.resultFileSha256
   ||hashFile(douyinWindowBindingPrepared.statePath)!==douyinWindowBindingPrepared.preparedStateSha256
   ||hashFile(performanceLearningSeal.path)!==performanceLearningSeal.sha256
   ||hashFile(performanceLearningSeal.sealPath)!==performanceLearningSeal.sealSha256)return {ok:false,code:'DOUYIN_WINDOW_BINDING_PREPARED_LINEAGE_CHANGED'};
  const result=JSON.parse(fs.readFileSync(douyinWindowBindingPrepared.resultPath,'utf8'));
  if(result.status!=='PREPARED'||result.jobId!==douyinWindowBindingPrepared.jobId||result.fingerprint!==jobFingerprint
   ||result.preparedStateSha256!==douyinWindowBindingPrepared.preparedStateSha256
   ||JSON.stringify(result.oldBinding)!==JSON.stringify(douyinWindowOldBinding)
   ||JSON.stringify(result.executionBinding)!==JSON.stringify({profileId:expectedDouyinBinding.profileId,spaceId:expectedDouyinBinding.spaceId,spaceName:expectedDouyinBinding.spaceName,ownership:'agent',pageLabel:expectedDouyinBinding.pageLabel,targetId:expectedDouyinBinding.targetId,host:'creator.douyin.com',uploadUrl:expectedDouyinBinding.uploadUrl}))return {ok:false,code:'DOUYIN_WINDOW_BINDING_PREPARED_SCOPE_CHANGED'};
  for(const pin of [${JSON.stringify(id.video)},...${JSON.stringify(id.assets)}]){const bytes=fs.readFileSync(pin.path);if(bytes.length!==pin.size||hashFile(pin.path)!==pin.sha256)return {ok:false,code:'DOUYIN_WINDOW_BINDING_SOURCE_ASSET_CHANGED'};}
  const safe=${JSON.stringify(DOUYIN_WINDOW_SAFE_IDENTITY)};if(hashFile(safe.path)!==safe.sha256)return {ok:false,code:'DOUYIN_WINDOW_BINDING_SAFE_IDENTITY_HASH_CHANGED'};
  return {ok:true};
 }catch{return {ok:false,code:'DOUYIN_WINDOW_BINDING_FINAL_LINEAGE_UNAVAILABLE'};}
};
const personalFinalBoundFiles=${JSON.stringify(c.personalFinalBoundFiles||[])};
const checkPersonalFinalFiles=()=>{try{for(const f of personalFinalBoundFiles){const st=fs.lstatSync(f.path);if(!st.isFile()||st.isSymbolicLink()||crypto.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex')!==f.sha256)return {ok:false,code:'PERSONAL_R3_FINAL_BOUND_BYTES_CHANGED'};}return {ok:true};}catch{return {ok:false,code:'PERSONAL_R3_FINAL_BOUND_BYTES_UNAVAILABLE'};}};
const prepared=await preparePlatform();
if(!prepared.selected.ok){console.log(releaseMarker+JSON.stringify({ok:false,status:'BLOCKED',code:prepared.selected.blocker?.code||'TARGET_UNAVAILABLE'}));}
else {
  const preview=typeof nativeRecovery!=='undefined'&&nativeRecovery?await recoveryPreview(nativeRecovery):{ok:true};
  const current=await runPlatformPhase(),guard=await inspectFinalPublishGuard();
 const sourceProofPreClick=checkSourceProofReleaseLock();if(!sourceProofPreClick.ok)current.blocker={code:sourceProofPreClick.code,retryable:false};
 const douyinWindowPreClick=checkDouyinWindowFinalLock();if(!douyinWindowPreClick.ok)current.blocker={code:douyinWindowPreClick.code,retryable:false};
 const personalBoundPreClick=checkPersonalFinalFiles();if(!personalBoundPreClick.ok)current.blocker={code:personalBoundPreClick.code,retryable:false};
 const publishedBefore=${douyinPublishedInventoryRequested}?await readDouyinPublishedRows():{ok:true,rows:[]};if(!publishedBefore.ok)current.blocker={code:publishedBefore.code,retryable:false};
 const scheduledBefore=${douyinScheduleRequested}?await readDouyinScheduleRows():{ok:true,rows:[]};if(!scheduledBefore.ok)current.blocker={code:scheduledBefore.code,retryable:false};
 if(!preview.ok)current.blocker={code:preview.code,retryable:false};
 if(typeof nativeRecovery!=='undefined' && nativeRecovery){const proof=await js('('+recoveryProbe.toString()+')('+JSON.stringify(nativeRecovery)+')');if(!proof.ok)current.blocker={code:proof.code,retryable:false};}
 const required=${JSON.stringify(requiredGates(b.platform).filter(g=>g!=='safety'))};
 const missing=required.filter(g=>current.gates?.[g]?.ok!==true);
 if(current.blocker||missing.length||!guard.armed||guard.blockedAttempts?.length){console.log(releaseMarker+JSON.stringify({ok:false,status:'BLOCKED',code:'LIVE_RELEASE_PREFLIGHT_FAILED',missing,blocker:current.blocker||null}));}
 else {
  const mark=${JSON.stringify(markerPath)},nativeEvidencePath=${JSON.stringify(markerPath+'.native-readback.json')};
  if(${JSON.stringify(douyinSchoolImmediateProofRequested)}&&fs.existsSync(nativeEvidencePath))throw new Error('DOUYIN_NATIVE_EVIDENCE_ALREADY_EXISTS');
  const nativeEvidenceSchema='ego-douyin-native-inventory-evidence/v1';
  const writeNativeEvidenceFirst=value=>{
   const tmp=nativeEvidencePath+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';let fd;
   try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.linkSync(tmp,nativeEvidencePath);fs.unlinkSync(tmp);}
   catch(error){if(fd!==undefined)try{fs.closeSync(fd);}catch{}try{fs.unlinkSync(tmp);}catch{}throw error;}
  };
  const replaceNativeEvidence=value=>{
   const priorStat=fs.lstatSync(nativeEvidencePath);if(!priorStat.isFile()||priorStat.isSymbolicLink())throw new Error('DOUYIN_NATIVE_EVIDENCE_PATH_INVALID');
   const prior=JSON.parse(fs.readFileSync(nativeEvidencePath,'utf8'));if(prior.schema!==nativeEvidenceSchema||prior.jobId!==nativeJobId||prior.packageFingerprint!==jobFingerprint)throw new Error('DOUYIN_NATIVE_EVIDENCE_LINEAGE_CHANGED');
   const tmp=path.join(path.dirname(nativeEvidencePath),'.'+path.basename(nativeEvidencePath)+'.'+crypto.randomBytes(8).toString('hex')+'.tmp');let fd;
   try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,nativeEvidencePath);}
   catch(error){if(fd!==undefined)try{fs.closeSync(fd);}catch{}try{fs.unlinkSync(tmp);}catch{}throw error;}
  };
  const evidenceTitle=String(pkg.douyinTitle||pkg.platformTitle?.douyin||pkg.title||'').normalize('NFC').replace(/\\s+/g,' ').trim(),evidenceDescription=String(pkg.douyinDescription||pkg.description||'').normalize('NFC').replace(/\\s+/g,' ').trim();
  const evidenceBase={schema:nativeEvidenceSchema,source:'ego_creator_work_list_status_1',jobId:nativeJobId,packageFingerprint:jobFingerprint,preparedStateSha256:${JSON.stringify(c.preparedStateSha256||null)},account:{publicAccountId:String(pkg.schoolAccount.accountId||''),apiUid:publishedBefore.ownerUid||null,accountName:String(pkg.schoolAccount.accountName||'')},binding:{profileId:expectedDouyinBinding.profileId,taskSpaceId:expectedDouyinBinding.spaceId,taskSpaceName:expectedDouyinBinding.spaceName,pageLabel:expectedDouyinBinding.pageLabel,targetId:expectedDouyinBinding.targetId},intent:{expectedTitle:evidenceTitle,expectedDescription:evidenceDescription},before:{complete:publishedBefore.complete===true,identityVerified:publishedBefore.identityVerified===true,ownerUid:publishedBefore.ownerUid||null,rows:publishedBefore.rows||[],rowsSha256:publishedBefore.snapshotSha256||null},afterSnapshots:[]};
  if(${JSON.stringify(douyinSchoolImmediateProofRequested)})writeNativeEvidenceFirst({...evidenceBase,status:'PRE_CLICK_READY',preparedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  try{fs.writeFileSync(mark,JSON.stringify({status:'FINAL_CLICK_RESERVED',platform,accountKey:pkg.schoolAccount.accountKey,fingerprint:jobFingerprint,jobId:nativeJobId,...(${JSON.stringify(douyinSchoolImmediateProofRequested)}?{nativeEvidencePath}:{}),at:new Date().toISOString()}),{flag:'wx',mode:0o600});}
  catch(error){if(error.code==='EEXIST')throw new Error('FINAL_CLICK_ALREADY_RESERVED');throw error;}
  // The reservation precedes the irreversible boundary; any timeout retains it.
  const sourceProofAtClick=checkSourceProofReleaseLock(),douyinWindowAtClick=checkDouyinWindowFinalLock(),personalBoundAtClick=checkPersonalFinalFiles();
${identityReadLine}
  const douyinWindowImmediatelyBeforeClick=checkDouyinWindowFinalLock();
  let clicked=personalBoundAtClick.ok&&sourceProofAtClick.ok&&douyinWindowAtClick.ok&&douyinWindowImmediatelyBeforeClick.ok?await js(String.raw\`(async (binding,key${douyinApiBound?',apiIdentity':''}) =>{
    const compact=x=>String(x||'').replace(/\\s+/g,' ').trim();
    const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];
    if(!binding.platformHosts.includes(location.hostname))return {ok:false,code:'PLATFORM_CHANGED_BEFORE_CLICK'};
    const header=roots.flatMap(r=>[...r.querySelectorAll('header,nav,[role="banner"],[class*="header"],[class*="Header"]' + ${JSON.stringify(b.platform === 'wechat_channels' ? ', .finder-info-container, .full-screen-body .operate-bar .left-area .name' : b.platform === 'xiaohongshu' ? ', .d-topbar .name-box' : '')})]).filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.visibility!=='hidden'&&s.display!=='none';}).map(e=>[e.innerText,e.getAttribute('title'),e.getAttribute('aria-label'),...[...e.querySelectorAll('img[alt], [aria-label], [title]')].map(x=>x.getAttribute('alt')||x.getAttribute('aria-label')||x.getAttribute('title'))].filter(Boolean).join(' ')).join(' ');
    if(binding.platform==='douyin'&&(binding.accountId||binding.apiUid)){
      if(!apiIdentity?.ok|| (${migrationRelease}&&apiIdentity.oldSpaceAbsent!==true))return {ok:false,code:apiIdentity?.code||'ACCOUNT_IDENTITY_UNAVAILABLE_BEFORE_CLICK'};
      if(apiIdentity.uidMatched!==true||apiIdentity.nicknameMatched!==true||apiIdentity.publicIdMatched!==true||apiIdentity.spaceId!==binding.taskSpaceId||apiIdentity.spaceName!==binding.taskSpaceName||apiIdentity.profileId!==binding.egoProfileId||apiIdentity.pageLabel!==binding.pageLabel||apiIdentity.targetId!==binding.targetId||apiIdentity.url!==location.href)return {ok:false,code:'ACCOUNT_BINDING_CHANGED_BEFORE_CLICK'};
    }else if(!(header.includes(binding.accountName)||(binding.accountId&&header.includes(binding.accountId))))return {ok:false,code:'ACCOUNT_CHANGED_BEFORE_CLICK'};
    if(binding.knownAccounts.some(a=>a.key!==binding.accountKey&&((a.id&&header.includes(a.id))||(a.name&&header.includes(a.name)))))return {ok:false,code:'CONFLICTING_ACCOUNT_BEFORE_CLICK'};
${douyinPoiFinalClickGuard}
${douyinScheduleFinalClickGuard}
    const labels=/^(发布|发布笔记|发表|立即投稿)$/;
    const buttons=roots.flatMap(r=>[...r.querySelectorAll('button,[role="button"],.d-button,.bcc-button')]).filter(e=>{const z=e.getBoundingClientRect(),s=getComputedStyle(e);return labels.test(compact(e.innerText||e.textContent||e.getAttribute('aria-label')))&&z.width>12&&z.height>12&&s.display!=='none'&&s.visibility!=='hidden'&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';});
    if(buttons.length!==1)return {ok:false,code:'FINAL_BUTTON_AMBIGUOUS'};
    const state=window[key];
    if(!state?.armed||state.blockedAttempts.length)return {ok:false,code:'FINAL_GUARD_UNCLEAN'};
    const released=state.releaseForConfirmedPublish();if(!released.ok)return {ok:false,code:'FINAL_GUARD_RELEASE_FAILED'};
    buttons[0].click();return {ok:true,clickCount:1};
  })(${JSON.stringify(b)},'__VIDEO_PUBLISHER_FINAL_GUARD__'${identityArgument})\`):{ok:false,code:!personalBoundAtClick.ok?personalBoundAtClick.code:!sourceProofAtClick.ok?sourceProofAtClick.code:!douyinWindowAtClick.ok?douyinWindowAtClick.code:douyinWindowImmediatelyBeforeClick.code};
  if(clicked.ok&&${douyinScheduleRequested}){
   const oldIds=new Set((scheduledBefore.rows||[]).map(row=>row.id)),expectedTitle=String(pkg.douyinTitle||pkg.platformTitle?.douyin||pkg.title||'').normalize('NFC').replace(/\\s+/g,' ').trim(),expectedDescription=String(pkg.douyinDescription||pkg.description||'').normalize('NFC').replace(/\\s+/g,' ').trim(),expectedPublicTimeSeconds=Date.parse(${JSON.stringify(douyinScheduleRequested?pkg.douyinSchedule.publishAt:'')})/1000,ownerUid=String(pkg.schoolAccount.apiUid||'');
   let afterScheduled={ok:false,rows:[]};for(let attempt=0;attempt<8;attempt++){afterScheduled=await readDouyinScheduleRows();if(afterScheduled.ok&&afterScheduled.rows.some(row=>!oldIds.has(row.id)&&isDouyinScheduledRowMatch(row,{expectedTitle,expectedDescription,expectedPublicTimeSeconds,ownerUid})))break;await new Promise(resolve=>setTimeout(resolve,1000));}
   if(!afterScheduled.ok)clicked={ok:false,clickCount:1,code:'DOUYIN_SCHEDULE_POST_CLICK_READBACK_UNAVAILABLE'};
   else {const matches=afterScheduled.rows.filter(row=>!oldIds.has(row.id)&&isDouyinScheduledRowMatch(row,{expectedTitle,expectedDescription,expectedPublicTimeSeconds,ownerUid}));clicked=matches.length===1?{...clicked,platformContentId:matches[0].id,scheduledPublicTimeSeconds:matches[0].publicTimeSeconds,scheduledPublicTimeIso:new Date(matches[0].publicTimeSeconds*1000).toISOString(),scheduledReadbackEvidence:matches[0].source==='ego_native_management_react_props'?matches[0]:undefined}:{ok:false,clickCount:1,code:'DOUYIN_SCHEDULE_POST_CLICK_EXACT_ID_AMBIGUOUS'};}
  }
  if(clicked.ok&&${douyinPublishedInventoryRequested}&&!${douyinScheduleRequested}){
   if(${JSON.stringify(douyinSchoolImmediateProofRequested)}){
    const clickAt=Date.now(),deadlineAt=clickAt+${douyinPostClickReadbackMaxMs},oldIds=new Set((publishedBefore.rows||[]).map(row=>row.id)),expectedTitle=evidenceTitle,expectedDescription=evidenceDescription,ownerUid=publishedBefore.ownerUid,afterSnapshots=[];
    let latestRows=null,latestCode=null,matches=null,evidenceWriteFailed=false,evidenceWriteCode=null;
    const terminalReadErrors=new Set(['DOUYIN_PUBLISHED_LIST_ACCOUNT_IDENTITY_MISMATCH','DOUYIN_PUBLISHED_LIST_ACCOUNT_IDENTITY_CHANGED','DOUYIN_PUBLISHED_LIST_BINDING_CHANGED','ACCOUNT_BINDING_CHANGED_BEFORE_CLICK','DOUYIN_WINDOW_BINDING_OLD_SPACE_STILL_PRESENT','DOUYIN_PUBLISHED_LIST_ID_OR_OWNER_INVALID','DOUYIN_PUBLISHED_LIST_DUPLICATE_ID','DOUYIN_PUBLISHED_LIST_CURSOR_STALLED','DOUYIN_PUBLISHED_LIST_WINDOW_INCOMPLETE']);
    const activeEvidenceBase={...evidenceBase,clickAt:new Date(clickAt).toISOString(),deadlineAt:new Date(deadlineAt).toISOString()};
    try{replaceNativeEvidence({...activeEvidenceBase,status:'POST_CLICK_POLLING',updatedAt:new Date().toISOString()});}catch(error){evidenceWriteFailed=true;evidenceWriteCode=String(error?.code||error?.message||'NATIVE_EVIDENCE_UPDATE_FAILED');}
    if(!evidenceWriteFailed){
     do{
      const observedAt=new Date().toISOString(),afterPublished=await readDouyinPublishedRows(${JSON.stringify(douyinSchoolImmediateProofRequested)});
      if(afterPublished.ok){
       latestRows=afterPublished.rows;latestCode=null;
       afterSnapshots.push({observedAt,complete:afterPublished.complete===true,identityVerified:afterPublished.identityVerified===true,ownerUid:afterPublished.ownerUid,rows:afterPublished.rows,rowsSha256:afterPublished.snapshotSha256});
       const candidates=afterPublished.rows.filter(row=>{if(oldIds.has(row.id)||row.ownerUid!==ownerUid)return false;const text=String(row.title||'').normalize('NFC').replace(/\\s+/g,' ').trim();return text===expectedTitle||(expectedDescription&&text.includes(expectedDescription));});
       if(candidates.length>1){matches=candidates;break;}
       if(candidates.length===1){matches=candidates;break;}
      }else{
       latestCode=afterPublished.code||'DOUYIN_POST_CLICK_ID_READBACK_UNAVAILABLE';
       afterSnapshots.push({observedAt,complete:false,identityVerified:false,code:latestCode,rows:[]});
       if(terminalReadErrors.has(latestCode))break;
      }
      try{replaceNativeEvidence({...activeEvidenceBase,status:'POST_CLICK_POLLING',updatedAt:new Date().toISOString(),lastCode:latestCode,afterSnapshots});}catch(error){evidenceWriteFailed=true;evidenceWriteCode=String(error?.code||error?.message||'NATIVE_EVIDENCE_UPDATE_FAILED');break;}
      if(Date.now()>=deadlineAt)break;
      await new Promise(resolve=>setTimeout(resolve,Math.min(${douyinPostClickReadbackIntervalMs},Math.max(0,deadlineAt-Date.now()))));
     }while(Date.now()<=deadlineAt);
    }
    let association=null;
    if(matches?.length===1){
     const afterPublished={rows:latestRows||[],snapshotSha256:afterSnapshots.at(-1)?.rowsSha256,identityVerified:afterSnapshots.at(-1)?.identityVerified,complete:afterSnapshots.at(-1)?.complete};
     association={status:'UNIQUE_NEW_ID_MATCHED',absentBefore:true,uniqueNewMatch:true,platformContentId:matches[0].id,ownerUid,expectedTitle,expectedDescription,beforeCount:publishedBefore.rows.length,afterCount:afterPublished.rows.length,beforeRowsSha256:publishedBefore.snapshotSha256,afterRowsSha256:afterPublished.snapshotSha256,source:'ego_creator_work_list_status_1',identityVerified:publishedBefore.identityVerified===true&&afterPublished.identityVerified===true,complete:publishedBefore.complete===true&&afterPublished.complete===true};
     clicked={...clicked,platformContentId:matches[0].id,newContentAssociation:association,nativeEvidencePath,nativeReadbackDeadlineAt:new Date(deadlineAt).toISOString()};
    }else clicked={ok:false,clickCount:1,code:evidenceWriteFailed?'DOUYIN_POST_CLICK_EVIDENCE_WRITE_FAILED':matches?.length>1?'DOUYIN_POST_CLICK_EXACT_ID_AMBIGUOUS':terminalReadErrors.has(latestCode)?latestCode:'DOUYIN_POST_CLICK_PUBLISHED_ID_NOT_VISIBLE',...(evidenceWriteCode?{evidenceWriteCode}:{}),nativeEvidencePath,nativeReadbackDeadlineAt:new Date(deadlineAt).toISOString()};
    try{replaceNativeEvidence({...activeEvidenceBase,status:matches?.length===1?'UNIQUE_NEW_ID_MATCHED':matches?.length>1?'AMBIGUOUS_NEW_IDS':evidenceWriteFailed?'EVIDENCE_WRITE_FAILED':terminalReadErrors.has(latestCode)?'READBACK_TERMINAL_ERROR':'PUBLISHED_ID_NOT_VISIBLE',updatedAt:new Date().toISOString(),lastCode:latestCode,matchedPlatformContentId:matches?.length===1?matches[0].id:null,afterSnapshots});}
    catch(error){clicked={ok:false,clickCount:1,code:'DOUYIN_POST_CLICK_EVIDENCE_WRITE_FAILED',evidenceWriteCode:String(error?.code||error?.message||'NATIVE_EVIDENCE_UPDATE_FAILED'),nativeEvidencePath,nativeReadbackDeadlineAt:new Date(deadlineAt).toISOString()};}
   }else{
    await new Promise(resolve=>setTimeout(resolve,1500));const afterPublished=await readDouyinPublishedRows(${JSON.stringify(douyinSchoolImmediateProofRequested)});
    if(!afterPublished.ok)clicked={ok:false,clickCount:1,code:'DOUYIN_POST_CLICK_ID_READBACK_UNAVAILABLE'};
    else {
     const oldIds=new Set((publishedBefore.rows||[]).map(row=>row.id)),expectedTitle=String(pkg.douyinTitle||pkg.platformTitle?.douyin||pkg.title||'').normalize('NFC').replace(/\\s+/g,' ').trim(),expectedDescription=String(pkg.douyinDescription||pkg.description||'').normalize('NFC').replace(/\\s+/g,' ').trim(),ownerUid=publishedBefore.ownerUid;
     const matches=afterPublished.rows.filter(row=>{if(oldIds.has(row.id)||row.ownerUid!==ownerUid)return false;const text=String(row.title||'').normalize('NFC').replace(/\\s+/g,' ').trim();return text===expectedTitle||(expectedDescription&&text.includes(expectedDescription));});
     const association={status:'UNIQUE_NEW_ID_MATCHED',absentBefore:true,uniqueNewMatch:true,platformContentId:matches[0]?.id||null,ownerUid,expectedTitle,expectedDescription,beforeCount:publishedBefore.rows.length,afterCount:afterPublished.rows.length,beforeRowsSha256:publishedBefore.snapshotSha256,afterRowsSha256:afterPublished.snapshotSha256,source:'ego_creator_work_list_status_1',identityVerified:publishedBefore.identityVerified===true&&afterPublished.identityVerified===true,complete:publishedBefore.complete===true&&afterPublished.complete===true};
     clicked=matches.length===1?{...clicked,platformContentId:matches[0].id,...(${JSON.stringify(douyinSchoolImmediateProofRequested)}?{newContentAssociation:association}:{})}:{ok:false,clickCount:1,code:'DOUYIN_POST_CLICK_EXACT_ID_AMBIGUOUS'};
    }
   }
  }
  if(${JSON.stringify(douyinSchoolImmediateProofRequested)}&&!clicked.nativeEvidencePath)clicked={...clicked,nativeEvidencePath};
  const markerStatus=clicked.ok?'FINAL_CLICK_SENT':clicked.clickCount===1?'POST_CLICK_READBACK_REQUIRED':'BLOCKED_AT_FINAL_BOUNDARY';
  const nativeEvidenceSha256=clicked.nativeEvidencePath&&fs.existsSync(clicked.nativeEvidencePath)?crypto.createHash('sha256').update(fs.readFileSync(clicked.nativeEvidencePath)).digest('hex'):null;
  const finalMarker={...clicked,...(nativeEvidenceSha256?{nativeEvidenceSha256}:{}),status:markerStatus,platform,accountKey:pkg.schoolAccount.accountKey,fingerprint:jobFingerprint,jobId:nativeJobId,at:new Date().toISOString()};
  const markerTmp=mark+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';let markerFd;
  try{markerFd=fs.openSync(markerTmp,'wx',0o600);fs.writeFileSync(markerFd,JSON.stringify(finalMarker));fs.fsyncSync(markerFd);fs.closeSync(markerFd);markerFd=undefined;fs.renameSync(markerTmp,mark);}catch(error){if(markerFd!==undefined)try{fs.closeSync(markerFd);}catch{}try{fs.unlinkSync(markerTmp);}catch{}throw error;}
  console.log(releaseMarker+JSON.stringify({...clicked,nativeEvidenceSha256,status:clicked.ok?'SUBMITTED':'BLOCKED',publicReadbackVerified:false,markerPath:mark}));
 }
}
`;
}
function writeAtomicJson(file,value) {
 const directory=path.dirname(file),tmp=path.join(directory,`.${path.basename(file)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
 let fd;
 try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);}
 catch(error){if(fd!==undefined)try{fs.closeSync(fd);}catch{}try{fs.unlinkSync(tmp);}catch{}throw error;}
}
function updateDouyinFinalClickMarker(markerPath,patch) {
 const stat=fs.lstatSync(markerPath);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('DOUYIN_FINAL_CLICK_MARKER_INVALID');
 const record=JSON.parse(fs.readFileSync(markerPath,'utf8'));
 if(record.platform!=='douyin'||record.status!=='FINAL_CLICK_SENT'||record.clickCount!==1||!/^\d{15,22}$/.test(record.platformContentId||''))throw new Error('DOUYIN_FINAL_CLICK_MARKER_LINEAGE_INVALID');
 writeAtomicJson(markerPath,{...record,...patch});
}
function markDouyinReadbackUncertain(markerPath,{platformContentId=null,code='DOUYIN_FINAL_EXACT_ID_READBACK_NOT_PUBLISHED',nativeEvidencePath=null,nativeEvidenceSha256=null}={}) {
 try{
  const stat=fs.lstatSync(markerPath);if(!stat.isFile()||stat.isSymbolicLink())return;
  const record=JSON.parse(fs.readFileSync(markerPath,'utf8'));
  if(record.platform==='douyin'&&record.clickCount===1)writeAtomicJson(markerPath,{...record,status:'FINAL_CLICK_SENT_READBACK_UNVERIFIED',platformContentId,readbackCode:code,readbackAt:new Date().toISOString(),...(nativeEvidencePath?{nativeEvidencePath}:{}),...(nativeEvidenceSha256?{nativeEvidenceSha256}:{})});
 }catch{}
}
function verifyDouyinNativeInventoryEvidence({file,sha256,c,state,identity,binding,contentId,expectedTitle,expectedDescription,uid,association}={}){
 try{
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_PATH_INVALID'};
  const raw=fs.readFileSync(file);if(crypto.createHash('sha256').update(raw).digest('hex')!==sha256)return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_SHA_MISMATCH'};
  const proof=JSON.parse(raw.toString('utf8'));
  const compact=value=>String(value??'').normalize('NFC').replace(/\s+/g,' ').trim();
  const rows=proof.before?.rows,snapshots=proof.afterSnapshots;
  if(proof.schema!=='ego-douyin-native-inventory-evidence/v1'||proof.source!=='ego_creator_work_list_status_1'||proof.status!=='UNIQUE_NEW_ID_MATCHED'||proof.matchedPlatformContentId!==contentId)return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_CONTRACT_INVALID'};
  if(proof.jobId!==state.jobId||proof.packageFingerprint!==identity.fingerprint||proof.preparedStateSha256!==c.preparedStateSha256)return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_JOB_LINEAGE_INVALID'};
  if(proof.account?.publicAccountId!==String(binding.accountId)||proof.account?.apiUid!==uid||proof.account?.accountName!==binding.accountName)return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_ACCOUNT_MISMATCH'};
  if(proof.binding?.profileId!==binding.egoProfileId||proof.binding?.taskSpaceId!==binding.taskSpaceId||proof.binding?.taskSpaceName!==binding.taskSpaceName||proof.binding?.pageLabel!==binding.pageLabel||proof.binding?.targetId!==binding.targetId)return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_BINDING_MISMATCH'};
  if(compact(proof.intent?.expectedTitle)!==compact(expectedTitle)||compact(proof.intent?.expectedDescription)!==compact(expectedDescription))return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_CONTENT_MISMATCH'};
  if(proof.before?.complete!==true||proof.before?.identityVerified!==true||proof.before?.ownerUid!==uid||!Array.isArray(rows)||!Array.isArray(snapshots)||!snapshots.length)return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_BEFORE_INVENTORY_INVALID'};
  const validRows=list=>Array.isArray(list)&&list.every(row=>typeof row?.id==='string'&&/^\d{15,22}$/.test(row.id)&&row.ownerUid===uid&&typeof row.title==='string')&&new Set(list.map(row=>row.id)).size===list.length;
  const rowHash=list=>crypto.createHash('sha256').update(JSON.stringify(list.slice().sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex');
  if(!validRows(rows)||proof.before.rowsSha256!==rowHash(rows)||!snapshots.every(snapshot=>Array.isArray(snapshot.rows)&&((snapshot.complete===true&&snapshot.identityVerified===true&&snapshot.ownerUid===uid&&validRows(snapshot.rows)&&snapshot.rowsSha256===rowHash(snapshot.rows))||(snapshot.complete===false&&snapshot.identityVerified===false&&typeof snapshot.code==='string'&&snapshot.rows.length===0))))return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_ROWS_INVALID'};
  const beforeIds=new Set(rows.map(row=>row.id));if(beforeIds.has(contentId))return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_ID_NOT_NEW'};
  if(association?.beforeRowsSha256!==proof.before.rowsSha256||association?.beforeCount!==rows.length)return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_BEFORE_ROWS_MISMATCH'};
  const matching=snapshots.filter(snapshot=>snapshot.rows.some(row=>row.id===contentId&&row.ownerUid===uid&&(compact(row.title)===compact(expectedTitle)||(compact(expectedDescription)&&compact(row.title).includes(compact(expectedDescription))))));
  if(!matching.length||!matching.every(snapshot=>snapshot.rows.filter(row=>row.id===contentId).length===1)||!matching.some(snapshot=>snapshot.rowsSha256===association?.afterRowsSha256&&snapshot.rows.length===association?.afterCount))return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_NEW_ID_MISSING'};
  return {ok:true,proof,sha256};
 }catch{return {ok:false,code:'DOUYIN_NATIVE_EVIDENCE_UNAVAILABLE'};}
}
export async function runVideoRelease(file,statePath,matrix,execute,deps={}) {


 const rawPackage=JSON.parse(fs.readFileSync(file,'utf8'));
 if(rawPackage?.schoolAccount?.platform==='douyin'&&rawPackage?.schoolAccount?.accountKey==='reserved_personal_route'){
  if(!deps.personalDouyinAdmission)return {ok:false,status:'BLOCKED',code:'PERSONAL_DOUYIN_ROUTE_READ_ONLY_ONLY',platform:'douyin',accountKey:'reserved_personal_route',publicationPerformed:false,readOnly:true};
  const accounts=matrix?.platforms?.douyin?.accounts||[],matches=accounts.filter(row=>row?.key==='reserved_personal_route');
  if(matches.length!==1)return {ok:false,status:'BLOCKED',code:'PERSONAL_DOUYIN_ACCOUNT_BINDING_NOT_READY',platform:'douyin',accountKey:'reserved_personal_route',publicationPerformed:false,readOnly:true};
  const admission=validatePersonalDouyinWriteAdmission({admission:deps.personalDouyinAdmission,packagePath:file,pkg:rawPackage,action:'publish',account:matches[0]});
  if(!admission.ok)return {ok:false,status:'BLOCKED',code:admission.code||'PERSONAL_DOUYIN_ROUTE_READ_ONLY_ONLY',platform:'douyin',accountKey:'reserved_personal_route',publicationPerformed:false,readOnly:true,contentReviewVerified:false};
 }
 const c=await releaseContext(file,statePath,matrix,deps);
 const preflight=await (deps.preflight||runEgoPreflight)(c.binding);
 if(!preflight.ok)return {ok:false,status:'BLOCKED',code:preflight.code};
 const douyinImmediateSchoolRequested=c.binding.platform==='douyin'&&c.binding.accountKey!=='reserved_personal_route'&&!Object.prototype.hasOwnProperty.call(c.pkg,'douyinSchedule');
 if(douyinImmediateSchoolRequested&&(!/^[a-f0-9]{64}$/.test(c.preparedStateSha256||'')||typeof c.state?.jobId!=='string'||!c.state.jobId.trim()))return {ok:false,status:'BLOCKED',code:'DOUYIN_PUBLICATION_PROOF_CONTEXT_REQUIRED'};
 if(douyinImmediateSchoolRequested&&crypto.createHash('sha256').update(fs.readFileSync(c.statePath)).digest('hex')!==c.preparedStateSha256)return {ok:false,status:'BLOCKED',code:'PREPARED_STATE_CHANGED_BEFORE_RELEASE'};
 const r=await execute('ego-browser',['nodejs'],{input:buildVideoReleaseScript(c),timeoutMs:douyinImmediateSchoolRequested?210000:180000});
 const line=(r.stdout+'\n'+r.stderr).split(/\r?\n/).find(l=>l.startsWith('SCHOOL_VIDEO_RELEASE:'));
 const fallbackMarkerPath=path.join(path.dirname(c.statePath),`school-final-douyin-${c.identity.fingerprint}.json`),fallbackEvidencePath=fallbackMarkerPath+'.native-readback.json';
 if(r.code!==0||!line)return {ok:false,status:'SUBMISSION_UNCERTAIN',code:'VIDEO_RELEASE_RESULT_UNAVAILABLE',...(douyinImmediateSchoolRequested?{markerPath:fallbackMarkerPath,nativeEvidencePath:fallbackEvidencePath,nativeEvidenceSha256:fs.existsSync(fallbackEvidencePath)?crypto.createHash('sha256').update(fs.readFileSync(fallbackEvidencePath)).digest('hex'):null}:{}),publicReadbackVerified:false};
 let result=JSON.parse(line.slice('SCHOOL_VIDEO_RELEASE:'.length));
 const douyinScheduleRequested=c.binding.platform==='douyin'&&Object.prototype.hasOwnProperty.call(c.pkg,'douyinSchedule');
 const douyinSchoolProofRequested=c.binding.platform==='douyin'&&c.binding.accountKey!=='reserved_personal_route'&&!douyinScheduleRequested&&!c.douyinWindowBindingPrepared;
 if(!c.douyinWindowBindingPrepared&&!douyinScheduleRequested&&!douyinImmediateSchoolRequested)return result;
 if(result.clickCount!==1)return result;
 const contentId=result.platformContentId;
 const safeId=typeof contentId==='string'&&/^\d{15,22}$/.test(contentId);
 if(!result.ok||!safeId){const marker=result.markerPath||fallbackMarkerPath,evidence=result.nativeEvidencePath||fallbackEvidencePath;markDouyinReadbackUncertain(marker,{platformContentId:safeId?contentId:null,code:result.code||'DOUYIN_POST_CLICK_EXACT_ID_REQUIRED',nativeEvidencePath:evidence,nativeEvidenceSha256:result.nativeEvidenceSha256||null});return {ok:false,status:'SUBMISSION_UNCERTAIN',code:result.code||'DOUYIN_POST_CLICK_EXACT_ID_REQUIRED',clickCount:1,platformContentId:safeId?contentId:null,...(douyinSchoolProofRequested?{markerPath:marker,nativeEvidencePath:evidence,nativeEvidenceSha256:result.nativeEvidenceSha256||null}:{}),platformReadbackVerified:false,platformStatusVerified:false,publicReadbackVerified:false};}
 const uid=c.douyinWindowBindingPrepared?readPinnedDouyinUid():String(result.newContentAssociation?.ownerUid||c.binding.apiUid||'');
 const route={platform:'douyin',transport:'ego_creator_native',api_uid:uid,account_name:c.binding.accountName,public_account_id:String(c.binding.accountId),task_space_id:Number(c.binding.taskSpaceId),task_space_name:c.binding.taskSpaceName,ego_profile_id:c.binding.egoProfileId,page_label:c.binding.pageLabel,target_id:c.binding.targetId,...(douyinScheduleRequested?{allow_upload_page:true}:{})};
 let readback;
 const scheduleDomEvidence=result.scheduledReadbackEvidence;
 if(douyinScheduleRequested&&scheduleDomEvidence){
  const expectedTitle=String(c.pkg.douyinTitle||c.pkg.platformTitle?.douyin||c.pkg.title||'').normalize('NFC').replace(/\s+/g,' ').trim(),expectedDescription=String(c.pkg.douyinDescription||c.pkg.description||'').normalize('NFC').replace(/\s+/g,' ').trim(),expectedPublicTimeSeconds=Date.parse(c.pkg.douyinSchedule.publishAt)/1000;
  const checked=scheduleDomEvidence.source==='ego_native_management_react_props'&&scheduleDomEvidence.id===contentId?validateDouyinNativeScheduledCard(scheduleDomEvidence.nativeCardEvidence,{expectedTitle,expectedDescription,expectedPublicTimeSeconds,ownerUid:uid}):{ok:false};
  if(!checked.ok||checked.row.id!==contentId){const marker=result.markerPath||path.join(path.dirname(c.statePath),`school-final-douyin-${c.identity.fingerprint}.json`);markDouyinReadbackUncertain(marker,{platformContentId:contentId,code:'DOUYIN_NATIVE_SCHEDULE_DOM_READBACK_MISMATCH'});return {ok:false,status:'SUBMISSION_UNCERTAIN',code:'DOUYIN_NATIVE_SCHEDULE_DOM_READBACK_MISMATCH',clickCount:1,platformContentId:contentId,platformReadbackVerified:false,platformStatusVerified:false,publicReadbackVerified:false};}
  readback={ok:true,readOnly:true,platformReadbackVerified:true,platformStatusVerified:true,publicReadbackVerified:false,status:'SCHEDULED',platformContentId:contentId,title:checked.row.title,publicTimeSeconds:checked.row.publicTimeSeconds,publicTimeIso:new Date(checked.row.publicTimeSeconds*1000).toISOString(),source:checked.row.source,nativeStatus:checked.row.nativeStatus,nativeStatusValue:checked.row.nativeStatusValue};
 }else try{
  const readNative=deps.nativeReadback||executeNativeCreatorReadback;
  if(douyinSchoolProofRequested){
    const deadlineMs=Date.parse(result.nativeReadbackDeadlineAt||''),now=deps.now||Date.now,delay=deps.delay||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
   if(!Number.isFinite(deadlineMs))throw new Error('DOUYIN_NATIVE_READBACK_DEADLINE_MISSING');
   const retryableStatuses=new Set(['CONTENT_FOUND_STATUS_UNKNOWN','REVIEWING','UNKNOWN']),retryableCodes=new Set(['VIDEO_CONTENT_NOT_FOUND_IN_READ_WINDOW','NATIVE_CREATOR_TRANSPORT_FAILED','NATIVE_CREATOR_READ_TIMEOUT']);
   if(now()>=deadlineMs)readback={ok:false,status:'BLOCKED',code:'DOUYIN_NATIVE_PUBLISHED_READBACK_DEADLINE_EXPIRED',readOnly:true,platformReadbackVerified:false,platformStatusVerified:false,publicReadbackVerified:false};
   while(now()<deadlineMs){
    const remaining=Math.max(0,deadlineMs-now());
    if(remaining<1000){readback={ok:false,status:'BLOCKED',code:'DOUYIN_NATIVE_PUBLISHED_READBACK_DEADLINE_EXPIRED',readOnly:true,platformReadbackVerified:false,platformStatusVerified:false,publicReadbackVerified:false};break;}
    try{readback=await readNative(route,{id:contentId,limit:50,includeDetailedStats:false,timeoutMs:Math.max(1000,Math.min(30000,remaining))},execute);}
    catch(error){readback={ok:false,status:'BLOCKED',code:String(error?.message||'NATIVE_CREATOR_TRANSPORT_FAILED'),readOnly:true,platformReadbackVerified:false,platformStatusVerified:false,publicReadbackVerified:false};}
    if(readback?.ok===true&&readback.status==='PUBLISHED'&&readback.platformContentId===contentId)break;
    if(!retryableStatuses.has(readback?.status)&&!retryableCodes.has(readback?.code))break;
    const waitFor=Math.min(2500,Math.max(0,deadlineMs-now()));if(waitFor>0)await delay(waitFor);
   }
  }else readback=await readNative(route,{id:contentId,limit:50,includeDetailedStats:false},execute);
 }
 catch(error){const marker=result.markerPath||path.join(path.dirname(c.statePath),`school-final-douyin-${c.identity.fingerprint}.json`);markDouyinReadbackUncertain(marker,{platformContentId:contentId,code:'DOUYIN_FINAL_EXACT_ID_READBACK_FAILED'});return {ok:false,status:'SUBMISSION_UNCERTAIN',code:'DOUYIN_FINAL_EXACT_ID_READBACK_FAILED',clickCount:1,platformContentId:contentId,platformReadbackVerified:false,platformStatusVerified:false,publicReadbackVerified:false};}
 const expectedTexts=[c.pkg.douyinTitle,c.pkg.platformTitle?.douyin,c.pkg.title,c.pkg.douyinDescription,c.pkg.description].filter(value=>typeof value==='string'&&value.trim()).map(value=>value.normalize('NFC').replace(/\s+/g,' ').trim());
 const actualTitle=typeof readback.title==='string'?readback.title.normalize('NFC').replace(/\s+/g,' ').trim():'';
 const titleMatches=expectedTexts.some(value=>actualTitle===value||((value===c.pkg.douyinDescription||value===c.pkg.description)&&actualTitle.includes(value)));
 const compact=value=>String(value??'').normalize('NFC').replace(/\s+/g,' ').trim();
 const expectedTitle=compact(c.pkg.douyinTitle||c.pkg.platformTitle?.douyin||c.pkg.title||''),expectedDescription=compact(c.pkg.douyinDescription||c.pkg.description||'');
 const association=result.newContentAssociation,associationMatches=!douyinSchoolProofRequested||(association?.status==='UNIQUE_NEW_ID_MATCHED'&&association.absentBefore===true&&association.uniqueNewMatch===true&&association.platformContentId===contentId&&association.ownerUid===uid&&association.expectedTitle===expectedTitle&&association.expectedDescription===expectedDescription&&association.identityVerified===true&&association.complete===true&&/^[a-f0-9]{64}$/.test(association.beforeRowsSha256||'')&&/^[a-f0-9]{64}$/.test(association.afterRowsSha256||''));
 const evidencePath=result.nativeEvidencePath||fallbackEvidencePath,evidenceCheck=douyinSchoolProofRequested?verifyDouyinNativeInventoryEvidence({file:evidencePath,sha256:result.nativeEvidenceSha256,c,state:c.state,identity:c.identity,binding:c.binding,contentId,expectedTitle,expectedDescription,uid,association}):{ok:true};
 const identityBefore=readback.identityEvidence?.before,identityAfter=readback.identityEvidence?.after;
 const identityMatches=!douyinSchoolProofRequested||(readback.identityVerifiedBeforeAndAfter===true&&identityBefore?.accountId===String(c.binding.accountId)&&identityAfter?.accountId===String(c.binding.accountId)&&identityBefore?.apiUid===uid&&identityAfter?.apiUid===uid&&identityBefore?.accountName===c.binding.accountName&&identityAfter?.accountName===c.binding.accountName&&identityBefore?.profileId===c.binding.egoProfileId&&identityAfter?.profileId===c.binding.egoProfileId);
 const scheduleVerification=douyinScheduleRequested?verifyDouyinScheduleReadback({readback,intent:c.pkg.douyinSchedule,contentId}):null;
 const verified=douyinScheduleRequested?scheduleVerification?.ok===true&&titleMatches:(readback?.ok===true&&readback.status==='PUBLISHED'&&readback.platformContentId===contentId&&readback.platformStatusVerified===true&&titleMatches&&associationMatches&&identityMatches&&evidenceCheck.ok===true);
 const markerPath=result.markerPath||path.join(path.dirname(c.statePath),`school-final-douyin-${c.identity.fingerprint}.json`);
 const failureCode=douyinScheduleRequested?'DOUYIN_SCHEDULE_PUBLIC_TIME_READBACK_MISMATCH':douyinSchoolProofRequested&&!associationMatches?'DOUYIN_SCHOOL_NEW_CONTENT_ASSOCIATION_INVALID':douyinSchoolProofRequested&&!identityMatches?'DOUYIN_SCHOOL_IDENTITY_EVIDENCE_INVALID':douyinSchoolProofRequested&&!evidenceCheck.ok?evidenceCheck.code:'DOUYIN_FINAL_EXACT_ID_READBACK_NOT_PUBLISHED';
 if(!verified){markDouyinReadbackUncertain(markerPath,{platformContentId:contentId,code:failureCode,nativeEvidencePath:evidencePath,nativeEvidenceSha256:result.nativeEvidenceSha256||null});return {ok:false,status:'SUBMISSION_UNCERTAIN',code:failureCode,clickCount:1,platformContentId:contentId,...(douyinSchoolProofRequested?{markerPath,nativeEvidencePath:evidencePath,nativeEvidenceSha256:result.nativeEvidenceSha256||null}:{}),platformReadbackVerified:readback?.platformReadbackVerified===true,platformStatusVerified:false,publicReadbackVerified:false};}
 const nativeReadback={platform:'douyin',accountKey:c.binding.accountKey,platformContentId:contentId,status:douyinScheduleRequested?'SCHEDULED':'PUBLISHED',platformReadbackVerified:true,platformStatusVerified:true,publicReadbackVerified:false,source:readback.source||'ego_native_creator_work_list',checkedAt:readback.checkedAt||new Date().toISOString(),title:actualTitle,...(douyinSchoolProofRequested?{identityEvidence:readback.identityEvidence||null,publishedAt:readback.publishedAt||null,publishedAtSource:readback.publishedAtSource||null,nativeEvidencePath:evidencePath,nativeEvidenceSha256:result.nativeEvidenceSha256}:{}),...(douyinScheduleRequested?{publicTimeSeconds:readback.publicTimeSeconds,publicTimeIso:readback.publicTimeIso,...(readback.nativeStatus?{managementStatus:readback.nativeStatus,managementStatusValue:readback.nativeStatusValue}:{})}:{}),executionTransport:'ego_creator_native',egoProfileId:c.binding.egoProfileId,taskSpaceId:c.binding.taskSpaceId,taskSpaceName:c.binding.taskSpaceName,pageLabel:c.binding.pageLabel,targetId:c.binding.targetId};
 const publicationProof=douyinImmediateSchoolRequested&&!c.douyinWindowBindingPrepared?{
  schema:'ego-school-douyin-publication-proof/v1',
  jobId:c.state.jobId,
  preparedStateSha256:c.preparedStateSha256,
  packageFingerprint:c.identity.fingerprint,
  account:{publicAccountId:String(readback.identityEvidence?.before?.accountId||''),apiUid:String(readback.identityEvidence?.before?.apiUid||''),name:String(readback.identityEvidence?.before?.accountName||'')},
  binding:{profileId:c.binding.egoProfileId,taskSpaceId:c.binding.taskSpaceId,taskSpaceName:c.binding.taskSpaceName,pageLabel:c.binding.pageLabel,targetId:c.binding.targetId},
  newContentAssociation:result.newContentAssociation,
  nativeReadback,
 }:null;
 if(douyinImmediateSchoolRequested&&crypto.createHash('sha256').update(fs.readFileSync(c.statePath)).digest('hex')!==c.preparedStateSha256){markDouyinReadbackUncertain(markerPath,{platformContentId:contentId,code:'PREPARED_STATE_CHANGED_DURING_RELEASE'});return {ok:false,status:'SUBMISSION_UNCERTAIN',code:'PREPARED_STATE_CHANGED_DURING_RELEASE',clickCount:1,platformContentId:contentId,platformReadbackVerified:true,platformStatusVerified:true,publicReadbackVerified:false};}
 try{updateDouyinFinalClickMarker(markerPath,{status:douyinScheduleRequested?'SCHEDULED_READBACK_VERIFIED':'PUBLISHED_READBACK_VERIFIED',platformContentId:contentId,platformReadbackVerified:true,platformStatusVerified:true,readbackAt:nativeReadback.checkedAt,readbackEvidence:nativeReadback,...(douyinSchoolProofRequested?{nativeEvidencePath:evidencePath,nativeEvidenceSha256:result.nativeEvidenceSha256}:{})});}catch{}
 return {...result,ok:true,status:douyinScheduleRequested?'SCHEDULED':'PUBLISHED',platformContentId:contentId,platformReadbackVerified:true,platformStatusVerified:true,publicReadbackVerified:false,...(douyinScheduleRequested?{douyinScheduleReadback:nativeReadback}:{douyinImmediateReadback:nativeReadback,...(douyinImmediateSchoolRequested?{publicationProof}:{})})};
}
