import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {buildReadOnlyScript,parseReadOnlyOutput,validateReadOnlyRequest,READ_ONLY_HOSTS} from '../lib/read-only.mjs';
import {openSohuCoverEditor,uploadSohuCover} from '../core/lib/native-article-backend.mjs';
import {clickSohuTopic} from '../core/lib/sohu-topic-controls.mjs';
import {collectVisibleState} from '../lib/read-only-probe.mjs';
const req={platform:'toutiao',spaceId:7,page:'p1'},nonce='12345678-1234-1234-1234-123456789012';
const raw=(patch={})=>({host:'mp.toutiao.com',path:'/profile_v4/index',identities:[{kind:'public-id',value:'000001'}],identityOverflow:false,restricted:false,loginRequired:false,createChannel:false,overlayVisible:false,managementVisible:true,publishedStatusVisible:false,inventoryCount:null,bodyHasVisibleText:true,...patch});
async function run({request=req,owner='agent',pageOwner='agent',host='mp.toutiao.com',path='/profile_v4/index',missing=false,targetChange=false,ownerChange=false,routeChange=false,queryChange=false,lazyTarget=false,observations=[raw(),raw()]}={}){
 let lists=0,tabs=0,evals=0,targetWarm=false;const out=[],calls=[];
 const tab=()=>({label:'p1',openedBy:pageOwner,targetId:targetChange&&tabs>1?'other':'synthetic',url:'https://'+host+(routeChange&&tabs>1?'/changed':path)+(queryChange&&tabs>1?'?changed=not-exported':'?opaque=not-exported')});
 const page={spaceId:7,get targetId(){return lazyTarget&&!targetWarm?undefined:'synthetic';},info:async()=>{calls.push('info');targetWarm=true;return {};},evaluate:async()=>{calls.push('evaluate');return observations[evals++]||raw();}};
 const task={spaceId:7,ownership:owner,tabs:async()=>{calls.push('tabs');tabs++;return missing?[]:[tab()];},page:()=>page};
 const context=vm.createContext({URL,Date,console:{log:s=>out.push(s)},process:{exitCode:0},listTaskSpaces:async()=>{calls.push('list');lists++;return [{id:7,ownership:ownerChange&&lists>1?'user':owner}];},taskSpace:async id=>{calls.push('space');assert.equal(id,7);return task;}});
 const script=buildReadOnlyScript(request,nonce).replace("const crypto=await import('node:crypto');","const crypto=fixtureCrypto;");context.fixtureCrypto={createHash};
 await new vm.Script('(async()=>{'+script+'})()').runInContext(context,{timeout:1000});
 return {result:parseReadOnlyOutput({status:context.process.exitCode,stdout:out.join('\n')},request,nonce),output:out.join('\n'),calls,script};
}
test('request requires known platform, exact existing page and no action/source/profile injection',()=>{
 assert.deepEqual(validateReadOnlyRequest(req),req);
 for(const patch of [{platform:'toString'},{platform:'unknown'},{spaceId:0},{spaceId:'7'},{page:'p0'},{page:'p1;mutate()'},{action:'publish'},{source:'arbitrary'},{profileId:'other'},{expectedIdentitySha256:'bad'}])assert.throws(()=>validateReadOnlyRequest({...req,...patch}),/READONLY_/);
});
test('fixed script only exposes observation APIs and uses no shell/program source options',()=>{
 const script=buildReadOnlyScript(req,nonce);
 assert.ok(script.includes('page.evaluate(collect'));
 for(const forbidden of [/\.goto\(/,/\.click\(/,/\.fill\(/,/\.setInputFiles\(/,/\.fetch\(/,/\.cdp\(/,/\.close\(/,/claimTaskSpace/,/profiles\(/,/document\.cookie/,/localStorage/,/sessionStorage/,/\b(?:input|textarea|document)\.value\b/,/keyboard/,/newPage/])assert.doesNotMatch(script,forbidden);
 assert.throws(()=>buildReadOnlyScript(req,'injected'),/NONCE/);
});
test('real fixed bridge script observes twice, hashes identity and never exports raw identifiers/query',async()=>{
 const {result,output,calls}=await run();assert.equal(result.ok,true);assert.equal(result.status,'OBSERVED_UNCONFIRMED');assert.equal(result.accountIdentityVerified,false);assert.equal(result.publicationPerformed,false);
 assert.equal(result.identitySha256,undefined);assert.doesNotMatch(output,new RegExp(createHash('sha256').update(JSON.stringify(['toutiao','public-id','000001'])).digest('hex')));
 assert.doesNotMatch(output,/000001|opaque|not-exported|synthetic/);assert.equal(calls.filter(x=>x==='evaluate').length,2);
});
for(const [name,options]of [['user space',{owner:'user'}],['delegated space',{owner:'agentDelegatedToUser'}],['user page',{pageOwner:'unknown'}],['missing page',{missing:true}],['wrong host',{host:'wrong.invalid'}]])test(name+' refuses before any page evaluation',async()=>{const r=await run(options);assert.equal(r.result.ok,false);assert.equal(r.calls.includes('evaluate'),false);});
for(const [name,options]of [['target change',{targetChange:true}],['ownership change',{ownerChange:true}],['route change',{routeChange:true}],['query change',{queryChange:true}],['identity change',{observations:[raw(),raw({identities:[{kind:'public-id',value:'000002'}]})]}]])test(name+' refuses observed result',async()=>{assert.equal((await run(options)).result.ok,false);});
for(const [status,patch]of [['ACCOUNT_RESTRICTED',{restricted:true}],['LOGIN_REQUIRED',{loginRequired:true}],['SESSION_AMBIGUOUS',{sessionAmbiguous:true}],['PAGE_NOT_READY',{bodyHasVisibleText:false}],['IDENTITY_UNAVAILABLE',{identities:[]}],['IDENTITY_AMBIGUOUS',{identities:[{kind:'public-id',value:'1'},{kind:'public-id',value:'2'}]}]])test(status+' is blocked without mutation',async()=>{const r=await run({observations:[raw(patch),raw(patch)]});assert.equal(r.result.status,status);assert.equal(r.result.ok,false);assert.equal(r.result.mutationAllowed,false);});
test('explicit expected hash mismatch blocks; matching still does not claim authenticated identity',async()=>{
 const hash=createHash('sha256').update(JSON.stringify(['toutiao','public-id','000001'])).digest('hex');
 assert.equal((await run({request:{...req,expectedIdentitySha256:'0'.repeat(64)}})).result.status,'IDENTITY_MISMATCH');
 const r=await run({request:{...req,expectedIdentitySha256:hash}});assert.equal(r.result.expectedIdentityMatched,true);assert.equal(r.result.accountIdentityVerified,false);
});
test('channel creation dialog is classified without creating channel',async()=>{
 const request={platform:'youtube',spaceId:7,page:'p1'},a=raw({host:'www.youtube.com',path:'/profile_v4/index',createChannel:true});
 const r=await run({request,host:'www.youtube.com',observations:[a,a]});assert.equal(r.result.status,'CHANNEL_CREATION_REQUIRED');assert.equal(r.result.ok,false);
});
test('transport failure and duplicate/unparseable/replayed markers do not echo stderr or raw output',()=>{
 for(const result of [{status:4,stderr:'sensitive upstream diagnostic'},{status:0,stdout:'sensitive upstream diagnostic'},{status:0,stdout:'MAX_PUBLISH_READONLY:{}\nMAX_PUBLISH_READONLY:{}'},{status:0,stdout:'MAX_PUBLISH_READONLY:broken'}]){const r=parseReadOnlyOutput(result,req,nonce);assert.equal(r.ok,false);assert.doesNotMatch(JSON.stringify(r),/sensitive|upstream/);}
});
test('result schema refuses changed flags, nonce, host, stale or future observations',async()=>{
 const r=await run(),line=JSON.parse(r.output.split('MAX_PUBLISH_READONLY:')[1]);
 for(const patch of [{nonce:'other'},{host:'wrong.invalid'},{mutationAllowed:true},{publicationPerformed:true},{accountIdentityVerified:true},{completeInventoryVerified:true},{status:'PUBLISHED'},{observedAt:new Date(Date.now()-61000).toISOString()},{observedAt:new Date(Date.now()+10000).toISOString()}])assert.equal(parseReadOnlyOutput({status:0,stdout:'MAX_PUBLISH_READONLY:'+JSON.stringify({...line,...patch})},req,nonce).ok,false);
 const clean=parseReadOnlyOutput({status:0,stdout:'MAX_PUBLISH_READONLY:'+JSON.stringify({...line,cookie:'never-forward',rawText:'never-forward'})},req,nonce);assert.doesNotMatch(JSON.stringify(clean),/never-forward|cookie|rawText/);
});
function dom({text='',links=[],inputs=[],userNames=[],search='',path='/profile_v4/index',host='mp.toutiao.com'}={}){
 const element=(x)=>({getBoundingClientRect:()=>({width:1,height:1}),innerText:x.text||'',getAttribute:()=>x.href,closest:()=>x.nav?{}:null});
 return vm.createContext({URL,location:{hostname:host,pathname:path,origin:'https://'+host,href:'https://'+host+path+search},getComputedStyle:()=>({visibility:'visible',display:'block'}),document:{body:{innerText:text},querySelectorAll:s=>s==='a[href]'?links.map(element):s.startsWith('input')?inputs.map(element):s==='.user-name'?userNames.map(text=>element({text})):[]}});
}
test('actual DOM collector scopes owner links and never returns body, name, article text or URL query',()=>{
 const ctx=dom({text:'作品管理 Synthetic article text',links:[{href:'https://www.toutiao.com/c/user/000001/?sensitive=omitted',text:'Fixture author'}]});
 const r=vm.runInContext('('+collectVisibleState.toString()+')("toutiao")',ctx);assert.equal(r.identities[0].value,'000001');assert.equal(r.managementVisible,true);assert.doesNotMatch(JSON.stringify(r),/Synthetic article|Fixture author|sensitive/);
});
test('actual DOM collector detects login, suspension and bounded ambiguous identities',()=>{
 assert.equal(vm.runInContext('('+collectVisibleState.toString()+')("toutiao")',dom({text:'短信登录'})).loginRequired,true);
 assert.equal(vm.runInContext('('+collectVisibleState.toString()+')("toutiao")',dom({text:'您的账号已被封停'})).restricted,true);
 const links=Array.from({length:12},(_,i)=>({href:'https://www.toutiao.com/c/user/'+(i+1)+'/',text:'Fixture'}));const r=vm.runInContext('('+collectVisibleState.toString()+')("toutiao")',dom({links}));assert.equal(r.identities.length,9);assert.equal(r.identityOverflow,true);
});
test('DOM collector ignores non-navigation Weibo author links',()=>{
 const ctx=dom({host:'weibo.com',links:[{href:'/u/000001',text:'Unrelated author',nav:false}]});assert.equal(vm.runInContext('('+collectVisibleState.toString()+')("weibo")',ctx).identities.length,0);
});
test('CLI refuses extra write, execute, profile and script flags before transport',()=>{
 for(const option of ['--action','--execute','--profile','--script']){const r=spawnSync(process.execPath,[new URL('../bin/maxiaojian-publish.mjs',import.meta.url).pathname,'read-only','--platform','toutiao','--space-id','7','--page','p1',option,'publish'],{encoding:'utf8'});assert.equal(r.status,2);assert.match(r.stderr,/READONLY_INVALID_OPTION/);}
});
test('all 12 platform host contracts remain explicit and exact',()=>{assert.equal(Object.keys(READ_ONLY_HOSTS).length,12);for(const hosts of Object.values(READ_ONLY_HOSTS))for(const h of hosts)assert.doesNotMatch(h,/\*|\//);});

test('lazy official Page handle is hydrated by read-only info before comparing target',async()=>{const r=await run({lazyTarget:true});assert.equal(r.result.ok,true);assert.equal(r.calls.includes('info'),true);assert.ok(r.calls.indexOf('info')<r.calls.indexOf('evaluate'));});
test('official CLI stderr markers work; duplicate cross-stream markers and mixed unknown errors refuse',async()=>{
 const r=await run();const parsed=parseReadOnlyOutput({status:0,stdout:'',stderr:r.output},req,nonce);assert.equal(parsed.ok,true);
 assert.equal(parseReadOnlyOutput({status:0,stdout:r.output,stderr:r.output},req,nonce).ok,false);
 assert.equal(parseReadOnlyOutput({status:1,stderr:'MAX_PUBLISH_READONLY:'+JSON.stringify({nonce,error:'READONLY_HOST_MISMATCH'})},req,nonce).code,'READONLY_HOST_MISMATCH');
 assert.equal(parseReadOnlyOutput({status:1,stderr:'MAX_PUBLISH_READONLY:'+JSON.stringify({nonce,error:'sensitive raw error'})},req,nonce).ok,false);
});

test('Bilibili personal-center UID link is accepted only on exact account home and with own-space label',()=>{
 const a={href:'https://space.bilibili.com/000001',text:'个人空间'};
 const result=vm.runInContext('('+collectVisibleState.toString()+')("bilibili")',dom({host:'account.bilibili.com',path:'/account/home',links:[a,a]}));assert.equal(result.identities.length,1);assert.equal(result.identities[0].value,'000001');
 for(const config of [{host:'account.bilibili.com',path:'/other',links:[a]},{host:'account.bilibili.com',path:'/account/home',links:[{...a,text:'Unrelated author'}]}])assert.equal(vm.runInContext('('+collectVisibleState.toString()+')("bilibili")',dom(config)).identities.length,0);
});

test('unknown handle paths are redacted in both real script and output parser',async()=>{
 const request={platform:'youtube',spaceId:7,page:'p1'},a=raw({host:'www.youtube.com',path:'/@fixture-private-handle'});
 const r=await run({request,host:'www.youtube.com',path:'/@fixture-private-handle',observations:[a,a]});assert.equal(r.result.path,'/:redacted');assert.doesNotMatch(r.output,/fixture-private-handle/);
 const payload=JSON.parse((await run()).output.split('MAX_PUBLISH_READONLY:')[1]);const parsed=parseReadOnlyOutput({status:0,stdout:'MAX_PUBLISH_READONLY:'+JSON.stringify({...payload,path:'/@another-private',identitySha256:'unwanted-digest'})},req,nonce);assert.equal(parsed.path,'/:redacted');assert.equal(parsed.identitySha256,undefined);
});

test('Sohu route identifier requires one visible account header on backend paths',()=>{
 const config={host:'mp.sohu.com',path:'/mpfe/v4/data/analysis',search:'?accountId=000001&opaque=not-exported',userNames:['Fixture owner']};
 const result=vm.runInContext('('+collectVisibleState.toString()+')("sohu")',dom(config));assert.equal(result.identities.length,1);assert.equal(result.identities[0].value,'000001');assert.doesNotMatch(JSON.stringify(result),/Fixture owner|opaque/);
 for(const patch of [{userNames:[]},{userNames:['A','B']},{path:'/other'}])assert.equal(vm.runInContext('('+collectVisibleState.toString()+')("sohu")',dom({...config,...patch})).identities.length,0);
});
test('visible login wording together with owner identity remains ambiguous, not authenticated',()=>{
 const result=vm.runInContext('('+collectVisibleState.toString()+')("toutiao")',dom({text:'扫码登录',links:[{href:'https://www.toutiao.com/c/user/000001/',text:'Owner'}]}));assert.equal(result.sessionAmbiguous,true);assert.equal(result.loginRequired,false);
});

test('Sohu missing numeric route ID stays name-only rather than guessing an ID',()=>{
 const result=vm.runInContext('('+collectVisibleState.toString()+')("sohu")',dom({host:'mp.sohu.com',path:'/mpfe/v4/data/analysis',userNames:['Fixture owner']}));assert.equal(result.identities.length,1);assert.equal(result.identities[0].kind,'visible-name');
});

