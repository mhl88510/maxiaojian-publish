import fs from 'node:fs';
import {runEgoPreflight} from '../run-school-account.mjs';
export const FORM_HOSTS=Object.freeze({zhihu:['zhuanlan.zhihu.com'],baijiahao:['baijiahao.baidu.com'],sohu:['mp.sohu.com'],toutiao:['mp.toutiao.com'],netease:['mp.163.com']});
export function formBinding(pkg, matrix) {
  const t=pkg.schoolAccount||{}, accounts=matrix.platforms?.[t.platform]?.accounts||[];
  const a=accounts.filter(x=>x.key===t.accountKey);
  if(a.length!==1)throw new Error('ACCOUNT_BINDING_REQUIRED');
  if(!FORM_HOSTS[t.platform])throw new Error('FORM_PLATFORM_NOT_SUPPORTED');
  if(!Number.isSafeInteger(t.taskSpaceId)||t.taskSpaceId<1||!t.taskSpaceName||!/^p[1-9]\d*$/.test(t.pageLabel||''))throw new Error('EXACT_EXISTING_EGO_TARGET_REQUIRED');
  if(t.accountName&&t.accountName!==a[0].name)throw new Error('ACCOUNT_NAME_MISMATCH');
  return {...t,accountName:a[0].name,accountId:a[0].id||'',egoProfileId:t.egoProfileId||a[0].ego?.profileId||'',platformHosts:FORM_HOSTS[t.platform],knownAccounts:accounts};
}
export function buildFormScript(pkg,binding,action) {
  if (pkg.topics?.length || pkg.poi || pkg.originalDeclaration || pkg.sourceComponent) throw new Error("PLATFORM_EXTRA_FIELDS_REQUIRE_CURRENT_PAGE_MAPPING");
  const c=pkg.pageContract;
  if(!c||!c.editorUrl||!c.titleSelector||!c.bodySelector)throw new Error('CURRENT_PAGE_CONTRACT_REQUIRED');
  if(!FORM_HOSTS[binding.platform].includes(new URL(c.editorUrl).hostname))throw new Error('EDITOR_HOST_MISMATCH');
  const body=pkg.body??(pkg.articlePath?fs.readFileSync(pkg.articlePath,'utf8'):'');
  if(!pkg.title||!body)throw new Error('TITLE_AND_BODY_REQUIRED');
  if(action==='draft'&&c.draftMode!=='autosave'&&!c.draftSelector)throw new Error('DRAFT_CONTROL_REQUIRED');
  if(action==='publish'&&!c.publishSelector)throw new Error('PUBLISH_CONTROL_REQUIRED');
  if(!['check','draft','publish','status'].includes(action))throw new Error('INVALID_FORM_ACTION');
  const input={title:pkg.title,body,coverPath:pkg.coverPath||'',contract:c};
  if(input.coverPath&&!fs.statSync(input.coverPath).isFile())throw new Error('COVER_FILE_MISSING');
  if(input.coverPath&&(!c.coverSelector||!c.coverReadySelector))throw new Error('COVER_CONTROLS_REQUIRED');
  // Only documented Ego methods. No new tabs, navigation, profile switching or browser launch.
  return `
const input=${JSON.stringify(input)},binding=${JSON.stringify(binding)},action=${JSON.stringify(action)};
const marker='SCHOOL_FORM_RESULT:';
const compact=x=>String(x||'').replace(/\\s+/g,' ').trim();
const spaces=await listTaskSpaces();
const matches=spaces.filter(s=>Number(s.id)===binding.taskSpaceId&&s.name===binding.taskSpaceName);
if(matches.length!==1||matches[0].ownership!=='agent'||(binding.egoProfileId&&matches[0].profileId!==binding.egoProfileId))throw new Error('WAIT_USER_CONTROL_OR_TARGET_MISSING');
const task=await taskSpace(binding.taskSpaceId);
if(task.spaceId!==binding.taskSpaceId||task.name!==binding.taskSpaceName||task.ownership!=='agent')throw new Error('SPACE_CHANGED');
const page=task.page(binding.pageLabel);
const inspect=async()=>page.evaluate(({input,binding})=>{
  const compact=x=>String(x||'').replace(/\\s+/g,' ').trim();
  const text=document.body.innerText;
  const visible=s=>[...document.querySelectorAll(s)].filter(e=>{const r=e.getBoundingClientRect();return r.width>2&&r.height>2&&getComputedStyle(e).visibility!=='hidden';});
  const value=s=>{const es=visible(s);return {count:es.length,text:es.length===1?(es[0].value??es[0].innerText??''):''};};
  const header=[...document.querySelectorAll('header,nav,[role="banner"],[class*="header"],[class*="Header"]')].map(e=>[e.innerText,...[...e.querySelectorAll('img[alt], [aria-label], [title]')].map(x=>x.getAttribute('alt')||x.getAttribute('aria-label')||x.getAttribute('title'))].filter(Boolean).join(' ')).join(' ');
  const identity=(header.includes(binding.accountName)||(binding.accountId&&header.includes(binding.accountId)))&&!binding.knownAccounts.some(a=>a.key!==binding.accountKey&&((a.id&&header.includes(a.id))||(a.name&&header.includes(a.name))));
  return {url:location.href,identity,title:value(input.contract.titleSelector),body:value(input.contract.bodySelector),coverReady:input.contract.coverReadySelector?visible(input.contract.coverReadySelector).some(e=>e.tagName!=='IMG'||e.naturalWidth>0):false,blocked:/实名认证后|完成实名认证|解锁发文|手机验证码|请输入验证码|账号已被封停|账号已封禁|账号信息正在审核中/.test(text)};
},{input,binding});
let state=await inspect();
if(!state.identity)throw new Error('ACCOUNT_IDENTITY_UNVERIFIED');
if(state.blocked)throw new Error('AUTH_OR_PUBLISH_PERMISSION_REQUIRED');
if(state.url!==input.contract.editorUrl)throw new Error('EDITOR_URL_CHANGED');
if(state.title.count!==1||state.body.count!==1)throw new Error('FORM_SELECTOR_AMBIGUOUS');
if(action==='check'){console.log(marker+JSON.stringify({ok:true,status:'FORM_PREFLIGHT_PASSED',url:state.url}));}
else if(action==='status'){console.log(marker+JSON.stringify({ok:true,status:'EDITOR_READBACK',url:state.url,title:state.title.text,bodyMatches:compact(state.body.text)===compact(input.body),coverReady:state.coverReady}));}
else {
  await page.fill(input.contract.titleSelector,input.title);
  await page.fill(input.contract.bodySelector,input.body);
  if(input.coverPath){
    const chooser=page.waitForFileChooser({timeout:15000});
    await page.click(input.contract.coverSelector);
    await (await chooser).setFiles(input.coverPath);
  }
  state=await inspect();
  if(!state.identity||state.url!==input.contract.editorUrl)throw new Error('ACCOUNT_OR_EDITOR_CHANGED');
  if(compact(state.title.text)!==compact(input.title)||compact(state.body.text)!==compact(input.body))throw new Error('CONTENT_READBACK_MISMATCH');
  if(input.coverPath&&!state.coverReady)throw new Error('COVER_NOT_READY');
  if(action==='draft'&&input.contract.draftMode==='autosave'){
    await page.waitForFunction(pattern=>new RegExp(pattern).test(document.body.innerText),input.contract.autosavePattern,{timeout:15000});
    console.log(marker+JSON.stringify({ok:true,status:'DRAFT_SAVE_REQUESTED',autosaveObserved:true,publicReadbackVerified:false}));
  }else {
  const selector=action==='draft'?input.contract.draftSelector:input.contract.publishSelector;
  const ready=await page.evaluate(s=>{const es=[...document.querySelectorAll(s)].filter(e=>{const r=e.getBoundingClientRect();return r.width>2&&r.height>2;});return es.length===1&&!es[0].disabled&&es[0].getAttribute('aria-disabled')!=='true';},selector);
  if(!ready)throw new Error('SUBMIT_CONTROL_NOT_UNIQUELY_READY');
  await page.click(selector);
  // Clicking a control is NOT proof of a draft save or public publication.
  console.log(marker+JSON.stringify({ok:true,status:action==='draft'?'DRAFT_SAVE_REQUESTED':'SUBMITTED',publicReadbackVerified:false,actual_rendered_pixel_QA:false}));
  }
}
`;
}
export async function runEgoForm(pkg,matrix,action,execute,{preflight=runEgoPreflight}={}) {


  const binding=formBinding(pkg,matrix);
  const script=buildFormScript(pkg,binding,action);
  const check=await preflight(binding);
  if(!check.ok)return {ok:false,status:'BLOCKED',code:check.code};
  const r=await execute('ego-browser',['nodejs'],{input:script});
  const line=(r.stdout+'\n'+r.stderr).split(/\r?\n/).find(x=>x.startsWith('SCHOOL_FORM_RESULT:'));
  if(r.code!==0||!line)return {ok:false,status:['draft','publish'].includes(action)?'SUBMISSION_UNCERTAIN':'BLOCKED',code:'EGO_FORM_RESULT_UNAVAILABLE',publicReadbackVerified:false};
  return {...JSON.parse(line.slice('SCHOOL_FORM_RESULT:'.length)),backend:'ego_article',platform:binding.platform,accountKey:binding.accountKey};
}
