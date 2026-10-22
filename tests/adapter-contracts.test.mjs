// Source-level adapter contracts. DOM snapshots and subprobes are synthetic;
// no browser, upload, native runner, network or original account is invoked.
import test from 'node:test';
import crypto from 'node:crypto';
import {validateWeiboNativeInventoryPages,validateWeiboText} from '../core/lib/weibo-native-text.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {evaluateObservation} from '../core/v2/lib/model.mjs';
import {formBinding,buildFormScript} from '../core/lib/ego-form-backend.mjs';
import {assertArticleMutationAllowed} from '../core/lib/article-contracts.mjs';
import {assessWechatNativeSnapshot} from '../core/lib/wechat-native-ui-backend.mjs';
const base=new URL('../core/v2/',import.meta.url),core=fs.readFileSync(new URL('ego/core.mjs',base),'utf8');
const rows=[['douyin','douyin','inspectDouyin'],['xiaohongshu','xiaohongshu','inspectXiaohongshu'],['wechat_channels','wechat-channels','inspectWechatChannels'],['bilibili','bilibili','inspectBilibili'],['youtube','youtube','inspectYoutube']];
function defaults(platform){
 return {text:'上传完成 封面设置',pageText:'Synthetic fixture',dialogText:'',title:'Fixture title',description:'Fixture body',prose:'Fixture body',desc:'Fixture body',plainText:'Fixture body',editorText:'Fixture body',descriptionMatches:true,selected:[],plainResidue:[],duplicates:[],duplicate:[],unexpected:[],missing:[],malformed:[],chips:[],topicCounts:{},tokenCounts:{},activeDialogs:[],dialogs:[],blockingDialogs:[],loginRequired:false,filenameVisible:true,identityMatches:true,identityEmpty:false,identityAmbiguous:false,identityForeign:false,knownMisroutedInput:false,uploaded:true,uploadSucceeded:true,uploading:false,processing:false,failed:false,uploadFailed:false,resumeDialog:false,originalEnabled:false,originalFound:true,selfMade:false,noMark:true,creationInput:'',coverBg:'url(synthetic-cover)',coverUrls:{portrait:['synthetic-p'],landscape:['synthetic-l']},coverImagesBySlot:{},coverUrlsBySlot:{},unifiedCover:false,componentEvidence:{selected:false,status:'NOT_REQUESTED'},noSyncChecked:true,syncOn:false,simultaneousChecked:false,syncUnavailable:false,declarationAvailable:false,declarationNone:true,declarationText:'',topicSpans:[],topicEditorCount:1,topicEditorMatchesDescription:true,shortTitle:'Fixture title',shortTitleInputCount:1,videoInputs:[],rootCount:1,thumbnailUrls:[],videoId:'synthetic-video',workflowStep:'DETAILS',audience:'not_made_for_kids',visibility:'private',visibilityReady:true,settingsOk:true,settingsEvidence:{expected:{},actual:{}},tagChips:[],missingTags:[],unexpectedTags:[],duplicateTags:[],url:'https://studio.youtube.com/',...(platform==='bilibili'?{coverUrls:[]}:{})};
}
async function inspect(platform,file,fn,patch={},customCover=false){
 const state={...defaults(platform),...patch};let transportCalls=0;
 const pkg={platformTitle:Object.fromEntries(rows.map(([name])=>[name,'Fixture title'])),description:'Fixture body',douyinDescription:'Fixture body',douyinTopics:[],xhsTopics:[],wechatDescription:'Fixture body',wechatTags:[],bilibiliDescription:'Fixture body',bilibiliTags:[],bilibiliAllowedAutoTags:[],youtubeDescription:'Fixture body',youtubeTags:[],youtubeAudience:'not_made_for_kids',youtubeVisibility:'private',youtubeCategory:'Fixture category',youtubeLanguage:'Fixture language',youtubePlaylist:'',youtubeLicense:'Fixture license',cover:{uploadCustomCover:customCover},schoolAccount:{platform,accountKey:'synthetic'}};
 const context=vm.createContext({platform,pkg,videoPath:'synthetic.mp4',expectedReceipts:{},expectedVideoReceipt:null,jobFingerprint:'synthetic-fingerprint',activeTaskSpace:{id:1},phase:'verify',js:async()=>structuredClone(state),cdp:async()=>{transportCalls++;return {};}});
 vm.runInContext(core,context,{timeout:1000});
 vm.runInContext(fs.readFileSync(new URL('platforms/'+file+'.mjs',base),'utf8'),context,{timeout:1000});
 // Isolate the gate assembler from browser-specific DOM and POI/schedule probes.
 vm.runInContext("inspectFinalButtons=async()=>[{buttonish:true,disabled:false}];",context);
 if(platform==='douyin')vm.runInContext("inspectDouyinPoi=async()=>({ok:true,requested:false});inspectDouyinUploadSurface=async()=>({ok:true});inspectDouyinSchedule=async()=>({ok:true,requested:false});",context);
 const result=await vm.runInContext(fn+'()',context,{timeout:1000});
 return {result,transportCalls};
}
for(const [platform,file,fn]of rows){
 test(platform+' source inspector preserves identity/video/title contracts',async()=>{
  const {result}=await inspect(platform,file,fn);assert.equal(result.gates.authenticated.ok,true);assert.equal(result.gates.draftIdentity.ok,true);assert.equal(result.gates.video.ok,true);
  assert.equal((result.gates.title||result.gates.shortTitle).ok,true);
  const denied=await inspect(platform,file,fn,{loginRequired:true});assert.equal(denied.result.gates.authenticated.ok,false);
  const foreign=await inspect(platform,file,fn,{identityMatches:false,identityForeign:true,identityAmbiguous:true,title:'Other fixture',filenameVisible:false});assert.equal(foreign.result.gates.draftIdentity.ok,false);
  const moving=await inspect(platform,file,fn,{uploading:true});assert.equal(moving.result.gates.video.ok,false);
 });
 test(platform+' source inspector blocks custom cover without matching receipt',async()=>{
  const {result}=await inspect(platform,file,fn,{},true);assert.equal(result.gates.cover.ok,false);
  const verdict=evaluateObservation({platform,phase:'verify',gates:{...result.gates,safety:{ok:true,evidence:{guardArmed:true,blockedAttempts:0,finalPublishClicked:false}}}});assert.equal(verdict.ready,false);assert.ok(verdict.missing.includes('cover'));
 });
 test(platform+' real final-button guard blocks synthetic click and dirty release',async()=>{
  const listeners=[];class Element{matches(){return true;}getAttribute(){return null;}get innerText(){return platform==='youtube'?'保存':platform==='bilibili'?'立即投稿':platform==='wechat_channels'?'发表':'发布';}}
  const page=vm.createContext({window:{},Element,document:{addEventListener(type,fn){if(type==='click')listeners.push(fn);}}});
  const runner=vm.createContext({platform,js:async expr=>vm.runInContext(expr,page)});vm.runInContext(core,runner,{timeout:1000});await vm.runInContext('armFinalPublishGuard()',runner);
  let prevented=false;const target=new Element();for(const callback of listeners)callback({target,composedPath:()=>[target],preventDefault(){prevented=true;},stopImmediatePropagation(){}});
  assert.equal(prevented,true);assert.equal(page.window.__VIDEO_PUBLISHER_FINAL_GUARD__.releaseForConfirmedPublish().ok,false);
 });
}
const author={platform:'zhihu',accountKey:'synthetic',accountName:'Fixture author',accountId:'001',taskSpaceId:1,taskSpaceName:'Fixture space',pageLabel:'p1'};
for(const platform of ['zhihu','sohu','toutiao','baijiahao','netease']){
 test(platform+' form source rejects ambiguous bindings and missing native controls',()=>{
  const account={key:'synthetic',name:'Fixture author',id:'001'},matrix={platforms:{[platform]:{accounts:[account]}}};
  const pkg={title:'Fixture',body:'Synthetic text',schoolAccount:{...author,platform}},binding=formBinding(pkg,matrix);
  assert.throws(()=>buildFormScript(pkg,binding,'publish'),/CURRENT_PAGE_CONTRACT_REQUIRED/);
  assert.throws(()=>formBinding(pkg,{platforms:{[platform]:{accounts:[account,account]}}}),/ACCOUNT_BINDING_REQUIRED/);
  assert.throws(()=>buildFormScript({...pkg,pageContract:{editorUrl:'https://wrong.invalid/edit',titleSelector:'#title',bodySelector:'#body',publishSelector:'#publish'}},binding,'publish'),/EDITOR_HOST_MISMATCH/);
 });
}
test('article source never treats an existing article editor as a new publish',()=>{
 const pkg={pageContract:{editorUrl:'https://zhuanlan.zhihu.com/p/123/edit'}};
 assert.throws(()=>assertArticleMutationAllowed(pkg,{protectedContentIds:['123']},'publish'),/EXISTING_PUBLISHED_ARTICLE_PROTECTED/);
 assert.throws(()=>assertArticleMutationAllowed(pkg,{protectedContentIds:[]},'publish'),/DRAFT_VERIFICATION/);
});
test('WeChat snapshot source does not invent identity or a missing requested ID',()=>{
 const result=assessWechatNativeSnapshot('',{accountKey:'synthetic',accountName:'Fixture author',accountType:'订阅号'},{requestedContentId:'123'});
 assert.equal(result.accountNameVerified,false);assert.equal(result.accountTypeVerified,false);assert.equal(result.requestedArticleStatus,'CONTENT_ID_NOT_OBSERVED');assert.equal(result.selectedArticle,null);
 assert.throws(()=>assessWechatNativeSnapshot('',{accountKey:'synthetic',accountName:'Fixture author',accountType:'订阅号'},{requestedContentId:123}),/EXACT_STRING_CONTENT_ID_REQUIRED/);
});

