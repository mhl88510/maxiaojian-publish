import {validateExactJuniorNoCover} from './toutiao-legacy-continuation-a.mjs';
import os from 'node:os';
import {isToutiaoOptionsResume,OPTIONS_HASH} from './toutiao-options-resume.mjs';
import {isKnownSohuPreExecuteRejection,isKnownSohuUploadedCoverBlock} from './sohu-pre-execute-recovery.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {inspectSohuTopics,clickSohuTopic} from './sohu-topic-controls.mjs';
import {ARTICLE_CONTRACTS} from './article-contracts.mjs';
import {resolveSchoolAccountBinding} from './school-account.mjs';
import {runArticleManagement} from './article-management-readback.mjs';
import {buildSohuStudioInlineIntent,isSohuInlineImagesOnlyAdapterGap} from './sohu-inline-image-plan.mjs';

function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function boundAsset(pkg,file) {
 const stat=fs.statSync(file,{throwIfNoEntry:false});
 if(!stat?.isFile())throw Error('ARTICLE_INLINE_IMAGE_FILE_MISSING');
 const sha256=sha256File(file),size=stat.size;
 const bindings=pkg?.studio?.assetBindings;
 if(Array.isArray(bindings)&&bindings.length){
  const matches=bindings.filter(x=>x&&typeof x.path==='string'&&path.resolve(x.path)===path.resolve(file));
  if(matches.length!==1||matches[0].sha256!==sha256||matches[0].size!==size)throw Error('ARTICLE_INLINE_IMAGE_ASSET_BINDING_MISMATCH');
 }
 return {sha256,size};
}
function stripStudioImageLines(source) {
 return source.replace(/^!\[([^\]]*)\]\(([^)]+)\)[ \t]*\r?$/gm,'').replace(/\n{3,}/g,'\n\n').trim();
}
function studioInlineIntent(pkg,platform,source) {
 const plan=pkg?.studio?.articleImages;
 if(plan===undefined)return null;
 if(plan?.status==='NO_INLINE_IMAGES'){
  if(plan.schema!=='article-inline-image-plan/v1'||plan.scope!=='local_document_references_only'||!Array.isArray(plan.documents)||plan.documents.length!==1||!Array.isArray(plan.references)||plan.references.length||!Array.isArray(plan.uploadOrder)||plan.uploadOrder.length||!Array.isArray(plan.unanchoredPaths)||plan.unanchoredPaths.length)throw Error('ARTICLE_ZERO_IMAGE_PLAN_INVALID');
  const doc=plan.documents[0];
  if(doc.role!=='source'||doc.format!=='markdown'||doc.path!==pkg.articlePath||doc.imageCount!==0)throw Error('ARTICLE_ZERO_IMAGE_DOCUMENT_MISMATCH');
  if((pkg.images!==undefined&&(!Array.isArray(pkg.images)||pkg.images.length))||(pkg.inlineImages!==undefined&&(!Array.isArray(pkg.inlineImages)||pkg.inlineImages.length))||/!\[[^\]]*\]\([^)]*\)|<img\b/i.test(source))throw Error('ARTICLE_ZERO_IMAGE_SOURCE_MISMATCH');
  const require=createRequire(import.meta.url);
  const {Marked}=require('marked');
  const {parseFragment}=require('parse5');
  const html=new Marked().parse(source.replace(/^# [^\n]+\n+/,''));
  const text=n=>n.nodeName==='#text'?n.value:(n.childNodes||[]).map(text).join('');
  return {items:[],body:text(parseFragment(html)),html,plan};
 }
 if(pkg?.studio?.needsAdapter===true){
  if(platform!=='sohu'||!isSohuInlineImagesOnlyAdapterGap(pkg))throw Error('ARTICLE_CONTENT_ADAPTER_REQUIRED');
  const verified=buildSohuStudioInlineIntent(pkg);
  // Preserve the audited historical appointment-QR bridge only for a source
  // that really ends with the second image after the exact "扫码预约" paragraph.
  if(!verified.proof.legacyTerminalQr)return verified;
 }
 if(platform!=='sohu')throw Error('ARTICLE_INLINE_IMAGE_PLATFORM_NOT_VERIFIED');
 if(!plan||plan.schema!=='article-inline-image-plan/v1'||plan.scope!=='local_document_references_only'||plan.status!=='LOCAL_REFERENCES_RECONCILED'||!Array.isArray(plan.documents)||plan.documents.length!==1||!Array.isArray(plan.references)||plan.references.length<1||!Array.isArray(plan.uploadOrder)||plan.uploadOrder.length!==plan.references.length||!Array.isArray(plan.unanchoredPaths)||plan.unanchoredPaths.length)throw Error('SOHU_STUDIO_INLINE_PLAN_INVALID');
 const doc=plan.documents[0];
 if(doc.role!=='source'||doc.format!=='markdown'||doc.path!==pkg.articlePath||doc.imageCount!==plan.references.length)throw Error('SOHU_STUDIO_INLINE_DOCUMENT_MISMATCH');
 const legacy=pkg.images;
 if(!Array.isArray(legacy)||legacy.length!==plan.references.length)throw Error('SOHU_STUDIO_INLINE_IMAGE_ORDER_MISMATCH');
 const matches=[...source.matchAll(/^!\[([^\]]*)\]\(([^)]+)\)[ \t]*$/gm)];
 if(matches.length!==plan.references.length)throw Error('SOHU_STUDIO_INLINE_MARKDOWN_IMAGE_COUNT_MISMATCH');
 const paragraphBlocks=source.replace(/^!\[[^\]]*\]\([^)]+\)[ \t]*$/gm,'').split(/\n{2,}/).map(x=>x.trim()).filter(Boolean);
 const terminal=paragraphBlocks.at(-1);
 const finalMatch=matches.at(-1);
 const legacyTerminal=plan.references.length===2&&source.slice(finalMatch.index+finalMatch[0].length).trim()===''
  &&terminal==='扫码预约'&&/预约|二维码/.test(plan.references[1]?.alt||'');
 if(legacyTerminal){
 const finalAnchor=plan.references[1]?.anchor?.precedingText;
 if(!terminal||paragraphBlocks.filter(x=>x===terminal).length!==1||(terminal!=='扫码预约'&&finalAnchor!==terminal))throw Error('SOHU_STUDIO_INLINE_TERMINAL_ANCHOR_UNVERIFIED');
 if(source.slice(matches[1].index+matches[1][0].length).trim())throw Error('SOHU_STUDIO_INLINE_IMAGE_NOT_AT_DOCUMENT_END');
 }
 const items=plan.references.map((ref,i)=>{
  const ordered=plan.uploadOrder[i],match=matches[i];
  if(!ref||ref.document!=='source'||ref.ordinal!==i+1||!ordered||ordered.ordinal!==i+1||ordered.path!==ref.path||ordered.alt!==ref.alt||legacy[i]!==ref.path||match[2]!==ref.path||match[1]!==ref.alt)throw Error('SOHU_STUDIO_INLINE_IMAGE_ORDER_MISMATCH');
  if(!path.isAbsolute(ref.path))throw Error('SOHU_STUDIO_INLINE_ASSET_PATH_INVALID');
  const binding=boundAsset(pkg,ref.path);
  const anchor=ref.anchor?.precedingText;
  let position;
  if(i===0||!legacyTerminal){
   if(typeof anchor!=='string'||!anchor.trim()||paragraphBlocks.filter(x=>x===anchor).length!==1)throw Error('SOHU_STUDIO_INLINE_ANCHOR_NOT_UNIQUE');
   position={kind:'after_paragraph',text:anchor};
  }else{
   // The source final paragraph is unique; new plans must bind its full text.
   // Legacy truncated QR anchors are retained only for historical compatibility.
   position={kind:'after_paragraph',text:terminal};
  }
  return {path:ref.path,filename:path.basename(ref.path),role:ref.role||ordered.role||ref.alt,position,...binding};
 });
 return {items,body:stripStudioImageLines(source),plan};
}
function resolveInlineImages(pkg,platform,body,studioIntent=null) {
 const legacy=pkg.images;
 const requested=pkg.inlineImages===undefined?studioIntent?.items:pkg.inlineImages;
 if(legacy===undefined&&requested===undefined)return [];
 if(legacy!==undefined&&!Array.isArray(legacy))throw Error('ARTICLE_INLINE_IMAGE_INTENT_INVALID');
 if(requested!==undefined&&!Array.isArray(requested))throw Error('ARTICLE_INLINE_IMAGE_INTENT_INVALID');
 const oldPaths=legacy||[],items=requested||[];
 if(!oldPaths.length&&!items.length)return [];
 if(platform!=='sohu')throw Error('ARTICLE_INLINE_IMAGE_PLATFORM_NOT_VERIFIED');
 if(oldPaths.length&&!items.length)throw Error('ARTICLE_INLINE_IMAGE_POSITION_REQUIRED');
 if(oldPaths.length&&(oldPaths.length!==items.length||oldPaths.some((p,i)=>p!==items[i]?.path)))throw Error('ARTICLE_INLINE_IMAGE_INTENT_MISMATCH');
 const seenPositions=new Set();
 const normalized=items.map(item=>{
  if(!item||typeof item!=='object'||typeof item.path!=='string'||!item.path.trim()||!item.role||typeof item.role!=='string')throw Error('ARTICLE_INLINE_IMAGE_INTENT_INVALID');
  const evidence=boundAsset(pkg,item.path);
  if(evidence.size>10*1024*1024||! /\.(?:png|jpe?g|gif)$/i.test(item.path))throw Error('ARTICLE_INLINE_IMAGE_FILE_UNSUPPORTED');
  const position=item.position;
  if(!position||typeof position!=='object')throw Error('ARTICLE_INLINE_IMAGE_POSITION_REQUIRED');
  let key='';
  if(position.kind==='after_paragraph'&&typeof position.text==='string'&&position.text.trim()===position.text){
   const paragraphCount=body.split(/\n{2,}/).filter(x=>x===position.text).length;
   if(paragraphCount!==1)throw Error('ARTICLE_INLINE_IMAGE_ANCHOR_NOT_UNIQUE');
   key=`after_paragraph:${position.text}`;
  }else if(position.kind==='end')key='end';
  else throw Error('ARTICLE_INLINE_IMAGE_POSITION_INVALID');
  if(seenPositions.has(key))throw Error('ARTICLE_INLINE_IMAGE_POSITION_DUPLICATED');
  seenPositions.add(key);
  return {path:item.path,filename:item.path.split(/[\\/]/).pop(),position,role:item.role,...evidence};
 });
 if(new Set(normalized.map(x=>x.filename)).size!==normalized.length)throw Error('ARTICLE_INLINE_IMAGE_FILENAME_DUPLICATED');
 return normalized;
}

export function bridgeSohuStudioPlanToPreparedPackage(basePkg,studioPkg,{planPath=''}={}) {
 const b=basePkg?.schoolAccount||{},s=studioPkg?.schoolAccount||{};
 if(b.platform!=='sohu'||s.platform!=='sohu'||b.accountKey!=='EXCLUDED_ROUTE_ACCOUNT'||s.accountKey!=='EXCLUDED_ROUTE_ACCOUNT'||basePkg.backend!=='ego_article'||studioPkg.backend!=='ego_article')throw Error('SOHU_STUDIO_PREPARED_ACCOUNT_MISMATCH');
 for(const key of ['title','description','summary','author','declaration','category','contentType'])if((basePkg[key]??'')!==(studioPkg[key]??''))throw Error('SOHU_STUDIO_PREPARED_FIELD_MISMATCH:'+key);
 if(JSON.stringify(basePkg.topics||[])!==JSON.stringify(studioPkg.topics||[])||JSON.stringify(basePkg.images||[])!==JSON.stringify(studioPkg.images||[])||basePkg.coverPath!==studioPkg.coverPath)throw Error('SOHU_STUDIO_PREPARED_ASSET_OR_TOPIC_MISMATCH');
 const baseBody=basePkg.body??(basePkg.articlePath?fs.readFileSync(basePkg.articlePath,'utf8'):'');
 const source=studioPkg.articlePath?fs.readFileSync(studioPkg.articlePath,'utf8'):'';
 const intent=studioInlineIntent(studioPkg,'sohu',source);
 if(!intent||intent.body!==baseBody.trim())throw Error('SOHU_STUDIO_PREPARED_BODY_MISMATCH');
 if(!Array.isArray(basePkg.inlineImages)||basePkg.inlineImages.length!==2)throw Error('SOHU_STUDIO_PREPARED_POSITION_BASE_MISSING');
 const existing=basePkg.inlineImages;
 if(existing.some((item,i)=>item.path!==intent.items[i].path||typeof item.role!=='string'||!item.role))throw Error('SOHU_STUDIO_PREPARED_IMAGE_BINDING_MISMATCH');
 if(existing[0].position?.kind!=='after_paragraph'||existing[0].position.text!==intent.items[0].position.text||existing[1].position?.kind!=='end')throw Error('SOHU_STUDIO_PREPARED_POSITION_MISMATCH');
 const allPaths=[...basePkg.images,basePkg.coverPath].filter(Boolean);
 const assets=allPaths.map(file=>({path:file,...boundAsset(basePkg,file)}));
 const planAssets=[...studioPkg.images,studioPkg.coverPath].filter(Boolean).map(file=>({path:file,...boundAsset(studioPkg,file)}));
 if(JSON.stringify(assets)!==JSON.stringify(planAssets))throw Error('SOHU_STUDIO_PREPARED_ASSET_BYTES_MISMATCH');
 const nativeInlineImages=intent.items.map((item,i)=>({...item,role:existing[i].role}));
 return {
  schema:'sohu-studio-inline-bridge/v1',
  planPath,planContentId:studioPkg.studio?.contentId||null,
  planPackageSha256:planPath&&fs.existsSync(planPath)?sha256File(planPath):null,
  bodySha256:crypto.createHash('sha256').update(baseBody.trim()).digest('hex'),
  structureVerified:true,bodyVerified:true,assetBytesVerified:true,orderVerified:true,
  nativeUploadVerified:false,nativePlacementVerified:false,pixelsVerified:false,
  anchorNotes:[
   {ordinal:1,kind:'after_paragraph',text:nativeInlineImages[0].position.text,unique:true},
   {ordinal:2,kind:'after_paragraph',text:'扫码预约',unique:true,studioAnchorIgnored:true,reason:'source-plan anchor was truncated; derived from the unique terminal source paragraph immediately before the final QR directive'},
  ],
  assets,nativeInlineImages,
 };
}

