import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {collectVisibleState} from './read-only-probe.mjs';
export const READ_ONLY_HOSTS=Object.freeze(Object.fromEntries(Object.entries({douyin:['creator.douyin.com'],xiaohongshu:['creator.xiaohongshu.com'],wechat_channels:['channels.weixin.qq.com'],bilibili:['member.bilibili.com','account.bilibili.com'],youtube:['studio.youtube.com','www.youtube.com'],zhihu:['www.zhihu.com','zhuanlan.zhihu.com'],sohu:['mp.sohu.com'],toutiao:['mp.toutiao.com'],baijiahao:['baijiahao.baidu.com'],netease:['mp.163.com'],weibo:['weibo.com'],wechat_official:['mp.weixin.qq.com']}).map(([k,v])=>[k,Object.freeze(v)])));
const OUTPUT_PATHS=Object.freeze(['/','/platform/home','/creator','/account/home','/creator-micro/home','/creator-micro/content/manage','/profile_v4/index','/profile_v4/manage/content/all','/mpfe/v4/data/analysis','/login.html','/cgi-bin/home']);
export function validateReadOnlyRequest(input){
 if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).some(k=>!['platform','spaceId','page','expectedIdentitySha256'].includes(k)))throw Error('READONLY_OPTIONS_REQUIRED');
 if(!Object.hasOwn(READ_ONLY_HOSTS,input.platform))throw Error('READONLY_PLATFORM_REQUIRED');
 if(!Number.isSafeInteger(input.spaceId)||input.spaceId<1||!/^p[1-9]\d*$/.test(input.page||''))throw Error('READONLY_EXACT_EXISTING_PAGE_REQUIRED');
 if(input.expectedIdentitySha256!==undefined&&!/^[a-f0-9]{64}$/.test(input.expectedIdentitySha256))throw Error('READONLY_EXPECTED_HASH_INVALID');
 return {...input};
}
export function buildReadOnlyScript(input,nonce){
 const req=validateReadOnlyRequest(input);if(!/^[a-f0-9-]{36}$/.test(nonce))throw Error('READONLY_NONCE_REQUIRED');
 return `const request=${JSON.stringify(req)},nonce=${JSON.stringify(nonce)},hosts=${JSON.stringify(READ_ONLY_HOSTS[req.platform])},outputPaths=${JSON.stringify(OUTPUT_PATHS)};
const MARK='MAX_PUBLISH_READONLY:';
try{
 const listed=(await listTaskSpaces()).filter(s=>s.id===request.spaceId);
 if(listed.length!==1||listed[0].ownership!=='agent')throw Error('READONLY_AGENT_SPACE_REQUIRED');
 const task=await taskSpace(request.spaceId);
 if(task.ownership!=='agent'||task.spaceId!==request.spaceId)throw Error('READONLY_AGENT_SPACE_REQUIRED');
 const findTab=async()=>{const tabs=(await task.tabs()).filter(t=>t.label===request.page);if(tabs.length!==1||tabs[0].openedBy!=='agent'||!tabs[0].targetId)throw Error('READONLY_AGENT_PAGE_REQUIRED');return tabs[0];};
 const route=url=>{let u;try{u=new URL(url);}catch{throw Error('READONLY_HOST_MISMATCH');}if(u.protocol!=='https:'||u.username||u.password||u.port&&!['443'].includes(u.port)||!hosts.includes(u.hostname))throw Error('READONLY_HOST_MISMATCH');return {host:u.hostname,path:u.pathname};};
 const first=await findTab(),before=route(first.url),page=task.page(request.page);
 await page.info();
 if(page.spaceId!==request.spaceId||page.targetId!==first.targetId)throw Error('READONLY_TARGET_CHANGED');
 const collect=${collectVisibleState.toString()};
 const a=await page.evaluate(collect,request.platform),b=await page.evaluate(collect,request.platform);
 const last=await findTab(),after=route(last.url),owners=(await listTaskSpaces()).filter(s=>s.id===request.spaceId);
 if(owners.length!==1||owners[0].ownership!=='agent'||task.ownership!=='agent'||page.spaceId!==request.spaceId||page.targetId!==first.targetId||last.targetId!==first.targetId||first.url!==last.url||before.host!==after.host||before.path!==after.path||a.host!==before.host||b.host!==before.host||a.path!==before.path||b.path!==before.path)throw Error('READONLY_TARGET_CHANGED');
 const key=x=>JSON.stringify(x.identities.map(i=>[i.kind,i.value]).sort());
 if(key(a)!==key(b))throw Error('READONLY_IDENTITY_CHANGED');
 const ids=a.identities,unique=ids.length===1&&!a.identityOverflow&&!b.identityOverflow;
 const crypto=await import('node:crypto');
 const identitySha256=unique?crypto.createHash('sha256').update(JSON.stringify([request.platform,ids[0].kind,ids[0].value])).digest('hex'):null;
 let status=a.restricted||b.restricted?'ACCOUNT_RESTRICTED':a.createChannel||b.createChannel?'CHANNEL_CREATION_REQUIRED':a.loginRequired||b.loginRequired?'LOGIN_REQUIRED':a.sessionAmbiguous||b.sessionAmbiguous?'SESSION_AMBIGUOUS':!a.bodyHasVisibleText||!b.bodyHasVisibleText?'PAGE_NOT_READY':!unique?(ids.length>1||a.identityOverflow||b.identityOverflow?'IDENTITY_AMBIGUOUS':'IDENTITY_UNAVAILABLE'):request.expectedIdentitySha256&&identitySha256!==request.expectedIdentitySha256?'IDENTITY_MISMATCH':'OBSERVED_UNCONFIRMED';
 const safePath=outputPaths.includes(before.path)?before.path:'/:redacted';
 console.log(MARK+JSON.stringify({nonce,platform:request.platform,spaceId:request.spaceId,page:request.page,status,host:before.host,path:safePath,expectedIdentityMatched:!!request.expectedIdentitySha256&&identitySha256===request.expectedIdentitySha256,identityKind:unique?ids[0].kind:null,identityCandidateCount:ids.length,managementVisible:a.managementVisible&&b.managementVisible,publishedStatusVisible:a.publishedStatusVisible&&b.publishedStatusVisible,inventoryCount:a.inventoryCount===b.inventoryCount?a.inventoryCount:null,overlayVisible:a.overlayVisible||b.overlayVisible,observedAt:new Date().toISOString(),readOnly:true,mutationAllowed:false,publicationPerformed:false,accountIdentityVerified:false,completeInventoryVerified:false,exactWorkReadbackVerified:false}));
}catch(e){const allowed=['READONLY_AGENT_SPACE_REQUIRED','READONLY_AGENT_PAGE_REQUIRED','READONLY_HOST_MISMATCH','READONLY_TARGET_CHANGED','READONLY_IDENTITY_CHANGED'];console.log(MARK+JSON.stringify({nonce,error:allowed.includes(e.message)?e.message:'READONLY_PROBE_FAILED'}));process.exitCode=2;}
`;
}
export function parseReadOnlyOutput(result,request,nonce,now=Date.now()){
 const fail=code=>({ok:false,code,readOnly:true,mutationAllowed:false,publicationPerformed:false});
 if(result.error)return fail('READONLY_TRANSPORT_FAILED');
 const lines=(String(result.stdout||'')+'\n'+String(result.stderr||'')).split(/\r?\n/).filter(x=>x.startsWith('MAX_PUBLISH_READONLY:'));
 if(lines.length!==1)return fail(result.status===0?'READONLY_RESULT_UNCONFIRMED':'READONLY_TRANSPORT_FAILED');
 let r;try{r=JSON.parse(lines[0].slice('MAX_PUBLISH_READONLY:'.length));}catch{return fail('READONLY_RESULT_UNCONFIRMED');}
 if(r.nonce===nonce&&['READONLY_AGENT_SPACE_REQUIRED','READONLY_AGENT_PAGE_REQUIRED','READONLY_HOST_MISMATCH','READONLY_TARGET_CHANGED','READONLY_IDENTITY_CHANGED','READONLY_PROBE_FAILED'].includes(r.error))return fail(r.error);
 if(result.status!==0||r.error||r.nonce!==nonce||r.platform!==request.platform||r.spaceId!==request.spaceId||r.page!==request.page||r.readOnly!==true||r.mutationAllowed!==false||r.publicationPerformed!==false||r.accountIdentityVerified!==false||r.completeInventoryVerified!==false||r.exactWorkReadbackVerified!==false||!READ_ONLY_HOSTS[request.platform].includes(r.host)||!Number.isFinite(Date.parse(r.observedAt))||now-Date.parse(r.observedAt)>60000||Date.parse(r.observedAt)-now>5000)return fail('READONLY_RESULT_UNCONFIRMED');
 const statuses=['ACCOUNT_RESTRICTED','CHANNEL_CREATION_REQUIRED','LOGIN_REQUIRED','SESSION_AMBIGUOUS','PAGE_NOT_READY','IDENTITY_AMBIGUOUS','IDENTITY_UNAVAILABLE','IDENTITY_MISMATCH','OBSERVED_UNCONFIRMED'];
 if(!statuses.includes(r.status))return fail('READONLY_RESULT_UNCONFIRMED');
 // Explicit output whitelist: never forward raw transport fields, URLs or page text.
 return {ok:r.status==='OBSERVED_UNCONFIRMED',status:r.status,platform:r.platform,spaceId:r.spaceId,page:r.page,host:r.host,path:OUTPUT_PATHS.includes(r.path)?r.path:'/:redacted',expectedIdentityMatched:r.expectedIdentityMatched===true,identityKind:['public-id','public-slug','account-route-id','visible-public-id','visible-name'].includes(r.identityKind)?r.identityKind:null,identityCandidateCount:Number.isSafeInteger(r.identityCandidateCount)?r.identityCandidateCount:null,managementVisible:r.managementVisible===true,publishedStatusVisible:r.publishedStatusVisible===true,inventoryCount:Number.isSafeInteger(r.inventoryCount)&&r.inventoryCount>=0?r.inventoryCount:null,overlayVisible:r.overlayVisible===true,observedAt:r.observedAt,readOnly:true,mutationAllowed:false,publicationPerformed:false,accountIdentityVerified:false,completeInventoryVerified:false,exactWorkReadbackVerified:false};
}
export async function inspectReadOnly(input){
 const request=validateReadOnlyRequest(input),nonce=randomUUID();
 const result=spawnSync('ego-browser',['nodejs'],{input:buildReadOnlyScript(request,nonce),encoding:'utf8',shell:false,timeout:20000,maxBuffer:256*1024,windowsHide:true});
 return parseReadOnlyOutput(result,request,nonce);
}
