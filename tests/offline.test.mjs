import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {simulate,demoMatrix,validateDemo,createFixture} from '../lib/offline.mjs';
import {reserve,fingerprintPackage} from '../core/run-school-publisher.mjs';
import {buildIdentity} from '../core/v2/lib/identity.mjs';
const source=new URL('../examples/package.json',import.meta.url);
async function fixture(fn){const parent=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-offline-'));try{const made=createFixture(path.join(parent,'fixture'));const root=path.dirname(made.packagePath);return await fn(root,made.packagePath);}finally{fs.rmSync(parent,{recursive:true,force:true});}}
test('original dispatcher submits once and blocks duplicate despite mock success',()=>fixture(async(root,file)=>{
 const a=await simulate(file,{stateRoot:root,execute:true}),b=await simulate(file,{stateRoot:root,execute:true});
 assert.equal(a.status,'MOCK_PUBLISHED');assert.equal(a.adapterCalls,1);assert.equal(a.publicationPerformed,false);assert.equal(a.publicReadbackVerified,false);
 assert.equal(b.status,'DUPLICATE_OR_UNCERTAIN_SUBMISSION');assert.equal(b.adapterCalls,0);
}));
test('lost response keeps reservation and prohibits another submission',()=>fixture(async(root,file)=>{
 const a=await simulate(file,{stateRoot:root,execute:true,scenario:'uncertain'});assert.equal(a.ok,false);assert.equal(a.adapterCalls,1);
 const b=await simulate(file,{stateRoot:root,execute:true});assert.equal(b.status,'DUPLICATE_OR_UNCERTAIN_SUBMISSION');assert.equal(b.adapterCalls,0);
 const read=await simulate(file,{stateRoot:root,action:'status'});assert.equal(read.retryAllowed,false);assert.equal(read.adapterCalls,0);assert.equal(read.status,'MOCK_RECONCILED_PUBLISHED');
}));
test('identity and ownership failures stop before reservation or adapter',()=>fixture(async(root,file)=>{
 for(const scenario of ['identity-mismatch','user-owned']){const r=await simulate(file,{stateRoot:root,execute:true,scenario});assert.equal(r.ok,false);assert.equal(r.adapterCalls,0);assert.equal(fs.existsSync(path.join(root,'.offline-state')),false);}
}));
test('no execution opt-in means no adapter or reservation',()=>fixture(async(root,file)=>{const r=await simulate(file,{stateRoot:root});assert.equal(r.status,'EXECUTION_OPT_IN_REQUIRED');assert.equal(r.adapterCalls,0);}));
test('submitted is distinct from mock published',()=>fixture(async(root,file)=>{const r=await simulate(file,{stateRoot:root,execute:true,scenario:'submitted'});assert.equal(r.status,'MOCK_SUBMITTED');assert.equal(r.publicReadbackVerified,false);}));
test('media bytes change original package identity and fingerprint',()=>fixture(async(root,file)=>{
 const media=path.join(root,'fake.bin');fs.writeFileSync(media,'fake-one');const pkg={...JSON.parse(fs.readFileSync(file)),videoPath:media};
 const a=fingerprintPackage(pkg),id=await buildIdentity(pkg);fs.writeFileSync(media,'fake-two');
 assert.notEqual(fingerprintPackage(pkg).contentHash,a.contentHash);assert.notEqual((await buildIdentity(pkg)).video.sha256,id.video.sha256);
}));
test('atomic reservation has one winner under parallel processes',()=>fixture(async(root,file)=>{
 const script=`import {reserve} from ${JSON.stringify(new URL('../core/run-school-publisher.mjs',import.meta.url).href)};console.log(JSON.stringify(reserve({title:'parallel',schoolAccount:{platform:'douyin',accountKey:'demo'}},'publish',process.argv[1])));`;
 const {spawn}=await import('node:child_process');
 const run=()=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--input-type=module','-e',script,root]);let text='';p.stdout.on('data',v=>text+=v);p.on('error',reject);p.on('close',code=>code?reject(Error('child failure')):resolve(JSON.parse(text)));});
 const results=await Promise.all([run(),run(),run(),run()]);assert.equal(results.filter(x=>!x.duplicate).length,1);
}));
test('CLI rejects native mode, resume flags and unsupported options',()=>{
 const cli=new URL('../bin/maxiaojian-publish.mjs',import.meta.url).pathname;
 for(const args of [['--account-status','douyin','demo'],['simulate',source.pathname,'--resume','case'],['simulate',source.pathname]]){const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});assert.equal(r.status,2);}
});
test('demo refuses local media paths, fixed contracts and real account mappings',()=>{
 const pkg=JSON.parse(fs.readFileSync(source));for(const patch of [{videoPath:'/does-not-exist'},{preparedState:'x'},{schoolAccount:{platform:'douyin',accountKey:'other'}}])assert.throws(()=>validateDemo({...pkg,...patch}));
});


test('fictional publisher configuration passes original semantic validator',async()=>{const {normalizeConfig,validateConfig}=await import('../core/lib/config.mjs');const c=JSON.parse(fs.readFileSync(new URL('../examples/publisher-config.json',import.meta.url)));assert.deepEqual(validateConfig(normalizeConfig(c)),[]);assert.equal(c.onboarding.completed,false);});