async function insertSohuInlineImage({p,c,image,body,expectedBefore,clickReady,index,resumePendingInline=false}) {
 const placement=await p.evaluate(({c,image,body,expectedBefore})=>{
  const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};
  const compact=x=>String(x||'').replace(/[\s\u200b\ufeff]+/g,'');
  const editors=[...document.querySelectorAll(c.bodySelector)].filter(visible);
  if(editors.length!==1)return {ok:false,code:'SOHU_INLINE_EDITOR_NOT_UNIQUE'};
  const editor=editors[0];
  if(compact([...editor.children].filter(node=>!node.classList.contains('ql-image-container')).map(node=>node.innerText||'').join(' '))!==compact(body))return {ok:false,code:'SOHU_INLINE_TEXT_READBACK_MISMATCH'};
  const existing=[...editor.querySelectorAll('.ql-image-container img')];
  if(existing.length!==expectedBefore.length||existing.some((img,i)=>img.alt!==expectedBefore[i]))return {ok:false,code:'SOHU_INLINE_IMAGE_ORDER_MISMATCH'};
  let target=null;
  if(image.position.kind==='after_paragraph'){
   const anchors=[...editor.querySelectorAll('p')].filter(node=>compact(node.innerText)===compact(image.position.text));
   if(anchors.length!==1)return {ok:false,code:'SOHU_INLINE_IMAGE_ANCHOR_NOT_UNIQUE'};
   target=anchors[0];
  }
  const controls=[...document.querySelectorAll('button.ql-image')].filter(e=>visible(e)&&e.getAttribute('aria-label')==='image'&&e.querySelector('.button-tip')?.innerText.trim()==='添加图片');
  if(controls.length!==1)return {ok:false,code:'SOHU_INLINE_IMAGE_BUTTON_NOT_UNIQUE'};
  editor.focus();
  const range=document.createRange();
  if(target){range.setStartAfter(target);range.collapse(true);}else{range.selectNodeContents(editor);range.collapse(false);}
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
  return {ok:true,anchorKind:image.position.kind,anchorTextMatched:image.position.kind==='after_paragraph',imageCountBefore:existing.length};
 },{c,image,body,expectedBefore});
 if(!placement.ok)throw Error(placement.code);
 if(!resumePendingInline){
 await clickReady('button.ql-image');
 try{
  await p.waitForFunction(()=>{
   const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};
   const scopes=[...document.querySelectorAll('.win-mask')].filter(visible).flatMap(mask=>[...mask.querySelectorAll('.main')].filter(visible).filter(main=>main.innerText.includes('本地上传')&&main.querySelector('.local-upload input#new-file[type="file"]')));
   if(scopes.length!==1)return false;
   const scope=scopes[0],local=scope.querySelector('.local-upload'),input=local?.querySelector('input#new-file[type="file"]'),label=local?.querySelector('.upload-button label[for="new-file"]');
   return !!(local&&visible(local)&&input&&input.multiple&&/image\/(?:jpg|jpeg|png|gif)/i.test(input.accept||'')&&label&&visible(label));
  },null,{timeout:10000});
 }catch{throw Error('SOHU_INLINE_IMAGE_MODAL_NOT_UNIQUELY_READY');}
 const inputMarker=`school-native-inline-input-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`;
 const markedInput=await p.evaluate(({inputMarker})=>{
  const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};
  const scopes=[...document.querySelectorAll('.win-mask')].filter(visible).flatMap(mask=>[...mask.querySelectorAll('.main')].filter(visible).filter(main=>main.innerText.includes('本地上传')&&main.querySelector('.local-upload input#new-file[type="file"]')));
  if(scopes.length!==1)return {ok:false,code:'SOHU_INLINE_IMAGE_MODAL_NOT_UNIQUE'};
  const scope=scopes[0],local=scope.querySelector('.local-upload'),inputs=[...local.querySelectorAll('input#new-file[type="file"]')],labels=[...local.querySelectorAll('.upload-button label[for="new-file"]')].filter(visible),confirms=[...scope.querySelectorAll('.bottom-buttons p.button')].filter(e=>visible(e)&&e.innerText.trim()==='确定');
  if(inputs.length!==1||labels.length!==1||confirms.length!==1)return {ok:false,code:'SOHU_INLINE_IMAGE_FILE_INPUT_NOT_UNIQUE'};
  const input=inputs[0];
  if(!input.multiple||!/image\/(?:jpg|jpeg|png|gif)/i.test(input.accept||''))return {ok:false,code:'SOHU_INLINE_IMAGE_FILE_INPUT_UNVERIFIED'};
  input.setAttribute('data-school-native-inline-image-input',inputMarker);
  return {ok:true};
 },{inputMarker});
 if(!markedInput.ok)throw Error(markedInput.code);
 try{await p.setInputFiles(`[data-school-native-inline-image-input="${inputMarker}"]`,image.path);}
 finally{try{await p.evaluate(inputMarker=>document.querySelector(`[data-school-native-inline-image-input="${inputMarker}"]`)?.removeAttribute('data-school-native-inline-image-input'),inputMarker);}catch{}}
 }
 try{
  await p.waitForFunction(({filename})=>{
   const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};
   const scopes=[...document.querySelectorAll('.win-mask')].filter(visible).flatMap(mask=>[...mask.querySelectorAll('.main')].filter(visible).filter(main=>main.innerText.includes('本地上传')&&main.querySelector('.local-upload input#new-file[type="file"]')));
   if(scopes.length!==1)return false;
   const scope=scopes[0],local=scope.querySelector('.local-upload'),input=local?.querySelector('input#new-file[type="file"]'),confirms=[...scope.querySelectorAll('.bottom-buttons p.button')].filter(e=>visible(e)&&e.innerText.trim()==='确定');
   return !!(input&&(input.files.length===0||(input.files.length===1&&input.files[0].name===filename))&&[...local.querySelectorAll('img')].filter(img=>img.complete&&img.naturalWidth>0&&new URL(img.src,location.href).hostname==='res.mp.sohu.com').length===1&&confirms.length===1&&!confirms[0].classList.contains('disable-button')&&!confirms[0].disabled&&!/上传失败|文件格式错误|大小超出/.test(local.innerText));
  },{filename:image.filename},{timeout:30000});
 }catch{throw Error('SOHU_INLINE_IMAGE_UPLOAD_NOT_READY');}
 const confirmMarker=`school-native-inline-confirm-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`;
 const markedConfirm=await p.evaluate(({confirmMarker,filename})=>{
  const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};
  const scopes=[...document.querySelectorAll('.win-mask')].filter(visible).flatMap(mask=>[...mask.querySelectorAll('.main')].filter(visible).filter(main=>main.innerText.includes('本地上传')&&main.querySelector('.local-upload input#new-file[type="file"]')));
  if(scopes.length!==1)return {ok:false,code:'SOHU_INLINE_IMAGE_MODAL_NOT_UNIQUE'};
  const scope=scopes[0],local=scope.querySelector('.local-upload'),input=local?.querySelector('input#new-file[type="file"]'),confirms=[...scope.querySelectorAll('.bottom-buttons p.button')].filter(e=>visible(e)&&e.innerText.trim()==='确定');
  if(!input||(input.files.length!==0&&(input.files.length!==1||input.files[0].name!==filename))||[...local.querySelectorAll('img')].filter(img=>img.complete&&img.naturalWidth>0&&new URL(img.src,location.href).hostname==='res.mp.sohu.com').length!==1||confirms.length!==1)return {ok:false,code:'SOHU_INLINE_IMAGE_UPLOAD_READBACK_MISMATCH'};
  const confirm=confirms[0];if(confirm.classList.contains('disable-button')||confirm.disabled)return {ok:false,code:'SOHU_INLINE_IMAGE_CONFIRM_DISABLED'};
  confirm.setAttribute('data-school-native-inline-image-confirm',confirmMarker);
  return {ok:true};
 },{confirmMarker,filename:image.filename});
 if(!markedConfirm.ok)throw Error(markedConfirm.code);
 const confirmSelector=`[data-school-native-inline-image-confirm="${confirmMarker}"]`;
 await clickReady(confirmSelector);
 try{await p.evaluate(confirmMarker=>document.querySelector(`[data-school-native-inline-image-confirm="${confirmMarker}"]`)?.removeAttribute('data-school-native-inline-image-confirm'),confirmMarker);}catch{}
 try{
  await p.waitForFunction(({c,image,expectedBefore})=>{
   const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};
   const compact=x=>String(x||'').replace(/[\s\u200b\ufeff]+/g,'');
   const editors=[...document.querySelectorAll(c.bodySelector)].filter(visible);if(editors.length!==1)return false;
   const editor=editors[0],imgs=[...editor.querySelectorAll('.ql-image-container img')];
   if(imgs.length!==expectedBefore.length+1||imgs.some((img,i)=>i<expectedBefore.length?img.alt!==expectedBefore[i]:(img.alt!==image.filename&&img.alt!=='')))return false;
   const img=imgs[imgs.length-1];if((img.alt!==image.filename&&img.alt!=='')||!img.complete||img.naturalWidth<=0)return false;
   try{const url=new URL(img.getAttribute('src')||img.src,location.href);if(url.protocol!=='https:'||url.hostname!=='res.mp.sohu.com')return false;}catch{return false;}
   return compact([...editor.children].filter(node=>!node.classList.contains('ql-image-container')).map(node=>node.innerText||'').join(' '))===compact(image.body);
  },{c,image:{...image,body},expectedBefore},{timeout:20000});
 }catch{throw Error('SOHU_INLINE_IMAGE_HOSTED_READBACK_TIMEOUT');}
 const readback=await p.evaluate(({c,image,body,expectedBefore})=>{
  const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};
  const compact=x=>String(x||'').replace(/[\s\u200b\ufeff]+/g,'');
  const editors=[...document.querySelectorAll(c.bodySelector)].filter(visible);if(editors.length!==1)return {ok:false,code:'SOHU_INLINE_EDITOR_NOT_UNIQUE'};
  const editor=editors[0],imgs=[...editor.querySelectorAll('.ql-image-container img')],expected=[...expectedBefore,image.filename];
  if(imgs.length!==expected.length||imgs.some((img,i)=>i<expectedBefore.length?img.alt!==expected[i]:(img.alt!==image.filename&&img.alt!=='')))return {ok:false,code:'SOHU_INLINE_IMAGE_ORDER_MISMATCH'};
  const img=imgs[imgs.length-1];let host='';
  try{const url=new URL(img.getAttribute('src')||img.src,location.href);if(url.protocol!=='https:'||url.hostname!=='res.mp.sohu.com')return {ok:false,code:'SOHU_INLINE_IMAGE_HOST_NOT_VERIFIED'};host=url.hostname;}catch{return {ok:false,code:'SOHU_INLINE_IMAGE_HOST_NOT_VERIFIED'};}
  if(!img.complete||img.naturalWidth<=0)return {ok:false,code:'SOHU_INLINE_IMAGE_PIXEL_NOT_LOADED'};
  if(compact([...editor.children].filter(node=>!node.classList.contains('ql-image-container')).map(node=>node.innerText||'').join(' '))!==compact(body))return {ok:false,code:'SOHU_INLINE_TEXT_READBACK_MISMATCH'};
  const topLevel=node=>{let current=node;while(current.parentElement&&current.parentElement!==editor)current=current.parentElement;return current;};
  const imageBlock=topLevel(img),blocks=[...editor.children],imageBlockIndex=blocks.indexOf(imageBlock);
  if(imageBlockIndex<0)return {ok:false,code:'SOHU_INLINE_IMAGE_POSITION_NOT_VERIFIED'};
  let anchorMatched=false;
  if(image.position.kind==='after_paragraph'){
   const anchors=[...editor.querySelectorAll('p')].filter(node=>compact(node.innerText)===compact(image.position.text));
   if(anchors.length!==1)return {ok:false,code:'SOHU_INLINE_IMAGE_ANCHOR_NOT_UNIQUE'};
   const anchor=anchors[0],anchorBlock=topLevel(anchor),anchorIndex=blocks.indexOf(anchorBlock);
   if(anchor.compareDocumentPosition(img)&Node.DOCUMENT_POSITION_PRECEDING)return {ok:false,code:'SOHU_INLINE_IMAGE_POSITION_MISMATCH'};
   const nextTextIndex=blocks.findIndex((node,i)=>i>anchorIndex&&compact(node.innerText||'')&&!node.querySelector('img'));
   if(nextTextIndex>=0&&imageBlockIndex>=nextTextIndex)return {ok:false,code:'SOHU_INLINE_IMAGE_POSITION_MISMATCH'};
   anchorMatched=true;
  }else if(image.position.kind==='end'){
   const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let node;const imageContainer=img.closest('.ql-image-container');
   while((node=walker.nextNode())){
    if(compact(node.nodeValue)&&(img.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING)&&!imageContainer?.contains(node))return {ok:false,code:'SOHU_INLINE_IMAGE_POSITION_MISMATCH'};
   }
  }else return {ok:false,code:'SOHU_INLINE_IMAGE_POSITION_INVALID'};
  return {ok:true,host,filename:image.filename,filenameAttributeState:img.alt===image.filename?'preserved':'platform_cleared',role:image.role,position:{kind:image.position.kind,anchorMatched},orderIndex:imgs.length,textMatched:true,hostedPixelsLoaded:true};
 },{c,image,body,expectedBefore});
 if(!readback.ok)throw Error(readback.code);
 return readback;
}

