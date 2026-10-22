import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createFixture,readFixture,hash} from '../lib/fixture.mjs';
import {admit,consume,validatePrepared} from '../lib/publication-guard.mjs';
import {simulate,mockObservation,demoMatrix} from '../lib/offline.mjs';
import {resolveSchoolAccountBinding} from '../core/lib/school-account.mjs';
import {verifyAssetBindings} from '../lib/wrapper/content-packet.mjs';
import {validateDocument} from '../lib/schemas.mjs';
async function fixture(fn){const parent=fs.mkdtempSync(path.join(os.tmpdir(),'wrapper-guard-'));try{const made=createFixture(path.join(parent,'fixture'));return await fn(path.dirname(made.packagePath),made.packagePath);}finally{fs.rmSync(parent,{recursive:true,force:true});}}
const binding=()=>resolveSchoolAccountBinding({platform:'douyin',accountKey:'demo'},demoMatrix);
function rewrite(root,file,mutate,{review=true}={}){const p=JSON.parse(fs.readFileSync(file));mutate(p);const bytes=JSON.stringify(p,null,2)+'\n';fs.writeFileSync(file,bytes);if(review){const r=JSON.parse(fs.readFileSync(path.join(root,'review.json')));r.packageSha256=hash(bytes);fs.writeFileSync(path.join(root,'review.json'),JSON.stringify(r));}return p;}
test('original asset verifier rejects missing, duplicate, unexpected and changed bindings',()=>fixture((root,file)=>{
 const p=JSON.parse(fs.readFileSync(file));assert.equal(verifyAssetBindings(p).ok,true);
 for(const mutate of [p=>delete p.studio.assetBindings,p=>p.studio.assetBindings.pop(),p=>p.studio.assetBindings.push(p.studio.assetBindings[0]),p=>p.studio.assetBindings[0].path=path.join(root,'not-a-slot'),p=>p.studio.subject.key='different',p=>p.studio.assetBindings[0].size++]){const q=structuredClone(p);mutate(q);assert.equal(verifyAssetBindings(q).ok,false);}
 fs.appendFileSync(p.videoPath,'changed');assert.equal(verifyAssetBindings(p).ok,false);
}));
test('preflight failures never allocate submission state or call adapter',()=>fixture(async(root,file)=>{
 const p=JSON.parse(fs.readFileSync(file));fs.appendFileSync(p.videoPath,'drift');const r=await simulate(file,{stateRoot:root,execute:true});assert.equal(r.adapterCalls,0);assert.equal(r.code,'SYNTHETIC_ASSET_CHANGED');assert.equal(fs.existsSync(path.join(root,'.offline-state')),false);
}));
test('compiled adapter gaps remain blocked even with resealed review',()=>fixture(async(root,file)=>{
 rewrite(root,file,p=>{p.studio.needsAdapter=true;p.studio.adapterIssues=['UNVERIFIED_COMPONENT'];});const r=await simulate(file,{stateRoot:root,execute:true});assert.equal(r.code,'ADAPTER_NOT_VERIFIED');assert.equal(r.adapterCalls,0);
}));
test('review is bound to exact package bytes, action and account',()=>fixture(async(root,file)=>{
 const reviewPath=path.join(root,'review.json'),original=JSON.parse(fs.readFileSync(reviewPath));
 for(const patch of [{packageSha256:'0'.repeat(64)},{actions:['draft']},{accountKey:'other'},{truthVerified:true}]){fs.writeFileSync(reviewPath,JSON.stringify({...original,...patch}));const r=await simulate(file,{stateRoot:root,execute:true});assert.equal(r.code,'REVIEW_BINDING_MISMATCH');assert.equal(r.adapterCalls,0);}
}));
test('every declared review gate is mandatory; byte checks do not approve truth',()=>fixture(async(root,file)=>{
 const reviewPath=path.join(root,'review.json'),original=JSON.parse(fs.readFileSync(reviewPath));
 for(const name of Object.keys(original.checks)){fs.writeFileSync(reviewPath,JSON.stringify({...original,checks:{...original.checks,[name]:false}}));const r=await simulate(file,{stateRoot:root,execute:true});assert.equal(r.code,'CONTENT_REVIEW_INCOMPLETE');assert.equal(r.adapterCalls,0);}
}));
test('media issues cannot be dismissed by otherwise true review flags',()=>fixture(async(root,file)=>{
 const f=path.join(root,'review.json'),r=JSON.parse(fs.readFileSync(f));r.mediaReviewIssues=['UNRESOLVED'];fs.writeFileSync(f,JSON.stringify(r));assert.equal((await simulate(file,{stateRoot:root,execute:true})).code,'CONTENT_REVIEW_INCOMPLETE');
}));
test('opaque admission cannot be forged, reused or moved across actions',()=>fixture((root,file)=>{
 const s=readFixture(file),b=binding(),obs=mockObservation();
 assert.throws(()=>consume({}, {snapshot:s,action:'publish',binding:b,observation:obs}),/ADMISSION_MISSING/);
 const token=admit(s,'publish',b,obs);assert.equal(consume(token,{snapshot:s,action:'publish',binding:b,observation:obs}),true);assert.throws(()=>consume(token,{snapshot:s,action:'publish',binding:b,observation:obs}),/CONSUMED/);
 const wrong=admit(s,'draft',b,obs);assert.throws(()=>consume(wrong,{snapshot:s,action:'publish',binding:b,observation:obs}),/TARGET_MISMATCH/);
}));
test('changed package, assets and review after admission are refused',()=>fixture((root,file)=>{
 const s=readFixture(file),b=binding(),obs=mockObservation(),token=admit(s,'publish',b,obs);fs.appendFileSync(file,' ');assert.throws(()=>consume(token,{snapshot:s,action:'publish',binding:b,observation:obs}),/PACKAGE_CHANGED/);
 fs.writeFileSync(file,s.bytes);const t=admit(s,'publish',b,obs);fs.appendFileSync(s.pkg.videoPath,'changed');assert.throws(()=>consume(t,{snapshot:s,action:'publish',binding:b,observation:obs}),/ASSET_CHANGED/);
}));
test('review replacement after admission cannot reuse the old token',()=>fixture((root,file)=>{
 const s=readFixture(file),b=binding(),obs=mockObservation(),token=admit(s,'publish',b,obs);fs.appendFileSync(path.join(root,'review.json'),' ');assert.throws(()=>consume(token,{snapshot:s,action:'publish',binding:b,observation:obs}),/REVIEW_CHANGED/);
}));
test('fresh identity includes API UID, ownership and original target',()=>fixture(async(root,file)=>{
 for(const scenario of ['identity-mismatch','user-owned','target-mismatch','stale-identity']){const r=await simulate(file,{stateRoot:root,execute:true,scenario});assert.equal(r.ok,false);assert.equal(r.adapterCalls,0);}
 assert.equal(fs.existsSync(path.join(root,'.offline-state')),false);
}));
test('public text links fail before reservation despite a matching review hash',()=>fixture(async(root,file)=>{
 rewrite(root,file,p=>{p.title='点击 https://outside.example/next';p.douyinTitle=p.title;});const r=await simulate(file,{stateRoot:root,execute:true});assert.equal(r.code,'PUBLIC_EXTERNAL_LINK_POLICY_BLOCKED');assert.equal(r.adapterCalls,0);
}));
test('a supplied path outside the fixture is rejected before the file is read',()=>fixture(async(root,file)=>{
 rewrite(root,file,p=>{p.studio.assetBindings.push({path:path.join(path.dirname(root),'never-read-secret'),sha256:'0'.repeat(64),size:0});});const r=await simulate(file,{stateRoot:root,execute:true});assert.equal(r.code,'FIXTURE_PATH_ESCAPE');assert.equal(r.adapterCalls,0);
}));
test('asset symlinks are rejected even when byte hashes would match',()=>fixture(async(root,file)=>{
 const p=JSON.parse(fs.readFileSync(file)),backup=path.join(root,'backup.bin');fs.renameSync(p.videoPath,backup);fs.symlinkSync(backup,p.videoPath);const r=await simulate(file,{stateRoot:root,execute:true});assert.equal(r.code,'FIXTURE_SYMLINK_FORBIDDEN');assert.equal(r.adapterCalls,0);
}));
test('unknown outcome reconciliation preserves original receipt and blocks repeat',()=>fixture(async(root,file)=>{
 const a=await simulate(file,{stateRoot:root,execute:true,scenario:'uncertain'});assert.equal(a.status,'SUBMISSION_UNCERTAIN');const original=fs.readFileSync(a.receiptPath);
 const read=await simulate(file,{stateRoot:root,action:'status'});assert.equal(read.status,'MOCK_RECONCILED_PUBLISHED');assert.equal(read.retryAllowed,false);assert.equal(read.publicReadbackVerified,false);assert.deepEqual(fs.readFileSync(a.receiptPath),original);
 assert.equal((await simulate(file,{stateRoot:root,execute:true})).adapterCalls,0);
}));
test('missing or ambiguous mock readback remains UNKNOWN, never authorizes retry',()=>fixture(async(root,file)=>{
 await simulate(file,{stateRoot:root,execute:true,scenario:'uncertain'});const dir=path.join(root,'.offline-state','remote'),f=path.join(dir,fs.readdirSync(dir)[0]),original=JSON.parse(fs.readFileSync(f));
 for(const rows of [[],[...original.rows,...original.rows],[{...original.rows[0],creatorUid:'other'}],[{...original.rows[0],contentId:'other'}],[{...original.rows[0],status:'UNKNOWN'}]]){fs.writeFileSync(f,JSON.stringify({rows}));const r=await simulate(file,{stateRoot:root,action:'status'});assert.equal(r.status,'MOCK_RECONCILIATION_UNKNOWN');assert.equal(r.retryAllowed,false);}
}));
test('status can reconcile a pending job without reopening drifted media',()=>fixture(async(root,file)=>{
 await simulate(file,{stateRoot:root,execute:true,scenario:'uncertain'});fs.unlinkSync(JSON.parse(fs.readFileSync(file)).videoPath);const r=await simulate(file,{stateRoot:root,action:'status'});assert.equal(r.status,'MOCK_RECONCILED_PUBLISHED');assert.equal((await simulate(file,{stateRoot:root,execute:true})).adapterCalls,0);
}));
test('foreign account or ID after submit remains uncertain and cannot become mock published',()=>fixture(async(root,file)=>{
 const r=await simulate(file,{stateRoot:root,execute:true,scenario:'result-account-mismatch'});assert.equal(r.status,'SUBMISSION_UNCERTAIN');assert.equal((await simulate(file,{stateRoot:root,action:'status'})).status,'MOCK_RECONCILIATION_UNKNOWN');assert.equal((await simulate(file,{stateRoot:root,execute:true})).adapterCalls,0);
}));
test('state cannot escape fixture or follow a replaced job-directory symlink',()=>fixture(async(root,file)=>{
 await assert.rejects(simulate(file,{stateRoot:path.dirname(root),execute:true}),/STATE_ROOT_OUTSIDE/);
 fs.symlinkSync(path.dirname(root),path.join(root,'.offline-state'));await assert.rejects(simulate(file,{stateRoot:root,execute:true}),/STATE_DIRECTORY_UNSAFE/);
}));
test('runtime JSON Schema enforces configuration and compiled package shape',()=>fixture((root,file)=>{
 const p=JSON.parse(fs.readFileSync(file));assert.equal(validateDocument('compiled',p).ok,true);assert.equal(validateDocument('compiled',{...p,unregisteredField:true}).ok,false);
 assert.equal(validateDocument('accounts',{platforms:{}}).ok,true);assert.equal(validateDocument('accounts',{platforms:{douyin:{accounts:[{key:'a',name:'fake',id:'001'}]}}}).ok,false);
 const cfg=JSON.parse(fs.readFileSync(new URL('../examples/publisher-config.json',import.meta.url)));assert.equal(validateDocument('publisher',cfg).ok,true);cfg.execution.checkConcurrency=0;assert.equal(validateDocument('publisher',cfg).ok,false);
}));


