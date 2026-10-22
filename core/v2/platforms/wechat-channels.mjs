const wechatBody = String(pkg.wechatDescription || "");
const wechatTags = Array.isArray(pkg.wechatTags) ? pkg.wechatTags.map(tag => String(tag || "").trim().replace(/^#+\s*/, "").trim()).filter(Boolean) : [];
function hasExactDeclaredWechatTopicSuffix(body,tags){
  if(!tags.length)return false;
  const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
  const actual=compact(body),suffix=compact(tags.map(tag=>`#${tag}`).join(' '));
  return actual===suffix||actual.endsWith(` ${suffix}`);
}
const wechatDescription = wechatTags.length&&!hasExactDeclaredWechatTopicSuffix(wechatBody,wechatTags)
  ? `${wechatBody}\n\n${wechatTags.map(tag => `#${tag}`).join(" ")}`
  : wechatBody;
const wechatShortTitle = String(pkg.platformTitle?.wechat_channels || pkg.wechatTitle || pkg.wechatChannelsTitle || pkg.title || "").trim();
const wechatCustomCover = pkg.cover?.uploadCustomCover === true;
const wechatCoverAssets = [
  {slot:'vertical',ratio:'3:4',path:String(pkg.cover?.vertical3x4Path||''),wrap:'.vertical-cover-wrap',image:'img.vertical-img-size',dialogTitle:'编辑个人主页卡片'},
  {slot:'horizontal',ratio:'4:3',path:String(pkg.cover?.horizontal4x3Path||''),wrap:'.horizon-cover-wrap',image:'img.horizon-img-size',dialogTitle:'编辑分享卡片'},
];

function readWechatNativeTopicNodes(editors, descriptionEditor, compact) {
  const editor = editors.length === 1 ? editors[0] : null;
  const nodes = editor ? [...editor.querySelectorAll('.hl.topic[data-type="topic"]')] : [];
  return {
    topicEditorCount: editors.length,
    topicEditorMatchesDescription: Boolean(editor && editor === descriptionEditor),
    topicSpans: nodes.map(node => ({
      text: compact(node.innerText || node.textContent || ""),
      dataType: node.getAttribute("data-type"),
      classes: String(node.className || "").split(/\s+/).filter(Boolean),
    })),
  };
}

function wechatNativeTopicsMatch(state) {
  const expected = wechatTags.map(tag => `#${tag}`);
  return state?.description === compactText(wechatDescription)
    && state?.topicEditorCount === 1
    && state?.topicEditorMatchesDescription === true
    && Array.isArray(state?.topicSpans)
    && state.topicSpans.length === expected.length
    && state.topicSpans.every((topic, index) => topic.dataType === "topic"
      && topic.classes.includes("hl")
      && topic.classes.includes("topic")
      && topic.text === expected[index]);
}

function wechatCoverRatioMatches(image, ratio) {
  const [width, height] = ratio.split(':').map(Number);
  return image?.width > 0 && image?.height > 0
    && Math.abs(image.width / image.height - width / height) < 0.01;
}

function wechatCoverPreviewMatches(preview, asset, selectedFile, previousKey) {
  return preview?.editorMatched === true && preview.image?.loaded === true
    && selectedFile?.name === path.basename(asset.path)
    && selectedFile?.size === fs.statSync(asset.path).size
    && Boolean(preview.image.sourceKey) && (preview.image.sourceKey !== previousKey || preview.pixelProof?.ok===true&&preview.pixelProof.sourcePixelsMatched===true&&preview.pixelProof.sourceSha256===selectedFile.sha256)
    && wechatCoverRatioMatches(preview.image, asset.ratio);
}

function wechatCoverReceiptMatches(asset, receipt, images) {
  return receipt?.assetPath === asset.path && receipt?.ratio === asset.ratio
    && receipt.selectedFile?.name === path.basename(asset.path)
    && receipt.selectedFile?.size === fs.statSync(asset.path).size
    && receipt.previewProof?.editorMatched === true
    && receipt.previewProof.image?.loaded === true
    && wechatCoverRatioMatches(receipt.previewProof.image, asset.ratio)
    && (images || []).some(image => image.url === receipt.afterUrl
      && wechatCoverRatioMatches(image, asset.ratio));
}

function wechatCoverEditorExpression(title, body) {
  return `((title)=>{
    const compact=v=>String(v||'').replace(/\\s+/g,' ').trim();
    const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0};
    const owned=(dialog,selector)=>[...dialog.querySelectorAll(selector)].filter(e=>e.closest('.weui-desktop-dialog__wrp')===dialog);
    const dialogs=roots.flatMap(r=>[...r.querySelectorAll('.weui-desktop-dialog__wrp')]).filter(visible);
    const heading=d=>compact(owned(d,'.weui-desktop-dialog__title')[0]?.textContent);
    const exact=dialogs.filter(d=>heading(d)===title);
    const candidates=exact.length?exact:dialogs.filter(d=>heading(d)==='编辑封面');
    const editor=candidates.length===1?candidates[0]:null;
    ${body}
  })(${JSON.stringify(title)})`;
}

async function probeWechatCoverEditor(asset) {
  return await js(wechatCoverEditorExpression(asset.dialogTitle, `
    if(!editor)return {editorMatched:false,reason:'cover editor is missing or ambiguous'};
    const image=owned(editor,'.single-cover-uploader-wrap img').find(visible);
    if(!image)return {editorMatched:true,image:null};
    const src=image.currentSrc||image.src||'';let hash=2166136261;
    for(let i=0;i<src.length;i++)hash=Math.imul(hash^src.charCodeAt(i),16777619);
    return {editorMatched:true,image:{width:image.naturalWidth,height:image.naturalHeight,loaded:image.complete&&image.naturalWidth>0,sourceKey:(hash>>>0).toString(16)}};
  `));
}

function compareWechatCoverPixels(native,source){
 if(!native?.length||native.length!==source?.length||native.length%4)return {sourcePixelsMatched:false,reason:'pixel_buffer_shape_mismatch'};
 let maxRgbError=0,maxAlphaError=0,totalRgbError=0,differentRgbChannels=0;
 for(let n=0;n<native.length;n++){const difference=Math.abs(native[n]-source[n]);if(n%4===3)maxAlphaError=Math.max(maxAlphaError,difference);else{maxRgbError=Math.max(maxRgbError,difference);totalRgbError+=difference;if(difference)differentRgbChannels++}}
 return {sourcePixelsMatched:maxRgbError<=1&&maxAlphaError===0,exactPixelsMatch:maxRgbError===0&&maxAlphaError===0,pixelCount:native.length/4,maxRgbError,maxAlphaError,meanRgbError:totalRgbError/(native.length/4*3),differentRgbChannels,roundingTolerancePerRgbChannel:1};
}
async function probeWechatCoverEditorPixels(asset,expectedKey,allowRounding=false){
  const bytes=fs.readFileSync(asset.path),sourceSha256=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
  return await js(wechatCoverEditorExpression(asset.dialogTitle, `
    return (async()=>{if(!editor)return {ok:false,reason:'unique_cover_editor_required'};
      const images=owned(editor,'.single-cover-uploader-wrap img').filter(visible);if(images.length!==1)return {ok:false,reason:'unique_cover_image_required'};const im=images[0],src=im.currentSrc||im.src||'';let key=2166136261;for(let i=0;i<src.length;i++)key=Math.imul(key^src.charCodeAt(i),16777619);const sourceKey=(key>>>0).toString(16);
      if(sourceKey!==${JSON.stringify(expectedKey)}||!im.complete||!im.naturalWidth)return {ok:false,reason:'cover_preview_identity_changed'};
      const bytes=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes]));
      try{if(bitmap.width!==im.naturalWidth||bitmap.height!==im.naturalHeight)return {ok:false,reason:'cover_source_dimensions_mismatch'};
        const pixelHash=async(image)=>{const canvas=document.createElement('canvas');canvas.width=im.naturalWidth;canvas.height=im.naturalHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;return {pixels,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))].map(x=>x.toString(16).padStart(2,'0')).join('')}};
        const native=await pixelHash(im),source=await pixelHash(bitmap),comparePixels=${compareWechatCoverPixels.toString()},comparison=comparePixels(native.pixels,source.pixels);
        if((im.currentSrc||im.src)!==src)return {ok:false,reason:'cover_preview_changed_during_pixel_read'};
        return {ok:comparison.exactPixelsMatch||${JSON.stringify(allowRounding)}&&comparison.sourcePixelsMatched,...comparison,width:bitmap.width,height:bitmap.height,sourceSha256:${JSON.stringify(sourceSha256)},sourceKey,nativePixelSha256:native.sha256,sourcePixelSha256:source.sha256};
      }catch{return {ok:false,reason:'cover_pixels_unreadable'}}finally{bitmap.close()}
    })();
  `));
}
async function confirmExistingWechatCover(asset){
  const contract=channelsBlobRecovery.coverPreviewConfirm;if(asset.slot!=='horizontal'||contract.assetPath!==asset.path)return {ok:false,reason:'exact_failed_horizontal_asset_required'};
  const selectedFile=contract.selectedFile,previewProof=await probeWechatCoverEditor(asset);
  if(!previewProof.editorMatched||!previewProof.image?.loaded||previewProof.image.sourceKey!==contract.previewProof.image.sourceKey||!wechatCoverRatioMatches(previewProof.image,asset.ratio))return {ok:false,reason:'original_loaded_horizontal_editor_changed'};
  const pixelProof=await probeWechatCoverEditorPixels(asset,previewProof.image.sourceKey,true);previewProof.pixelProof=pixelProof;
  if(!pixelProof.ok||pixelProof.sourceSha256!==selectedFile.sha256)return {ok:false,reason:'original_horizontal_full_pixels_not_source_matched',pixelProof};
  const before=(await inspectWechatChannels()).gates.cover.evidence.urlsBySlot.horizontal||[];
  const control=await js(wechatCoverEditorExpression(asset.dialogTitle, `
    const g=window.__VIDEO_PUBLISHER_FINAL_GUARD__;if(!g||g.armed!==true||g.releasedAt||g.blockedAttempts?.length)return {ok:false,reason:'original_guard_required'};
    if(dialogs.length!==1||!editor)return {ok:false,reason:'unique_original_cover_dialog_required'};
    const buttons=owned(editor,'button').filter(b=>compact(b.textContent)==='确认'&&visible(b)&&!b.disabled&&!/disabled/.test(String(b.className||'')));if(buttons.length!==1)return {ok:false,reason:'unique_enabled_cover_confirm_required'};return {ok:true};
  `));if(!control.ok)return control;
  const marker=channelsBlobRecovery.coverConfirmOncePath;
  try{fs.writeFileSync(marker,JSON.stringify({fingerprint:jobFingerprint,slot:asset.slot,sourceSha256:selectedFile.sha256,sourceKey:previewProof.image.sourceKey,pixelProof,coverConfirmAttemptedAt:new Date().toISOString()}),{flag:'wx',mode:0o600})}catch{return {ok:false,reason:'horizontal_cover_confirm_already_reserved'}};
  const confirmed=await js(wechatCoverEditorExpression(asset.dialogTitle, `
    const g=window.__VIDEO_PUBLISHER_FINAL_GUARD__;if(!g||g.armed!==true||g.releasedAt||g.blockedAttempts?.length||dialogs.length!==1||!editor)return {ok:false,reason:'original_cover_guard_or_dialog_changed'};
    const image=owned(editor,'.single-cover-uploader-wrap img').filter(visible);if(image.length!==1)return {ok:false,reason:'cover_image_changed'};const src=image[0].currentSrc||image[0].src||'';let hash=2166136261;for(let i=0;i<src.length;i++)hash=Math.imul(hash^src.charCodeAt(i),16777619);if((hash>>>0).toString(16)!==${JSON.stringify(previewProof.image.sourceKey)})return {ok:false,reason:'cover_source_changed_before_confirm'};
    const buttons=owned(editor,'button').filter(b=>compact(b.textContent)==='确认'&&visible(b)&&!b.disabled&&!/disabled/.test(String(b.className||'')));if(buttons.length!==1)return {ok:false,reason:'cover_confirm_changed'};buttons[0].click();return {ok:true};
  `));if(!confirmed.ok)return confirmed;
  for(let n=0;n<30;n++){await activateWechatLifecycle();const state=await inspectWechatChannels(),acceptedImage=state.gates.cover.evidence.imagesBySlot.horizontal?.find(im=>!before.includes(im.url)&&wechatCoverRatioMatches(im,asset.ratio));if(acceptedImage&&state.gates.noBlockingDialog.ok)return {ok:true,receipt:{assetPath:asset.path,ratio:asset.ratio,beforeUrls:before,afterUrl:acceptedImage.url,selectedFile,previewProof,acceptedImage,mode:'confirmed_existing_source_pixels',confirmOncePath:marker}};await wait(1)}
  return {ok:false,reason:'horizontal_cover_confirm_attempted_but_acceptance_unverified',noAutomaticRetry:true};
}

let verifiedChannelsBlobProof=null;
async function probeExistingWechatBlob(){
 return await js(String.raw`(async(expected)=>{
  const fail=reason=>({ok:false,reason});const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];const all=[...new Set(roots.flatMap(r=>[...r.querySelectorAll('*')]))];const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};
  if(location.origin!=='https://channels.weixin.qq.com'||location.pathname!=='/platform/post/create')return fail('original_create_page_required');
  const names=[...new Set(roots.flatMap(r=>[...r.querySelectorAll('.full-screen-body .operate-bar .left-area .name')]))].filter(visible);if(names.length!==1||names[0].innerText.trim()!==expected.accountName)return fail('unique_native_account_preview_required');
  const videos=all.filter(e=>e.tagName==='VIDEO');const visibleReady=videos.filter(e=>visible(e)&&e.readyState>=3&&e.videoWidth>0&&e.videoHeight>0);const primaries=expected.strictDuplicateVideoIdentity===true?visibleReady.filter(e=>e.id==='fullScreenVideo'):visibleReady;if(primaries.length!==1)return fail(expected.strictDuplicateVideoIdentity===true?'unique_visible_full_screen_video_required':'unique_visible_ready_video_required');const v=primaries[0],src=v.currentSrc||v.src;if(!src.startsWith('blob:'))return fail('existing_local_blob_required');
  const blobVideos=expected.strictDuplicateVideoIdentity===true?videos.filter(e=>String(e.currentSrc||e.src||'').startsWith('blob:')):[v];const blobSources=[...new Set(blobVideos.map(e=>e.currentSrc||e.src))];if(blobVideos.length<1||blobSources.length!==1||blobSources[0]!==src)return fail('unique_original_blob_source_required');
  if(expected.strictDuplicateVideoIdentity===true&&blobVideos.some(e=>e.readyState<3||!Number.isFinite(e.duration)||e.duration<=0||Math.abs(e.duration-v.duration)>0.1))return fail('duplicate_blob_source_video_not_ready_or_inconsistent');
  if(v.readyState<3||!Number.isFinite(v.duration)||v.duration<=0||!v.videoWidth||!v.videoHeight)return fail('visible_primary_video_not_ready');
  const g=window.__VIDEO_PUBLISHER_FINAL_GUARD__;if(!g||g.armed!==true||g.releasedAt||!Array.isArray(g.blockedAttempts)||g.blockedAttempts.length)return fail('original_final_guard_required');
  const labels=all.filter(e=>visible(e)&&!e.children.length&&/上传中|正在上传|正在处理文件|处理中|生成中|剩余时间|上传进度|取消上传|^\d{1,3}%$/.test((e.innerText||'').trim()));if(labels.length)return fail('upload_still_active');
  const covers=all.filter(e=>e.tagName==='IMG'&&visible(e)&&/vertical-img-size|horizon-img-size/.test(String(e.className||'')));if(covers.length!==2||covers.some(e=>!e.complete||!e.naturalWidth||!e.naturalHeight))return fail('both_native_cover_previews_required');
  const coverUrls=covers.map(e=>e.currentSrc||e.src||'');if(expected.strictDuplicateVideoIdentity===true&&coverUrls.some(url=>!url))return fail('native_cover_preview_source_missing');
  let bytes;try{const res=await fetch(src);bytes=await res.arrayBuffer()}catch{return fail('existing_blob_unreadable')}
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(bytes.byteLength!==expected.size||digest!==expected.sha256)return fail('source_blob_bytes_mismatch');
  const latestVideos=all.filter(e=>e.tagName==='VIDEO'),latestPrimary=expected.strictDuplicateVideoIdentity===true?latestVideos.filter(e=>e.id==='fullScreenVideo'&&visible(e)&&e.readyState>=3&&e.videoWidth>0&&e.videoHeight>0):latestVideos.filter(e=>visible(e)&&e.readyState>=3&&e.videoWidth>0&&e.videoHeight>0),latestBlobVideos=expected.strictDuplicateVideoIdentity===true?latestVideos.filter(e=>String(e.currentSrc||e.src||'').startsWith('blob:')):latestPrimary,latestSources=[...new Set(latestBlobVideos.map(e=>e.currentSrc||e.src))];
  if(latestSources.length!==1||latestSources[0]!==src||latestBlobVideos.length!==blobVideos.length||latestPrimary.length!==1||(latestPrimary[0].currentSrc||latestPrimary[0].src)!==src||covers.some((e,i)=>(e.currentSrc||e.src||'')!==coverUrls[i])||window.__VIDEO_PUBLISHER_FINAL_GUARD__!==g||g.armed!==true||g.releasedAt||g.blockedAttempts.length)return fail('original_page_changed');
  return{ok:true,mode:'recovered_original_blob',...(expected.strictDuplicateVideoIdentity===true?{recoveryMode:'ready_source_proof'}:{}),sha256:digest,size:bytes.byteLength,duration:v.duration,width:v.videoWidth,height:v.videoHeight,source:'existing_visible_local_blob',guardArmed:true,blockedAttempts:0,serverContentIdKnown:false,videoElementCount:videos.length,blobVideoElementCount:blobVideos.length,uniqueBlobSourceCount:blobSources.length,visiblePrimaryId:v.id,observedAt:new Date().toISOString()};
 })(${JSON.stringify({accountName:pkg.schoolAccount?.accountName,size:channelsBlobRecovery?.video?.size,sha256:channelsBlobRecovery?.video?.sha256,strictDuplicateVideoIdentity:['ready_source_proof','ready_source_proof_safety_retry'].includes(channelsBlobRecovery?.recoveryMode)})})`);
}

async function inspectWechatChannels() {
  const uploadStartReceipt=expectedReceipts.uploadStart||null;
  const trustedVideoReceipt=Boolean(
    (expectedVideoReceipt?.fingerprint===jobFingerprint
      && Number(expectedVideoReceipt?.taskSpaceId)===Number(activeTaskSpace?.id)
      && ['injected','resume_existing','recovered_original_blob'].includes(expectedVideoReceipt?.mode))
    || (uploadStartReceipt?.fingerprint===jobFingerprint
      && Number(uploadStartReceipt?.taskSpaceId)===Number(activeTaskSpace?.id)
      && ['injected','resume_existing'].includes(uploadStartReceipt?.mode))
  );
  const state=await js(String.raw`((expectedDescription, trustedVideoReceipt) => {
    const compact=v=>String(v||'').replace(/\s+/g,' ').trim();const roots=[document,...[...document.querySelectorAll('*')].map(el=>el.shadowRoot).filter(Boolean)];const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};const text=compact(roots.map(root=>root.body?.innerText||root.host?.innerText||'').join('\n'));
    const descEditors=roots.flatMap(root=>[...root.querySelectorAll('[contenteditable="true"],[contenteditable=""],textarea')]).filter(visible).filter(el=>/input-editor|视频描述|editor/i.test(String(el.className||''))&&!/chatInput/.test(String(el.className||'')));
    const description=compact(descEditors[0]?.innerText||descEditors[0]?.value||descEditors[0]?.textContent||'');
    const topicEditors=roots.flatMap(root=>[...root.querySelectorAll('.input-editor')]).filter(visible);
    const nativeTopics=(${readWechatNativeTopicNodes.toString()})(topicEditors,descEditors[0],compact);
    const shortInputs=roots.flatMap(root=>[...root.querySelectorAll('input')]).filter(el=>(el.placeholder||'').includes('短标题')).filter(visible);const shortInput=shortInputs.length===1?shortInputs[0]:null;const shortTitle=String(shortInput?.value||'').trim();
    const initToast=/页面初始化中/.test(text);const coverCards=/封面预览/.test(text)&&/个人主页卡片|分享卡片/.test(text);const uploading=/上传中|正在上传|正在处理文件|处理中|生成中|剩余时间|上传进度|取消上传|(?:^|\s)\d{1,3}%(?:\s|$)/.test(text);const uploaded=coverCards&&!uploading;const failed=/上传失败|网络错误|文件格式不支持/.test(text);
    const loginRequired=/扫码登录|请登录|登录后|安全验证|验证码/.test(text)&&!/视频管理|发表动态/.test(text);const identityMatches=!uploaded||description===compact(expectedDescription)||trustedVideoReceipt;const identityAmbiguous=uploaded&&!description&&!trustedVideoReceipt;const identityForeign=uploaded&&!identityMatches&&!identityAmbiguous;
    const originalInput=roots.flatMap(root=>[...root.querySelectorAll('.declare-original-checkbox input[type="checkbox"],.form-item.post-with-link input.ant-checkbox-input')]).find(visible);const originalEnabled=Boolean(originalInput?.checked||/checked|active/.test(String(originalInput?.closest('.ant-checkbox')?.className||'')));
    const coverImagesBySlot={vertical:roots.flatMap(root=>[...root.querySelectorAll('.vertical-cover-wrap img.vertical-img-size')]).filter(visible).map(el=>({url:el.currentSrc||el.src||'',width:el.naturalWidth,height:el.naturalHeight})),horizontal:roots.flatMap(root=>[...root.querySelectorAll('.horizon-cover-wrap img.horizon-img-size')]).filter(visible).map(el=>({url:el.currentSrc||el.src||'',width:el.naturalWidth,height:el.naturalHeight}))};
    const coverUrlsBySlot={vertical:coverImagesBySlot.vertical.map(el=>el.url).filter(Boolean),horizontal:coverImagesBySlot.horizontal.map(el=>el.url).filter(Boolean)};const coverUrls=[...new Set([...coverUrlsBySlot.vertical,...coverUrlsBySlot.horizontal])];
    const unifiedCover=roots.flatMap(root=>[...root.querySelectorAll('.vertical-cover-wrap .cover-tips')]).some(el=>/个人主页和分享卡片\s*\(3:4\)/.test(compact(el.innerText||el.textContent||'')))&&!roots.some(root=>root.querySelector('.horizon-cover-wrap'));
    const dialogs=roots.flatMap(root=>[...root.querySelectorAll('[role="dialog"],[class*="modal"],.weui-desktop-dialog__wrp,[class*="dialog-mask"]')]).map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {text:compact(el.innerText||el.textContent||'').slice(0,500),cls:String(el.className||''),w:r.width,h:r.height,display:s.display,visibility:s.visibility,opacity:s.opacity}}).filter(item=>item.w>20&&item.h>20&&item.display!=='none'&&item.visibility!=='hidden'&&!/popover/i.test(item.cls)&&!(/leave-active/.test(item.cls)&&Number(item.opacity)===0));
    const videoInputs=roots.flatMap(root=>[...root.querySelectorAll('input[type=file]')]).filter(el=>/video/.test(el.accept||'')).map(el=>({accept:el.accept,files:el.files?.length||0}));
    const earlyMutation={ready:Boolean(visible(descEditors[0])&&visible(shortInput)),uploading,uploaded,controls:{description:visible(descEditors[0]),shortTitle:visible(shortInput)}};
    return {text:text.slice(0,3000),description,...nativeTopics,shortTitle,shortTitleInputCount:shortInputs.length,initToast,uploaded,uploading,failed,loginRequired,identityMatches,identityAmbiguous,identityForeign,trustedVideoReceipt,originalEnabled,originalFound:Boolean(originalInput),coverUrls,coverUrlsBySlot,coverImagesBySlot,unifiedCover,dialogs,videoInputs,rootCount:roots.length,earlyMutation}
  })(${JSON.stringify(wechatDescription)}, ${JSON.stringify(trustedVideoReceipt)})`);
  const buttons=await inspectFinalButtons(/^发表$/);const finalButton=buttons.find(button=>button.buttonish)||buttons[0]||null;const receipt=expectedReceipts.cover||null;
  const requiredCoverAssets=state.unifiedCover?wechatCoverAssets.filter(asset=>asset.slot==='vertical'):wechatCoverAssets;
  const customCoverOk=Boolean(wechatCustomCover&&receipt?.slots&&requiredCoverAssets.every(asset=>wechatCoverReceiptMatches(asset,receipt.slots[asset.slot],state.coverImagesBySlot[asset.slot])));const defaultCoverOk=!wechatCustomCover&&state.uploaded;
  return {gates:{
    authenticated:state.loginRequired?failedGate({loginRequired:true}):okGate({url:PLATFORM_URLS.wechat_channels}),
    draftIdentity:state.identityMatches?okGate({description:state.description,trustedVideoReceipt:state.trustedVideoReceipt}):failedGate({foreign:state.identityForeign,ambiguous:state.identityAmbiguous,description:state.description,expected:wechatDescription}),
    video:(verifiedChannelsBlobProof?.ok===true||state.uploaded&&!state.uploading&&!state.failed)?okGate({stable:true,coverCards:true}):failedGate({uploaded:state.uploaded,uploading:state.uploading,failed:state.failed,initToast:state.initToast,videoInputs:state.videoInputs}),
    description:state.description===compactText(wechatDescription)?okGate({expected:wechatDescription,actual:state.description}):failedGate({expected:wechatDescription,actual:state.description}),
    topics:wechatNativeTopicsMatch(state)?okGate({expected:wechatTags,nativeTopicSpans:state.topicSpans,description:state.description}):failedGate({expected:wechatTags.map(tag=>`#${tag}`),nativeTopicSpans:state.topicSpans||[],topicEditorCount:state.topicEditorCount,topicEditorMatchesDescription:state.topicEditorMatchesDescription,description:state.description,expectedDescription:wechatDescription,reason:state.description!==compactText(wechatDescription)?'description_mismatch':'native_topics_not_committed'}),
    shortTitle:state.shortTitleInputCount===1&&state.shortTitle===wechatShortTitle?okGate({expected:wechatShortTitle,actual:state.shortTitle}):failedGate({expected:wechatShortTitle,actual:state.shortTitle}),
    original:!state.originalEnabled
      ?okGate({choice:'none',enabled:false,found:state.originalFound})
      :failedGate({choice:'none',enabled:true,found:state.originalFound,unexpectedSelection:true}),
    cover:customCoverOk||defaultCoverOk?okGate({custom:wechatCustomCover,unified:state.unifiedCover,urls:state.coverUrls,urlsBySlot:state.coverUrlsBySlot,imagesBySlot:state.coverImagesBySlot,receipt}):failedGate({custom:wechatCustomCover,unified:state.unifiedCover,urls:state.coverUrls,urlsBySlot:state.coverUrlsBySlot,imagesBySlot:state.coverImagesBySlot,receipt,reason:wechatCustomCover&&!receipt?'custom cover receipt missing':'cover not verified'}),
    noBlockingDialog:state.dialogs.length===0?okGate({active:[]}):failedGate({active:state.dialogs}),
    finalButton:finalButton&&!finalButton.disabled?okGate(finalButton):failedGate({buttons}),
  },evidence:{pageSample:state.text,initToast:state.initToast,rootCount:state.rootCount,earlyMutation:state.earlyMutation}};
}

async function getWechatUploadProbe(){return await js(String.raw`(() => {const compact=v=>String(v||'').replace(/\s+/g,' ').trim();const roots=[document,...[...document.querySelectorAll('*')].map(el=>el.shadowRoot).filter(Boolean)];const text=compact(roots.map(root=>root.body?.innerText||root.host?.innerText||'').join('\n'));const input=roots.flatMap(root=>[...root.querySelectorAll('input[type=file]')]).find(el=>/video/.test(el.accept||''));const uploading=/上传中|正在上传|正在处理文件|处理中|生成中|剩余时间|上传进度|取消上传|(?:^|\s)\d{1,3}%(?:\s|$)/.test(text);const coverCards=/封面预览/.test(text)&&/个人主页卡片|分享卡片/.test(text);return {initToast:/页面初始化中/.test(text),hasInput:Boolean(input),uploading,uploaded:coverCards&&!uploading,sample:text.slice(0,1000)}})()`)}

async function activateWechatLifecycle(){await cdp('Page.bringToFront',{}).catch(()=>null);await cdp('Page.setWebLifecycleState',{state:'active'}).catch(()=>null);await cdp('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>null)}

async function waitWechatSdkReady(seconds){for(let i=0;i<seconds;i+=2){await activateWechatLifecycle();const probe=await getWechatUploadProbe();if(probe.uploaded||(!probe.initToast&&probe.hasInput))return {ok:true,probe};await wait(2)}return {ok:false,probe:await getWechatUploadProbe()}}

async function injectWechatVideo(){const evaluated=await cdp('Runtime.evaluate',{expression:String.raw`(() => {const roots=[document,...[...document.querySelectorAll('*')].map(el=>el.shadowRoot).filter(Boolean)];return roots.flatMap(root=>[...root.querySelectorAll('input[type=file]')]).find(el=>/video/.test(el.accept||''))})()`,objectGroup:'video-publisher-v2-wechat',includeCommandLineAPI:true});const objectId=evaluated?.result?.objectId;if(!objectId)return {ok:false,reason:'wechat video input objectId missing'};await cdp('DOM.setFileInputFiles',{objectId,files:[videoPath]});return {ok:true,objectId}}

async function waitWechatUploadCompletion(){let stableSince=0;for(let i=0;i<180;i+=1){await activateWechatLifecycle();const current=await inspectWechatChannels();if(current.gates.video.ok){if(!stableSince)stableSince=Date.now();if(Date.now()-stableSince>=10000)return current}else stableSince=0;await wait(5)}const after=await inspectWechatChannels();return {...after,blocker:typedBlocker('UPLOAD_STALLED','视频号上传没有在等待窗口内稳定完成',{retryable:true,evidence:after.gates.video.evidence})}}

function trustedWechatUploadStartReceipt(){
  const receipt=expectedReceipts.uploadStart||null;
  return receipt?.fingerprint===jobFingerprint
    && Number(receipt?.taskSpaceId)===Number(activeTaskSpace?.id)
    && ['injected','resume_existing'].includes(receipt?.mode)
    ? receipt
    : null;
}

function createWechatUploadStartReceipt(mode){
  if(!jobFingerprint||activeTaskSpace?.id==null)return null;
  return {fingerprint:jobFingerprint,taskSpaceId:activeTaskSpace.id,mode,observedAt:new Date().toISOString()};
}

function completeWechatUploadStartObservation(current,mode,stage,receipt,fallbackDispatched=false){
  if(receipt)expectedReceipts.uploadStart=receipt;
  current.gates.draftIdentity=okGate({trustedUploadAction:true,mode,uploadStartReceipt:Boolean(receipt)});
  const receipts=receipt?{uploadStart:receipt}:{};
  const actions={upload:{mode,stage,earlyMutationReady:true,fallbackDispatched}};
  if(receipt)actions.receiptCheckpoint=checkpointReceipts(receipts);
  return {...current,actions,receipts};
}

async function dispatchWechatUploadChange(){
  return await js(String.raw`(() => {const roots=[document,...[...document.querySelectorAll('*')].map(el=>el.shadowRoot).filter(Boolean)];const input=roots.flatMap(root=>[...root.querySelectorAll('input[type=file]')]).find(el=>/video/.test(el.accept||''));if(input)input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));return {files:input?.files?.length||0}})()`);
}

async function waitWechatEarlyMutationReady(mode,receipt,allowFallback=false){
  if(receipt)expectedReceipts.uploadStart=receipt;
  let fallbackDispatched=false;
  for(let attempt=1;attempt<=30;attempt+=1){
    await activateWechatLifecycle();
    const current=await inspectWechatChannels();
    if(!current.gates.authenticated.ok)return {...current,blocker:typedBlocker('AUTH_REQUIRED','视频号登录状态失效',{requiresUser:true,evidence:current.gates.authenticated.evidence})};
    if(current.gates.video.ok)return completeWechatUploadStartObservation(current,mode,'complete',receipt,fallbackDispatched);
    if(current.gates.video.evidence?.failed===true)return {...current,blocker:typedBlocker('UPLOAD_NOT_STARTED','视频号上传失败',{retryable:true,evidence:current.gates.video.evidence})};
    if(current.gates.video.evidence?.uploading===true&&current.evidence?.earlyMutation?.ready===true){
      return completeWechatUploadStartObservation(current,mode,'editable_uploading',receipt,fallbackDispatched);
    }
    if(allowFallback&&attempt===4&&!fallbackDispatched){
      await dispatchWechatUploadChange();
      fallbackDispatched=true;
    }
    await wait(1);
  }
  const after=await inspectWechatChannels();
  return {...after,blocker:typedBlocker('UPLOAD_NOT_STARTED','视频号上传启动后描述与短标题控件未及时进入可编辑状态',{retryable:true,evidence:after.evidence?.earlyMutation})};
}

async function startWechatChannelsUpload(){
  if(typeof channelsBlobRecovery!=='undefined'&&channelsBlobRecovery)return {...(await inspectWechatChannels()),blocker:typedBlocker('CHANNELS_BLOB_NEVER_REINJECT','Existing media recovery forbids upload/navigation')};
  const before=await inspectWechatChannels();
  if(!before.gates.draftIdentity.ok){
    const ambiguous=before.gates.draftIdentity.evidence?.ambiguous===true;
    return {...before,blocker:typedBlocker(ambiguous?'STATE_AMBIGUOUS':'FOREIGN_DRAFT',ambiguous?'视频号存在描述为空且来源无法证明的已上传草稿':'视频号当前编辑器属于其他视频草稿',{evidence:before.gates.draftIdentity.evidence})};
  }
  const existingReceipt=trustedWechatUploadStartReceipt();
  if(before.gates.video.ok){
    const mode=existingReceipt?.mode||'already_ready';
    return completeWechatUploadStartObservation(before,mode,'complete',existingReceipt,false);
  }
  if(before.gates.video.evidence?.uploading){
    const receipt=existingReceipt||createWechatUploadStartReceipt('resume_existing');
    return await waitWechatEarlyMutationReady('resume_existing',receipt,false);
  }
  let ready=await waitWechatSdkReady(30);
  if(!ready.ok){
    await gotoAndWait(PLATFORM_URLS.wechat_channels,{timeout:45,settle:2});
    const guard=await armFinalPublishGuard();
    if(!guard.ok||!guard.armed){
      const after=await inspectWechatChannels();
      return {...after,blocker:typedBlocker('INPUT_CHANNEL_BROKEN','视频号导航后无法重新挂载最终发布保护',{retryable:true,evidence:guard})};
    }
    ready=await waitWechatSdkReady(90);
  }
  if(!ready.ok){
    const after=await inspectWechatChannels();
    return {...after,blocker:typedBlocker('RISK_CONTROL','视频号 Wujie 上传 SDK 没有在激活页面生命周期后完成初始化',{retryable:true,evidence:ready.probe})};
  }
  const injected=await injectWechatVideo();
  if(!injected.ok)return {...before,blocker:typedBlocker('UPLOAD_NOT_STARTED',injected.reason,{retryable:true})};
  const receipt=createWechatUploadStartReceipt('injected');
  return await waitWechatEarlyMutationReady('injected',receipt,true);
}

async function uploadWechatChannels(){
  const started=await startWechatChannelsUpload();
  if(started.blocker)return started;
  const mode=started.actions?.upload?.mode||'already_ready';
  if(started.gates.video.ok)return {...started,actions:{...started.actions,upload:{mode}}};
  const current=await waitWechatUploadCompletion();
  if(current.gates.video.ok)current.gates.draftIdentity=okGate({trustedUploadAction:true,mode});
  return {...current,actions:{upload:{mode}},receipts:started.receipts||{}};
}

async function setWechatDescription(){return await js(String.raw`((value) => {const compact=v=>String(v||'').replace(/\s+/g,' ').trim();const roots=[document,...[...document.querySelectorAll('*')].map(el=>el.shadowRoot).filter(Boolean)];const editor=roots.flatMap(root=>[...root.querySelectorAll('[contenteditable="true"],[contenteditable=""]')]).find(el=>/input-editor|视频描述|editor/i.test(String(el.className||''))&&!/chatInput/.test(String(el.className||'')));if(!editor)return {ok:false,reason:'wechat description editor missing'};editor.focus();const sel=window.getSelection(),range=document.createRange();range.selectNodeContents(editor);sel.removeAllRanges();sel.addRange(range);document.execCommand('delete',false);document.execCommand('insertText',false,value);editor.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:value}));editor.dispatchEvent(new Event('change',{bubbles:true,composed:true}));return {ok:compact(editor.innerText||editor.textContent||'')===compact(value),actual:editor.innerText||editor.textContent||''}})(${JSON.stringify(wechatDescription)})`)}

async function setWechatShortTitle(){return await js(String.raw`((value) => {
 const roots=[document,...[...document.querySelectorAll('*')].map(el=>el.shadowRoot).filter(Boolean)];
 const inputs=roots.flatMap(root=>[...root.querySelectorAll('input')]).filter(el=>(el.placeholder||'').includes('短标题')).filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'});
 if(inputs.length!==1)return {ok:false,reason:'wechat short-title input missing or ambiguous'};
 const input=inputs[0],max=input.maxLength;
 if(max>=0&&value.length>max)return {ok:false,reason:'wechat short-title exceeds native maxLength',maxLength:max};
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
 if(!setter)return {ok:false,reason:'wechat short-title native setter missing'};
 input.focus();setter.call(input,value);input.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:value}));input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));input.blur();
 return {ok:input.value===value,expected:value,actual:input.value};
})(${JSON.stringify(wechatShortTitle)})`)}

async function dismissWechatCoverEditor(){
  const dismissed=await js(String.raw`(() => {const compact=v=>String(v||'').replace(/\s+/g,' ').trim();const roots=[document,...[...document.querySelectorAll('*')].map(el=>el.shadowRoot).filter(Boolean)];const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>20&&r.height>20&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0};const coverDialog=el=>{const text=compact(el.innerText||el.textContent||'');return /编辑个人主页卡片|编辑分享卡片|编辑封面|裁剪封面图/.test(text)&&/上传封面|从视频中选择封面|裁剪封面图/.test(text)};const dialog=roots.flatMap(root=>[...root.querySelectorAll('.weui-desktop-dialog__wrp')]).find(el=>visible(el)&&coverDialog(el));if(!dialog)return {ok:true,dismissed:false};const button=[...dialog.querySelectorAll('button,[role="button"]')].find(el=>compact(el.innerText||el.textContent||'')==='取消'&&visible(el))||[...dialog.querySelectorAll('.weui-desktop-dialog__close-btn')].find(el=>el.getBoundingClientRect().width>0);if(!button)return {ok:false,reason:'wechat cover recovery button missing'};button.click();return {ok:true,dismissed:true}})()`);
  if(!dismissed.ok)return dismissed;
  for(let i=0;i<12;i+=1){await activateWechatLifecycle();const active=await js(String.raw`(() => {const compact=v=>String(v||'').replace(/\s+/g,' ').trim();const roots=[document,...[...document.querySelectorAll('*')].map(el=>el.shadowRoot).filter(Boolean)];return roots.flatMap(root=>[...root.querySelectorAll('.weui-desktop-dialog__wrp')]).some(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),text=compact(el.innerText||el.textContent||'');return r.width>20&&r.height>20&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0&&/编辑个人主页卡片|编辑分享卡片|编辑封面|裁剪封面图/.test(text)&&/上传封面|从视频中选择封面|裁剪封面图/.test(text)})})()`);if(!active)return dismissed;await wait(1)}
  return {ok:false,reason:'wechat cover editor recovery did not close'};
}

// Capture at window capture phase, before an SDK can clear the native input in its change handler.
// This retains only this exact input's File temporarily; never substitutes a preview URL for source bytes.
async function armWechatCoverFileCapture(objectId){
  const r=await cdp('Runtime.callFunctionOn',{objectId,returnByValue:true,functionDeclaration:`function(){
    const key='__MAXIAOJIAN_COVER_FILE_CAPTURE__';if(this[key])return {ok:false,reason:'cover file capture already armed'};
    if(!this.isConnected||this.type!=='file')return {ok:false,reason:'connected native file input required'};
    const input=this,win=this.ownerDocument.defaultView,record={file:null,event:null,count:0};
    const listener=e=>{if(e.target!==input)return;const files=input.files;if(files?.length===1){record.file=files[0];record.event=e.type;record.count++}};
    record.cleanup=()=>{win.removeEventListener('input',listener,true);win.removeEventListener('change',listener,true);delete input[key]};
    Object.defineProperty(input,key,{value:record,configurable:true});win.addEventListener('input',listener,true);win.addEventListener('change',listener,true);
    return {ok:true};
  }`});return r?.result?.value||{ok:false,reason:'native file capture could not be armed'};
}
async function readWechatCoverFileCapture(objectId){
  const r=await cdp('Runtime.callFunctionOn',{objectId,awaitPromise:true,returnByValue:true,functionDeclaration:`async function(){
    const record=this.__MAXIAOJIAN_COVER_FILE_CAPTURE__;if(!record)return null;
    try{const f=record.file||(this.files?.length===1?this.files[0]:null);if(!f)return null;
      const bytes=await f.arrayBuffer();const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      return {name:f.name,size:f.size,type:f.type,sha256:digest,byteLength:bytes.byteLength,capturedBy:record.file?'native_'+record.event+'_capture':'native_current_file',eventCount:record.count};
    }finally{record.cleanup()}
  }`});return r?.result?.value||null;
}
async function cleanupWechatCoverFileCapture(objectId){
  await cdp('Runtime.callFunctionOn',{objectId,returnByValue:true,functionDeclaration:'function(){this.__MAXIAOJIAN_COVER_FILE_CAPTURE__?.cleanup();return true}'});
}
function wechatCoverSelectedFileMatches(selectedFile,expected){
  return selectedFile?.name===expected.name&&selectedFile.size===expected.size&&selectedFile.byteLength===expected.size&&selectedFile.sha256===expected.sha256;
}

async function uploadWechatCover(asset){
  if(!wechatCustomCover)return {ok:true,skipped:true};
  await activateWechatLifecycle();
  const before=(await inspectWechatChannels()).gates.cover.evidence?.urlsBySlot?.[asset.slot]||[];
  const opened=await js(String.raw`((selector) => {
    const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};
    const direct=roots.flatMap(r=>[...r.querySelectorAll('.btn-directly-edit button')]).filter(visible);
    if(direct.length===1){direct[0].click();return {ok:true,materialPopover:true}};
    const entries=roots.flatMap(r=>[...r.querySelectorAll(selector+' .edit-btn')]).filter(visible);
    if(entries.length!==1)return {ok:false,reason:'wechat cover edit entry missing or ambiguous'};
    entries[0].click();return {ok:true};
  })(${JSON.stringify(asset.wrap)})`);
  if(!opened.ok)return opened;
  let evaluated=null;
  for(let i=0;i<20;i+=1){
    await activateWechatLifecycle();
    const editor=await probeWechatCoverEditor(asset);
    if(!editor.editorMatched){
      await js(String.raw`(()=>{const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];const buttons=roots.flatMap(r=>[...r.querySelectorAll('.btn-directly-edit button')]).filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'});if(buttons.length===1){buttons[0].click();return true}return false})()`);
    }else{
      evaluated=await cdp('Runtime.evaluate',{expression:wechatCoverEditorExpression(asset.dialogTitle, `if(!editor)return null;const inputs=owned(editor,'input[type=file]').filter(e=>/image|png|jpe?g/i.test(e.accept||''));return inputs.length===1?inputs[0]:null;`),objectGroup:'video-publisher-v2-wechat-cover',includeCommandLineAPI:true});
      if(evaluated?.result?.objectId)break;
    }
    await wait(0.5);
  }
  const objectId=evaluated?.result?.objectId;
  if(!objectId)return {ok:false,reason:'wechat cover image input objectId missing'};
  const previousPreview=await probeWechatCoverEditor(asset);
  const sourceBytes=fs.readFileSync(asset.path),sourceDigest=(await import('node:crypto')).createHash('sha256').update(sourceBytes).digest('hex');
  const expectedFile={name:path.basename(asset.path),size:sourceBytes.length,sha256:sourceDigest};
  const armed=await armWechatCoverFileCapture(objectId);if(!armed.ok)return armed;
  let selectedFile;
  try{await cdp('DOM.setFileInputFiles',{objectId,files:[asset.path]});selectedFile=await readWechatCoverFileCapture(objectId)}
  catch(error){return {ok:false,reason:String(error?.message||error)}}
  finally{await cleanupWechatCoverFileCapture(objectId).catch(()=>{})}
  if(!wechatCoverSelectedFileMatches(selectedFile,expectedFile))return {ok:false,reason:'wechat cover native file bytes do not match the requested source',selectedFile,expectedFile};
  let previewReady=false,previewProof=null;
  for(let i=0;i<20;i+=1){await activateWechatLifecycle();previewProof=await probeWechatCoverEditor(asset);if(previewProof.image?.loaded&&previewProof.image.sourceKey===previousPreview.image?.sourceKey&&wechatCoverRatioMatches(previewProof.image,asset.ratio))previewProof.pixelProof=await probeWechatCoverEditorPixels(asset,previewProof.image.sourceKey);previewReady=wechatCoverPreviewMatches(previewProof,asset,selectedFile,previousPreview.image?.sourceKey);if(previewReady)break;await wait(1)}
  if(!previewReady)return {ok:false,reason:'wechat requested cover preview did not finish loading with the expected aspect',selectedFile,previewProof};
  let confirmed={ok:false,reason:'wechat cover confirm missing or disabled'};
  for(let i=0;i<20;i+=1){
    await activateWechatLifecycle();
    confirmed=await js(wechatCoverEditorExpression(asset.dialogTitle, `
      const crop=dialogs.find(d=>heading(d)==='裁剪封面图');
      if(crop){const buttons=owned(crop,'button').filter(b=>compact(b.textContent)==='确定'&&visible(b)&&!b.disabled);if(buttons.length===1){buttons[0].click();return {ok:false,waiting:true,cropConfirmed:true}}}
      if(!editor)return {ok:false,reason:'wechat cover editor missing or ambiguous'};
      const buttons=owned(editor,'button').filter(b=>compact(b.textContent)==='确认'&&visible(b)&&!b.disabled&&!/disabled/.test(String(b.className||'')));
      if(buttons.length!==1)return {ok:false,waiting:true,reason:'wechat cover confirm not visible yet'};
      buttons[0].click();return {ok:true};
    `));
    if(confirmed.ok)break;await wait(1);
  }
  if(!confirmed.ok)return {ok:false,reason:confirmed.reason||'wechat cover confirm missing or disabled'};
  let after=[];let dialogClosed=false;let acceptedImage=null;
  for(let i=0;i<30;i+=1){await activateWechatLifecycle();const state=await inspectWechatChannels();after=state.gates.cover.evidence?.urlsBySlot?.[asset.slot]||[];dialogClosed=state.gates.noBlockingDialog.ok;acceptedImage=(state.gates.cover.evidence?.imagesBySlot?.[asset.slot]||[]).find(image=>!before.includes(image.url)&&wechatCoverRatioMatches(image,asset.ratio));if(acceptedImage&&dialogClosed)break;await wait(1)}
  const afterUrl=after.find(url=>!before.includes(url));
  if(!afterUrl)return {ok:false,reason:`wechat ${asset.slot} cover card did not change`,before,after};
  if(!dialogClosed)return {ok:false,reason:'wechat cover confirmation dialog did not close',before,after};
  if(!acceptedImage)return {ok:false,reason:'wechat accepted cover image has the wrong aspect or has not loaded',before,after};
  return {ok:true,receipt:{assetPath:asset.path,ratio:asset.ratio,beforeUrls:before,afterUrl,selectedFile,previewProof,acceptedImage}};
}

async function waitForWechatNativeTopics(){
  let current=null;
  for(let attempt=0;attempt<20;attempt+=1){
    current=await inspectWechatChannels();
    if(current.gates.description.ok&&current.gates.topics.ok)return current;
    await wait(1);
  }
  return current||await inspectWechatChannels();
}

async function ensureWechatDescriptionAndTopics(before){
  const actions={};let current=before;
  if(!current.gates.description.ok||!current.gates.topics.ok){
    actions.description=await setWechatDescription();
    if(!actions.description.ok){
      current=await inspectWechatChannels();
      return {ok:false,actions,current,blocker:typedBlocker('ACTION_FAILED','视频号完整描述没有写入',{evidence:{action:actions.description,description:current.gates.description.evidence,topics:current.gates.topics.evidence}})};
    }
    current=await waitForWechatNativeTopics();
  }
  if(!current.gates.description.ok||!current.gates.topics.ok){
    return {ok:false,actions,current,blocker:typedBlocker('ACTION_FAILED','视频号原生话题未在限定等待内完成渲染',{evidence:{description:current.gates.description.evidence,topics:current.gates.topics.evidence}})};
  }
  return {ok:true,actions,current};
}

async function ensureWechatEarlyMetadata(before){
  const metadata=await ensureWechatDescriptionAndTopics(before);
  if(!metadata.ok)return metadata;
  const actions=metadata.actions;let current=metadata.current;
  if(!current.gates.shortTitle.ok)actions.shortTitle=await setWechatShortTitle();
  current=await inspectWechatChannels();
  if(!current.gates.description.ok||!current.gates.topics.ok||!current.gates.shortTitle.ok){
    return {ok:false,actions,current,blocker:typedBlocker('ACTION_FAILED','视频号描述、原生话题或短标题没有持久化',{evidence:{description:current.gates.description.evidence,topics:current.gates.topics.evidence,shortTitle:current.gates.shortTitle.evidence}})};
  }
  return {ok:true,actions,current};
}

async function prefillWechatChannels(){
  const before=await inspectWechatChannels();
  if(!before.gates.authenticated.ok)return {...before,blocker:typedBlocker('AUTH_REQUIRED','视频号登录状态失效',{requiresUser:true,evidence:before.gates.authenticated.evidence})};
  if(!before.gates.draftIdentity.ok)return {...before,blocker:typedBlocker(before.gates.draftIdentity.evidence?.ambiguous?'STATE_AMBIGUOUS':'FOREIGN_DRAFT','视频号无法证明当前草稿属于本任务',{evidence:before.gates.draftIdentity.evidence})};
  if(!before.gates.original.ok)return {...before,blocker:typedBlocker('DECLARATION_MISMATCH','视频号页面已经勾选原创声明；学校发布流程默认不选择原创/AI声明',{requiresUser:true,evidence:before.gates.original.evidence})};
  const uploading=before.gates.video.evidence?.uploading===true;
  if(!before.gates.video.ok&&(!uploading||before.evidence?.earlyMutation?.ready!==true)){
    return {...before,blocker:typedBlocker('STATE_AMBIGUOUS','视频号上传中的描述与短标题控件尚未完整就绪',{retryable:true,evidence:before.evidence?.earlyMutation})};
  }
  const metadata=await ensureWechatEarlyMetadata(before);
  if(!metadata.ok)return {...metadata.current,actions:metadata.actions,blocker:metadata.blocker};
  return {...metadata.current,actions:{...metadata.actions,prefill:{completedDuringUpload:uploading}}};
}

async function mutateWechatChannels(){let before=await inspectWechatChannels();if(!before.gates.draftIdentity.ok)return {...before,blocker:typedBlocker(before.gates.draftIdentity.evidence?.ambiguous?'STATE_AMBIGUOUS':'FOREIGN_DRAFT','视频号无法证明当前已上传草稿属于本任务',{evidence:before.gates.draftIdentity.evidence})};if(!before.gates.video.ok)return {...before,blocker:typedBlocker('STATE_AMBIGUOUS','视频号没有可修复的已上传视频')};if(!before.gates.original.ok)return {...before,blocker:typedBlocker('DECLARATION_MISMATCH','视频号页面已经勾选原创声明；学校发布流程默认不选择原创/AI声明',{requiresUser:true,evidence:before.gates.original.evidence})};const actions={};if(!channelsBlobRecovery?.coverPreviewConfirm&&!before.gates.noBlockingDialog.ok&&before.gates.noBlockingDialog.evidence?.active?.some(item=>/编辑个人主页卡片|编辑分享卡片|编辑封面|裁剪封面图/.test(item.text||''))){actions.coverRecovery=await dismissWechatCoverEditor();if(!actions.coverRecovery.ok)return {...(await inspectWechatChannels()),blocker:typedBlocker('STATE_AMBIGUOUS',actions.coverRecovery.reason,{retryable:true,evidence:actions.coverRecovery})};before=await inspectWechatChannels()}if(!channelsBlobRecovery?.coverPreviewConfirm&&!before.gates.noBlockingDialog.ok)return {...before,blocker:typedBlocker('STATE_AMBIGUOUS','视频号存在未识别的阻塞弹窗',{retryable:true,evidence:before.gates.noBlockingDialog.evidence})};const metadata=await ensureWechatEarlyMetadata(before);Object.assign(actions,metadata.actions);if(!metadata.ok)return {...metadata.current,actions,blocker:metadata.blocker};before=metadata.current;actions.original={ok:true,skipped:true,reason:'school_policy_no_declaration'};const receipts={};if(wechatCustomCover){receipts.cover={slots:{...(expectedReceipts.cover?.slots||{})}};const coverAssets=before.gates.cover.evidence?.unified?wechatCoverAssets.filter(asset=>asset.slot==='vertical'):wechatCoverAssets;for(const asset of coverAssets){const current=await inspectWechatChannels();if(wechatCoverReceiptMatches(asset,receipts.cover.slots[asset.slot],current.gates.cover.evidence?.imagesBySlot?.[asset.slot]))continue;const uploaded=channelsBlobRecovery?.coverPreviewConfirm?await confirmExistingWechatCover(asset):await uploadWechatCover(asset);(actions.covers||=[]).push({asset,...uploaded});if(!uploaded.ok)return {...(await inspectWechatChannels()),blocker:typedBlocker('PLATFORM_REJECTED_ASSET',uploaded.reason,{retryable:true,evidence:uploaded})};receipts.cover.slots[asset.slot]=uploaded.receipt;actions.receiptCheckpoint=checkpointReceipts({...expectedReceipts,...receipts})}expectedReceipts.cover=receipts.cover}actions.receiptCheckpoint=checkpointReceipts({...expectedReceipts,...receipts});const after=await inspectWechatChannels();return {...after,actions,receipts}}

function readyTopicsDescriptionAllowlist(){
  return new Set([wechatBody,`#${wechatBody}`,wechatDescription].map(value=>compactText(value)));
}

async function runWechatReadyTopicsRecovery(){
  if(!['inspect','verify','mutate'].includes(phase))return {blocker:typedBlocker('CHANNELS_BLOB_PHASE_REJECTED',phase)};
  const proof=await probeExistingWechatBlob();verifiedChannelsBlobProof=proof;
  if(!proof.ok)return {...(await inspectWechatChannels()),blocker:typedBlocker('CHANNELS_BLOB_SOURCE_UNPROVED',proof.reason)};
  let before=await inspectWechatChannels();
  before.gates.video=okGate({stable:true,existingBlobBytesVerified:true,serverContentIdKnown:false});
  before.gates.draftIdentity=okGate({originalSourceBytesVerified:true,readyTopicsResumeContract:true});
  if(phase==='inspect'||phase==='verify')return {...before,actions:{upload:{mode:'recovered_original_blob',proof,reuploaded:false}}};

  const actual=String(before.gates.description.evidence?.actual||'');
  if(!readyTopicsDescriptionAllowlist().has(compactText(actual)))return {...before,blocker:typedBlocker('FOREIGN_DRAFT','视频号现有正文超出ready_topics精确恢复允许范围',{evidence:{actual,allowed:[...readyTopicsDescriptionAllowlist()]}})};
  if(!before.gates.authenticated.ok||!before.gates.original.ok||!before.gates.shortTitle.ok||!before.gates.cover.ok||!before.gates.noBlockingDialog.ok){
    return {...before,blocker:typedBlocker('STATE_AMBIGUOUS','ready_topics恢复要求登录、原创状态、短标题、双封面回读和无阻塞弹窗均保持原样',{evidence:{authenticated:before.gates.authenticated,original:before.gates.original,shortTitle:before.gates.shortTitle,cover:before.gates.cover,noBlockingDialog:before.gates.noBlockingDialog}})};
  }
  const metadata=await ensureWechatDescriptionAndTopics(before);
  if(!metadata.ok)return {...metadata.current,actions:metadata.actions,blocker:metadata.blocker};
  const afterProof=await probeExistingWechatBlob();
  if(!afterProof.ok)return {...metadata.current,actions:metadata.actions,blocker:typedBlocker('CHANNELS_BLOB_SOURCE_CHANGED',afterProof.reason)};
  const after=await inspectWechatChannels();
  after.gates.video=okGate({stable:true,existingBlobBytesVerified:true,serverContentIdKnown:false});
  after.gates.draftIdentity=okGate({originalSourceBytesVerified:true,readyTopicsResumeContract:true});
  if(!after.gates.description.ok||!after.gates.topics.ok||!after.gates.shortTitle.ok||!after.gates.cover.ok||!after.gates.original.ok||!after.gates.noBlockingDialog.ok){
    return {...after,actions:metadata.actions,blocker:typedBlocker('ACTION_FAILED','ready_topics写入后原有视频、标题、双封面或安全状态发生变化',{evidence:{description:after.gates.description,topics:after.gates.topics,shortTitle:after.gates.shortTitle,cover:after.gates.cover,original:after.gates.original,noBlockingDialog:after.gates.noBlockingDialog}})};
  }
  return {...after,actions:{...metadata.actions,upload:{mode:'recovered_original_blob',proof:afterProof,reuploaded:false},readyTopicsResume:{changedDescription:Boolean(metadata.actions.description),coversSkipped:true,videoReinjected:false,coverDialogDismissed:false}}};
}

// safety is centrally injected by ego/core.mjs after this platform fragment is
// serialized and dispatched. The adapter still checks its own byte-proof guard
// here; the final V2 observation/verdict remains responsible for the real safety gate.
const READY_SOURCE_PROOF_REQUIRED_GATES=['authenticated','draftIdentity','video','description','topics','shortTitle','original','cover','noBlockingDialog','finalButton'];
async function runWechatReadySourceProof(){
 if(!['inspect','verify'].includes(phase))return {blocker:typedBlocker('CHANNELS_READY_SOURCE_PROOF_READ_ONLY_PHASE_REQUIRED',phase)};
 const proof=await probeExistingWechatBlob();verifiedChannelsBlobProof=proof;
 if(!proof.ok)return {...(await inspectWechatChannels()),blocker:typedBlocker('CHANNELS_READY_SOURCE_BLOB_PROOF_FAILED',proof.reason)};
 if(proof.guardArmed!==true||proof.blockedAttempts!==0||proof.serverContentIdKnown!==false)return {...(await inspectWechatChannels()),blocker:typedBlocker('CHANNELS_READY_SOURCE_GUARD_NOT_CLEAN','The source-byte probe did not prove the page-level final-action guard clean',{evidence:{guardArmed:proof.guardArmed,blockedAttempts:proof.blockedAttempts,serverContentIdKnown:proof.serverContentIdKnown}})};
  const current=await inspectWechatChannels();
  current.gates.video=okGate({stable:true,existingBlobBytesVerified:true,serverContentIdKnown:false,videoElementCount:proof.videoElementCount,blobVideoElementCount:proof.blobVideoElementCount,uniqueBlobSourceCount:proof.uniqueBlobSourceCount,visiblePrimaryId:proof.visiblePrimaryId});
  current.gates.draftIdentity=okGate({originalSourceBytesVerified:true,readySourceProofContract:true});
  const missing=READY_SOURCE_PROOF_REQUIRED_GATES.filter(name=>current.gates?.[name]?.ok!==true);
  const actions={upload:{mode:'recovered_original_blob',proof,reuploaded:false}};
  if(missing.length)return {...current,actions,blocker:typedBlocker('CHANNELS_READY_SOURCE_CURRENT_GATES_NOT_READY','Fresh source proof is not enough unless the unchanged native draft is fully READY',{evidence:{missing}})};
  return {...current,actions};
}

async function runPlatformPhase(){
 if(typeof channelsBlobRecovery!=='undefined'&&['ready_source_proof','ready_source_proof_safety_retry'].includes(channelsBlobRecovery?.recoveryMode))return await runWechatReadySourceProof();
 if(typeof channelsBlobRecovery!=='undefined'&&channelsBlobRecovery?.recoveryMode==='ready_topics')return await runWechatReadyTopicsRecovery();
 if(typeof channelsBlobRecovery!=='undefined'&&channelsBlobRecovery){
  if(['upload','upload_start','quarantine'].includes(phase))return {blocker:typedBlocker('CHANNELS_BLOB_NEVER_REINJECT','Existing media recovery forbids upload/navigation')};
  const proof=await probeExistingWechatBlob();verifiedChannelsBlobProof=proof;if(!proof.ok)return {...(await inspectWechatChannels()),blocker:typedBlocker('CHANNELS_BLOB_SOURCE_UNPROVED',proof.reason)};
  let result;if(phase==='inspect'||phase==='verify')result=await inspectWechatChannels();else if(phase==='mutate')result=await mutateWechatChannels();else return {...(await inspectWechatChannels()),blocker:typedBlocker('CHANNELS_BLOB_PHASE_REJECTED',phase)};
  const afterProof=phase==='mutate'?await probeExistingWechatBlob():proof;if(!afterProof.ok)return {...result,blocker:typedBlocker('CHANNELS_BLOB_SOURCE_CHANGED',afterProof.reason)};
  result.gates.video=okGate({stable:true,existingBlobBytesVerified:true,serverContentIdKnown:false});result.gates.draftIdentity=okGate({originalSourceBytesVerified:true});
  return {...result,actions:{...result.actions,upload:{mode:'recovered_original_blob',proof,reuploaded:false}}};
 }
 if(phase==='inspect'||phase==='verify')return await inspectWechatChannels();if(phase==='upload_start')return await startWechatChannelsUpload();if(phase==='prefill')return await prefillWechatChannels();if(phase==='upload')return await uploadWechatChannels();if(phase==='mutate')return await mutateWechatChannels();return {...(await inspectWechatChannels()),blocker:typedBlocker('ACTION_FAILED',`unsupported WeChat phase: ${phase}`)}}