export async function openSohuCoverEditor({p,clickReady}) {

 const coverState=await p.evaluate(()=>{
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const covers=[...document.querySelectorAll('.pic-cover')].filter(visible);
  if(covers.length>1)return 'ambiguous';
  if(covers.length===0)return 'empty';
  const background=covers[0].style.backgroundImage||getComputedStyle(covers[0]).backgroundImage||'';
  const match=background.match(/url\((?:["']?)([^"')]+)(?:["']?)\)/);
  return match?.[1]?.trim()?'existing':'empty';
 });
 if(coverState==='ambiguous')throw Error('SOHU_COVER_EXISTING_IMAGE_NOT_UNIQUE');
 if(coverState==='existing'){
  // "编辑封面" only opens a crop view of the current image; replacement uses
  // the native remove icon to expose the upload control, then uploads the new
  // cover within this unsaved draft editor.
  await p.hover('.pic-cover');
  await p.waitForFunction(()=>{
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
   const controls=[...document.querySelectorAll('.pic-cover .mp-icon-close')].filter(visible);
   return controls.length===1;
  },undefined,{timeout:10000});
  await clickReady('.pic-cover .mp-icon-close');
  try{await p.waitForFunction(()=>{
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
   const covers=[...document.querySelectorAll('.pic-cover')].filter(visible);
   const uploads=[...document.querySelectorAll('.upload-file.mp-upload')].filter(visible);
   return covers.length===0&&uploads.length===1&&uploads[0].innerText.includes('上传图片');
  },undefined,{timeout:10000});}catch{throw Error('SOHU_COVER_REMOVE_NOT_VERIFIED');}
 }
 const uploadState=await p.evaluate(()=>{
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const uploads=[...document.querySelectorAll('.upload-file.mp-upload')].filter(visible);
  return uploads.length===1&&uploads[0].innerText.includes('上传图片');
 });
 if(!uploadState)throw Error('SOHU_COVER_UPLOAD_TARGET_NOT_UNIQUE');
 await clickReady('.upload-file.mp-upload');
 return coverState==='existing'?'existing_cover_removed_for_replacement':'empty_cover_upload';
}

export async function uploadSohuCover({p,c,coverPath,clickReady,resumeUploadedCover=false}) {

 const guide=await p.evaluate(({guideCheck})=>{
  const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const notices=[...document.querySelectorAll('.new-feature-alert-submit')].filter(visible);
  if(!notices.length)return {status:'absent'};
  if(notices.length!==1)return {status:'unverified'};
  const button=notices[0],box=button.closest('.new-feature-alert-box');
  const title=box?.querySelector('.new-feature-alert-title')?.innerText.trim()||'';
  const description=box?.querySelector('.new-feature-alert-desc')?.innerText.trim()||'';
  return button.innerText.trim()==='我知道了'&&title==='文章排版新升级！'&&description==='现支持设置二级标题、斜体、下划线、分割线等多种样式，快来试试吧!'?{status:'verified'}:{status:'unverified'};
 },{guideCheck:true});
 if(!guide||!['absent','verified'].includes(guide.status))throw Error('SOHU_COVER_GUIDE_NOT_VERIFIED');
 if(guide.status==='verified'){
  const dismissed=await p.evaluate(({expectedTitle,expectedDescription})=>{
   const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
   const notices=[...document.querySelectorAll('.new-feature-alert-submit')].filter(visible);
   if(notices.length!==1)return false;
   const button=notices[0],box=button.closest('.new-feature-alert-box');
   if(button.innerText.trim()!=='我知道了'||box?.querySelector('.new-feature-alert-title')?.innerText.trim()!==expectedTitle||box?.querySelector('.new-feature-alert-desc')?.innerText.trim()!==expectedDescription)return false;
   button.click();return true;
  },{expectedTitle:'文章排版新升级！',expectedDescription:'现支持设置二级标题、斜体、下划线、分割线等多种样式，快来试试吧!'});
  if(!dismissed)throw Error('SOHU_COVER_GUIDE_DISMISS_NOT_VERIFIED');
  await p.waitForFunction(()=>![...document.querySelectorAll('.new-feature-alert-submit')].some(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}),null,{timeout:10000});
 }
 // Topic suggestions can remain open after the exact topic tags have been
 // selected. Sohu positions that popover over the cover control, so do not
 // click through it: dismiss only the focused topic selector and prove the
 // selected tags are unchanged before starting cover upload.
 const topicOverlay=await p.evaluate(()=>{
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const dropdowns=[...document.querySelectorAll('.el-select-dropdown')].filter(visible);
  return {count:dropdowns.length,focusedTopic:!!document.activeElement?.closest('.select-topic'),tags:[...document.querySelectorAll('.select-topic .el-select__tags-text')].map(e=>e.innerText.trim())};
 });
 if(topicOverlay?.count){
  if(topicOverlay.count!==1||!topicOverlay.focusedTopic)throw Error('SOHU_UNRELATED_DROPDOWN_BLOCKS_COVER_UPLOAD');
  await p.keyboard.press('Escape');
  try{await p.waitForFunction(()=>![...document.querySelectorAll('.el-select-dropdown')].some(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}),null,{timeout:10000});}catch{throw Error('SOHU_TOPIC_DROPDOWN_DISMISS_NOT_VERIFIED');}
  const afterTopics=await p.evaluate(()=>({count:[...document.querySelectorAll('.el-select-dropdown')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}).length,tags:[...document.querySelectorAll('.select-topic .el-select__tags-text')].map(e=>e.innerText.trim())}));
  if(afterTopics.count!==0||JSON.stringify(afterTopics.tags)!==JSON.stringify(topicOverlay.tags))throw Error('SOHU_TOPIC_TAGS_CHANGED_WHILE_DISMISSING_DROPDOWN');
 }
 if(!resumeUploadedCover){
 await openSohuCoverEditor({p,clickReady});
 const dialogReady=()=>{
  const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
  if(dialogs.length!==1)return false;
  const main=dialogs[0].querySelector('.main');
  return !!main&&[...main.querySelectorAll('.dialog-title h3')].filter(e=>visible(e)&&e.innerText.trim()==='本地上传').length===1;
 };
 try{await p.waitForFunction(dialogReady,null,{timeout:10000});}catch{throw Error('SOHU_COVER_DIALOG_NOT_UNIQUE');}
 await clickReady('[role="dialog"] .main .dialog-title h3:text-is("本地上传")');
 const localReady=()=>{
  const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);if(dialogs.length!==1)return false;
  const main=dialogs[0].querySelector('.main');if(!main)return false;
  const tabs=[...main.querySelectorAll('.dialog-title h3')].filter(e=>visible(e)&&e.innerText.trim()==='本地上传');
  const boards=[...main.querySelectorAll('.board[contentpictures]')].filter(visible);
  if(tabs.length!==1||!tabs[0].classList.contains('selected')||boards.length!==1)return false;
  const local=boards[0],inputs=[...local.querySelectorAll('input#new-file[type="file"]')],labels=[...local.querySelectorAll('.upload-button label[for="new-file"]')].filter(visible);
  return inputs.length===1&&inputs[0].multiple&&inputs[0].files.length===0&&/image\/(?:jpg|jpeg|png|gif)/i.test(inputs[0].accept||'')&&labels.length===1;
 };
 try{await p.waitForFunction(localReady,null,{timeout:10000});}catch{throw Error('SOHU_COVER_LOCAL_UPLOAD_NOT_VERIFIED');}
 const inputMarker=`school-native-cover-input-${Date.now()}-${Math.random().toString(16).slice(2)}`;
 const marked=await p.evaluate(({coverInputMarker})=>{
  const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
  const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);if(dialogs.length!==1)return {ok:false,code:'SOHU_COVER_DIALOG_NOT_UNIQUE'};
  const main=dialogs[0].querySelector('.main');if(!main)return {ok:false,code:'SOHU_COVER_DIALOG_SCOPE_MISSING'};
  const tabs=[...main.querySelectorAll('.dialog-title h3')].filter(e=>visible(e)&&e.innerText.trim()==='本地上传');
  const boards=[...main.querySelectorAll('.board[contentpictures]')].filter(visible);
  if(tabs.length!==1||!tabs[0].classList.contains('selected')||boards.length!==1)return {ok:false,code:'SOHU_COVER_LOCAL_TAB_NOT_UNIQUE'};
  const local=boards[0],inputs=[...local.querySelectorAll('input#new-file[type="file"]')],labels=[...local.querySelectorAll('.upload-button label[for="new-file"]')].filter(visible);
  if(inputs.length!==1||labels.length!==1)return {ok:false,code:'SOHU_COVER_FILE_INPUT_NOT_UNIQUE'};
  const input=inputs[0];if(!input.multiple||input.files.length||!/image\/(?:jpg|jpeg|png|gif)/i.test(input.accept||''))return {ok:false,code:'SOHU_COVER_FILE_INPUT_UNVERIFIED'};
  input.setAttribute('data-school-native-cover-input',coverInputMarker);
  return {ok:true};
 },{coverInputMarker:inputMarker});
 if(!marked?.ok)throw Error(marked?.code||'SOHU_COVER_FILE_INPUT_NOT_UNIQUE');
 const inputSelector=`[data-school-native-cover-input="${inputMarker}"]`;
 try{await p.setInputFiles(inputSelector,coverPath);}
 finally{try{await p.evaluate(({coverInputMarker})=>document.querySelector(`[data-school-native-cover-input="${coverInputMarker}"]`)?.removeAttribute('data-school-native-cover-input'),{coverInputMarker:inputMarker});}catch{}}
 }
 try{
  await p.waitForFunction(({coverPath,confirmSelector})=>{
   const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
   const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);if(dialogs.length!==1)return false;
   const main=dialogs[0].querySelector('.main');if(!main)return false;
   const tabs=[...main.querySelectorAll('.dialog-title h3')].filter(e=>visible(e)&&e.innerText.trim()==='本地上传'&&e.classList.contains('selected'));
   const boards=[...main.querySelectorAll('.board[contentpictures]')].filter(visible);if(tabs.length!==1||boards.length!==1)return false;
   const local=boards[0],inputs=[...local.querySelectorAll('input#new-file[type="file"]')],selected=local.querySelector('.pagination-wrapper .success-number i');
   const confirms=[...local.querySelectorAll(confirmSelector)].filter(visible);
   return inputs.length===1&&(inputs[0].files.length===0||(inputs[0].files.length===1&&inputs[0].files[0].name===coverPath.split(/[\\/]/).pop()))&&[...local.querySelectorAll('.upload-area img.upload-item')].filter(img=>img.complete&&img.naturalWidth>0&&new URL(img.src,location.href).hostname==='res.mp.sohu.com').length===1&&selected?.innerText.trim()==='1'&&confirms.length===1&&!confirms[0].classList.contains('disable-button')&&!confirms[0].disabled&&confirms[0].getAttribute('aria-disabled')!=='true'&&!/上传失败|文件格式错误|大小超出/.test(local.innerText);
  },{coverPath,confirmSelector:c.coverConfirmSelector},{timeout:30000});
 }catch{throw Error('SOHU_COVER_UPLOAD_NOT_READY');}
 if(c.coverConfirmSelector!=='p.button.positive-button')throw Error('SOHU_COVER_CONFIRM_SELECTOR_NOT_VERIFIED');
 await clickReady(c.coverConfirmSelector);
 try{
  await p.waitForFunction(({selector})=>{
   const element=document.querySelector(selector);if(!element)return false;
   const background=element.style.backgroundImage||'';
   const match=background.match(/url\((?:["']?)([^"')]+)(?:["']?)\)/);
   const coverDialog=[...document.querySelectorAll('[role="dialog"]')].some(dialog=>{const r=dialog.getBoundingClientRect();const s=getComputedStyle(dialog);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&dialog.querySelector('.main .dialog-title h3');});
   return !!match?.[1]?.trim()&&!coverDialog&&!document.body.innerText.includes('加载中......');
  },{selector:c.coverReadySelector||'.pic-cover'},{timeout:20000});
 }catch{throw Error('SOHU_COVER_HOSTED_READBACK_TIMEOUT');}
}

export function validateToutiaoNoCoverIntent(pkg,platform,inlineImages) {
 if(pkg.toutiaoCoverMode===undefined)return false;
 if(pkg.toutiaoCoverMode!=='none'||platform!=='toutiao'||pkg.coverPath||inlineImages.length||pkg.images?.length||pkg.inlineImages?.length||pkg.studio?.articleImages?.status!=='NO_INLINE_IMAGES')throw Error('TOUTIAO_NO_COVER_ZERO_IMAGE_INTENT_REQUIRED');
 return true;
}