test('recursive fingerprint paths cannot escape through nested compiler metadata',()=>fixture(async(root,file)=>{
 rewrite(root,file,p=>{p.studio.requested.extra={extraPath:path.join(path.dirname(root),'not-readable')};});
 const r=await simulate(file,{stateRoot:root,execute:true});assert.equal(r.code,'FIXTURE_PATH_ESCAPE');assert.equal(r.adapterCalls,0);assert.equal(fs.existsSync(path.join(root,'.offline-state')),false);
}));
test('unknown studio fields fail schema before they can affect original fingerprint',()=>fixture(async(root,file)=>{
 rewrite(root,file,p=>{p.studio.extraPath=path.join(path.dirname(root),'not-readable');});await assert.rejects(simulate(file,{stateRoot:root,execute:true}),/SCHEMA_VALIDATION_FAILED/);
}));
test('nested account ledger symlink cannot write outside fixture',()=>fixture(async(root,file)=>{
 const state=path.join(root,'.offline-state'),dispatch=path.join(state,'dispatch'),outside=path.join(path.dirname(root),'outside');fs.mkdirSync(dispatch,{recursive:true});fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(dispatch,'douyin'));
 await assert.rejects(simulate(file,{stateRoot:root,execute:true}),/STATE_DIRECTORY_UNSAFE/);assert.deepEqual(fs.readdirSync(outside),[]);
}));