// Only pure validation; all identifiers below are fictional.
const uid='001',post=(id)=>({idstr:String(id),mblogid:'Mock'+id,user:{idstr:uid},text_raw:'Synthetic text',isLongText:false});
const page=(list,total=list.length,since_id='')=>({ok:1,data:{total,list,since_id}});
test('Weibo inventory requires complete unique records for exactly the expected owner',()=>{
 assert.equal(validateWeiboNativeInventoryPages([page([post(1)])],uid,1).length,1);
 assert.throws(()=>validateWeiboNativeInventoryPages([page([{...post(1),user:{idstr:'002'}}])],uid,1),/IDENTITY_INVALID/);
 assert.throws(()=>validateWeiboNativeInventoryPages([page([post(1),post(1)])],uid,2),/COMPLETE_NATIVE_INVENTORY_REQUIRED/);
 assert.throws(()=>validateWeiboNativeInventoryPages([page([])],uid,1),/COMPLETE_NATIVE_INVENTORY_REQUIRED/);
});
test('Weibo paginated inventory validates continuity, completeness and bounded size',()=>{
 const a=Array.from({length:20},(_,i)=>post(i+1)),b=[post(21)];
 assert.equal(validateWeiboNativeInventoryPages([page(a,21,'21'),page(b,21)],uid,21).length,21);
 assert.throws(()=>validateWeiboNativeInventoryPages([page(a,21,'22'),page(b,21)],uid,21),/CURSOR_INVALID/);
 assert.throws(()=>validateWeiboNativeInventoryPages([page(a,21,'21')],uid,21),/COMPLETE_NATIVE_INVENTORY_REQUIRED/);
 assert.throws(()=>validateWeiboNativeInventoryPages([],uid,201),/COMPLETE_NATIVE_INVENTORY_REQUIRED/);
});
test('Weibo plain text binds body SHA, exact target and status URL without reading files',()=>{
 const body='Synthetic text',account={id:uid,ego:{targetId:'synthetic-target',pageLabel:'p1'}};
 const pkg={body,schoolAccount:{platform:'weibo'},backend:'ego_weibo_text',contentType:'text',declaration:'none',nativeTextContract:{version:1,expectedUid:uid,expectedTargetId:'synthetic-target',bodySha256:crypto.createHash('sha256').update(body).digest('hex')}};
 assert.equal(validateWeiboText(pkg,account,'check').body,body);
 assert.throws(()=>validateWeiboText({...pkg,body:body+' changed'},account,'check'),/SOURCE_HASH_MISMATCH/);
 assert.throws(()=>validateWeiboText({...pkg,title:'Unapproved title'},account,'check'),/PLAIN_TEXT_ONLY/);
 assert.throws(()=>validateWeiboText({...pkg,videoPath:'never-read.mp4'},account,'check'),/PLAIN_TEXT_ONLY/);
 assert.throws(()=>validateWeiboText(pkg,{...account,id:'002'},'check'),/EXACT_BINDING_REQUIRED/);
 assert.equal(validateWeiboText({...pkg,publicUrl:'https://weibo.com/001/Mock1'},account,'status').uid,uid);
 assert.throws(()=>validateWeiboText({...pkg,publicUrl:'https://weibo.com/002/Mock1'},account,'status'),/EXACT_PUBLIC_URL_REQUIRED/);
});