export function nativeArticleScript(pkg,binding,c,action,baselineIds,{resumePreparation=null,visualReviewScreenshots=[],zeroImageNoCoverEvidence=null}={}) {
 const sourceBody=pkg.body??(pkg.articlePath?fs.readFileSync(pkg.articlePath,'utf8'):'');
 const studioIntent=studioInlineIntent(pkg,binding.platform,sourceBody);
 const body=studioIntent?.body??sourceBody;
 const inlineImages=resolveInlineImages(pkg,binding.platform,body,studioIntent);
 const noCover=zeroImageNoCoverEvidence ? validateExactJuniorNoCover(pkg,binding,zeroImageNoCoverEvidence) : validateToutiaoNoCoverIntent(pkg,binding.platform,inlineImages);
 if(!['check','draft','publish'].includes(action))throw Error('INVALID_NATIVE_ARTICLE_ACTION');
 if(pkg.topics?.length&&binding.platform==='sohu'&&(!c.topicWriteReadbackVerified||!c.topicScopeSelector||!c.topicInputSelector||!c.topicTagSelector||!c.topicOptionSelector))throw Error('SOHU_TOPIC_WRITE_READBACK_NOT_VERIFIED');
 if(pkg.topics!==undefined&&(!Array.isArray(pkg.topics)||pkg.topics.some(x=>typeof x!=='string'||!x.trim()||x!==x.trim())||new Set(pkg.topics).size!==pkg.topics.length))throw Error('INVALID_TOPICS');
 if(binding.platform==='sohu'&&pkg.category&&(!c.attributeScopeSelector||!c.attributeControlSelector||!Array.isArray(c.attributeVerifiedValues)||!c.attributeVerifiedValues.includes(pkg.category)))throw Error('SOHU_ATTRIBUTE_VALUE_NOT_VERIFIED');
 const toutiaoFields=['toutiaoLocation','toutiaoFirstPublish','toutiaoMicroHeadlineSync'];
 if((pkg.topics?.length&&binding.platform!=='sohu')||pkg.poi||pkg.originalDeclaration||pkg.sourceComponent
  ||(binding.platform!=='toutiao'&&toutiaoFields.some(k=>pkg[k]!==undefined)))throw Error('PLATFORM_EXTRA_FIELDS_REQUIRE_CURRENT_PAGE_MAPPING');
 if(binding.platform==='toutiao'){
  if(pkg.toutiaoLocation!==undefined)throw Error('TOUTIAO_LOCATION_ADAPTER_UNVERIFIED');
  for(const key of ['toutiaoFirstPublish','toutiaoMicroHeadlineSync'])if(pkg[key]!==undefined&&typeof pkg[key]!=='boolean')throw Error('TOUTIAO_OPTION_INVALID');
 }
 if((pkg.summary&&!c.summarySelector)||(binding.platform!=='sohu'&&(pkg.category||pkg.declaration)))throw Error('PLATFORM_EXTRA_FIELDS_REQUIRE_CURRENT_PAGE_MAPPING');
 if(action!=='check'){
  if(!pkg.title||!body)throw Error('TITLE_AND_BODY_REQUIRED');
  const length=[...pkg.title].length;if(length<c.minTitleLength||length>c.maxTitleLength)throw Error('PLATFORM_TITLE_LENGTH_EXCEEDED');
  if(action==='publish'&&!pkg.coverPath&&!noCover)throw Error('ARTICLE_PUBLISH_COVER_REQUIRED');
 }
 if(pkg.coverPath&&!fs.statSync(pkg.coverPath).isFile())throw Error('COVER_FILE_MISSING');
 if(resumePreparation&&(action!=='publish'||!resumePreparation.receiptPath||!resumePreparation.priorReceipt
   ||(binding.platform!=='sohu'&&!(binding.platform==='toutiao'&&(resumePreparation.toutiaoDraftResume===true||resumePreparation.toutiaoOptionsResume===true||resumePreparation.toutiaoNoCoverResume===true)))))throw Error('PREPARED_STATE_RESUME_NOT_ALLOWED');
 if(resumePreparation&&!inlineImages.length&&!(binding.platform==='toutiao'&&(resumePreparation.toutiaoDraftResume===true||resumePreparation.toutiaoOptionsResume===true||resumePreparation.toutiaoNoCoverResume===true)))throw Error('PREPARED_STATE_RESUME_IMAGE_COUNT_NOT_VERIFIED');
 if(action==='publish'&&binding.platform==='sohu'&&inlineImages.length&&!resumePreparation&&visualReviewScreenshots.length!==inlineImages.length+1)throw Error('SOHU_NATIVE_VISUAL_REVIEW_PLAN_REQUIRED');
 if(action==='publish'&&binding.platform==='sohu'&&inlineImages.length&&resumePreparation?.priorReceipt?.stage==='visual-review'
  &&(resumePreparation.priorReceipt.code!=='SOHU_NATIVE_INLINE_VISUAL_REVIEW_REQUIRED'||resumePreparation.resumeExistingCount!==inlineImages.length
   ||resumePreparation.visualReviewProofPath!==`${path.resolve(resumePreparation.receiptPath||'')}.native-visual-review.json`||resumePreparation.baselineIdsKnown!==true))throw Error('SOHU_NATIVE_VISUAL_REVIEW_PROOF_REQUIRED');
 const html=studioIntent?.html??body.split(/\n\n/).map(x=>'<p>'+x.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')+'</p>').join('');
 const coverBytes=binding.platform==='toutiao'&&pkg.coverPath?fs.readFileSync(pkg.coverPath):null;
 const coverDimensions=coverBytes&&coverBytes.length>=24&&coverBytes.toString('ascii',12,16)==='IHDR'?{width:coverBytes.readUInt32BE(16),height:coverBytes.readUInt32BE(20)}:null;
 const input={resumeExistingCount:resumePreparation?.resumeExistingCount||0,resumePendingInline:resumePreparation?.resumePendingInline===true,resumeUploadedCover:resumePreparation?.priorReceipt?.code==='SOHU_COVER_UPLOAD_NOT_READY',resumeVisualReview:resumePreparation?.priorReceipt?.stage==='visual-review',toutiaoNoCover:noCover,title:pkg.title||'',body,html,summary:pkg.summary||'',coverPath:pkg.coverPath||'',category:pkg.category||'',topics:pkg.topics||[],declaration:pkg.declaration||'无需声明',toutiaoOptions:binding.platform==='toutiao'&&(pkg.toutiaoLocation!==undefined||pkg.toutiaoFirstPublish!==undefined||pkg.toutiaoMicroHeadlineSync!==undefined)?{location:pkg.toutiaoLocation,firstPublish:pkg.toutiaoFirstPublish,microHeadlineSync:pkg.toutiaoMicroHeadlineSync}:null,inlineImages,baselineIds,baselineIdsKnown:resumePreparation?resumePreparation.baselineIdsKnown===true:true,visualReviewScreenshots,resumePreparation:resumePreparation?{receiptPath:resumePreparation.receiptPath,priorReceipt:resumePreparation.priorReceipt,toutiaoOptionsResume:resumePreparation.toutiaoOptionsResume===true,toutiaoNoCoverResume:resumePreparation.toutiaoNoCoverResume===true,toutiaoDraftResume:resumePreparation.toutiaoDraftResume===true,contentHash:resumePreparation.contentHash||resumePreparation.priorReceipt?.contentHash,toutiaoRecoveryReceipt:resumePreparation.toutiaoRecoveryReceipt||null}:null,coverDimensions};
 return `const b=${JSON.stringify(binding)},c=${JSON.stringify(c)},input=${JSON.stringify(input)},action=${JSON.stringify(action)};
const marker='SCHOOL_NATIVE_ARTICLE:',spaces=await listTaskSpaces();const s=spaces.filter(s=>s.id===b.taskSpaceId&&s.name===b.taskSpaceName);
if(s.length!==1||s[0].ownership!=='agent'||(b.egoProfileId&&s[0].profileId!==b.egoProfileId))throw Error('EXACT_AGENT_SESSION_REQUIRED');
const t=await taskSpace(b.taskSpaceId);if(t.spaceId!==b.taskSpaceId||t.name!==b.taskSpaceName||t.ownership!=='agent')throw Error('SPACE_CHANGED');
const p=t.page(b.pageLabel),original=await p.url();const u=new URL(original),resumeMode=!!input.resumePreparation;
const validEntry=b.platformHosts.includes(u.hostname)&&(resumeMode?original===c.editorUrl:new RegExp(c.managementPathPattern).test(u.pathname+u.hash));
 let entered=false,mutated=false,submitted=false,submitAttempted=false,draftSaveAttempted=false,unexpectedConfirmation=false,visualReviewStage=false,preparedForReview=null,toutiaoCoverDialogResume=false,toutiaoExistingCoverResume=false;
const inlineImageReadback=[];
const inspectTopics=${inspectSohuTopics.toString()},clickTopic=${clickSohuTopic.toString()};
const insertInlineImage=${insertSohuInlineImage.toString()};
const openSohuCoverEditor=${openSohuCoverEditor.toString()};
const uploadCover=${uploadSohuCover.toString()};
const readTopics=async()=>p.evaluate(inspectTopics,c);
const compact=x=>String(x||'').replace(/[\\s\\u200b\\ufeff]+/g,'');
const inspect=async(includeHiddenForm=false)=>p.evaluate(({b,c,includeHiddenForm})=>{
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 const nodes=selector=>[...document.querySelectorAll(selector)].filter(visible);
 const ids=nodes(c.identitySelector);let storeIdentity=null;
 if(c.identityMode==='scoped_vue_user_info'&&ids.length===1){for(let n=ids[0];n;n=n.parentElement){const u=n.__vue__?.$store?.state?.app?.userInfo;if(u){storeIdentity={id:String(u.id??''),name:String(u.nickName??'')};break;}}}
 const identity=ids.length===1&&(c.identityMode==='scoped_vue_user_info'?ids[0].innerText.trim()===b.accountName&&storeIdentity?.name===b.accountName&&storeIdentity?.id===b.accountId:c.identityHrefPattern?new RegExp(c.identityHrefPattern).exec(ids[0].href)?.[1]===b.accountId:ids[0].innerText.trim()===b.accountName);
 const title=includeHiddenForm?[...document.querySelectorAll(c.titleSelector)]:nodes(c.titleSelector),body=includeHiddenForm?[...document.querySelectorAll(c.bodySelector)]:nodes(c.bodySelector),text=document.body.innerText;
 const quota=text.match(/您今天还能发\\s*([0-9]+)\\s*篇文章/);
 const permission=/账号已被封停|账号已封禁/.test(text)?'ACCOUNT_SUSPENDED':/账号信息正在审核中/.test(text)?'ACCOUNT_REVIEW_PENDING':/百度安全验证|手机验证码|请输入验证码/.test(text)?'SECURITY_VERIFICATION_REQUIRED':null;
 const inlineImages=body.flatMap(editor=>[...editor.querySelectorAll('.ql-image-container img')].map(img=>({alt:img.alt||'',src:img.getAttribute('src')||img.src||'',loaded:img.complete&&img.naturalWidth>0})));
 const oneChecked=selector=>{if(!selector)return null;const found=nodes(selector);return found.length===1?!!found[0].checked:null;};
 const locationNode=c.toutiaoLocationSelector?nodes(c.toutiaoLocationSelector):[];
 const toutiaoOptions=b.platform==='toutiao'?{location:locationNode.length===1?locationNode[0].innerText.trim():null,firstPublish:oneChecked(c.toutiaoFirstPublishSelector),microHeadlineSync:oneChecked(c.toutiaoMicroHeadlineSelector)}:null;
 const noCoverLabels=b.platform==='toutiao'?[...document.querySelectorAll('.article-cover-radio-group label')].filter(x=>x.innerText.trim()==='无封面'&&x.querySelector('input[value=\"1\"]')):[];const noCoverSelected=noCoverLabels.length===1&&!!noCoverLabels[0].querySelector('.byte-radio-inner.checked');
 return {noCoverSelected,url:location.href,identity,titleCount:title.length,bodyCount:body.length,title:title[0]?.value||'',body:body[0]?[...body[0].children].filter(node=>!node.classList.contains('ql-image-container')).map(node=>node.innerText||'').join(' '):'',inlineImages,summary:c.summarySelector?document.querySelector(c.summarySelector)?.value||'':'',declarations:[...document.querySelectorAll('input[type=radio]')].filter(e=>e.checked).map(e=>e.closest('label')?.innerText.trim()||e.parentElement.parentElement.innerText.trim()),quota:quota?Number(quota[1]):null,permission,coverReady:c.coverMode==='sohu'?/url[(]["']?[^"')\\s]+/.test(document.querySelector(c.coverReadySelector||'.pic-cover')?.style.backgroundImage||''):!!document.querySelector(c.coverReadySelector||'.article-cover-img-wrap img')?.naturalWidth,toutiaoOptions};
 },{b,c,includeHiddenForm});
const settledQuota=async()=>{
 let previous=null,stable=0;const quotaPollMs=Number.isFinite(c.quotaPollMs)?Math.max(0,c.quotaPollMs):1000;
 for(let i=0;i<8;i++){
  const current=await p.evaluate(()=>{const m=document.body.innerText.match(/您今天还能发\\s*([0-9]+)\\s*篇文章/);return m?Number(m[1]):null;});
  if(current===null){previous=null;stable=0;}else{stable=current===previous?stable+1:1;previous=current;}
  if(i<7)await new Promise(resolve=>setTimeout(resolve,quotaPollMs));
 }
 return stable>=3?previous:null;
};
const readCategory=async()=>p.evaluate(c=>{
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};
 if(!c.attributeScopeSelector||!c.attributeControlSelector)return null;
 const scopes=[...document.querySelectorAll(c.attributeScopeSelector)].filter(e=>visible(e)&&e.querySelector(c.attributeControlSelector));
 if(scopes.length!==1)return null;
 const controls=[...scopes[0].querySelectorAll(c.attributeControlSelector)].filter(visible);
 return controls.length===1?controls[0].innerText.trim():null;
},c);
const assertState=state=>{
 if(state.permission)throw Error(state.permission);
 if(!state.identity)throw Error('ACCOUNT_IDENTITY_UNVERIFIED');
 if(state.url!==c.editorUrl)throw Error('EDITOR_URL_CHANGED');
 if(state.titleCount!==1||state.bodyCount!==1)throw Error('FORM_SELECTOR_AMBIGUOUS');
};
const ready=async selector=>p.evaluate(selector=>{const m=selector.match(/^(.*):text-is[(]"([^"]+)"[)]$/);const es=[...document.querySelectorAll(m?m[1]:selector)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&(!m||e.innerText.trim()===m[2]);});return es.length===1&&!es[0].disabled&&es[0].getAttribute('aria-disabled')!=='true';},selector);
const scrollToControl=async selector=>p.evaluate(selector=>{const m=selector.match(/^(.*):text-is[(]"([^"]+)"[)]$/);const es=[...document.querySelectorAll(m?m[1]:selector)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&(!m||e.innerText.trim()===m[2]);});if(es.length!==1||es[0].disabled||es[0].getAttribute('aria-disabled')==='true')return false;es[0].scrollIntoView({block:'center',inline:'center'});return true;},selector);
const clickReady=async(selector,beforeClick)=>{if(!await ready(selector))throw Error('SUBMIT_CONTROL_NOT_UNIQUELY_READY');if(!await scrollToControl(selector))throw Error('SUBMIT_CONTROL_NOT_UNIQUELY_READY');if(!await ready(selector))throw Error('SUBMIT_CONTROL_NOT_UNIQUELY_READY');if(beforeClick)beforeClick();await p.click(selector);};
const setToutiaoBool=async(selector,wanted,code,expectedLabel)=>{
 if(wanted===undefined)return;
 const initial=await p.evaluate(({selector,expectedLabel})=>{const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};const labels=[...document.querySelectorAll(selector)].filter(visible),inputs=labels.flatMap(e=>[...e.querySelectorAll('input[type=checkbox]')]);return labels.length===1&&inputs.length===1&&labels[0].innerText.trim()===expectedLabel?{checked:inputs[0].checked,labelText:labels[0].innerText.trim()}:null;},{selector,expectedLabel});
 if(!initial)throw Error(code+'_CONTROL_NOT_UNIQUE');
 if(initial.checked!==wanted){await p.click(selector);await p.waitForFunction(({selector,wanted,expectedLabel})=>{const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};const labels=[...document.querySelectorAll(selector)].filter(visible),inputs=labels.flatMap(e=>[...e.querySelectorAll('input[type=checkbox]')]);return labels.length===1&&inputs.length===1&&labels[0].innerText.trim()===expectedLabel&&inputs[0].checked===wanted;},{selector,wanted,expectedLabel},{timeout:5000});}
 const checked=await p.evaluate(({selector,expectedLabel})=>{const labels=[...document.querySelectorAll(selector)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';}),inputs=labels.flatMap(e=>[...e.querySelectorAll('input[type=checkbox]')]);return labels.length===1&&inputs.length===1&&labels[0].innerText.trim()===expectedLabel?inputs[0].checked:null;},{selector,expectedLabel});
 if(checked!==wanted)throw Error(code+'_READBACK_MISMATCH');
};
const applyToutiaoOptions=async()=>{
 if(!input.toutiaoOptions)return;
 const wanted=input.toutiaoOptions;
 const closeAssistant=async()=>{
  const open=await p.evaluate(()=>{const d=document.querySelector('.byte-drawer'),x=d?.querySelector('.ai-assistant-panel .close-btn');if(!d||!x)return false;const r=d.getBoundingClientRect(),q=x.getBoundingClientRect(),s=getComputedStyle(d);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&q.width>0&&q.height>0;});
  if(open){await p.click('.ai-assistant-panel .close-btn');await p.evaluate(selector=>document.querySelector(selector)?.scrollIntoView({block:'center',inline:'center'}),c.toutiaoLocationPickerSelector);await p.waitForFunction(selector=>{const target=document.querySelector(selector),r=target?.getBoundingClientRect();if(!target||!r||r.width===0)return false;const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&(hit===target||target.contains(hit));},c.toutiaoLocationPickerSelector,{timeout:5000});}
 };
 if(wanted.location){
  const readLocation=()=>p.evaluate(selector=>{const es=[...document.querySelectorAll(selector)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';});return es.length===1?es[0].innerText.trim():null;},c.toutiaoLocationSelector);
  let current=await readLocation();
  if(current!==wanted.location){
   await closeAssistant();
   const pickerReady=await p.evaluate(selector=>{const es=[...document.querySelectorAll(selector)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';});if(es.length!==1)return false;es[0].scrollIntoView({block:'center',inline:'center'});return true;},c.toutiaoLocationPickerSelector);
   if(!pickerReady)throw Error('TOUTIAO_LOCATION_PICKER_NOT_UNIQUE');
   await p.click(c.toutiaoLocationPickerSelector);
   await p.waitForFunction(({optionSelector,city})=>{const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};return [...document.querySelectorAll(optionSelector)].filter(e=>visible(e)&&e.innerText.trim()===city).length===1;},{optionSelector:c.toutiaoLocationOptionSelector,city:wanted.location},{timeout:5000});
   const exact=c.toutiaoLocationOptionSelector+':text-is('+JSON.stringify(wanted.location)+')';
   await p.click(exact);
   await p.waitForFunction(({selector,city})=>{const es=[...document.querySelectorAll(selector)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';});return es.length===1&&es[0].innerText.trim()===city;},{selector:c.toutiaoLocationSelector,city:wanted.location},{timeout:5000});
   current=await readLocation();
  }
  if(current!==wanted.location)throw Error('TOUTIAO_LOCATION_READBACK_MISMATCH');
 }
 await setToutiaoBool(c.toutiaoFirstPublishSelector,wanted.firstPublish,'TOUTIAO_FIRST_PUBLISH','头条首发');
 await setToutiaoBool(c.toutiaoMicroHeadlineSelector,wanted.microHeadlineSync,'TOUTIAO_MICROHEADLINE_SYNC','发布得更多收益');
};
const assertToutiaoOptions=state=>{
 if(!input.toutiaoOptions)return;
 const wanted=input.toutiaoOptions,actual=state.toutiaoOptions;
 if(!actual||actual.location!==wanted.location)throw Error('TOUTIAO_LOCATION_FINAL_READBACK_MISMATCH');
 if(actual.firstPublish!==wanted.firstPublish)throw Error('TOUTIAO_FIRST_PUBLISH_FINAL_READBACK_MISMATCH');
 if(actual.microHeadlineSync!==wanted.microHeadlineSync)throw Error('TOUTIAO_MICROHEADLINE_FINAL_READBACK_MISMATCH');
};
const handleIncomeDialog=async()=>{
 const dialogs=await p.evaluate(()=>[...document.querySelectorAll('[role=dialog]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;}).map(e=>e.innerText));
 if(!dialogs.length)return;
 if(dialogs.length!==1||!dialogs[0].includes('不会产生广告收益')){unexpectedConfirmation=true;throw Error('UNEXPECTED_PLATFORM_CONFIRMATION');}
 await clickReady('[role=dialog] button:text-is("确定")');
};
try{
 // Return the typed preflight reason through the native marker; never navigate/write on a wrong entry.
 if(input.resumePreparation?.toutiaoNoCoverResume===true){const tabs=(await t.tabs()).filter(x=>x.label===b.pageLabel&&x.targetId===b.targetId);if(tabs.length!==1||p.targetId!==b.targetId||p.spaceId!==b.taskSpaceId)throw Error('TOUTIAO_NO_COVER_RESUME_EXACT_TARGET_REQUIRED');}
 if(!resumeMode&&!validEntry)throw Error('EXACT_MANAGEMENT_ENTRY_REQUIRED');
 if(resumeMode&&!validEntry)throw Error('RESUME_EDITOR_URL_MISMATCH');
 if(!resumeMode)await p.goto(c.editorUrl);entered=true;await p.waitForSelector(c.bodySelector);await p.waitForSelector(c.identitySelector);
 if(c.identityMode==='scoped_vue_user_info')await p.waitForFunction(c=>{for(let n=document.querySelector(c.identitySelector);n;n=n.parentElement){const u=n.__vue__?.$store?.state?.app?.userInfo;if(u?.id&&u?.nickName)return true;}return false;},c);
 let state=await inspect();assertState(state);
 if(b.platform==='sohu')state.quota=await settledQuota();
 const existingTopics=b.platform==='sohu'&&c.topicWriteReadbackVerified?await readTopics():{labels:[]};
 const blank=!existingTopics.labels.length&&state.title.trim()===''&&['','请输入正文'].includes(state.body.trim())&&!(state.summary||'').trim()&&!state.coverReady&&!(state.inlineImages||[]).length;
 if(action==='check'){
  const quotaUnverified=b.platform==='sohu'&&state.quota===null;
  console.log(marker+JSON.stringify({ok:!quotaUnverified&&state.quota!==0,status:quotaUnverified?'PUBLISH_QUOTA_HYDRATION_UNVERIFIED':state.quota===0?'PUBLISH_QUOTA_EXHAUSTED':'FORM_PREFLIGHT_PASSED',code:quotaUnverified?'PUBLISH_QUOTA_HYDRATION_UNVERIFIED':state.quota===0?'PUBLISH_QUOTA_EXHAUSTED':null,emptyEditor:blank,remainingPublishQuota:state.quota,toutiaoOptions:state.toutiaoOptions,accountIdentityVerified:true,readOnly:true,publicationPerformed:false,publicReadbackVerified:false}));
 }else{
  if(resumeMode&&b.platform==='toutiao'&&(input.resumePreparation?.toutiaoNoCoverResume===true||input.resumePreparation?.toutiaoOptionsResume===true)){
   throw Error('BUSINESS_CASE_CONTINUATION_EXCLUDED');
  }else if(resumeMode&&b.platform==='toutiao'&&input.resumePreparation?.toutiaoDraftResume===true){
   const prior=input.resumePreparation.priorReceipt;
   if(action!=='publish'||!input.coverPath||prior?.platform!=='toutiao'||prior?.accountKey!==b.accountKey||prior?.action!=='draft'
      ||prior?.code!=='page.click timed out after 3000ms: Selector .article-cover-add matched 1 elements, but none can receive input; <div> intercepts pointer events'
      ||prior?.submitted!==false||prior?.submitAttempted!==false||compact(state.title)!==compact(input.title)||compact(state.body)!==compact(input.body)
      ||!(/草稿已保存/.test(await p.evaluate(()=>document.body.innerText))))throw Error('TOUTIAO_NATIVE_DRAFT_RESUME_STATE_MISMATCH');
   if(input.inlineImages.length)throw Error('TOUTIAO_INLINE_IMAGES_NOT_SUPPORTED');
   if(input.resumePreparation.toutiaoRecoveryReceipt?.code==='RESUME_CATEGORY_READBACK_MISMATCH'){
    const cover=await p.evaluate(selector=>{const images=[...document.querySelectorAll(selector)].filter(i=>{const r=i.getBoundingClientRect();return r.width>0&&r.height>0&&i.complete&&i.naturalWidth>0;});return images.length===1?{width:images[0].naturalWidth,height:images[0].naturalHeight,srcHost:new URL(images[0].src,location.href).hostname}:null;},c.coverReadySelector||'.article-cover-img-wrap img');
    if(!state.coverReady||cover?.srcHost!=='image-tt-private.toutiao.com'||state.toutiaoOptions?.location!==input.toutiaoOptions?.location||state.toutiaoOptions?.firstPublish!==input.toutiaoOptions?.firstPublish||state.toutiaoOptions?.microHeadlineSync!==input.toutiaoOptions?.microHeadlineSync)throw Error('TOUTIAO_EXISTING_COVER_RESUME_MISMATCH');
    toutiaoExistingCoverResume=true;
   }else if(input.resumePreparation.toutiaoRecoveryReceipt?.code==='page.click timed out after 3000ms: Locator button:text-is("确定") matched 0 elements'){
    if(state.coverReady||state.toutiaoOptions?.location!==input.toutiaoOptions?.location||state.toutiaoOptions?.firstPublish!==input.toutiaoOptions?.firstPublish||state.toutiaoOptions?.microHeadlineSync!==input.toutiaoOptions?.microHeadlineSync)throw Error('TOUTIAO_COVER_DIALOG_RESUME_OPTIONS_MISMATCH');
    const modal=await p.evaluate(({dimensions})=>{const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};const panels=[...document.querySelectorAll('.upload-image-panel')].filter(visible);if(panels.length!==1||!panels[0].innerText.includes('已上传 1 张图片'))return false;const imgs=[...panels[0].querySelectorAll('img')].filter(i=>visible(i)&&i.complete&&i.naturalWidth>0);const buttons=[...panels[0].querySelectorAll('.confirm-btns button.byte-btn-primary')].filter(visible);return imgs.length===1&&imgs[0].naturalWidth===dimensions?.width&&imgs[0].naturalHeight===dimensions?.height&&buttons.length===1&&buttons[0].innerText.trim()==='确定'&&!buttons[0].disabled;},{dimensions:input.coverDimensions});
    if(!modal)throw Error('TOUTIAO_COVER_DIALOG_RESUME_ASSET_MISMATCH');toutiaoCoverDialogResume=true;
   }else if(state.coverReady||state.toutiaoOptions?.firstPublish===null||state.toutiaoOptions?.microHeadlineSync===null)throw Error('TOUTIAO_NATIVE_DRAFT_RESUME_STATE_MISMATCH');
   mutated=true;
  }else if(resumeMode){
   const prior=input.resumePreparation;
   if(action!=='publish'||!input.coverPath||!input.inlineImages.length||input.inlineImages.some(x=>!['after_paragraph','end'].includes(x.position.kind)))throw Error('PREPARED_STATE_RESUME_NOT_ALLOWED');
   if(!prior.receiptPath)throw Error('PREPARED_STATE_RECEIPT_PATH_MISSING');
   if(state.quota===null)throw Error('PUBLISH_QUOTA_HYDRATION_UNVERIFIED');
   if(state.quota<=0)throw Error('PUBLISH_QUOTA_EXHAUSTED');
   if(compact(state.title)!==compact(input.title))throw Error('RESUME_TITLE_READBACK_MISMATCH');
   if(compact(state.body)!==compact(input.body))throw Error('RESUME_BODY_READBACK_MISMATCH');
   if(state.summary!==input.summary)throw Error('RESUME_SUMMARY_READBACK_MISMATCH');
   if(!state.declarations.includes(input.declaration))throw Error('RESUME_DECLARATION_READBACK_MISMATCH');
   if(JSON.stringify(existingTopics.labels)!==JSON.stringify(input.topics))throw Error('RESUME_TOPICS_READBACK_MISMATCH');
   if(await readCategory()!==(input.category||''))throw Error('RESUME_CATEGORY_READBACK_MISMATCH');
   if(input.resumeVisualReview&&(!state.coverReady||(state.inlineImages||[]).length!==input.resumeExistingCount))throw Error('SOHU_NATIVE_VISUAL_REVIEW_EDITOR_STATE_CHANGED');
   if((state.coverReady&&!input.resumePendingInline&&!input.resumeExistingCount)||(state.inlineImages||[]).length!==input.resumeExistingCount)throw Error('RESUME_PARTIAL_MEDIA_NOT_ALLOWED');
  }else{
  if(!blank)throw Error('EXISTING_EDITOR_CONTENT_PROTECTED');
  if(action==='publish'&&b.platform==='sohu'&&state.quota===null)throw Error('PUBLISH_QUOTA_HYDRATION_UNVERIFIED');
  if(action==='publish'&&state.quota===0)throw Error('PUBLISH_QUOTA_EXHAUSTED');
  mutated=true;await p.fill(c.titleSelector,input.title);await p.focus(c.bodySelector);await p.keyboard.paste({text:input.body,html:input.html});
  if(input.summary&&c.summarySelector)await p.fill(c.summarySelector,input.summary);
  if(b.platform==='sohu'){
   await p.evaluate(value=>{const es=[...document.querySelectorAll('label')].filter(e=>e.innerText.trim()===value);if(es.length!==1)throw Error('DECLARATION_CONTROL_NOT_UNIQUE');es[0].click();},input.declaration);
   if(input.category){
    await p.evaluate(c=>{const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};const scopes=[...document.querySelectorAll(c.attributeScopeSelector)].filter(e=>visible(e)&&e.querySelector(c.attributeControlSelector));if(scopes.length!==1)throw Error('SOHU_ATTRIBUTE_SCOPE_AMBIGUOUS');const controls=[...scopes[0].querySelectorAll(c.attributeControlSelector)].filter(visible);if(controls.length!==1)throw Error('SOHU_ATTRIBUTE_CONTROL_AMBIGUOUS');controls[0].click();},c);
    await p.waitForFunction(({c,value})=>{const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};const scopes=[...document.querySelectorAll(c.attributeScopeSelector)].filter(e=>visible(e)&&e.querySelector(c.attributeControlSelector));return scopes.length===1&&[...scopes[0].querySelectorAll('li')].filter(e=>visible(e)&&e.innerText.trim()===value).length===1;},{c,value:input.category},{timeout:10000});
    await p.evaluate(({c,value})=>{const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};const scopes=[...document.querySelectorAll(c.attributeScopeSelector)].filter(e=>visible(e)&&e.querySelector(c.attributeControlSelector));if(scopes.length!==1)throw Error('SOHU_ATTRIBUTE_SCOPE_AMBIGUOUS');const options=[...scopes[0].querySelectorAll('li')].filter(e=>visible(e)&&e.innerText.trim()===value);if(options.length!==1)throw Error('SOHU_ATTRIBUTE_OPTION_NOT_UNIQUE');options[0].click();},{c,value:input.category});
    const selected=await p.evaluate(c=>{const scopes=[...document.querySelectorAll(c.attributeScopeSelector)].filter(e=>e.getBoundingClientRect().width>0&&e.querySelector(c.attributeControlSelector));return scopes.length===1?scopes[0].querySelector(c.attributeControlSelector)?.innerText.trim():null;},c);if(selected!==input.category)throw Error('SOHU_ATTRIBUTE_READBACK_MISMATCH');
   }
  }
  if(b.platform==='sohu'&&input.topics.length){
   for(const value of input.topics){
    const before=await readTopics();if(before.labels.includes(value))throw Error('SOHU_TOPIC_ALREADY_SELECTED');
    await p.fill(c.topicInputSelector,value);
    await p.waitForFunction(({c,value})=>{const scopes=[...document.querySelectorAll(c.topicScopeSelector)];if(scopes.length!==1)return false;const v=scopes[0].__vue__,pop=v?.$refs?.popper?.$el;const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};return v?.query===value&&pop?.isConnected&&visible(pop)&&[...pop.querySelectorAll(c.topicOptionSelector)].filter(e=>visible(e)&&e.innerText.trim()===value).length===1;},{c,value},{timeout:10000});
    await p.evaluate(clickTopic,{c,value});
    await p.waitForFunction(({c,value})=>{const es=[...document.querySelectorAll(c.topicScopeSelector)];return es.length===1&&[...es[0].querySelectorAll(c.topicTagSelector)].some(e=>e.innerText.trim()===value);},{c,value},{timeout:10000});
    const after=await readTopics();if(JSON.stringify(after.labels)!==JSON.stringify([...before.labels,value]))throw Error('SOHU_TOPIC_SELECTION_READBACK_MISMATCH');
   }
  }
  }
  if(resumeMode)mutated=true;
  // Toutiao opens an assistant drawer when the editor loads. Close it through
  // its visible native control before clicking the cover picker, or the drawer
  // mask intercepts the cover control. Applying the requested location does
  // this and reads back the location/checkboxes before media upload.
  if(b.platform==='toutiao'&&!toutiaoCoverDialogResume&&!toutiaoExistingCoverResume)await applyToutiaoOptions();
  if(input.toutiaoNoCover){
   if(b.platform!=='toutiao'||input.coverPath||input.inlineImages.length)throw Error('TOUTIAO_NO_COVER_SCOPE_CHANGED');
   const drawerOpen=await p.evaluate(()=>{const xs=[...document.querySelectorAll('.ai-assistant-panel .close-btn')].filter(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(x).visibility!=='hidden';});return xs.length===1;});
   if(drawerOpen)await p.click('.ai-assistant-panel .close-btn');
   await clickReady('.article-cover-radio-group label:has(input[value="1"])');
   await p.waitForFunction(()=>{const rows=[...document.querySelectorAll('.article-cover-radio-group label')].filter(x=>x.innerText.trim()==='无封面'&&x.querySelector('input[value="1"]'));return rows.length===1&&!!rows[0].querySelector('.byte-radio-inner.checked')&&!document.querySelector('.article-cover-img-wrap img');},undefined,{timeout:10000});
  }
  if(input.coverPath&&!toutiaoExistingCoverResume&&!((input.resumePendingInline||input.resumeExistingCount)&&state.coverReady)){
   if(c.coverMode==='sohu'){
    await uploadCover({p,c,coverPath:input.coverPath,clickReady,resumeUploadedCover:input.resumeUploadedCover});
   }else if(b.platform==='toutiao'&&toutiaoCoverDialogResume){
    await clickReady(c.coverConfirmSelector);await p.waitForFunction(selector=>!!document.querySelector(selector)?.naturalWidth,c.coverReadySelector||'.article-cover-img-wrap img');
   }else{
    await clickReady(c.coverOpenSelector||'.article-cover-add');await p.setInputFiles(c.coverInputSelector||'input[type=file]:not([id])',input.coverPath);
    await p.waitForFunction(()=>/已上传\\s*1\\s*张/.test(document.body.innerText));await clickReady(c.coverConfirmSelector||'button:text-is("确定")');await p.waitForFunction(selector=>!!document.querySelector(selector)?.naturalWidth,c.coverReadySelector||'.article-cover-img-wrap img');
   }
  }
  for(let i=0;i<input.inlineImages.length;i++){
   const item=input.inlineImages[i],expectedBefore=input.inlineImages.slice(0,i).map(x=>x.filename);
   if(i<input.resumeExistingCount){
    const verified=await p.evaluate(({c,item,body,index})=>{
     const editor=document.querySelector(c.bodySelector),imgs=[...editor.querySelectorAll('.ql-image-container img')],img=imgs[index];
     const compact=x=>String(x||'').replace(/[\\s\\u200b\\ufeff]+/g,'');
     const text=[...editor.children].filter(n=>!n.classList.contains('ql-image-container')).map(n=>n.innerText||'').join(' ');
     const anchors=[...editor.querySelectorAll('p')].filter(n=>compact(n.innerText)===compact(item.position.text));
     if(!img||img.alt!==item.filename||!img.complete||!img.naturalWidth||new URL(img.src,location.href).hostname!=='res.mp.sohu.com'||compact(text)!==compact(body)||item.position.kind!=='after_paragraph'||anchors.length!==1)return false;
     const blocks=[...editor.children],a=blocks.indexOf(anchors[0]),im=blocks.indexOf(img.closest('.ql-image-container'));
     const next=blocks.findIndex((n,j)=>j>a&&compact(n.innerText||'')&&!n.querySelector('img'));
     return im>a&&(next<0||im<next);
    },{c,item,body:input.body,index:i});
    if(!verified)throw Error('RESUME_EXISTING_INLINE_NOT_VERIFIED');
    inlineImageReadback.push({index:i+1,role:item.role,filename:item.filename,host:'res.mp.sohu.com',position:{kind:item.position.kind,anchorMatched:true},orderIndex:i+1,textMatched:true,reusedExisting:true});continue;
   }

   const receipt=await insertInlineImage({p,c,image:item,body:input.body,expectedBefore,clickReady,index:i,resumePendingInline:input.resumePendingInline&&i===input.resumeExistingCount});
   inlineImageReadback.push({index:i+1,role:receipt.role,filename:receipt.filename,host:receipt.host,position:receipt.position,orderIndex:receipt.orderIndex,textMatched:receipt.textMatched});
  }
  state=await inspect();assertState(state);
  if(compact(state.title)!==compact(input.title)||compact(state.body)!==compact(input.body))throw Error('CONTENT_READBACK_MISMATCH');
  if(input.summary&&state.summary!==input.summary)throw Error('SUMMARY_READBACK_MISMATCH');
  if((input.category||(resumeMode&&b.platform==='sohu'))&&await readCategory()!==(input.category||''))throw Error(resumeMode?'RESUME_CATEGORY_READBACK_MISMATCH':'SOHU_ATTRIBUTE_READBACK_MISMATCH');
  if(b.platform==='sohu'&&!state.declarations.includes(input.declaration))throw Error('DECLARATION_READBACK_MISMATCH');
  if(b.platform==='sohu'&&c.topicWriteReadbackVerified&&JSON.stringify((await readTopics()).labels)!==JSON.stringify(input.topics))throw Error('SOHU_TOPIC_FINAL_READBACK_MISMATCH');
  if(input.coverPath&&!state.coverReady)throw Error('COVER_NOT_READY');
  if(input.toutiaoNoCover&&!state.noCoverSelected)throw Error('TOUTIAO_NO_COVER_FINAL_READBACK_REQUIRED');
  if(action==='publish'&&b.platform==='sohu'&&!resumeMode&&input.inlineImages.length&&input.visualReviewScreenshots.length){
   visualReviewStage=true;
   const exactTarget=(await t.tabs()).filter(x=>x.label===b.pageLabel&&x.targetId===b.targetId);
   if(!b.targetId||exactTarget.length!==1)throw Error('EXACT_TARGET_REQUIRED');
   const screenshotEvidence=[];
   for(const shot of input.visualReviewScreenshots){
    const observed=await p.evaluate(({c,shot})=>{
     const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
     let node=null,detail={};
     if(shot.role==='cover'){
      const matches=[...document.querySelectorAll(c.coverReadySelector||'.pic-cover')].filter(visible);
      if(matches.length!==1)return {ok:false,code:'SOHU_NATIVE_COVER_SCREENSHOT_TARGET_NOT_UNIQUE'};
      node=matches[0];detail={backgroundImage:node.style?.backgroundImage||getComputedStyle(node).backgroundImage||'',ready:true};
     }else{
      const editors=[...document.querySelectorAll(c.bodySelector)].filter(visible);
      if(editors.length!==1)return {ok:false,code:'SOHU_NATIVE_INLINE_SCREENSHOT_EDITOR_NOT_UNIQUE'};
      const imgs=[...editors[0].querySelectorAll('.ql-image-container img')].filter(img=>img.alt===shot.filename);
      if(imgs.length!==1||!imgs[0].complete||!imgs[0].naturalWidth)return {ok:false,code:'SOHU_NATIVE_INLINE_SCREENSHOT_IMAGE_NOT_READY'};
      const img=imgs[0];node=img.closest('.ql-image-container');if(!node)return {ok:false,code:'SOHU_NATIVE_INLINE_SCREENSHOT_CONTAINER_MISSING'};
      const editorBlocks=[...editors[0].children],imageIndex=editorBlocks.indexOf(node);
      detail={filename:img.alt,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,srcHost:new URL(img.src,location.href).hostname,position:shot.position,anchorBefore:imageIndex>0?(editorBlocks[imageIndex-1].innerText||''):''};
     }
     node.scrollIntoView({block:'center',inline:'center'});
     const r=node.getBoundingClientRect();
     return {ok:true,role:shot.role,filename:shot.filename||null,rect:{x:r.x,y:r.y,width:r.width,height:r.height},...detail};
    },{c,shot});
    if(!observed?.ok)throw Error(observed?.code||'SOHU_NATIVE_REVIEW_SCREENSHOT_TARGET_UNVERIFIED');
    await p.screenshot({path:shot.path});
    screenshotEvidence.push({...shot,...observed});
   }
   await p.evaluate(()=>window.scrollTo(0,0));
  preparedForReview={nativePage:{taskSpaceId:b.taskSpaceId,pageLabel:b.pageLabel,targetId:b.targetId,accountId:b.accountId,accountName:b.accountName,url:await p.url()},title:state.title,coverReady:state.coverReady,baselineIds:input.baselineIds,inlineImages:inlineImageReadback,screenshots:screenshotEvidence};
   throw Error('SOHU_NATIVE_INLINE_VISUAL_REVIEW_REQUIRED');
  }
  if(action==='draft'&&c.draftMode==='autosave'){
   await p.waitForFunction(pattern=>new RegExp(pattern).test(document.body.innerText),c.autosavePattern,{timeout:15000});
   console.log(marker+JSON.stringify({ok:true,status:'DRAFT_SAVE_REQUESTED',submitted:false,autosaveObserved:true,inlineImageReadback,publicReadbackVerified:false}));
  }else if(action==='draft'){
   await clickReady(c.draftSelector,()=>{draftSaveAttempted=true;});console.log(marker+JSON.stringify({ok:true,status:'DRAFT_SAVE_REQUESTED',submitted:false,inlineImageReadback,publicReadbackVerified:false}));
  }else{
   if(c.publishMode==='preview_confirm'){
    await clickReady(c.publishSelector);
    if(!c.finalPublishSelector)throw Error('FINAL_PUBLISH_SELECTOR_NOT_VERIFIED');
    const waitFinalControl=()=>p.waitForFunction(({selector,expectedText})=>{const es=[...document.querySelectorAll(selector)].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&(!expectedText||e.innerText.trim()===expectedText);});return es.length===1;},{selector:c.finalPublishSelector,expectedText:b.platform==='toutiao'?'确认发布':null});
    await waitFinalControl();await handleIncomeDialog();await waitFinalControl();
    state=await inspect(true);assertState(state);assertToutiaoOptions(state);
    if(compact(state.title)!==compact(input.title)||compact(state.body)!==compact(input.body))throw Error('CONTENT_CHANGED_BEFORE_FINAL_CONFIRM');
    let verifiedFinalSelector=c.finalPublishSelector;
    if(b.platform==='toutiao'){
     const marked=await p.evaluate(selector=>{const es=[...document.querySelectorAll(selector)].filter(e=>{const r=e.getBoundingClientRect();return e.innerText.trim()==='确认发布'&&r.width>0&&r.height>0&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';});if(es.length!==1)return false;es[0].setAttribute('data-maxiaojian-final-confirm','verified');return true;},c.finalPublishSelector);
     if(!marked)throw Error('EXACT_TOUTIAO_FINAL_CONFIRM_TEXT_REQUIRED');verifiedFinalSelector='button[data-maxiaojian-final-confirm="verified"]';
    }
    if(input.resumePreparation?.toutiaoNoCoverResume===true){const tabs=(await t.tabs()).filter(x=>x.label===b.pageLabel&&x.targetId===b.targetId);if(tabs.length!==1||p.targetId!==b.targetId||p.spaceId!==b.taskSpaceId||!state.noCoverSelected)throw Error('TOUTIAO_NO_COVER_FINAL_TARGET_REQUIRED');}
    await clickReady(verifiedFinalSelector,()=>{submitAttempted=true;});submitted=true;
    await handleIncomeDialog();
   }else{await clickReady(c.publishSelector,()=>{submitAttempted=true;});submitted=true;}
   await p.waitForFunction(pattern=>new RegExp(pattern).test(location.pathname),c.managementPathPattern,{timeout:30000});
   const matches=await p.evaluate(({c,input})=>[...document.querySelectorAll(c.rowSelector)].flatMap(row=>[...row.querySelectorAll(c.articleLinkSelector)].map(a=>({title:a.innerText,url:a.href}))).filter(a=>a.title===input.title),{c,input});
   console.log(marker+JSON.stringify({ok:true,status:'SUBMITTED',submitted:true,candidates:matches,baselineIds:input.baselineIds,baselineIdsKnown:input.baselineIdsKnown,resumePreparation:resumeMode?{continuedSameEditor:true,originalReceiptPath:input.resumePreparation.receiptPath}:null,inlineImageReadback,toutiaoOptions:state.toutiaoOptions,publicReadbackVerified:false}));
  }
 }
}catch(error){const status=submitAttempted||submitted||unexpectedConfirmation?'SUBMISSION_UNCERTAIN':draftSaveAttempted?'DRAFT_SAVE_UNCERTAIN':mutated?'PREPARATION_BLOCKED':'BLOCKED';console.log(marker+JSON.stringify({ok:false,status,stage:visualReviewStage?'visual-review':submitAttempted||submitted?'submit':unexpectedConfirmation?'platform-confirmation':draftSaveAttempted?'draft-save':mutated?'content-preparation':'preflight',code:String(error.message),submitted,submitAttempted,inlineImageReadback,...(preparedForReview?{prepared:preparedForReview}:{}),publicReadbackVerified:false}));}
finally{if(entered&&!mutated&&!resumeMode)await p.goto(original);}
`;
}

const SOHU_VISUAL_REVIEW_SCHEMA='sohu-native-article-visual-review/v1';
function pngDimensions(buffer) {
 if(!Buffer.isBuffer(buffer)||buffer.length<24||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||buffer.toString('ascii',12,16)!=='IHDR')return null;
 return {width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
}
function regularFileBytes(file) {
 const resolved=path.resolve(file),stat=fs.lstatSync(resolved);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('SOHU_NATIVE_VISUAL_REVIEW_EVIDENCE_INVALID');
 const bytes=fs.readFileSync(resolved),dimensions=pngDimensions(bytes);
 if(!dimensions||dimensions.width<1||dimensions.height<1)throw Error('SOHU_NATIVE_VISUAL_REVIEW_SCREENSHOT_INVALID');
 return {bytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:stat.size,width:dimensions.width,height:dimensions.height};
}
function expectedSohuVisualScreenshots(pkg,inlineImages,basePath) {
 if(typeof basePath!=='string'||!path.isAbsolute(basePath))throw Error('SOHU_NATIVE_VISUAL_REVIEW_PATH_REQUIRED');
 const base=path.resolve(basePath);
 return [
  {kind:'cover',role:'cover',filename:path.basename(pkg.coverPath),sourcePath:pkg.coverPath,path:path.join(base,'cover.png'),sourceAssetSha256:sha256File(pkg.coverPath)},
  ...inlineImages.map((item,index)=>({kind:'inline',role:item.role,filename:item.filename,sourcePath:item.path,path:path.join(base,`inline-${index+1}.png`),sourceAssetSha256:item.sha256})),
 ];
}

/**
 * Verify the exact visual checkpoint before allowing a staged Sohu editor to
 * continue to its one final native submit.  The proof file is deliberately
 * separate from the immutable preparation receipt and binds its raw bytes,
 * source assets, native account/page, and every reviewed screenshot.
 */
export function validateSohuNativeVisualReview({pkg,matrix,statePath,priorRaw,priorReceipt,contractPath=ARTICLE_CONTRACTS}) {
 const target=pkg?.schoolAccount||{},resolvedState=path.resolve(statePath||'');
 const {contentHash}=fingerprintContentHashForVisualReview(pkg);
 const expectedReceipt=path.resolve(path.join(path.dirname(resolvedState),path.basename(resolvedState)));
 if(target.platform!=='sohu'||!resolvedState||!fs.existsSync(resolvedState)||!priorReceipt||priorReceipt.ok!==false||priorReceipt.status!=='PREPARATION_BLOCKED'
  ||priorReceipt.stage!=='visual-review'||priorReceipt.code!=='SOHU_NATIVE_INLINE_VISUAL_REVIEW_REQUIRED'||priorReceipt.submitted!==false||priorReceipt.submitAttempted!==false
  ||priorReceipt.fingerprintVersion!==2||priorReceipt.contentHash!==contentHash||priorReceipt.platform!=='sohu'||priorReceipt.accountKey!==target.accountKey
  ||priorReceipt.action!=='publish'||priorReceipt.backend!=='ego_article'||typeof priorRaw!=='string'||fs.readFileSync(resolvedState,'utf8')!==priorRaw
  ||JSON.stringify(JSON.parse(priorRaw))!==JSON.stringify(priorReceipt))throw Error('SOHU_NATIVE_VISUAL_REVIEW_RECEIPT_INVALID');
 if(expectedReceipt!==resolvedState)throw Error('SOHU_NATIVE_VISUAL_REVIEW_RECEIPT_INVALID');
 const b=resolveSchoolAccountBinding(target,matrix),c=JSON.parse(fs.readFileSync(contractPath,'utf8')).platforms.sohu?.nativeArticle;
 if(!c||!pkg.coverPath||!fs.statSync(pkg.coverPath,{throwIfNoEntry:false})?.isFile())throw Error('SOHU_NATIVE_VISUAL_REVIEW_PACKAGE_INVALID');
 const sourceBody=pkg.body??(pkg.articlePath?fs.readFileSync(pkg.articlePath,'utf8'):''),studioIntent=studioInlineIntent(pkg,'sohu',sourceBody),body=studioIntent?.body??sourceBody;
 const inlineImages=resolveInlineImages(pkg,'sohu',body,studioIntent);
 if(!inlineImages.length)throw Error('SOHU_NATIVE_VISUAL_REVIEW_PACKAGE_INVALID');
 const expected=expectedSohuVisualScreenshots(pkg,inlineImages,`${resolvedState}.native-visual-review`),prepared=priorReceipt.prepared;
 if(!prepared||prepared.title!==pkg.title||prepared.coverReady!==true||!Array.isArray(prepared.baselineIds)||prepared.baselineIds.some(x=>typeof x!=='string'||!x)
  ||new Set(prepared.baselineIds).size!==prepared.baselineIds.length||!Array.isArray(prepared.inlineImages)||prepared.inlineImages.length!==inlineImages.length
  ||!Array.isArray(prepared.screenshots)||prepared.screenshots.length!==expected.length)throw Error('SOHU_NATIVE_VISUAL_REVIEW_PREPARATION_INVALID');
 const page=prepared.nativePage;
 if(!page||page.taskSpaceId!==b.taskSpaceId||page.pageLabel!==b.pageLabel||page.targetId!==b.targetId||String(page.accountId)!==String(b.accountId)||page.accountName!==b.accountName||page.url!==c.editorUrl)throw Error('SOHU_NATIVE_VISUAL_REVIEW_NATIVE_PAGE_MISMATCH');
 const reviewDir=`${resolvedState}.native-visual-review`;
 const dirStat=fs.lstatSync(reviewDir);
 if(!dirStat.isDirectory()||dirStat.isSymbolicLink())throw Error('SOHU_NATIVE_VISUAL_REVIEW_EVIDENCE_INVALID');
 const reviewedPrepared=[];
 for(let i=0;i<expected.length;i++){
  const want=expected[i],got=prepared.screenshots[i],actual=regularFileBytes(want.path),source=fs.statSync(want.sourcePath);
  if(!source.isFile()||path.resolve(got?.path||'')!==want.path||got.kind!==want.kind||got.role!==want.role||got.filename!==want.filename
   ||got.sourceAssetSha256!==want.sourceAssetSha256||got.screenshotSha256!==actual.sha256||got.screenshotBytes!==actual.size
   ||got.width!==actual.width||got.height!==actual.height)throw Error('SOHU_NATIVE_VISUAL_REVIEW_SCREENSHOT_MISMATCH');
  if(want.kind==='inline'){
   const inline=prepared.inlineImages[i-1];
   if(!inline||inline.index!==i||inline.role!==want.role||inline.filename!==want.filename||inline.textMatched!==true||inline.reusedExisting===true)throw Error('SOHU_NATIVE_VISUAL_REVIEW_INLINE_READBACK_MISMATCH');
  }
  reviewedPrepared.push({kind:want.kind,role:want.role,filename:want.filename,path:want.path,sourceAssetSha256:want.sourceAssetSha256,screenshotSha256:actual.sha256,screenshotBytes:actual.size,width:actual.width,height:actual.height});
 }
 if(!Array.isArray(priorReceipt.inlineImageReadback)||priorReceipt.inlineImageReadback.length!==inlineImages.length
  ||priorReceipt.inlineImageReadback.some((x,i)=>x.index!==i+1||x.role!==inlineImages[i].role||x.filename!==inlineImages[i].filename||x.textMatched!==true))throw Error('SOHU_NATIVE_VISUAL_REVIEW_INLINE_READBACK_MISMATCH');
 const proofPath=`${resolvedState}.native-visual-review.json`,proofStat=fs.lstatSync(proofPath);
 if(!proofStat.isFile()||proofStat.isSymbolicLink())throw Error('SOHU_NATIVE_VISUAL_REVIEW_PROOF_INVALID');
 const proof=JSON.parse(fs.readFileSync(proofPath,'utf8'));
 const rawHash=crypto.createHash('sha256').update(priorRaw).digest('hex');
 if(proof.schema!==SOHU_VISUAL_REVIEW_SCHEMA||proof.originalReceiptPath!==resolvedState||proof.originalReceiptSha256!==rawHash||proof.contentHash!==contentHash
  ||proof.platform!=='sohu'||proof.accountKey!==target.accountKey||JSON.stringify(proof.nativePage)!==JSON.stringify(page)
  ||proof.visualChecks?.allRequiredPixelsInspected!==true||proof.visualChecks?.coverMatchesSourceAndIsUsable!==true
  ||proof.visualChecks?.inlineImagesMatchSourceAndPlacement!==true||proof.visualChecks?.noUnexpectedOcclusionOrOverlay!==true
  ||!Array.isArray(proof.screenshots)||proof.screenshots.length!==reviewedPrepared.length)throw Error('SOHU_NATIVE_VISUAL_REVIEW_PROOF_INVALID');
 for(let i=0;i<reviewedPrepared.length;i++){
  const want=reviewedPrepared[i],given=proof.screenshots[i];
  if(given?.kind!==want.kind||given?.role!==want.role||given?.filename!==want.filename||path.resolve(given?.path||'')!==want.path
   ||given?.sourceAssetSha256!==want.sourceAssetSha256||given?.screenshotSha256!==want.screenshotSha256
   ||given?.pixelsInspected!==true||given?.matchesSource!==true||given?.placementApproved!==true)throw Error('SOHU_NATIVE_VISUAL_REVIEW_PROOF_INVALID');
 }
 return {proof,proofPath,resumeExistingCount:inlineImages.length,baselineIds:[...prepared.baselineIds],reviewedScreenshots:reviewedPrepared};
}

function fingerprintContentHashForVisualReview(pkg) {
 // Keep this module independent from the CLI runner while reproducing its
 // canonical content fingerprint byte-for-byte for article packages.
 const hash=crypto.createHash('sha256');
 const content={title:pkg.title||'',body:pkg.body||'',mediaId:pkg.mediaId||'',contentType:pkg.contentType||'',topics:pkg.topics||pkg.douyinTopics||[]};
 hash.update(JSON.stringify(content));
 const streamHash=(file,into)=>{const fd=fs.openSync(file,'r'),buf=Buffer.allocUnsafe(65536);try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null))>0)into.update(buf.subarray(0,n));}finally{fs.closeSync(fd);}return into;};
 for(const k of ['articlePath','videoPath','coverPath','douyinPortraitCoverPath','douyinLandscapeCoverPath'])if(pkg[k])streamHash(pkg[k],hash);
 const legacyKey=hash.digest('hex'),{schoolAccount,backend,pageContract,publicUrl,...payload}=pkg,assets=new Map();
 const canonical=(value,key='')=>{
  if(typeof value==='string'&&value&&(/Path$/.test(key)||['images','imagesPaths'].includes(key))){const file=path.resolve(value);if(!assets.has(file))assets.set(file,{sha256:streamHash(file,crypto.createHash('sha256')).digest('hex'),size:fs.statSync(file).size});return assets.get(file);}
  if(Array.isArray(value))return value.map(x=>canonical(x,key));
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k],k)]));
  return value;
 };
 return {legacyKey,contentHash:crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex')};
}
function summarizeNativeRunnerStderr(stderr) {
 const lines=String(stderr||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const line=lines.find(x=>/\b(?:Error|Exception|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOENT)\b/i.test(x)&&!/^at\s/.test(x));
 if(!line)return null;
 return line
  .replace(/(authorization|cookie|session(?:id)?|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,'$1=<redacted>')
  .replace(/\bBearer\s+\S+/gi,'Bearer <redacted>')
  .replace(/https?:\/\/[^\s)]+/gi,'<url>')
  .replace(/file:\/\/[^\s)]+/gi,'<file>')
  .replace(/\/Users\/[^\s)]+/g,'<path>')
  .replace(/\b1[3-9]\d{9}\b/g,'<phone>')
  .replace(/\b\d{8,}\b/g,'<id>')
  .replace(/示例作者/g,'<account-name>')
  .replace(/\s+/g,' ')
  .slice(0,240);
}
function nativeRunnerObservation(result) {
 if(!result||typeof result!=='object'||Array.isArray(result))return null;
 const observation={};
 for(const key of ['status','code','stage'])if(typeof result[key]==='string')observation[key]=result[key].slice(0,120);
 for(const key of ['readOnly','submitted','publicationPerformed','accountIdentityVerified','emptyEditor'])if(typeof result[key]==='boolean')observation[key]=result[key];
 if(Number.isFinite(result.remainingPublishQuota))observation.remainingPublishQuota=result.remainingPublishQuota;
 return Object.keys(observation).length?observation:null;
}
function nativeRunnerDiagnostic(r,{markerFound,markerParsed}) {
 return {
  reason:r?.timedOut===true?'RUNNER_TIMEOUT':r?.code!==0?'RUNNER_NONZERO_EXIT':!markerFound?'RESULT_MARKER_MISSING':'RESULT_MARKER_INVALID_JSON',
  exitCode:Number.isInteger(r?.code)?r.code:null,
  timedOut:r?.timedOut===true,
  markerFound:markerFound===true,
  markerParsed:markerParsed===true,
  stderrBytes:Buffer.byteLength(String(r?.stderr||'')),
  stderrSummary:summarizeNativeRunnerStderr(r?.stderr),
 };
}
export async function runNativeArticle(pkg,matrix,action,execute,{contractPath=ARTICLE_CONTRACTS,resumePreparation=null,nativeVisualReviewBasePath=null,zeroImageNoCoverEvidence=null}={}) {


 const sourceBody=pkg.body??(pkg.articlePath?fs.readFileSync(pkg.articlePath,'utf8'):'');
 const studioIntent=studioInlineIntent(pkg,pkg.schoolAccount.platform,sourceBody);
 const body=studioIntent?.body??sourceBody;
 const inlineImages=resolveInlineImages(pkg,pkg.schoolAccount.platform,body,studioIntent);
 const c=JSON.parse(fs.readFileSync(contractPath,'utf8')).platforms[pkg.schoolAccount.platform]?.nativeArticle;
 if(!c)throw Error('NATIVE_ARTICLE_CONTRACT_NOT_VERIFIED');
 const binding=resolveSchoolAccountBinding(pkg.schoolAccount,matrix);
 let visualReviewScreenshots=[],pendingVisualReviewBasePath=null;
 if(action==='publish'&&binding.platform==='sohu'&&inlineImages.length){
  if(resumePreparation?.priorReceipt?.stage==='visual-review'){
   if(nativeVisualReviewBasePath!==`${path.resolve(resumePreparation.receiptPath||'')}.native-visual-review`)throw Error('SOHU_NATIVE_VISUAL_REVIEW_PATH_MISMATCH');
   const priorPath=path.resolve(resumePreparation.receiptPath||''),raw=fs.readFileSync(priorPath,'utf8');
   const verified=validateSohuNativeVisualReview({pkg,matrix,statePath:priorPath,priorRaw:raw,priorReceipt:resumePreparation.priorReceipt,contractPath});
   if(resumePreparation.resumeExistingCount!==undefined&&resumePreparation.resumeExistingCount!==verified.resumeExistingCount)throw Error('SOHU_NATIVE_VISUAL_REVIEW_RESUME_COUNT_MISMATCH');
   resumePreparation={...resumePreparation,resumeExistingCount:verified.resumeExistingCount,visualReviewProofPath:verified.proofPath,baselineIds:verified.baselineIds,baselineIdsKnown:true};
  }else if(!resumePreparation){
   if(typeof nativeVisualReviewBasePath!=='string'||!path.isAbsolute(nativeVisualReviewBasePath))throw Error('SOHU_NATIVE_VISUAL_REVIEW_PATH_REQUIRED');
   const coverStat=fs.lstatSync(pkg.coverPath||'');
   if(!coverStat.isFile()||coverStat.isSymbolicLink())throw Error('SOHU_NATIVE_VISUAL_REVIEW_COVER_ASSET_INVALID');
   // De-dup and native account preflight must succeed before we create the
   // review directory. Otherwise a readback-only failure leaves an empty
   // directory that blocks a safe same-job continuation.
   pendingVisualReviewBasePath=path.resolve(nativeVisualReviewBasePath);
  }else if(resumePreparation.resumeExistingCount!==undefined&&resumePreparation.resumeExistingCount!==1){
   throw Error('EXISTING_INLINE_RECOVERY_NOT_VERIFIED');
  }
 }
 let baselineIds=[];
 if(resumePreparation?.baselineIdsKnown===true&&Array.isArray(resumePreparation.baselineIds))baselineIds=[...resumePreparation.baselineIds];
 if(resumePreparation){
  const prior=resumePreparation.priorReceipt,receiptPath=resumePreparation.receiptPath;
  if(resumePreparation.resumePendingInline===true&&!isKnownSohuUploadedCoverBlock(prior,prior?.contentHash))throw Error('PENDING_INLINE_RECOVERY_NOT_VERIFIED');
  if(resumePreparation.resumeExistingCount!==undefined&&!(prior?.stage==='visual-review'&&resumePreparation.visualReviewProofPath===`${path.resolve(receiptPath||'')}.native-visual-review.json`&&resumePreparation.resumeExistingCount===inlineImages.length)&&!(resumePreparation.resumeExistingCount===1&&isKnownSohuUploadedCoverBlock(prior,prior?.contentHash)))throw Error('EXISTING_INLINE_RECOVERY_NOT_VERIFIED');
  const eligible=action==='publish'&&binding.platform==='sohu'&&pkg.backend==='ego_article'&&prior&&prior.ok===false&&prior.status==='PREPARATION_BLOCKED'&&prior.stage==='content-preparation'&&(prior.code==='SOHU_COVER_GUIDE_NOT_VERIFIED'||(prior.code==='page.click timed out after 3000ms: Selector .upload-file.mp-upload matched 1 elements, but none can receive input; <span> intercepts pointer events'&&[3,4].includes(prior.history?.length)&&prior.history[0]?.code==='SOHU_COVER_GUIDE_NOT_VERIFIED'&&prior.history.every(r=>r.submitted===false&&r.contentHash===prior.contentHash))||(prior.code==='page.click timed out after 3000ms: Locator .upload-tip:text-is("上传图片") matched 1 elements, but none can receive input; <span> intercepts pointer events'&&prior.history?.length===2&&prior.history[0]?.code==='SOHU_COVER_GUIDE_NOT_VERIFIED'&&prior.history.every(r=>r.submitted===false&&r.contentHash===prior.contentHash))||(prior.code==='page.waitForFunction timed out after 10000ms on page p9; last URL was "https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=1"; last title was "搜狐号".'&&prior.history?.length===1&&prior.history[0]?.code==='SOHU_COVER_GUIDE_NOT_VERIFIED'&&prior.history[0]?.submitted===false&&prior.history[0]?.contentHash===prior.contentHash))&&prior.submitted===false&&prior.fingerprintVersion===2&&prior.platform==='sohu'&&prior.accountKey===binding.accountKey&&prior.accountName===binding.accountName&&prior.backend==='ego_article'&&prior.action==='publish'&&Array.isArray(prior.inlineImageReadback)&&prior.inlineImageReadback.length===0&&prior.publicReadbackVerified===false&&typeof prior.contentHash==='string'&&/^[a-f0-9]{64}$/.test(prior.contentHash);
  const toutiaoOptionsEligible=resumePreparation?.toutiaoOptionsResume===true&&isToutiaoOptionsResume({pkg,receipt:prior,binding,contentHash:prior?.contentHash,statePath:receiptPath,expectedPath:path.join(os.homedir(),'.maxiaojian-publish','jobs','toutiao','EXCLUDED_ROUTE_ACCOUNT','publish-v2-'+OPTIONS_HASH+'.json')});
  const toutiaoEligible=action==='publish'&&binding.platform==='toutiao'&&resumePreparation?.toutiaoDraftResume===true&&prior?.platform==='toutiao'&&prior?.accountKey===binding.accountKey&&prior?.accountName===binding.accountName&&prior?.action==='draft'&&prior?.status==='PREPARATION_BLOCKED'&&prior?.stage==='content-preparation'&&prior?.code==='page.click timed out after 3000ms: Selector .article-cover-add matched 1 elements, but none can receive input; <div> intercepts pointer events'&&prior?.submitted===false&&prior?.submitAttempted===false&&prior?.publicReadbackVerified===false&&prior?.backend==='ego_article'&&prior?.contentHash===resumePreparation.contentHash;
  const toutiaoNoCoverEligible=false;
  const visualReviewEligible=prior?.stage==='visual-review'&&prior?.code==='SOHU_NATIVE_INLINE_VISUAL_REVIEW_REQUIRED'&&resumePreparation.visualReviewProofPath===`${path.resolve(receiptPath||'')}.native-visual-review.json`&&resumePreparation.resumeExistingCount===inlineImages.length&&resumePreparation.baselineIdsKnown===true;
  if((!toutiaoNoCoverEligible&&!toutiaoOptionsEligible&&!toutiaoEligible&&!eligible&&!visualReviewEligible&&!isKnownSohuPreExecuteRejection(prior,prior?.contentHash)&&!isKnownSohuUploadedCoverBlock(prior,prior?.contentHash))||typeof receiptPath!=='string'||!path.isAbsolute(receiptPath))throw Error('PREPARED_STATE_RESUME_INELIGIBLE');
  const stat=fs.lstatSync(receiptPath);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(receiptPath)!==receiptPath)throw Error('PREPARED_STATE_RECEIPT_INVALID');
  const stored=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
  if(JSON.stringify(stored)!==JSON.stringify(prior))throw Error('PREPARED_STATE_RECEIPT_CHANGED');
 }else{
  const before=await runArticleManagement(pkg,matrix,execute,{contractPath});
  if(!before.ok)return before;
  if(action!=='check'&&['sohu','toutiao','baijiahao'].includes(binding.platform)&&before.contentListReadbackVerified!==true)return {ok:false,status:'BLOCKED',code:'ARTICLE_LIST_NOT_READY_FOR_DUPLICATE_CHECK',publicReadbackVerified:false};
  if(action!=='check'&&!before.articles.length&&!(['sohu','toutiao','baijiahao'].includes(binding.platform)&&before.contentListReadbackVerified===true))return {ok:false,status:'BLOCKED',code:'ARTICLE_LIST_NOT_READY_FOR_DUPLICATE_CHECK',publicReadbackVerified:false};
  if(action!=='check'&&before.articles.some(a=>a.title===pkg.title))return {ok:false,status:'BLOCKED',code:'EXISTING_ARTICLE_TITLE_REQUIRES_RECONCILIATION',publicReadbackVerified:false};
  baselineIds=before.articles.map(a=>a.contentId);
 }
 if(pendingVisualReviewBasePath){
  if(fs.existsSync(pendingVisualReviewBasePath))throw Error('SOHU_NATIVE_VISUAL_REVIEW_DIRECTORY_ALREADY_EXISTS');
  fs.mkdirSync(pendingVisualReviewBasePath,{mode:0o700});
  visualReviewScreenshots=expectedSohuVisualScreenshots(pkg,inlineImages,pendingVisualReviewBasePath).map(({sourcePath,...shot})=>shot);
 }
 const script=nativeArticleScript(pkg,binding,c,action,baselineIds,{resumePreparation,visualReviewScreenshots,zeroImageNoCoverEvidence});
 const r=await execute('ego-browser',['nodejs'],{input:script});
 const line=(r.stdout+'\n'+r.stderr).split(/\r?\n/).find(x=>x.startsWith('SCHOOL_NATIVE_ARTICLE:'));
 let result=null;
 if(line)try{result=JSON.parse(line.slice('SCHOOL_NATIVE_ARTICLE:'.length));}catch{}
 if(result?.code==='SOHU_NATIVE_INLINE_VISUAL_REVIEW_REQUIRED'&&result.prepared?.screenshots){
  try{
   result.prepared.screenshots=result.prepared.screenshots.map(shot=>{
    const evidence=regularFileBytes(shot.path);
    return {...shot,screenshotSha256:evidence.sha256,screenshotBytes:evidence.size,width:evidence.width,height:evidence.height};
   });
  }catch(error){result={...result,ok:false,status:'PREPARATION_BLOCKED',stage:'visual-review',code:error.message==='SOHU_NATIVE_VISUAL_REVIEW_SCREENSHOT_INVALID'?'SOHU_NATIVE_VISUAL_REVIEW_SCREENSHOT_INVALID':'SOHU_NATIVE_VISUAL_REVIEW_SCREENSHOT_CAPTURE_UNAVAILABLE',submitted:false,submitAttempted:false};}
 }
 if(r.code!==0||!result)return {
  ok:false,status:action==='check'?'READBACK_UNAVAILABLE':'SUBMISSION_UNCERTAIN',code:'NATIVE_ARTICLE_RESULT_UNAVAILABLE',
  publicReadbackVerified:false,runnerDiagnostic:nativeRunnerDiagnostic(r,{markerFound:!!line,markerParsed:!!result}),
  ...(result?{nativeObservation:nativeRunnerObservation(result)}:{}),
 };
 if(result.submitted&&result.candidates&&(!resumePreparation||resumePreparation.visualReviewProofPath||resumePreparation.toutiaoNoCoverResume===true&&resumePreparation.baselineIdsKnown===true)){
  const {articleId}=await import('./article-management-readback.mjs');
  const ids=result.candidates.map(x=>articleId(x.url,binding.platform)).filter(id=>id&&!result.baselineIds.includes(id));
  if(ids.length===1){result.platformContentId=ids[0];result.submissionReconciliation='UNIQUE_NEW_EXACT_TITLE_ID';}
  else result.submissionReconciliation='NEW_CONTENT_ID_NOT_UNIQUELY_RECONCILED';
 }else if(result.submitted&&result.candidates&&resumePreparation){result.submissionReconciliation='RESUME_REQUIRES_ORIGINAL_BASELINE_RECONCILIATION';}
 return result;
}