test('a changed original uncertain receipt cannot be reconciled as success',()=>fixture(async(root,file)=>{
 const a=await simulate(file,{stateRoot:root,execute:true,scenario:'uncertain'});const receipt=JSON.parse(fs.readFileSync(a.receiptPath));receipt.accountKey='other';fs.writeFileSync(a.receiptPath,JSON.stringify(receipt));const r=await simulate(file,{stateRoot:root,action:'status'});assert.equal(r.status,'MOCK_RECONCILIATION_UNKNOWN');assert.equal(r.retryAllowed,false);
}));
test('submitted-to-published mock readback appends evidence without replacing original receipt',()=>fixture(async(root,file)=>{
 const a=await simulate(file,{stateRoot:root,execute:true,scenario:'submitted'}),original=fs.readFileSync(a.receiptPath);assert.equal((await simulate(file,{stateRoot:root,action:'status'})).status,'MOCK_RECONCILED_SUBMITTED');
 const dir=path.join(root,'.offline-state','remote'),f=path.join(dir,fs.readdirSync(dir)[0]),remote=JSON.parse(fs.readFileSync(f));remote.rows[0].status='PUBLISHED';fs.writeFileSync(f,JSON.stringify(remote));assert.equal((await simulate(file,{stateRoot:root,action:'status'})).status,'MOCK_RECONCILED_PUBLISHED');assert.equal(fs.readdirSync(path.join(root,'.offline-state','reconciliation')).length,2);assert.deepEqual(fs.readFileSync(a.receiptPath),original);
}));

test('CLI-style original temporary paths remain usable with OS-owned aliases',async()=>{const parent=fs.mkdtempSync(path.join(os.tmpdir(),'alias-fixture-'));try{const raw=path.join(parent,'fixture');createFixture(raw);const r=await simulate(path.join(raw,'package.json'),{stateRoot:raw,execute:true});assert.equal(r.status,'MOCK_PUBLISHED');}finally{fs.rmSync(parent,{recursive:true,force:true});}});

test('configuration runtime also preserves original subset semantics and unique account binding',()=>{
 const cfg=JSON.parse(fs.readFileSync(new URL('../examples/publisher-config.json',import.meta.url)));cfg.defaultPlatforms=['youtube'];assert.equal(validateDocument('publisher',cfg).code,'CONFIG_SEMANTIC_VALIDATION_FAILED');
 const account=structuredClone(demoMatrix.platforms.douyin.accounts[0]);const compact={key:account.key,name:account.name,id:account.id,ego:account.ego};assert.equal(validateDocument('accounts',{platforms:{douyin:{accounts:[compact,compact]}}}).code,'ACCOUNT_BINDING_AMBIGUOUS');
});
