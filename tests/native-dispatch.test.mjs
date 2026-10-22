import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runSchoolPublisher,execute} from '../core/run-school-publisher.mjs';
import {validateDocument} from '../lib/schemas.mjs';
function fixture(fn){return async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-contract-'));try{const file=path.join(root,'package.json'),account={key:'fictional',name:'Fictional Creator',id:'000001',ego:{profileId:'fixture',taskSpaceId:1,taskSpaceName:'Fixture',pageLabel:'p1',targetId:'fixture-target'}};return await fn({root,file,account,write(pkg){fs.writeFileSync(file,JSON.stringify(pkg));},pkg(platform){return {schoolAccount:{platform,accountKey:account.key},title:'Fixture article',body:'Synthetic text',backend:'ego_article'};},matrix(platform){return {platforms:{[platform]:{accounts:[account]}}};}});}finally{fs.rmSync(root,{recursive:true,force:true});}};}
for(const platform of ['toutiao','sohu'])test(platform+' native publish requires explicit opt-in and dispatches exactly once',fixture(async f=>{
 f.write(f.pkg(platform));let calls=0;const deps={matrix:f.matrix(platform),stateBase:path.join(f.root,'jobs'),runNativeArticle:async()=>{calls++;return {ok:true,status:'SUBMITTED',publicationPerformed:false};}};
 assert.equal((await runSchoolPublisher([f.file,'--action','publish'],deps)).status,'EXECUTION_OPT_IN_REQUIRED');assert.equal(calls,0);
 const r=await runSchoolPublisher([f.file,'--action','publish','--execute'],deps);assert.equal(r.status,'SUBMITTED');assert.equal(calls,1);assert.equal(fs.existsSync(r.receiptPath),true);
 assert.equal((await runSchoolPublisher([f.file,'--action','publish','--execute'],deps)).status,'DUPLICATE_OR_UNCERTAIN_SUBMISSION');assert.equal(calls,1);
}));
test('native uncertain result retains reservation and forbids automatic retry',fixture(async f=>{
 f.write(f.pkg('toutiao'));let calls=0;const deps={matrix:f.matrix('toutiao'),stateBase:path.join(f.root,'jobs'),runNativeArticle:async()=>{calls++;throw Error('synthetic response lost');}};
 const r=await runSchoolPublisher([f.file,'--action','publish','--execute'],deps);assert.equal(r.status,'SUBMISSION_UNCERTAIN');assert.equal(fs.existsSync(r.receiptPath),true);
 assert.equal((await runSchoolPublisher([f.file,'--action','publish','--execute'],deps)).status,'DUPLICATE_OR_UNCERTAIN_SUBMISSION');assert.equal(calls,1);
}));
test('native video final dispatch accepts explicit prepared state, not a session-wide disable',fixture(async f=>{
 const p={...f.pkg('bilibili'),backend:'ego_video'};f.write(p);let calls=0;const state=path.join(f.root,'state.json');fs.writeFileSync(state,'{}');
 const r=await runSchoolPublisher([f.file,'--action','publish','--prepared-state',state,'--execute'],{matrix:f.matrix('bilibili'),stateBase:path.join(f.root,'jobs'),runVideoRelease:async(file,s)=>{calls++;assert.equal(s,state);return {ok:false,status:'BLOCKED',code:'SYNTHETIC_STATE_REJECTED'};}});
 assert.equal(calls,1);assert.equal(r.code,'SYNTHETIC_STATE_REJECTED');
}));
test('native account mismatch stops before any backend',fixture(async f=>{
 f.write({...f.pkg('toutiao'),schoolAccount:{platform:'toutiao',accountKey:'fictional',accountId:'wrong'}});let calls=0;
 await assert.rejects(runSchoolPublisher([f.file,'--action','publish','--execute'],{matrix:f.matrix('toutiao'),runNativeArticle:()=>calls++}),/ACCOUNT_ID_MISMATCH/);assert.equal(calls,0);
}));
test('restored process launcher executes only synthetic local child in test',async()=>{const r=await execute(process.execPath,['-e','process.stdout.write("fixture-only")']);assert.equal(r.code,0);assert.equal(r.stdout,'fixture-only');});
test('fictional browser and API account examples validate without credentials',()=>{const obj=JSON.parse(fs.readFileSync(new URL('../examples/accounts.json',import.meta.url)));assert.equal(validateDocument('accounts',obj).ok,true);obj.platforms.wechat_official.accounts[0].wechatApi.secret='must-not-be-here';assert.equal(validateDocument('accounts',obj).ok,false);});
const {buildVideoReleaseScript,runVideoRelease}=await import('../core/lib/video-release-backend.mjs');
const {claimPreparedSohuResume,fingerprintPackage}=await import('../core/run-school-publisher.mjs');
const {spawnSync}=await import('node:child_process');
for(const platform of ['douyin','xiaohongshu','wechat_channels','bilibili'])test(platform+' real final release builder remains reachable and produces valid module',fixture(async f=>{
 const b={...f.account.ego,platform,accountKey:'fictional',accountName:f.account.name,accountId:f.account.id,egoProfileId:'fixture',platformHosts:[]};
 const script=buildVideoReleaseScript({pkg:{...f.pkg(platform),videoPath:path.join(f.root,'video.mp4'),description:'Synthetic'},binding:b,identity:{fingerprint:'0'.repeat(64),video:{sha256:'1'.repeat(64),size:1,path:path.join(f.root,'video.mp4')}},item:{receipts:{},videoReceipt:null},statePath:path.join(f.root,'state.json'),state:{jobId:'0'.repeat(16)}});
 assert.equal(typeof script,'string');assert.match(script,/FINAL_CLICK_RESERVED/);assert.match(script,/FINAL_CLICK_ALREADY_RESERVED/);
 const output=path.join(f.root,'generated.mjs');fs.writeFileSync(output,script);const parsed=spawnSync(process.execPath,['--check',output],{encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);
}));
test('actual final release rejects missing prepared state before transport',fixture(async f=>{
 f.write({...f.pkg('bilibili'),backend:'ego_video'});let calls=0;await assert.rejects(runVideoRelease(f.file,null,f.matrix('bilibili'),()=>calls++),/PREPARED_VIDEO_STATE_REQUIRED/);assert.equal(calls,0);
}));
test('typed article continuation binds path/account/content and claims once',fixture(async f=>{
 const p=f.pkg('sohu'),base=path.join(f.root,'jobs'),hash=fingerprintPackage(p).contentHash,dir=path.join(base,'sohu','fictional');fs.mkdirSync(dir,{recursive:true});const state=path.join(dir,'publish-v2-'+hash+'.json');
 const prior={ok:false,status:'PREPARATION_BLOCKED',stage:'content-preparation',submitted:false,submitAttempted:false,contentHash:hash,fingerprintVersion:2,action:'publish',platform:'sohu',accountKey:'fictional',backend:'ego_article'};
 fs.writeFileSync(state,JSON.stringify({...prior,submitAttempted:true}));assert.throws(()=>claimPreparedSohuResume(p,'publish',base,state,f.matrix('sohu')),/INELIGIBLE/);
 fs.writeFileSync(state,JSON.stringify(prior));const c=claimPreparedSohuResume(p,'publish',base,state,f.matrix('sohu'));assert.equal(c.resume,true);assert.throws(()=>claimPreparedSohuResume(p,'publish',base,state,f.matrix('sohu')),/EEXIST/);
}));
test('WeChat API uses installer mapping and external toolchain with unchanged submission parsing',fixture(async f=>{
 const previousRoot=process.env.MAXIAOJIAN_WECHAT_ROOT,previousMatrix=process.env.SCHOOL_PUBLISHER_ACCOUNT_MATRIX;
 process.env.MAXIAOJIAN_WECHAT_ROOT=f.root;process.env.SCHOOL_PUBLISHER_ACCOUNT_MATRIX=path.join(f.root,'accounts.json');
 fs.writeFileSync(process.env.SCHOOL_PUBLISHER_ACCOUNT_MATRIX,JSON.stringify({platforms:{wechat_official:{accounts:[{key:'fictional',name:'Fictional Official',id:'fake',wechatApi:{alias:'fictional-alias',slot:3}}]}}}));
 try{
  const {planWechat,runWechat}=await import('../core/lib/wechat-api-backend.mjs?synthetic-config-test');
  const pkg={schoolAccount:{platform:'wechat_official',accountKey:'fictional'},mediaId:'fictional_media'};
  const plan=planWechat(pkg,'publish');assert.equal(plan.cwd,f.root);assert.deepEqual(plan.args.slice(-4),['--account','3','publish','fictional_media']);
  let calls=0;const result=await runWechat(pkg,'publish',async(command,args)=>{calls++;return calls===1?{code:0,stdout:JSON.stringify({ok:true,code:'API_LOCAL_CROSSWALK_VERIFIED'}),stderr:''}:{code:0,stdout:'publish_id: fictional_publish',stderr:''};});
  assert.equal(calls,2);assert.equal(result.publishId,'fictional_publish');assert.equal(result.status,'SUBMITTED');assert.equal(result.publicReadbackVerified,false);
 }finally{if(previousRoot===undefined)delete process.env.MAXIAOJIAN_WECHAT_ROOT;else process.env.MAXIAOJIAN_WECHAT_ROOT=previousRoot;if(previousMatrix===undefined)delete process.env.SCHOOL_PUBLISHER_ACCOUNT_MATRIX;else process.env.SCHOOL_PUBLISHER_ACCOUNT_MATRIX=previousMatrix;}
}));

// All accounts and backends below are synthetic. No browser/network transport.
const declaredPlatforms=JSON.parse(fs.readFileSync(new URL('../config/platform-scope.json',import.meta.url))).platforms.map(row=>row.key);
test('distribution explicitly enumerates all twelve original platform families',()=>{
 assert.deepEqual(new Set(declaredPlatforms),new Set(['douyin','xiaohongshu','wechat_channels','bilibili','youtube','zhihu','sohu','toutiao','baijiahao','netease','weibo','wechat_official']));
});
for(const platform of declaredPlatforms)test(platform+' offline no-execute regression never enters a write backend',fixture(async f=>{
 const pkg=f.pkg(platform);delete pkg.backend;f.write(pkg);let calls=0;
 const reject=async()=>{calls++;throw Error('UNEXPECTED_TRANSPORT');};
 const result=await runSchoolPublisher([f.file,'--action','publish'],{matrix:f.matrix(platform),stateBase:path.join(f.root,'jobs'),execute:reject,runNativeArticle:reject,runVideoRelease:reject,runWeiboText:reject,runArticleManagement:reject});
 assert.equal(result.status,'EXECUTION_OPT_IN_REQUIRED');assert.equal(calls,0);
 assert.equal(fs.existsSync(path.join(f.root,'jobs')),false);
}));
test('YouTube final release capability gap is explicit before media, state or transport',fixture(async f=>{
 f.write({...f.pkg('youtube'),backend:'ego_video'});let calls=0;
 await assert.rejects(runVideoRelease(f.file,path.join(f.root,'nonexistent-state.json'),f.matrix('youtube'),()=>calls++),/VIDEO_RELEASE_PLATFORM_NOT_IMPLEMENTED/);
 assert.equal(calls,0);
}));
test('Netease generic write stays blocked and uses only synthetic management readback',fixture(async f=>{
 f.write(f.pkg('netease'));let reads=0,writes=0;
 const result=await runSchoolPublisher([f.file,'--action','publish','--execute'],{matrix:f.matrix('netease'),stateBase:path.join(f.root,'jobs'),runArticleManagement:async()=>{reads++;return {ok:true,status:'OBSERVED'};},runNativeArticle:async()=>{writes++;throw Error('UNEXPECTED_WRITE');}});
 assert.equal(result.code,'ARTICLE_WRITE_PATH_NOT_VERIFIED');assert.equal(result.readOnly,true);assert.equal(reads,1);assert.equal(writes,0);
}));
