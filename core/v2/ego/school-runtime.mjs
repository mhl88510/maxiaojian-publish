// Compatibility for upstream fragments, implemented exclusively with the current documented Ego API.
// School callers have already fixed the exact task/page/profile. Never create a fallback context.
let schoolRuntimeTask = null;
let schoolRuntimePage = null;
let douyinWindowMutationCounters = { setInputFilesCalls: 0, uploadFileCalls: 0, uploadStartCount: 0, finalPublishClickCount: 0, uploadPerformed: false, finalPublishClicked: false };
function schoolRuntimeBinding(){
  return typeof douyinWindowBindingResumeActive!=='undefined'&&douyinWindowBindingResumeActive===true
    &&platform==='douyin'&&douyinWindowBindingResumeContract?.resumeType==='douyin_same_job_window_binding_recovery'
    ?douyinExecutionBinding:pkg.schoolAccount;
}
async function useOrCreateTaskSpace(id) {
  const b=schoolRuntimeBinding();
  if(!b||Number(id)!==Number(b.taskSpaceId))throw new Error('EXACT_SCHOOL_TASK_REQUIRED');
  const rows=(await listTaskSpaces()).filter(s=>Number(s.id)===Number(id)&&s.name===b.taskSpaceName);
  if(rows.length!==1||rows[0].ownership!=='agent')throw new Error('WAIT_USER_CONTROL');
  if(b.egoProfileId&&rows[0].profileId!==b.egoProfileId)throw new Error('PROFILE_BINDING_MISMATCH');
  schoolRuntimeTask=await taskSpace(Number(id));
  if(schoolRuntimeTask.ownership!=='agent'||schoolRuntimeTask.name!==b.taskSpaceName)throw new Error('SPACE_CHANGED');
  return {id:schoolRuntimeTask.spaceId,name:schoolRuntimeTask.name};
}
async function listTabs(){if(!schoolRuntimeTask)throw new Error('SCHOOL_TASK_UNBOUND');return await schoolRuntimeTask.tabs();}
async function switchTab(targetId){
  const tabs=await listTabs(),b=schoolRuntimeBinding();
  const tab=tabs.find(t=>t.targetId===targetId&&t.label===b.pageLabel);
  if(!tab)throw new Error('EXACT_SCHOOL_PAGE_REQUIRED');
  schoolRuntimePage=schoolRuntimeTask.page(tab.label);
  // No tab activation, browser focus or navigation.
}
function boundPage(){if(!schoolRuntimePage)throw new Error('SCHOOL_PAGE_UNBOUND');return schoolRuntimePage;}
async function js(expression){return await boundPage().evaluate(expression);}
async function pageInfo(){return await boundPage().evaluate(()=>({w:innerWidth,h:innerHeight,url:location.href,title:document.title}));}
async function wait(seconds){await new Promise(resolve=>setTimeout(resolve,Math.max(0,seconds)*1000));}
async function click(target,options={}){return Array.isArray(target)?await boundPage().mouse.click(target[0],target[1],options):await boundPage().click(target,options);}
async function hover(target,options={}){return Array.isArray(target)?await boundPage().mouse.move(target[0],target[1],options):await boundPage().hover(target,options);}
async function pressKey(chord){return await boundPage().keyboard.press(chord);}
async function assertDouyinInputMissingAssetsAtUploadFile(file){
  const code='DOUYIN_INPUT_MISSING_SOURCE_ASSET_CHANGED_AT_UPLOADFILE';
  const reject=()=>{const error=new Error(code);error.code=code;throw error;};
  try{
    const contract=typeof douyinInputMissingResumeContract==='undefined'?null:douyinInputMissingResumeContract;
    const expected=typeof douyinInputMissingExpectedIdentity==='undefined'?null:douyinInputMissingExpectedIdentity;
    if(!contract||contract.resumeType!=='before_file_input_missing'||contract.version!==1||contract.platform!=='douyin'
      ||!expected||expected.jobId!==contract.jobId||expected.fingerprint!==contract.fingerprint
      ||expected.fingerprint!==contract.packageFingerprint||jobFingerprint!==expected.fingerprint
      ||!/^[a-f0-9]{16}$/.test(String(expected.jobId||''))
      ||!Array.isArray(expected.assets)||!expected.video||!expected.video.path
      ||!sameAsset(expected.video,contract.video)||path.resolve(String(file||''))!==path.resolve(expected.video.path))reject();
    const checkpoint=receiptCheckpointPath;
    const statePath=path.resolve(String(contract.statePath||''));
    if(typeof checkpoint!=='string'||!checkpoint||path.basename(statePath)!=='state.json')reject();
    const expectedCheckpoint=path.join(path.dirname(statePath),'checkpoints','douyin.receipts.json');
    if(path.resolve(checkpoint)!==expectedCheckpoint)reject();
    const stateStat=fs.lstatSync(statePath);
    if(!stateStat.isFile()||stateStat.isSymbolicLink()||stateStat.size>16*1024*1024)reject();
    const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
    const item=state.platforms?.douyin;
    if(state.jobId!==expected.jobId||state.fingerprint!==expected.fingerprint
      ||!sameAsset(state.video,expected.video)||!sameAssets(state.assets,expected.assets)
      ||!item||item.status!=='needs_upload'||item.videoReceipt!=null
      ||!item.receipts||Object.keys(item.receipts).length!==0)reject();
    const files=[...expected.assets,expected.video];
    const paths=files.map(asset=>path.resolve(String(asset?.path||'')));
    if(new Set(paths).size!==paths.length)reject();
    const noFollow=fs.constants.O_NOFOLLOW||0,opened=[];
    const {createHash}=await import('node:crypto');
    try{
      for(const asset of files){
        if(!asset||!path.isAbsolute(asset.path)||!Number.isSafeInteger(asset.size)||asset.size<1||!/^[a-f0-9]{64}$/.test(asset.sha256||''))reject();
        const pathStat=fs.lstatSync(asset.path);
        if(!pathStat.isFile()||pathStat.isSymbolicLink())reject();
        const handle=await fs.promises.open(asset.path,fs.constants.O_RDONLY|noFollow);
        const entry={asset,handle,before:null};opened.push(entry);
        const before=await handle.stat({bigint:true});
        if(!before.isFile()||before.size!==BigInt(asset.size)||BigInt(pathStat.dev)!==before.dev||BigInt(pathStat.ino)!==before.ino)reject();
        entry.before=before;
      }
      for(const {asset,handle} of opened){
        const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);
        let position=0;
        while(position<asset.size){
          const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,asset.size-position),position);
          if(!bytesRead)reject();
          hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;
        }
        if(hash.digest('hex')!==asset.sha256)reject();
      }
      // Keep every asset fd open while checking hashes, then compare metadata on
      // all of them as a final short pass immediately before setInputFiles.
      for(const {asset,handle,before} of opened){
        const after=await handle.stat({bigint:true});
        if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size
          ||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||after.size!==BigInt(asset.size))reject();
      }
    }finally{await Promise.all(opened.map(({handle})=>handle.close()));}
  }catch(error){if(error?.code===code)throw error;reject();}

  function sameAsset(a,b){return Boolean(a&&b&&path.resolve(String(a.path||''))===path.resolve(String(b.path||''))
    &&Number.isSafeInteger(a.size)&&a.size>0&&a.size===b.size
    &&typeof a.sha256==='string'&&/^[a-f0-9]{64}$/.test(a.sha256)&&a.sha256===b.sha256);}
  function sameAssets(a,b){return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length
    &&a.every((asset,index)=>sameAsset(asset,b[index]));}
}
async function assertDouyinWindowAssetsAtUploadFile(file){
  const code='DOUYIN_WINDOW_BINDING_SOURCE_ASSET_CHANGED_AT_UPLOADFILE';
  const reject=()=>{const error=new Error(code);error.code=code;throw error;};
  const {createHash}=await import('node:crypto');
  try{
    const contract=typeof douyinWindowBindingResumeContract==='undefined'?null:douyinWindowBindingResumeContract;
    const expected=contract?.sourceIdentity;
    const binding=typeof douyinExecutionBinding==='undefined'?null:douyinExecutionBinding;
    const statePath=String(contract?.statePath||'');
    if(!contract||contract.resumeType!=='douyin_same_job_window_binding_recovery'||contract.version!==1
      ||contract.platform!=='douyin'||platform!=='douyin'||phase!=='upload_start'
      ||!expected?.video||!Array.isArray(expected.assets)||!binding
      ||jobFingerprint!==contract.fingerprint||!/^\d+$/.test(String(douyinWindowExpectedUid||''))
      ||path.resolve(String(file||''))!==path.resolve(expected.video.path)
      ||path.basename(statePath)!=='state.json')reject();
    const checkpoint=receiptCheckpointPath;
    const expectedCheckpoint=path.join(path.dirname(statePath),'checkpoints','douyin.receipts.json');
    if(typeof checkpoint!=='string'||path.resolve(checkpoint)!==path.resolve(expectedCheckpoint))reject();
    const stateStat=fs.lstatSync(statePath);
    if(!stateStat.isFile()||stateStat.isSymbolicLink()||stateStat.size>16*1024*1024)reject();
    const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
    const item=state.platforms?.douyin;
    if(state.jobId!==contract.jobId||state.fingerprint!==contract.fingerprint
      ||!item||Number(item.taskSpaceId)!==binding.spaceId||item.taskSpaceName!==binding.spaceName
      ||item.videoReceipt!=null||!item.receipts||Object.keys(item.receipts).length!==0
      ||!Array.isArray(item.history)||item.history.length<3
      ||item.history[0]?.phase!=='inspect'||path.resolve(item.history[0]?.evidencePath||'')!==path.resolve(contract.historyEvidence?.[0]?.path||'')
      ||item.history[1]?.phase!=='upload_start'||path.resolve(item.history[1]?.evidencePath||'')!==path.resolve(contract.historyEvidence?.[1]?.path||'')
      ||item.history[2]?.phase!=='inspect'||path.resolve(item.history[2]?.evidencePath||'')!==path.resolve(item.lastEvidencePath||''))reject();
    const expectedBackup=path.join(path.dirname(statePath),'state.backup.json');
    if(path.resolve(String(contract.checkpoint?.path||''))!==path.resolve(expectedCheckpoint)
      ||path.resolve(String(contract.backup?.path||''))!==path.resolve(expectedBackup)
      ||fs.existsSync(expectedCheckpoint))reject();
    const receiptStat=fs.lstatSync(String(contract.outerReceipt?.path||''));
    if(!receiptStat.isFile()||receiptStat.isSymbolicLink())reject();
    const receiptRaw=fs.readFileSync(contract.outerReceipt.path);
    const receiptHash=createHash('sha256').update(receiptRaw).digest('hex');
    if(receiptHash!==contract.outerReceipt.sha256)reject();
    for(const record of contract.historyEvidence||[]){
      const evidenceStat=fs.lstatSync(record.path);if(!evidenceStat.isFile()||evidenceStat.isSymbolicLink()||evidenceStat.size!==record.bytes)reject();
      const evidenceHash=createHash('sha256').update(fs.readFileSync(record.path)).digest('hex');if(evidenceHash!==record.sha256)reject();
    }
    const transitionRaw=fs.readFileSync(item.history[2].evidencePath);
    const transition=JSON.parse(transitionRaw.toString('utf8'))?.observation;
    if(transition?.phase!=='inspect'||Number(transition.taskSpaceId)!==binding.taskSpaceId
      ||transition.taskSpace!==binding.taskSpaceName
      ||JSON.stringify(transition.douyinWindowBinding)!==JSON.stringify(contract.executionBinding))reject();
    const files=[expected.video,...expected.assets];
    const paths=files.map(asset=>path.resolve(String(asset?.path||'')));
    if(new Set(paths).size!==paths.length)reject();
    const noFollow=fs.constants.O_NOFOLLOW||0,opened=[];
    try{
      for(const asset of files){
        if(!asset||!path.isAbsolute(asset.path)||!Number.isSafeInteger(asset.size)||asset.size<1||!/^[a-f0-9]{64}$/.test(asset.sha256||''))reject();
        const pathStat=fs.lstatSync(asset.path);if(!pathStat.isFile()||pathStat.isSymbolicLink())reject();
        const handle=await fs.promises.open(asset.path,fs.constants.O_RDONLY|noFollow);
        const entry={asset,handle,before:null};opened.push(entry);
        const before=await handle.stat({bigint:true});
        if(!before.isFile()||before.size!==BigInt(asset.size)||BigInt(pathStat.dev)!==before.dev||BigInt(pathStat.ino)!==before.ino)reject();
        entry.before=before;
      }
      for(const {asset,handle} of opened){
        const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let position=0;
        while(position<asset.size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,asset.size-position),position);if(!bytesRead)reject();hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;}
        if(hash.digest('hex')!==asset.sha256)reject();
      }
      for(const {asset,handle,before} of opened){
        const after=await handle.stat({bigint:true});
        if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||after.size!==BigInt(asset.size))reject();
      }
    }finally{await Promise.all(opened.map(({handle})=>handle.close()));}
  }catch(error){if(error?.code===code)throw error;reject();}
}
async function uploadFile(selector,file){
  if(platform==='douyin'&&phase==='upload_start'&&typeof douyinWindowBindingResumeActive!=='undefined'&&douyinWindowBindingResumeActive===true){
    douyinWindowMutationCounters.uploadFileCalls+=1;
    await assertDouyinWindowAssetsAtUploadFile(file);
    douyinWindowMutationCounters.setInputFilesCalls+=1;
  }
  if(platform==='douyin'&&phase==='upload_start'&&typeof douyinInputMissingResumeActive!=='undefined'
    &&douyinInputMissingResumeActive===true)await assertDouyinInputMissingAssetsAtUploadFile(file);
  return await boundPage().setInputFiles(selector,file);
}
async function cdp(method,params={}){
  if(method==='Page.bringToFront')return {skipped:true,reason:'school publisher does not steal foreground'};
  return await boundPage().cdp(method,params);
}
// Legacy fragment durations are seconds; public Ego Page durations are milliseconds.
async function gotoAndWait(url,options={}) {
  if(new URL(url).hostname!==new URL(await boundPage().url()).hostname)throw new Error('CROSS_PLATFORM_NAVIGATION_BLOCKED');
  if(Object.keys(options).some(k=>!['timeout','settle','waitUntil','referer'].includes(k)))throw new Error('SCHOOL_NAVIGATION_OPTION_UNSUPPORTED');
  const timeout=options.timeout===undefined?45000:Number(options.timeout)*1000;
  const settle=options.settle===undefined?0:Number(options.settle)*1000;
  if(!Number.isFinite(timeout)||timeout<0||!Number.isFinite(settle)||settle<0)throw new Error('SCHOOL_NAVIGATION_DURATION_INVALID');
  const result=await boundPage().goto(url,{timeout,waitUntil:options.waitUntil||'domcontentloaded',...(options.referer?{referer:options.referer}:{})});
  if(settle)await wait(settle/1000);
  return result;
}
async function openOrReuseTab(){throw new Error('SCHOOL_NEW_TAB_BLOCKED');}
function cliLog(value){console.log(value);}
