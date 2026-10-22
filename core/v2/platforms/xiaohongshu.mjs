const xhsTitle = pkg.platformTitle.xiaohongshu;
const xhsTopics = pkg.xhsTopics;
const xhsDescription = String(pkg.description || '').replace(/\r\n?/g, '\n').trim();
const xhsDeclarationChoice = pkg.platformDeclarations?.xiaohongshu || 'none';
const xhsPoi = pkg.xhsPoi || null;
const xhsContentSource = pkg.xhsContentSource || null;
const xhsPrivateMessageComponent = pkg.xhsPrivateMessageComponent || null;
const xhsVideoName = videoPath.split('/').pop();
const xhsCustomCover = pkg.cover?.uploadCustomCover === true;
const xhsCoverPath = String(pkg.cover?.vertical3x4Path || '');

function xhsCoverCropMatches(probe) {
  return probe?.actual === '3:4' && probe?.controlVisible === true;
}

function xhsCoverReceiptMatches(receipt, background) {
  return Boolean(receipt && receipt.assetPath === xhsCoverPath && receipt.ratio === '3:4'
    && receipt.selectedFile?.name === path.basename(xhsCoverPath)
    && receipt.selectedFile?.size === fs.statSync(xhsCoverPath).size
    && xhsCoverCropMatches(receipt.cropProof)
    && receipt.acceptedImage?.width > 0 && receipt.acceptedImage?.height > 0
    && Math.abs(receipt.acceptedImage.width / receipt.acceptedImage.height - 0.75) < 0.01
    && receipt.afterUrl && background.includes(receipt.afterUrl));
}

async function activateXhsCropPanel() {
  const target = await js(String.raw`(() => {
    const compact=v=>String(v||'').replace(/\s+/g,' ').trim();
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};
    const modal=[...document.querySelectorAll('.main-cover-editor-modal,.d-modal,[role="dialog"]')].find(e=>visible(e)&&/设置封面/.test(compact(e.innerText||e.textContent)));
    if(!modal)return {ok:false,reason:'xiaohongshu cover editor missing'};
    const item=[...modal.querySelectorAll('button,[role="tab"],div,span')].filter(e=>visible(e)&&compact(e.innerText||e.textContent)==='裁剪').sort((a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return ar.width*ar.height-br.width*br.height})[0];
    if(!item)return {ok:!!modal.querySelector('.ratio-select'),already:true};
    item.id='vp2-xhs-crop-panel';return {ok:true,selector:'#vp2-xhs-crop-panel'};
  })()`);
  if(!target.ok)return target;
  if(target.selector)await click(target.selector,{label:'activate xhs crop panel'});
  await wait(0.5);
  return {ok:true};
}

async function readXhsAcceptedImage(url) {
  for(let attempt=0;attempt<12;attempt+=1){
    const image=await js(String.raw`((url) => {
      const cache=window.__VP2_XHS_IMAGE_DIMENSIONS__||(window.__VP2_XHS_IMAGE_DIMENSIONS__={});
      if(!cache[url]){const item={loaded:false};cache[url]=item;const image=new Image();image.onload=()=>Object.assign(item,{loaded:true,width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>Object.assign(item,{failed:true});image.src=url;}
      return cache[url];
    })(${JSON.stringify(url)})`);
    if(image.loaded||image.failed)return image;
    await wait(0.5);
  }
  return {loaded:false};
}

async function inspectXiaohongshu() {
  const state = await js(String.raw`((expectedName, expectedTitle, requestedTopics, expectedDescription, declarationChoice, poi, source, poiReceipt, componentReceipt) => {
    const compact = value => String(value || '').replace(/\s+/g, ' ').trim()
    const visible = el => { if (!el) return false; const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden' }
    const text = compact(document.body.innerText || '')
    const titleInput = [...document.querySelectorAll('input')]
      .find(el => (el.placeholder || '').includes('填写标题'))
    const title = String(titleInput?.value || '').trim()
    const editors = [...document.querySelectorAll('[contenteditable="true"], [contenteditable=""]')]
    const editor = editors.find(el => el.querySelector('a') || /话题|creator-editor/i.test(String(el.className || ''))) || editors[0]
    const editorText = compact(editor?.innerText || editor?.textContent || '')
    const anchorNames = [...(editor?.querySelectorAll('a') || [])].map(el => {
      try { return String(JSON.parse(el.getAttribute('data-topic') || '{}').name || '').trim() }
      catch { return compact(el.innerText || el.textContent || '').replace(/^#|\[话题\]#.*$/g, '') }
    }).filter(Boolean)
    const plainClone = editor?.cloneNode(true)
    plainClone?.querySelectorAll('a').forEach(el => el.remove())
    // Detached clones lose layout-based innerText: preserve actual paragraph/BR boundaries.
    const semanticBodyText = node => {
      if(!node)return '';
      if(node.nodeType===3)return node.nodeValue||'';
      if(node.nodeType!==1)return '';
      if(node.tagName==='BR')return '\n';
      const content=[...node.childNodes].map(semanticBodyText).join('');
      return content+(/^(P|DIV|LI|BLOCKQUOTE|H[1-6])$/.test(node.tagName)?'\n':'');
    };
    const plainText = String(semanticBodyText(plainClone)).replace(/\u200b/g, '').replace(/\r\n?/g, '\n').trim()
    const normalizedPlainText = plainText.replace(/\s+/g, ' ')
    const normalizedDescription = String(expectedDescription || '').replace(/\s+/g, ' ').trim()
    const settings = document.querySelector('.publish-page-content-setting-content')
    const settingsText = compact(settings?.innerText || settings?.textContent || '')
    const sourceControlTexts = [...(settings?.querySelectorAll('.d-select-main') || [])].map(el => compact(el.innerText || el.textContent || ''))
    const poiContainer = document.querySelector('.publish-page-content-component-content')
    const poiText = compact(poiContainer?.innerText || poiContainer?.textContent || '')
    const poiNodes = [...(poiContainer?.querySelectorAll('.d-select, .d-select-main, [class*=location], [class*=poi]') || [])]
      .map(el => ({text: compact(el.innerText || el.textContent || ''), title: el.getAttribute('title') || '', aria: el.getAttribute('aria-label') || '', data: [...el.attributes].filter(a=>/^data-/i.test(a.name)).map(a=>a.name+'='+a.value).join(' '), cls: String(el.className || '')}))
    const sourceSummary = source?.type === 'self_shot' ? '拍摄于'+source.date+'，'+source.locationName : ''
    const sourceMatches = Boolean(source && (source.type === 'ai_generated'
      ? sourceControlTexts.includes('笔记含AI合成内容')
      : source.type === 'self_shot' && settingsText.includes('自主拍摄') && settingsText.includes(sourceSummary)))
    const poiReceiptMatches = Boolean(poiReceipt?.selected === true && poiReceipt.name === poi?.name && poiReceipt.address === poi?.address && String(poiReceipt.selectedText || '').includes(poi.name) && String(poiReceipt.selectedText || '').includes(poi.address))
    const poiMatches = Boolean(poi && poiText.includes(poi.name) && (poiText.includes(poi.address) || poiReceiptMatches))
    const componentRoot = document.querySelector('.publish-page-content-component-content')
    const componentControls = [...(componentRoot?.querySelectorAll('.wrapper, [role=button], button, [class*=component]') || [])]
      .map(el => ({text: compact(el.innerText || el.textContent || ''), cls: String(el.className || ''), selected: el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' || /selected|checked|active/.test(String(el.className || ''))}))
      .filter(item => item.text)
    const visibleDropdowns = [...document.querySelectorAll('[role=menu], [role=listbox], .d-select-dropdown, .d-dropdown, .d-popover, .d-popper, [class*=dropdown]')].filter(visible).map(el=>compact(el.innerText||el.textContent||'')).filter(Boolean)
    const componentMenuObserved = visibleDropdowns.some(text => /组件|私信|咨询/.test(text))
    const privateMessageOffered = componentControls.some(item => /私信咨询|私信组件|私信卡片/.test(item.text)) || visibleDropdowns.some(text => /私信咨询|私信组件|私信卡片/.test(text))
    const privateMessageSelected = componentControls.some(item => /私信咨询|私信组件|私信卡片/.test(item.text) && item.selected)
    const componentEvidence = {status: privateMessageOffered ? (privateMessageSelected ? 'OFFERED_AND_SELECTED' : 'OFFERED_NOT_SELECTED') : componentMenuObserved ? 'NOT_FOUND_IN_CURRENT_OPEN_MENU' : 'UNVERIFIED_COMPONENT_MENU_NOT_OPENED', offered: privateMessageOffered, selected: privateMessageSelected, controls: componentControls, visibleDropdowns, scope: 'current form only; no global/account entitlement conclusion'}; if(!privateMessageOffered&&componentReceipt?.status==='NOT_FOUND_IN_CURRENT_OPEN_MENU'&&componentReceipt?.videoName===expectedName){Object.assign(componentEvidence,componentReceipt,{controls:componentControls})}

    const topicCounts = Object.fromEntries(requestedTopics.map(tag => {
      const normalized = String(tag).replace(/\s+/g, '').toLowerCase()
      const count = anchorNames.filter(value => String(value).replace(/\s+/g, '').toLowerCase() === normalized).length
      return [tag, count]
    }))
    const selected = requestedTopics.filter(tag => topicCounts[tag] === 1)
    const plainCompact = plainText.replace(/\s+/g, '').toLowerCase()
    const plainResidue = requestedTopics.filter(tag => plainCompact.includes('#' + String(tag).replace(/\s+/g, '').toLowerCase()))
    const duplicate = requestedTopics.filter(tag => topicCounts[tag] > 1)
    const originalLabels = [...document.querySelectorAll('div,section,label,span')]
      .filter(el => compact(el.innerText || el.textContent || '') === '原创声明')
      .sort((a,b) => { const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect(); return ar.width*ar.height-br.width*br.height })
    const originalLabel = originalLabels[0] || null
    const originalAncestors = []; for(let el=originalLabel;el&&originalAncestors.length<8;el=el.parentElement)originalAncestors.push(el)
    const originalSelectors = '.custom-switch-switch, .d-switch, [role="switch"], input[type="checkbox"]'
    const originalRow = originalAncestors.find(el => el.matches?.(originalSelectors) || el.querySelector?.(originalSelectors))
      || originalAncestors.find(el => { const s=getComputedStyle(el); return compact(el.innerText||el.textContent||'')==='原创声明' && (parseFloat(s.borderRadius)>0 || s.backgroundColor!=='rgba(0, 0, 0, 0)') })
      || originalLabel?.parentElement
    const originalSwitch = (originalRow?.matches?.(originalSelectors) ? originalRow : originalRow?.querySelector(originalSelectors))
      || [...document.querySelectorAll('.custom-switch-switch, .d-switch, [role="switch"]')]
        .find(el => /原创声明/.test(el.parentElement?.parentElement?.innerText || ''))
    const simulator = originalSwitch?.querySelector?.('.d-switch-simulator') || originalSwitch?.parentElement?.querySelector?.('.d-switch-simulator')
    const originalInput = originalSwitch?.matches?.('input[type="checkbox"]')
      ? originalSwitch
      : originalSwitch?.querySelector?.('input[type="checkbox"]') || simulator?.querySelector?.('input[type="checkbox"]')
    const switchTokens = String(originalSwitch?.className || '').split(/\s+/).filter(Boolean)
    const simulatorTokens = String(simulator?.className || '').split(/\s+/).filter(Boolean)
    const originalEnabled = Boolean(originalSwitch && (
      originalInput?.checked === true
      || originalSwitch.getAttribute?.('aria-checked') === 'true'
      || originalSwitch.getAttribute?.('data-state') === 'checked'
      || switchTokens.some(token => ['checked', 'active', 'open', 'enabled'].includes(token))
      || simulatorTokens.some(token => ['checked', 'active', 'open', 'enabled'].includes(token))
    ))
    const activeDialogs = [...document.querySelectorAll('.d-modal-mask, [role="dialog"], [class*="modal-mask"]')]
      .map(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { text: compact(el.innerText || el.textContent || ''), cls: String(el.className || ''), width: r.width, height: r.height, opacity: s.opacity, display: s.display, visibility: s.visibility } })
      .filter(item => item.width > 20 && item.height > 20 && item.display !== 'none' && item.visibility !== 'hidden')
      .filter(item => !(/leave-active/.test(item.cls) && Number(item.opacity) === 0))
    const cover = document.querySelector('.cover-plugin-preview .default.row, .cover-plugin-preview .default.column')
    const coverBg = cover ? getComputedStyle(cover).backgroundImage : ''
    const filenameVisible = text.includes(expectedName) || text.includes(expectedName.replace(/\.[^.]+$/, ''))
    const uploaded = filenameVisible && /重新上传|上传完成|检测为高清视频/.test(text)
    const uploading = /封面上传中|视频上传中|取消上传|剩余时间|当前速度|处理中/.test(text)
    const failed = /上传失败|网络错误|重新上传失败/.test(text)
    const loginRequired = /扫码登录|请登录|登录后|安全验证|验证码/.test(text) && !/发布笔记|内容设置/.test(text)
    const topicButton = document.querySelector('button.contentBtn.topic-btn, #topicBtn')
    const earlyMutation = {
      ready: Boolean(visible(titleInput) && visible(editor) && visible(topicButton)),
      uploading,
      uploaded,
      controls: { title: visible(titleInput), topics: visible(editor) && visible(topicButton) },
    }
    return { text: text.slice(0, 2600), title, editorText, plainText, normalizedPlainText, normalizedDescription, descriptionMatches: normalizedPlainText === normalizedDescription, selected, topicCounts, plainResidue, duplicate, originalEnabled, settingsText, sourceControlTexts, sourceMatches, sourceSummary, poiText, poiNodes, poiMatches, componentEvidence, activeDialogs, coverBg, filenameVisible, uploaded, uploading, failed, loginRequired, earlyMutation }
  })(${JSON.stringify(xhsVideoName)}, ${JSON.stringify(xhsTitle)}, ${JSON.stringify(xhsTopics)}, ${JSON.stringify(xhsDescription)}, ${JSON.stringify(xhsDeclarationChoice)}, ${JSON.stringify(xhsPoi)}, ${JSON.stringify(xhsContentSource)}, ${JSON.stringify(expectedReceipts?.poi || null)}, ${JSON.stringify(expectedReceipts?.component || null)})`);
  const buttons = await inspectFinalButtons(/^(发布|发布笔记)$/);
  const identityOk = !state.uploaded || state.filenameVisible || state.title === xhsTitle;
  const receipt = expectedReceipts.cover || null;
  const receiptMatches = xhsCoverReceiptMatches(receipt,state.coverBg);
  const coverOk = xhsCustomCover
    ? receiptMatches && !state.uploading
    : Boolean(state.coverBg) && !state.uploading;
  const finalButton = buttons.find(button => button.buttonish) || buttons[0] || null;
  return {
    gates: {
      authenticated: state.loginRequired ? failedGate({ loginRequired: true }) : okGate({ url: PLATFORM_URLS.xiaohongshu }),
      draftIdentity: identityOk ? okGate({ expectedName: xhsVideoName, filenameVisible: state.filenameVisible }) : failedGate({ foreign: true, expectedName: xhsVideoName, actualTitle: state.title }),
      video: state.uploaded && !state.failed && !state.uploading
        ? okGate({ filename: xhsVideoName, stable: true })
        : failedGate({ filename: xhsVideoName, uploaded: state.uploaded, uploading: state.uploading, failed: state.failed }),
      title: state.title === xhsTitle ? okGate({ expected: xhsTitle, actual: state.title }) : failedGate({ expected: xhsTitle, actual: state.title }),
      description: state.descriptionMatches
        ? okGate({ expected: xhsDescription, actual: state.plainText })
        : failedGate({ expected: xhsDescription, actual: state.plainText, reason: 'body_mismatch' }),
      tags: state.selected.length === xhsTopics.length && !state.plainResidue.length && !state.duplicate.length && state.descriptionMatches
        ? okGate({ requested: xhsTopics, selected: state.selected, topicCounts: state.topicCounts, descriptionPreserved: true })
        : failedGate({ requested: xhsTopics, selected: state.selected, plainResidue: state.plainResidue, duplicate: state.duplicate, topicCounts: state.topicCounts, descriptionPreserved: state.descriptionMatches }),
      original: xhsDeclarationChoice === 'original'
        ? (state.originalEnabled && !state.activeDialogs.some(item => /原创声明|原创须知/.test(item.text || '')) ? okGate({ choice: 'original', enabled: true, confirmedDialogClosed: true }) : failedGate({ choice: 'original', enabled: state.originalEnabled, reason: state.originalEnabled ? 'original_confirmation_dialog_open' : 'requested_original_not_selected' }))
        : (!state.originalEnabled && !state.activeDialogs.some(item => /原创声明|原创须知/.test(item.text || '')) ? okGate({ choice: 'none', enabled: false }) : failedGate({ choice: 'none', enabled: state.originalEnabled, unexpectedSelection: true })),
      poi: !xhsPoi ? okGate({ skipped: true, reason: 'not_requested' }) : state.poiMatches ? okGate({ requested: xhsPoi, actual: state.poiText, nodes: state.poiNodes }) : failedGate({ requested: xhsPoi, actual: state.poiText, nodes: state.poiNodes, reason: 'exact_native_poi_not_selected' }),
      contentSource: !xhsContentSource ? okGate({ skipped: true, reason: 'not_requested' }) : state.sourceMatches ? okGate({ requested: xhsContentSource, actual: state.settingsText }) : failedGate({ requested: xhsContentSource, actual: state.settingsText, reason: 'source_declaration_not_persisted' }),
      privateMessageComponent: xhsPrivateMessageComponent !== 'if_available' ? okGate({ skipped: true, requested: xhsPrivateMessageComponent || null }) : (state.componentEvidence.selected || state.componentEvidence.status === 'NOT_FOUND_IN_CURRENT_OPEN_MENU')
        ? okGate({ ...state.componentEvidence, requested: xhsPrivateMessageComponent })
        : failedGate({ ...state.componentEvidence, requested: xhsPrivateMessageComponent, reason: state.componentEvidence.offered ? 'private_message_component_offered_but_not_selected' : 'component_menu_not_verified' }),
      cover: coverOk
        ? okGate({ custom: xhsCustomCover, background: state.coverBg, receipt })
        : failedGate({ custom: xhsCustomCover, background: state.coverBg, receipt, reason: xhsCustomCover && !receipt ? 'custom cover receipt missing' : 'cover not verified' }),
      noBlockingDialog: state.activeDialogs.length === 0 ? okGate({ active: [] }) : failedGate({ active: state.activeDialogs }),
      finalButton: finalButton && !finalButton.disabled ? okGate(finalButton) : failedGate({ buttons }),
    },
    evidence: { pageSample: state.text, earlyMutation: state.earlyMutation, privateMessageComponent: state.componentEvidence },
  };
}

async function waitXiaohongshuUploadCompletion(mode) {
  let stableSince = 0;
  for (let index = 0; index < 180; index += 1) {
    const current = await inspectXiaohongshu();
    const uploaded = current.gates.video.evidence?.uploaded || current.gates.video.ok;
    const uploading = current.gates.video.evidence?.uploading === true;
    if (uploaded && !uploading) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 10000) return { ...current, actions: { upload: { mode } } };
    } else {
      stableSince = 0;
    }
    await wait(5);
  }
  const after = await inspectXiaohongshu();
  return { ...after, actions: { upload: { mode } }, blocker: typedBlocker('UPLOAD_STALLED', '小红书视频没有在等待窗口内稳定完成', { retryable: true, evidence: after.gates.video.evidence }) };
}

async function uploadXiaohongshu() {
  const before = await inspectXiaohongshu();
  if (before.gates.video.ok) return { ...before, actions: { upload: { mode: expectedVideoReceipt ? 'already_ready' : 'resume_existing' } } };
  if (!before.gates.draftIdentity.ok) {
    return { ...before, blocker: typedBlocker('FOREIGN_DRAFT', '小红书当前编辑器属于其他视频草稿', { evidence: before.gates.draftIdentity.evidence }) };
  }
  if (before.gates.video.evidence?.uploading === true) {
    return await waitXiaohongshuUploadCompletion('resume_existing');
  }
  const exposed = await js(String.raw`(() => {
    const videoLike = value => /video|\.(mp4|mov|flv|f4v|mkv|rmvb?|m4v|mpg|mpeg|ts)\b/i.test(value || '')
    const input = [...document.querySelectorAll('input[type=file]')].find(el => videoLike(el.accept))
    if (!input) return { ok: false, reason: 'xiaohongshu video input missing' }
    input.id = 'vp2-xhs-video'
    return { ok: true, selector: '#vp2-xhs-video', accept: input.accept || '' }
  })()`);
  if (!exposed.ok) return { ...before, blocker: typedBlocker('SELECTOR_DRIFT', exposed.reason) };
  try {
    await uploadFile(exposed.selector, videoPath);
  } catch (error) {
    return { ...before, blocker: typedBlocker('UPLOAD_NOT_STARTED', `小红书文件注入失败: ${String(error?.message || error)}`, { retryable: true }) };
  }
  return await waitXiaohongshuUploadCompletion('injected');
}

async function waitXiaohongshuEarlyMutationReady(mode) {
  for (let index = 0; index < 30; index += 1) {
    const current = await inspectXiaohongshu();
    if (!current.gates.authenticated.ok) {
      return { ...current, blocker: typedBlocker('AUTH_REQUIRED', '小红书登录状态失效', { requiresUser: true, evidence: current.gates.authenticated.evidence }) };
    }
    if (current.gates.video.ok) return { ...current, actions: { upload: { mode, stage: 'complete', earlyMutationReady: true } } };
    if (current.gates.video.evidence?.failed === true) {
      return { ...current, blocker: typedBlocker('UPLOAD_NOT_STARTED', '小红书上传失败', { retryable: true, evidence: current.gates.video.evidence }) };
    }
    if (current.gates.video.evidence?.uploading === true && current.evidence?.earlyMutation?.ready === true) {
      return { ...current, actions: { upload: { mode, stage: 'editable_uploading', earlyMutationReady: true } } };
    }
    await wait(1);
  }
  const after = await inspectXiaohongshu();
  return { ...after, blocker: typedBlocker('UPLOAD_NOT_STARTED', '小红书上传启动后编辑区未及时就绪', { retryable: true, evidence: after.evidence?.earlyMutation }) };
}

async function startXiaohongshuUpload() {
  const before = await inspectXiaohongshu();
  if(emptyInputResume&&(before.gates.video?.ok!==false||before.gates.video.evidence?.uploaded!==false||before.gates.video.evidence?.uploading!==false))return {...before,blocker:typedBlocker('XHS_EMPTY_RESUME_CURRENT_VIDEO_PRESENT_OR_UNKNOWN','Original empty editor is no longer empty; never reuse or overwrite this video')};
  if (before.gates.video.ok) return { ...before, actions: { upload: { mode: 'already_ready', stage: 'complete', earlyMutationReady: true } } };
  if (!before.gates.authenticated.ok) {
    return { ...before, blocker: typedBlocker('AUTH_REQUIRED', '小红书登录状态失效', { requiresUser: true, evidence: before.gates.authenticated.evidence }) };
  }
  if (!before.gates.draftIdentity.ok) {
    return { ...before, blocker: typedBlocker('FOREIGN_DRAFT', '小红书当前编辑器属于其他视频草稿', { evidence: before.gates.draftIdentity.evidence }) };
  }
  if (before.gates.video.evidence?.uploading === true) return await waitXiaohongshuEarlyMutationReady('resume_existing');
  const exposed = await js(String.raw`(() => {
    const videoLike = value => /video|\.(mp4|mov|flv|f4v|mkv|rmvb?|m4v|mpg|mpeg|ts)\b/i.test(value || '')
    const input = [...document.querySelectorAll('input[type=file]')].find(el => videoLike(el.accept))
    if (!input) return { ok: false, reason: 'xiaohongshu video input missing' }
    input.id = 'vp2-xhs-video'
    return { ok: true, selector: '#vp2-xhs-video', accept: input.accept || '' }
  })()`);
  if (!exposed.ok) return { ...before, blocker: typedBlocker('SELECTOR_DRIFT', exposed.reason) };
  try {
    await uploadFile(exposed.selector, videoPath);
  } catch (error) {
    return { ...before, blocker: typedBlocker('UPLOAD_NOT_STARTED', `小红书文件注入失败: ${String(error?.message || error)}`, { retryable: true }) };
  }
  return await waitXiaohongshuEarlyMutationReady('injected');
}

async function activateXhsTopicLifecycle() {
  await cdp('Page.bringToFront', {}).catch(() => {});
  await cdp('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await wait(.35);
  const state=await js(String.raw`(() => ({visibility:document.visibilityState,hasFocus:document.hasFocus()}))()`);
  return state.visibility==='visible'&&state.hasFocus
    ? {ok:true,...state}
    : {ok:false,reason:'xiaohongshu topic page did not become visible and focused',...state};
}

async function rebuildXhsTopics() {
  if(typeof boundPage!=='function')return {ok:false,reason:'xiaohongshu exact native school page required'};
  const lifecycle=await activateXhsTopicLifecycle();if(!lifecycle.ok)return lifecycle;
  const scope=await js(String.raw`(() => {
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};
    const editors=[...document.querySelectorAll('[contenteditable="true"],[contenteditable=""]')].filter(visible);
    const preferred=editors.filter(e=>/话题|creator-editor/i.test(String(e.className||'')));
    const candidates=preferred.length?preferred:editors;
    const buttons=[...document.querySelectorAll('button')].filter(e=>String(e.innerText||'').trim()==='话题'&&visible(e));
    if(candidates.length!==1||buttons.length!==1)return {ok:false,reason:'xiaohongshu body/topic control missing or ambiguous'};
    candidates[0].setAttribute('data-school-topic-editor','current');buttons[0].setAttribute('data-school-topic-toolbar','current');candidates[0].scrollIntoView({block:'center'});return {ok:true};
  })()`);if(!scope.ok)return scope;
  const editorSelector='[data-school-topic-editor="current"]';
  // One body reset only. Use the real editor/clipboard path proven by native
  // operation, never execCommand insertion or a stale post-toolbar DOM Range.
  await click(editorSelector);await pressKey('Meta+A');await boundPage().keyboard.paste(xhsDescription);
  const restored=await inspectXiaohongshu();if(!restored.gates.description.ok)return {ok:false,reason:'xhs exact body did not persist before native topics',evidence:restored.gates.description.evidence};
  const committed=[];
  for(const tag of xhsTopics){
    await js(`(()=>{const e=document.querySelector('[data-school-topic-editor="current"]');if(!e)throw new Error('native editor vanished');e.scrollIntoView({block:'center'})})()`);
    await click(editorSelector);await pressKey('Meta+ArrowDown');await pressKey('Enter');
    await click('button[data-school-topic-toolbar="current"]');await boundPage().keyboard.type(String(tag));
    try{await boundPage().waitForFunction(tag=>[...document.querySelectorAll('.item .name')].some(e=>e.textContent.trim()==='#'+tag&&e.getClientRects().length),String(tag),{timeout:20000});}
    catch{return {ok:false,reason:'xiaohongshu exact native topic entity did not arrive; stopped without rebuilding',tag,committed};}
    const choice=await js(`((tag)=>{const rows=[...document.querySelectorAll('.item .name')].filter(e=>e.textContent.trim()==='#'+tag&&e.getClientRects().length);if(rows.length!==1)return {ok:false,reason:'exact native topic choice ambiguous'};document.querySelectorAll('[data-school-topic-choice]').forEach(e=>e.removeAttribute('data-school-topic-choice'));rows[0].setAttribute('data-school-topic-choice','current');rows[0].scrollIntoView({block:'center'});return {ok:true}})(${JSON.stringify(String(tag))})`);
    if(!choice.ok)return {...choice,tag,committed};
    await click('[data-school-topic-choice="current"]');
    let entity=false;
    for(let attempt=0;attempt<8&&!entity;attempt++){
      entity=await js(`((tag)=>[...document.querySelectorAll('[data-school-topic-editor="current"] a')].some(e=>{try{return JSON.parse(e.getAttribute('data-topic')||'{}').name===tag}catch{return false}}))(${JSON.stringify(String(tag))})`);
      if(!entity)await wait(.25);
    }
    if(!entity)return {ok:false,reason:'xiaohongshu selected native topic entity did not persist',tag,committed};
    committed.push(tag);
  }
  const after=await inspectXiaohongshu();
  return after.gates.description.ok&&after.gates.tags.ok?{ok:true,committed,nativeTopicMethod:'visible-editor-paste-native-caret-toolbar-exact-async-entity'}:{ok:false,reason:'xiaohongshu native topics/body final readback mismatch',committed,evidence:{description:after.gates.description.evidence,tags:after.gates.tags.evidence}};
}

async function uploadXhsCover() {
  if (!xhsCustomCover) return { ok: true, skipped: true };
  const before = await js(String.raw`(() => { const el=document.querySelector('.cover-plugin-preview .default.row, .cover-plugin-preview .default.column'); return el ? getComputedStyle(el).backgroundImage : '' })()`);
  let tab = { ok: false, reason: 'xiaohongshu upload-cover tab did not become visible' };
  for (let attempt = 0; attempt < 4 && !tab.ok; attempt += 1) {
    await removeExactStaleMask(/设置封面/);
    const existingEditor = await js(String.raw`(() => {
      const compact=value=>String(value||'').replace(/\s+/g,' ').trim()
      const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>10&&r.height>10&&s.display!=='none'&&s.visibility!=='hidden'}
      const modal=[...document.querySelectorAll('.main-cover-editor-modal,.d-modal,[role="dialog"]')]
        .find(el=>(el.matches('.main-cover-editor-modal')||/设置封面/.test(compact(el.innerText||el.textContent||'')))&&visible(el))
      const scope=modal||document
      const input=[...scope.querySelectorAll('input[type=file]')].find(el=>/image|png|jpe?g/i.test(el.accept||''))
      const uploaded=[...scope.querySelectorAll('.uploaded-thumbnail-img')].find(el=>el.naturalWidth>0&&el.naturalHeight>0&&visible(el))
      return uploaded
        ? {ok:true,alreadyUploaded:true,width:uploaded.naturalWidth,height:uploaded.naturalHeight}
        : {ok:!!input}
    })()`);
    if (existingEditor.ok) {
      tab = { ok: true, attempt: attempt + 1, mode: existingEditor.alreadyUploaded ? 'resume-uploaded-thumbnail' : 'direct-image-input', alreadyUploaded: existingEditor.alreadyUploaded === true };
      break;
    }
    const opener = await js(String.raw`((attempt) => {
      const compact=value=>String(value||'').replace(/\s+/g,' ').trim()
      const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>10&&r.height>10&&s.display!=='none'&&s.visibility!=='hidden'}
      const exact=[...document.querySelectorAll('button,[role="button"],div,span')]
        .filter(el=>compact(el.innerText||el.textContent||'')==='编辑封面'&&visible(el))
        .sort((a,b)=>{const ab=a.matches('button,[role="button"]')?0:1,bb=b.matches('button,[role="button"]')?0:1;if(ab!==bb)return ab-b;const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return ar.width*ar.height-br.width*br.height})
      const currentEntry=[...document.querySelectorAll('.cover-edit-entry')].find(visible)
      const currentStack=[...document.querySelectorAll('.cover-edit-stack')].find(visible)
      const currentOperator=[...document.querySelectorAll('.operator.default')].find(visible)
      const preview=document.querySelector('.cover-plugin-preview .default.row, .cover-plugin-preview .default.column')
      const targets=[currentEntry,currentStack,currentOperator,preview].filter(Boolean)
      const target=targets[attempt]||exact[0]||preview
      if(!target)return {ok:false,reason:'xiaohongshu cover editor opener missing'}
      target.scrollIntoView({block:'center',inline:'center'})
      if(target.matches('.cover-edit-entry')){target.click();return {ok:true,nativeHoverEntry:true,text:compact(target.innerText||target.textContent||'')}}
      document.querySelectorAll('#vp2-xhs-cover-opener').forEach(el=>el.removeAttribute('id'))
      target.id='vp2-xhs-cover-opener';return {ok:true,selector:'#vp2-xhs-cover-opener',text:compact(target.innerText||target.textContent||'')}
    })(${JSON.stringify(attempt)})`);
    if (!opener.ok) {
      tab = opener;
      continue;
    }
    if (!opener.nativeHoverEntry) {
      try {
        await click(opener.selector, { label: 'open xhs cover editor' });
      } catch (error) {
        tab = { ok: false, reason: `xiaohongshu cover preview click failed: ${String(error?.message || error)}` };
        continue;
      }
    }
    await wait(0.75);
    const openedAfterRealClick = await js(String.raw`(() => {
      const compact=value=>String(value||'').replace(/\s+/g,' ').trim()
      const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>10&&r.height>10&&s.display!=='none'&&s.visibility!=='hidden'}
      const modal=[...document.querySelectorAll('.main-cover-editor-modal,.d-modal,[role="dialog"]')]
        .find(el=>(el.matches('.main-cover-editor-modal')||/设置封面/.test(compact(el.innerText||el.textContent||'')))&&visible(el))
      const input=[...(modal?.querySelectorAll('input[type=file]')||[])].find(el=>/image|png|jpe?g/i.test(el.accept||''))
      return Boolean(modal||input)
    })()`);
    if (!openedAfterRealClick) {
      await js(String.raw`(() => {
        const target=document.querySelector('.cover-plugin-preview .cover-edit-entry')||document.querySelector('#vp2-xhs-cover-opener')
        if(!target)return {ok:false,reason:'xiaohongshu cover opener disappeared before native fallback'}
        target.click();return {ok:true}
      })()`);
    }
    for (let index = 0; index < 20; index += 1) {
      const exposed = await js(String.raw`(() => {
        const compact=value=>String(value||'').replace(/\s+/g,' ').trim()
        const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>10&&r.height>10&&s.display!=='none'&&s.visibility!=='hidden'}
        const modal=[...document.querySelectorAll('.main-cover-editor-modal,.d-modal,[role="dialog"]')]
          .find(el=>(el.matches('.main-cover-editor-modal')||/设置封面/.test(compact(el.innerText||el.textContent||'')))&&visible(el))
        const scope=modal||document
        const uploaded=[...scope.querySelectorAll('.uploaded-thumbnail-img')].find(el=>el.naturalWidth>0&&el.naturalHeight>0&&visible(el))
        if(uploaded)return {ok:true,alreadyUploaded:true}
        const input=[...scope.querySelectorAll('input[type=file]')].find(el=>/image|png|jpe?g/i.test(el.accept||''))
        if(input)return {ok:true,directInput:true}
        const item=[...scope.querySelectorAll('.d-tabs-header,[role="tab"],button,div,span')]
          .filter(el=>{const label=compact(el.innerText||el.textContent||'');return (/^(上传封面|上传)$/.test(label)||/^(上传图片|本地上传|从本地上传)$/.test(label))&&visible(el)})
          .sort((a,b)=>{const ap=a.matches('.d-tabs-header,[role="tab"],button')?0:1,bp=b.matches('.d-tabs-header,[role="tab"],button')?0:1;if(ap!==bp)return ap-bp;const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return ar.width*ar.height-br.width*br.height})[0]
        if(!item)return {ok:false,directInput:false}
        item.id='vp2-xhs-upload-cover-tab';item.scrollIntoView({block:'center',inline:'center'});return {ok:true,selector:'#vp2-xhs-upload-cover-tab'}
      })()`);
      if (exposed.ok) {
        if (exposed.alreadyUploaded) {
          tab = { ok: true, attempt: attempt + 1, waited: index * 0.5, mode: 'resume-uploaded-thumbnail', alreadyUploaded: true };
          break;
        }
        if (exposed.directInput) {
          tab = { ok: true, attempt: attempt + 1, waited: index * 0.5, mode: 'direct-image-input' };
          break;
        }
        try {
          await click(exposed.selector, { label: 'activate xhs upload-cover tab' });
          tab = { ok: true, attempt: attempt + 1, waited: index * 0.5 };
        } catch (error) {
          tab = { ok: false, reason: `xiaohongshu upload-cover tab click failed: ${String(error?.message || error)}` };
        }
        break;
      }
      await wait(0.5);
    }
  }
  if (!tab.ok) {
    const diagnostics = await js(String.raw`(() => {
      const compact=value=>String(value||'').replace(/\s+/g,' ').trim()
      const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'}
      const candidates=[...document.querySelectorAll('button,[role="button"],[role="tab"],div,span')]
        .filter(el=>visible(el)&&/封面|上传|本地|图片/.test(compact(el.innerText||el.textContent||'')))
        .map(el=>({tag:el.tagName,role:el.getAttribute?.('role')||'',className:String(el.className||'').slice(0,180),text:compact(el.innerText||el.textContent||'').slice(0,180)}))
        .filter((item,index,array)=>array.findIndex(other=>other.tag===item.tag&&other.role===item.role&&other.className===item.className&&other.text===item.text)===index)
        .slice(0,80)
      const dialogs=[...document.querySelectorAll('.main-cover-editor-modal,.d-modal,[role="dialog"],[class*="modal"],[class*="drawer"]')]
        .filter(visible)
        .map(el=>({tag:el.tagName,role:el.getAttribute?.('role')||'',className:String(el.className||'').slice(0,180),text:compact(el.innerText||el.textContent||'').slice(0,600)}))
        .slice(0,20)
      const inputs=[...document.querySelectorAll('input[type=file]')].map(el=>({accept:el.accept||'',className:String(el.className||''),outerHTML:String(el.outerHTML||'').slice(0,500)}))
      return {candidates,dialogs,inputs}
    })()`);
    return { ...tab, diagnostics };
  }
  const cropPanel=await activateXhsCropPanel();
  if(!cropPanel.ok)return {ok:false,reason:'xiaohongshu crop panel could not be activated',cropPanel};
  // Capture the native selection before a framework may reset its file input.
  let selectedFile=null;
  {
    await wait(1);
    const exposeInput = async () => await js(String.raw`(() => {
      const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>10&&r.height>10&&s.display!=='none'&&s.visibility!=='hidden'}
      const modal=[...document.querySelectorAll('.main-cover-editor-modal,.d-modal,[role="dialog"]')].find(e=>visible(e)&&/设置封面/.test(e.innerText||e.textContent||''))
      let inputs=[...(modal?.querySelectorAll('input[type=file]')||[])].filter(el=>/image|png|jpe?g/i.test(el.accept||''))
      if(!modal)return {ok:false,reason:'xiaohongshu active cover editor missing'}
      if(!inputs.length)inputs=[...document.querySelectorAll('input[type=file]')].filter(el=>/image|png|jpe?g/i.test(el.accept||''))
      if(inputs.length!==1)return {ok:false,reason:'xiaohongshu active cover input missing or ambiguous',count:inputs.length}
      const input=inputs[0];window.__VP2_XHS_SELECTED_FILE__=null
      input.addEventListener('change',()=>{const file=input.files?.[0];window.__VP2_XHS_SELECTED_FILE__=file?{name:file.name,size:file.size,type:file.type}:null},{capture:true,once:true})
      input.id='vp2-xhs-cover'; return {ok:true,selector:'#vp2-xhs-cover',accept:input.accept||''}
    })()`);
    let exposed=await exposeInput();
    if(!exposed.ok&&exposed.count===0){
      const clear=await js(String.raw`(()=>{const modal=document.querySelector('.main-cover-editor-modal');const buttons=[...(modal?.querySelectorAll('.uploaded-thumbnail-clear')||[])].filter(e=>e.getBoundingClientRect().width>0);if(buttons.length!==1)return {ok:false};buttons[0].click();return {ok:true}})()`);
      if(clear.ok){for(let i=0;i<12;i+=1){await wait(0.5);exposed=await exposeInput();if(exposed.ok)break}}
    }
    if (!exposed.ok) return exposed;
    try { await uploadFile(exposed.selector, xhsCoverPath); } catch (error) { return { ok: false, reason: String(error?.message || error) }; }
    await wait(2);
  }
  selectedFile=await js(String.raw`(() => window.__VP2_XHS_SELECTED_FILE__||null)()`);
  if(selectedFile?.name!==path.basename(xhsCoverPath)||selectedFile?.size!==fs.statSync(xhsCoverPath).size)return {ok:false,reason:'xiaohongshu requested cover file was not proven',selectedFile};
  const modernRatio=await js(String.raw`(() => {
    const modal=document.querySelector('.main-cover-editor-modal');
    const item=[...(modal?.querySelectorAll('button.ratio-option')||[])].find(e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()==='3:4');
    if(!item)return {ok:false};item.id='vp2-xhs-modern-ratio';return {ok:true,selector:'#vp2-xhs-modern-ratio'};
  })()`);
  if(modernRatio.ok){await click(modernRatio.selector,{label:'select xhs portrait crop ratio'});await wait(0.5);}
  let ratio = modernRatio.ok?{ok:true}:await js(String.raw`(() => {
    const item=[...document.querySelectorAll('.crop-ratio-item')].find(el=>String(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim()==='3:4')
    if(!item)return {ok:false,reason:'legacy-ratio-control-missing'}
    item.click(); return {ok:true,className:String(item.className||'')}
  })()`);
  if (!ratio.ok) {
    const ratioControl = await js(String.raw`(() => {
      const compact=value=>String(value||'').replace(/\s+/g,' ').trim()
      const modal=[...document.querySelectorAll('.main-cover-editor-modal,.d-modal,[role="dialog"]')]
        .find(el=>el.matches('.main-cover-editor-modal')||/设置封面/.test(compact(el.innerText||el.textContent||'')))
      const item=modal?.querySelector('.ratio-select')
      if(!item){
        return {ok:false,reason:'xiaohongshu crop ratio selector missing in the active crop panel'}
      }
      if(String(item.innerText||item.textContent||'').replace(/\s+/g,' ').trim()==='3:4')return {ok:true,already:true}
      item.id='vp2-xhs-ratio-select';return {ok:true,selector:'#vp2-xhs-ratio-select'}
    })()`);
    if (!ratioControl.ok) return ratioControl;
    if (!ratioControl.already) {
      try { await click(ratioControl.selector, { label: 'open xhs cover ratio selector' }); } catch (error) { return { ok: false, reason: `xiaohongshu ratio selector click failed: ${String(error?.message || error)}` }; }
      await wait(0.5);
      const ratioItem = await js(String.raw`(() => {
        const item=[...document.querySelectorAll('.ratio-select-menu .ratio-item')].find(el=>String(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim()==='3:4')
        if(!item)return {ok:false,reason:'xiaohongshu 3:4 ratio option missing'}
        item.id='vp2-xhs-ratio-3x4';return {ok:true,selector:'#vp2-xhs-ratio-3x4'}
      })()`);
      if (!ratioItem.ok) return ratioItem;
      try { await click(ratioItem.selector, { label: 'select xhs 3:4 cover ratio' }); } catch (error) { return { ok: false, reason: `xiaohongshu 3:4 ratio click failed: ${String(error?.message || error)}` }; }
      await wait(0.5);
    }
    ratio = await js(String.raw`(() => {
        const modal=[...document.querySelectorAll('.main-cover-editor-modal,.d-modal,[role="dialog"]')].find(el=>el.matches('.main-cover-editor-modal')||/设置封面/.test(el.innerText||el.textContent||''))
        const actual=String(modal?.querySelector('.ratio-select')?.innerText||modal?.querySelector('.ratio-select')?.textContent||'').replace(/\s+/g,' ').trim()
        const control=modal?.querySelector('.ratio-select');const rect=control?.getBoundingClientRect();const controlVisible=Boolean(rect&&rect.width>4&&rect.height>4);return actual==='3:4'?{ok:true,actual,controlVisible}:{ok:false,reason:'xiaohongshu 3:4 ratio did not persist',actual,controlVisible}
      })()`);
  }
  if (!ratio.ok) return ratio;
  const cropProof=await js(String.raw`(() => {
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};
    const modal=[...document.querySelectorAll('.main-cover-editor-modal,.d-modal,[role="dialog"]')].find(e=>visible(e)&&/设置封面/.test(e.innerText||e.textContent||''));
    const modern=modal?.querySelector('button.ratio-option.active');
    if(modern&&visible(modern))return {actual:String(modern.innerText||modern.textContent||'').replace(/\s+/g,' ').trim(),controlVisible:true,mode:'ratio-option'};
    const current=modal?.querySelector('.ratio-select');
    if(current&&visible(current))return {actual:String(current.innerText||current.textContent||'').replace(/\s+/g,' ').trim(),controlVisible:true};
    const legacy=[...(modal?.querySelectorAll('.crop-ratio-item')||[])].find(e=>visible(e)&&/^(active|selected)$/.test(String(e.className||'').split(/\s+/).find(x=>/^(active|selected)$/.test(x))||''));
    return {actual:String(legacy?.innerText||legacy?.textContent||'').trim(),controlVisible:Boolean(legacy)};
  })()`);
  if(!xhsCoverCropMatches(cropProof))return {ok:false,reason:'xiaohongshu crop ratio was not proven as 3:4',cropProof};
  await wait(1);
  let confirmed = {ok:false};
  for(let attempt=0;attempt<20;attempt+=1){
    confirmed = await js(String.raw`(() => {
    const compact=value=>String(value||'').replace(/\s+/g,' ').trim()
    const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>10&&r.height>10&&s.display!=='none'&&s.visibility!=='hidden'}
    const modal=[...document.querySelectorAll('.main-cover-editor-modal,.d-modal,[role="dialog"]')]
      .find(el=>(el.matches('.main-cover-editor-modal')||/设置封面/.test(compact(el.innerText||el.textContent||'')))&&visible(el))
    const buttons=[...(modal?.querySelectorAll('button')||[])].filter(el=>/^(确定|完成)$/.test(compact(el.innerText||el.textContent||''))&&!el.disabled&&visible(el))
    if(buttons.length!==1)return {ok:false,reason:'xiaohongshu cover confirm missing, disabled, or ambiguous',count:buttons.length}
    buttons[0].click(); return {ok:true}
  })()`);
    if(confirmed.ok)break;
    await wait(0.5);
  }
  if (!confirmed.ok) return confirmed;
  let after = '';
  let coverProcessingSettled = false;
  for (let index = 0; index < 60; index += 1) {
    const current = await js(String.raw`(() => { const el=document.querySelector('.cover-plugin-preview .default.row, .cover-plugin-preview .default.column'); const text=document.body.innerText||''; const modal=document.querySelector('.main-cover-editor-modal');const rect=modal?.getBoundingClientRect();return {bg:el?getComputedStyle(el).backgroundImage:'',uploading:/封面上传中|正在上传|处理中/.test(text),modalClosed:!rect||rect.width===0||rect.height===0} })()`);
    after = current.bg;
    if (after && !current.uploading && current.modalClosed) { coverProcessingSettled = true; break; }
    await wait(2);
  }
  if (!coverProcessingSettled) return {ok:false,reason:'xiaohongshu cover editor or processing did not settle after confirmation'};
  await removeExactStaleMask(/设置封面/);
  if (!after) return { ok: false, reason: 'xiaohongshu cover preview missing after proven upload and confirmation', before, after };
  const url = (after.match(/url\(["']?([^"')]+)/) || [])[1] || after;
  const acceptedImage=await readXhsAcceptedImage(url);
  if(!acceptedImage.loaded||Math.abs(acceptedImage.width/acceptedImage.height-0.75)>=0.01)return {ok:false,reason:'xiaohongshu accepted cover is not 3:4',acceptedImage};
  return { ok: true, receipt: { assetPath: xhsCoverPath, ratio: '3:4', beforeUrl: before, afterUrl: url,selectedFile,cropProof,acceptedImage } };
}

async function ensureXiaohongshuEarlyMetadata(before) {
  const actions = {};
  if (!before.gates.title.ok) actions.title = await setNativeInputValue('input[placeholder*="填写标题"]', xhsTitle);
  let current = await inspectXiaohongshu();
  if (!current.gates.title.ok) {
    return { ok: false, actions, current, blocker: typedBlocker('ACTION_FAILED', '小红书标题没有持久化', { evidence: current.gates.title.evidence }) };
  }
  if (!current.gates.tags.ok || !current.gates.description.ok) actions.tags = await rebuildXhsTopics();
  if (actions.tags && !actions.tags.ok) {
    current = await inspectXiaohongshu();
    return { ok: false, actions, current, blocker: typedBlocker('ACTION_FAILED', actions.tags.reason, { evidence: actions.tags }) };
  }
  current = await inspectXiaohongshu();
  return { ok: current.gates.title.ok && current.gates.tags.ok, actions, current };
}

async function ensureXhsOriginalDeclaration() {
  const before = await inspectXiaohongshu();
  if (xhsDeclarationChoice === 'none') {
    return before.gates.original.ok ? {ok:true, skipped:true, choice:'none'} : {ok:false, reason:'preselected_original_declaration_conflicts_with_package_none', evidence:before.gates.original.evidence};
  }
  if (before.gates.original.ok) return {ok:true, alreadyEnabled:true, choice:'original'};
  const toggle = await js(String.raw`(() => {
    const root=document.querySelector('.publish-page-content-setting-content');
    const label=[...(root?.querySelectorAll('div,section,label,span')||[])].filter(el=>String(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim()==='原创声明').sort((a,b)=>a.getBoundingClientRect().width*a.getBoundingClientRect().height-b.getBoundingClientRect().width*b.getBoundingClientRect().height)[0];
    const selectors='.custom-switch-switch, .d-switch, [role="switch"], input[type="checkbox"]';
    const ancestors=[];for(let el=label;el&&ancestors.length<8;el=el.parentElement)ancestors.push(el);
    const row=ancestors.find(el=>el.matches?.(selectors)||el.querySelector?.(selectors))||label?.parentElement;
    const control=row?.matches?.('.d-switch,[role="switch"]')?row:row?.querySelector?.('.d-switch,[role="switch"]');
    if(!control)return {ok:false,reason:'original switch missing'};
    const input=control.querySelector('input[type=checkbox]');
    const on=input?.checked===true||control.getAttribute('aria-checked')==='true'||control.querySelector('.d-switch-simulator.checked')!==null;
    control.id='vp2-xhs-original-switch';
    return {ok:true,wasEnabled:on,selector:'#vp2-xhs-original-switch'};
  })()`);
  if(!toggle.ok)return toggle;
  if(!toggle.wasEnabled)await click(toggle.selector,{label:'select Xiaohongshu original declaration'});
  await wait(0.8);
  const agreement=await js(String.raw`(() => {const box=document.querySelector('.originalContainer .d-checkbox');if(!box)return {ok:false,reason:'original agreement checkbox missing'};const input=box.querySelector('input[type=checkbox]');const checked=input?.checked===true||box.getAttribute('aria-checked')==='true'||/checked|selected/.test(String(box.className||''));if(!checked)box.click();return {ok:true,wasChecked:checked}})()`);
  if(!agreement.ok)return agreement;
  let confirm={ok:false,reason:'original confirmation remains disabled'};
  for(let attempt=0;attempt<20;attempt+=1){
    confirm=await js(String.raw`(() => {const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];const modal=document.querySelector('.originalContainer');const agreement=modal?.querySelector('.d-checkbox');const input=agreement?.querySelector('input[type=checkbox]');const checked=input?.checked===true||agreement?.getAttribute('aria-checked')==='true'||/checked|selected/.test(String(agreement?.className||''));const buttons=roots.flatMap(r=>[...r.querySelectorAll('button,[role=button],.d-button')]).filter(e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()==='声明原创'&&e.getBoundingClientRect().width>12&&e.getBoundingClientRect().height>12);if(!modal||!checked)return {ok:false,reason:'original agreement not checked',checked,count:buttons.length};if(buttons.length!==1)return {ok:false,reason:'original confirmation button missing_or_ambiguous',count:buttons.length};const b=buttons[0];if(b.disabled||b.getAttribute('aria-disabled')==='true')return {ok:false,reason:'original confirmation remains disabled'};b.click();return {ok:true}})()`);
    if(confirm.ok)break;
    if(confirm.reason!=='original confirmation remains disabled')return confirm;
    await wait(.25);
  }
  if(!confirm.ok)return confirm;
  await wait(1);
  const after=await inspectXiaohongshu();
  return after.gates.original.ok&&!after.gates.noBlockingDialog.evidence?.active?.some(item=>/原创|声明/.test(item.text||''))
    ? {ok:true,choice:'original',persisted:true}
    : {ok:false,reason:'original declaration was not confirmed and closed',evidence:after.gates.original.evidence,dialogs:after.gates.noBlockingDialog.evidence};
}

async function setXhsSearchValue(selector,value) {
  if(typeof boundPage==='function') {
    await boundPage().fill(selector,value);
    return await js(String.raw`((selector,value)=>{const e=document.querySelector(selector);return {ok:!!e&&e.value===value,value:e?.value}})(${JSON.stringify(selector)},${JSON.stringify(value)})`);
  }
  return await js(String.raw`((selector,value)=>{const e=document.querySelector(selector);if(!e)return {ok:false,reason:'search input missing'};const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)return {ok:false,reason:'native setter missing'};e.focus();setter.call(e,value);e.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:value}));return {ok:e.value===value,value:e.value}})(${JSON.stringify(selector)},${JSON.stringify(value)})`);
}

async function chooseXhsExactOption(scopeSelector, exactName, exactAddress, label) {
  const state=await js(String.raw`((scopeSelector,name,address) => {
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};
    const c=e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();
    const scope=document.querySelector(scopeSelector);if(!scope)return {ok:false,reason:'scope_missing',scopeSelector};
    const text=c(scope);if(text.includes(name)&&text.includes(address))return {ok:true,alreadySelected:true,text};
    const main=[...scope.querySelectorAll('.d-select-main,.d-select,[role=combobox],.marker-wrapper')].find(visible);
    if(!main)return {ok:false,reason:'native_location_control_missing',text};main.id='vp2-xhs-'+(scopeSelector.includes('setting')?'source':'poi')+'-selector';return {ok:true,selector:'#'+main.id,text};
  })(${JSON.stringify(scopeSelector)},${JSON.stringify(exactName)},${JSON.stringify(exactAddress)})`);
  if(!state.ok||state.alreadySelected)return state;
  await click(state.selector,{label:`open exact Xiaohongshu ${label} selector`});
  await wait(.5);
  const input=await js(String.raw`(() => {const inputs=[...document.querySelectorAll('input')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'});const scope=document.querySelector('#vp2-xhs-poi-selector');const item=scope?.querySelector('input')||inputs.find(e=>/地点|搜索|选择/.test(e.placeholder||''));return item?{ok:true,selector:item.id?('#'+item.id):(item.id='vp2-xhs-location-search','#vp2-xhs-location-search')}:{ok:false,reason:'location_search_input_missing'}})()`);
  if(!input.ok)return input;
  if(input.ok){const typed=await setXhsSearchValue(input.selector,exactName);if(!typed.ok)return {...typed,reason:'location_query_failed'};await wait(1);}
  const option=await js(String.raw`((name,address) => {const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>12&&r.height>10&&s.display!=='none'&&s.visibility!=='hidden'};const c=e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];const rows=roots.flatMap(root=>[...root.querySelectorAll('[role=option],li,.d-select-item,.item,[class*=option],[class*=Option]')]).filter(visible).map(el=>({el,text:c(el)})).filter(x=>x.text.includes(name)&&x.text.includes(address));const exact=rows.filter(x=>!rows.some(y=>y!==x&&x.el.contains(y.el)));if(!exact.length)return {ok:false,reason:'exact_location_candidate_missing',matches:[]};exact[0].el.id='vp2-xhs-exact-location';exact[0].el.click();return {ok:true,selectedText:exact[0].text,exactMatches:exact.length}})(${JSON.stringify(exactName)},${JSON.stringify(exactAddress)})`);
  if(!option.ok)return option;
  await wait(.5);
  const after=await js(String.raw`((scopeSelector,name,address) => {const scope=document.querySelector(scopeSelector);const text=String(scope?.innerText||scope?.textContent||'').replace(/\s+/g,' ').trim();return {ok:Boolean(scope&&text.includes(name)),text}})(${JSON.stringify(scopeSelector)},${JSON.stringify(exactName)},${JSON.stringify(exactAddress)})`);
  return after.ok?{ok:true,selectedText:after.text,receipt:{selected:true,name:exactName,address:exactAddress,selectedText:option.selectedText}}:{ok:false,reason:'exact_location_not_persisted',...after};
}

async function ensureXhsPoi() {
  if(!xhsPoi)return {ok:true,skipped:true,reason:'not_requested'};
  return chooseXhsExactOption('.publish-page-content-component-content',xhsPoi?.name||'',xhsPoi?.address||'','POI');
}

async function setXhsSourceDate(value) {
  const current=await js(String.raw`(()=>{const input=document.querySelector('.self-shooting-contain .d-datepicker-input-filter input');const calendar=[...document.querySelectorAll('.d-datepicker-calendar')].find(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);return {value:input?.value,open:!!calendar}})()`);
  if(current.value===value)return {ok:true,alreadySelected:true};
  if(!current.open)await click('.self-shooting-contain .d-datepicker-main',{label:'open native source date calendar'});
  const date=await js(String.raw`((value)=>{const [year,month,day]=value.split('-').map(Number);const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;const calendars=[...document.querySelectorAll('.d-datepicker-calendar')].filter(visible);if(calendars.length!==1)return {ok:false,reason:'native date calendar ambiguous'};const cal=calendars[0],head=String(cal.querySelector('.d-datepicker-header')?.innerText||'').replace(/\s+/g,' ').trim();if(!head.includes(year+'年')||!head.includes(month+'月'))return {ok:false,reason:'native date calendar month mismatch',actual:head,expected:year+'年 '+month+'月'};const cells=[...cal.querySelectorAll('.d-datepicker-cell')].filter(e=>visible(e)&&!e.classList.contains('disabled')&&!e.className.includes('color-text-placeholder')&&String(e.innerText||e.textContent||'').trim()===String(day));if(cells.length!==1)return {ok:false,reason:'native enabled date cell ambiguous',count:cells.length};cells[0].id='vp2-xhs-source-date-cell';return {ok:true,selector:'#vp2-xhs-source-date-cell'}})(${JSON.stringify(value)})`);
  if(!date.ok)return date;
  await click(date.selector,{label:'select exact native source date'});await wait(.4);
  return await js(String.raw`((value)=>{const input=document.querySelector('.self-shooting-contain .d-datepicker-input-filter input');return {ok:input?.value===value,value:input?.value}})(${JSON.stringify(value)})`);
}

async function ensureXhsContentSource() {
  if(!xhsContentSource)return {ok:true,skipped:true,reason:'not_requested'};
  const before=await inspectXiaohongshu();if(before.gates.contentSource.ok)return {ok:true,alreadySelected:true};
  if(xhsContentSource.type==='ai_generated'){
    const dropdown=await js(String.raw`(() => {const root=document.querySelector('.publish-page-content-setting-content');const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'};const selects=[...(root?.querySelectorAll('.d-select-main')||[])].filter(visible);const exact=selects.filter(e=>/添加内容类型声明|自主拍摄|笔记含AI合成内容/.test(String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()));if(exact.length!==1)return {ok:false,reason:'content-source-selector-missing_or_ambiguous',count:exact.length};exact[0].id='vp2-xhs-content-source';return {ok:true,selector:'#vp2-xhs-content-source'}})()`);
    if(!dropdown.ok)return dropdown;
    const optionIsOpen=await js(String.raw`(()=>[...document.querySelectorAll('.d-option')].some(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>8&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()==='笔记含AI合成内容'}))()`);
    if(!optionIsOpen){await click(dropdown.selector,{label:'open Xiaohongshu content declaration'});await wait(.4);}
    const aiOption=await js(String.raw`(() => {const rows=[...document.querySelectorAll('.d-option')].filter(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>8&&b.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()==='笔记含AI合成内容'});if(rows.length!==1)return {ok:false,reason:'ai-content-declaration-option-missing_or_ambiguous',count:rows.length};rows[0].id='vp2-xhs-ai-content-source';rows[0].click();return {ok:true,selectedText:String(rows[0].innerText||rows[0].textContent||'').replace(/\s+/g,' ').trim()}})()`);
    if(!aiOption.ok)return aiOption;
    await wait(.5);const after=await inspectXiaohongshu();return after.gates.contentSource.ok?{ok:true,persisted:true,selected:'笔记含AI合成内容',evidence:after.gates.contentSource.evidence}:{ok:false,reason:'ai-content-declaration-not-persisted',evidence:after.gates.contentSource.evidence};
  }
  if(xhsContentSource.type!=='self_shot')return {ok:false,reason:'unsupported_xhs_content_source_type',type:xhsContentSource.type};
  const detailOpen=await js(String.raw`(()=>{const e=document.querySelector('.self-shooting-contain');return !!e&&e.getBoundingClientRect().width>20&&e.getBoundingClientRect().height>20})()`);
  if(!detailOpen){
  const dropdown=await js(String.raw`(() => {const root=document.querySelector('.publish-page-content-setting-content');const selects=[...(root?.querySelectorAll('.d-select-main')||[])].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'});const exact=selects.filter(e=>/添加内容类型声明|自主拍摄/.test(String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()));if(exact.length!==1)return {ok:false,reason:'content-source-selector-missing_or_ambiguous',count:exact.length};exact[0].id='vp2-xhs-content-source';return {ok:true,selector:'#vp2-xhs-content-source'}})()`);
  if(!dropdown.ok)return dropdown;const alreadyOpen=await js(String.raw`(()=>[...document.querySelectorAll('.d-option')].some(e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&String(e.innerText||e.textContent||'').trim()==='内容来源声明'))()`);if(!alreadyOpen)await click(dropdown.selector,{label:'open Xiaohongshu content source'});await wait(.4);
  const sourceChoice=await js(String.raw`(() => {const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];const rows=roots.flatMap(r=>[...r.querySelectorAll('.d-option')]).filter(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>8&&b.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()==='内容来源声明'});if(rows.length!==1)return {ok:false,reason:'content-source-menu-item-missing_or_ambiguous',count:rows.length};rows[0].id='vp2-xhs-source-menu';return {ok:true,selector:'#vp2-xhs-source-menu'}})()`);
  if(!sourceChoice.ok)return sourceChoice;await hover(sourceChoice.selector,{label:'reveal Xiaohongshu content source options'});await wait(.3);
  const selfShot=await js(String.raw`(() => {const roots=[document,...[...document.querySelectorAll('*')].map(e=>e.shadowRoot).filter(Boolean)];const rows=roots.flatMap(r=>[...r.querySelectorAll('.d-option')]).filter(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>8&&b.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()==='自主拍摄'});if(rows.length!==1)return {ok:false,reason:'self-shot-option-missing_or_ambiguous',count:rows.length};rows[0].id='vp2-xhs-self-shot';rows[0].click();return {ok:true}})()`);
  if(!selfShot.ok)return selfShot;await wait(.5);
  }
  const fill=await js(String.raw`((source) => {const modal=[...document.querySelectorAll('.self-shooting-contain')].find(e=>e.getBoundingClientRect().width>20&&e.getBoundingClientRect().height>20);if(!modal)return {ok:false,reason:'source-detail-modal-missing'};const loc=modal.querySelector('input[placeholder="下拉选择地点"],input[placeholder*="选择地点"]');const date=modal.querySelector('.d-datepicker-input-filter input, input[placeholder*="日期"], input[placeholder*="时间"]');if(!loc||!date)return {ok:false,reason:'source-location-or-date-input-missing',location:!!loc,date:!!date};return {ok:true,locationSelector:loc.id?('#'+loc.id):(loc.id='vp2-xhs-source-location','#vp2-xhs-source-location'),dateSelector:date.id?('#'+date.id):(date.id='vp2-xhs-source-date','#vp2-xhs-source-date')}})(${JSON.stringify(xhsContentSource)})`);
  if(!fill.ok)return fill;
  const locationQuery=await setXhsSearchValue(fill.locationSelector,xhsContentSource.locationName);if(!locationQuery.ok)return {...locationQuery,reason:'source-location-query-failed'};await wait(.8);
  const locationOption=await js(String.raw`((name,address) => {const modal=[...document.querySelectorAll('.self-shooting-contain')].find(e=>e.getBoundingClientRect().width>20&&e.getBoundingClientRect().height>20);const visible=e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>8&&b.height>8&&s.display!=='none'&&s.visibility!=='hidden'};const rows=[...document.querySelectorAll('.el-autocomplete-suggestion li,[role=option],.d-option')].filter(visible).map(e=>({e,text:String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()})).filter(x=>x.text.includes(name)&&x.text.includes(address));if(!rows.length)return {ok:false,reason:'source-location-exact-option-missing',matches:[]};rows[0].e.click();return {ok:true,text:rows[0].text}})(${JSON.stringify(xhsContentSource.locationName)},${JSON.stringify(xhsContentSource.locationAddress)})`);
  if(!locationOption.ok)return locationOption;
  const dateValue=await setXhsSourceDate(xhsContentSource.date);if(!dateValue.ok)return {...dateValue,reason:'source-date-fill-failed'};
  const confirm=await js(String.raw`(() => {const modal=[...document.querySelectorAll('.self-shooting-contain')].find(e=>e.getBoundingClientRect().width>20&&e.getBoundingClientRect().height>20);const date=modal?.querySelector('.d-datepicker-input-filter input');const buttons=[...(modal?.querySelectorAll('button,[role=button],.d-button')||[])].filter(e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()==='确认');if(!modal||!date||date.value!==${JSON.stringify(xhsContentSource.date)}||buttons.length!==1||buttons[0].disabled||buttons[0].getAttribute('aria-disabled')==='true')return {ok:false,reason:'source-confirm-not-ready',date:date?.value,buttons:buttons.length};buttons[0].click();return {ok:true}})()`);
  if(!confirm.ok)return confirm;await wait(1);const after=await inspectXiaohongshu();return after.gates.contentSource.ok?{ok:true,persisted:true,evidence:after.gates.contentSource.evidence}:{ok:false,reason:'source-date-location-not-persisted',evidence:after.gates.contentSource.evidence};
}

async function ensureXhsPrivateMessageComponent() {
  if(xhsPrivateMessageComponent!=='if_available')return {ok:true,skipped:true};
  const current=await inspectXiaohongshu();if(current.gates.privateMessageComponent.ok)return {ok:true,skipped:true,evidence:current.gates.privateMessageComponent.evidence};
  const probe=await js(String.raw`(()=>{const root=document.querySelector('.publish-page-content-component-content');if(!root)return {ok:false,reason:'component region missing'};const controls=[...root.querySelectorAll('.wrapper')].map(e=>({e,text:String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()}));const direct=controls.filter(x=>/私信/.test(x.text));if(direct.length){if(direct.length!==1)return {ok:false,reason:'private component entry ambiguous'};direct[0].e.id='vp2-xhs-private-component';return {ok:true,offered:true,selector:'#vp2-xhs-private-component'}};const group=controls.find(x=>/选择群聊/.test(x.text));const target=group?.e.querySelector('.d-select-main');if(target)target.id='vp2-xhs-component-menu-probe';return {ok:true,offered:false,selector:target?'#vp2-xhs-component-menu-probe':null,controls:controls.map(x=>x.text)}})()`);
  if(!probe.ok)return probe;
  const menuAlreadyOpen=await js(String.raw`(()=>String(document.body.innerText||'').includes('暂无群聊'))()`);
  if(probe.selector&&!menuAlreadyOpen)await click(probe.selector,{label:probe.offered?'select Xiaohongshu private message component':'inspect current Xiaohongshu component menu'});
  await wait(.5);
  const menu=await js(String.raw`(()=>{const visible=e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>0&&b.height>0&&s.display!=='none'&&s.visibility!=='hidden'};const menus=[...document.querySelectorAll('.d-popup,.d-popover,.d-options,[role=menu],[role=listbox],[class*=dropdown]')].filter(visible).map(e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean);const groupEmpty=String(document.body.innerText||'').includes('暂无群聊');return {menus:menus.map(x=>x.slice(0,1000)),groupEmpty,privateOffered:menus.some(x=>/私信/.test(x))}})()`);
  if(probe.offered||menu.privateOffered){const after=await inspectXiaohongshu();return after.gates.privateMessageComponent.ok?{ok:true,selected:true,evidence:after.gates.privateMessageComponent.evidence}:{ok:false,reason:'private component offered but mounting not verified',menu};}
  if(probe.selector&&!menu.groupEmpty&&!menu.menus.length)return {ok:false,reason:'native component dropdown observation unavailable'};
  if(probe.selector)await click(probe.selector,{label:'close observed Xiaohongshu component dropdown'});
  const receipt={status:'NOT_FOUND_IN_CURRENT_OPEN_MENU',offered:false,selected:false,videoName:xhsVideoName,checkedRegions:['current component controls','native group selector menu'],controls:probe.controls,menu,scope:'current form only; not an entitlement/global absence conclusion'};
  expectedReceipts.component=receipt;checkpointReceipts(expectedReceipts);return {ok:true,receipt};
}

async function prefillXiaohongshu() {
  const before = await inspectXiaohongshu();
  if (!before.gates.authenticated.ok) {
    return { ...before, blocker: typedBlocker('AUTH_REQUIRED', '小红书登录状态失效', { requiresUser: true, evidence: before.gates.authenticated.evidence }) };
  }
  if (!before.gates.draftIdentity.ok) {
    return { ...before, blocker: typedBlocker('FOREIGN_DRAFT', '小红书当前编辑器属于其他视频草稿', { evidence: before.gates.draftIdentity.evidence }) };
  }
  if (xhsDeclarationChoice === 'none' && !before.gates.original.ok) {
    return { ...before, blocker: typedBlocker('DECLARATION_MISMATCH', '小红书页面已有原创声明，但package声明为none；不自动关闭用户已选声明', { requiresUser: true, evidence: before.gates.original.evidence }) };
  }
  const uploading = before.gates.video.evidence?.uploading === true;
  if (!before.gates.video.ok && (!uploading || before.evidence?.earlyMutation?.ready !== true)) {
    return { ...before, blocker: typedBlocker('STATE_AMBIGUOUS', '小红书上传中的编辑区尚未完整就绪', { retryable: true, evidence: before.evidence?.earlyMutation }) };
  }
  const metadata = await ensureXiaohongshuEarlyMetadata(before);
  if (!metadata.ok) return { ...metadata.current, actions: metadata.actions, blocker: metadata.blocker };
  return { ...metadata.current, actions: { ...metadata.actions, prefill: { completedDuringUpload: uploading } } };
}

async function mutateXiaohongshu() {
  const before = await inspectXiaohongshu();
  if (!before.gates.video.ok) return { ...before, blocker: typedBlocker('STATE_AMBIGUOUS', '小红书没有可修复的已上传视频') };
  const actions = {};
  if (xhsDeclarationChoice === 'original' && !before.gates.original.ok) actions.original = await ensureXhsOriginalDeclaration();
  else if (!before.gates.original.ok) return { ...before, blocker: typedBlocker('DECLARATION_MISMATCH', '小红书页面已有原创声明，但package声明为none；不自动关闭用户已选声明', { requiresUser: true, evidence: before.gates.original.evidence }) };
  if (actions.original && !actions.original.ok) return { ...(await inspectXiaohongshu()), actions, blocker: typedBlocker('ACTION_FAILED', '小红书原创声明未能按本次明确声明确认', { evidence: actions.original }) };
  const metadata = await ensureXiaohongshuEarlyMetadata(await inspectXiaohongshu());
  Object.assign(actions, metadata.actions);
  if (!metadata.ok) return { ...metadata.current, actions, blocker: metadata.blocker };
  actions.poi = before.gates.poi.ok ? {ok:true,skipped:true} : await ensureXhsPoi();
  if (!actions.poi.ok) return { ...(await inspectXiaohongshu()), actions, blocker: typedBlocker('ACTION_FAILED', '未选到完全匹配的学校POI', { evidence: actions.poi }) };
  if(actions.poi.receipt){expectedReceipts.poi=actions.poi.receipt;actions.poi.receiptCheckpoint=checkpointReceipts(expectedReceipts)}
  actions.contentSource = before.gates.contentSource.ok ? {ok:true,skipped:true} : await ensureXhsContentSource();
  if (!actions.contentSource.ok) return { ...(await inspectXiaohongshu()), actions, blocker: typedBlocker('ACTION_FAILED', '自主拍摄来源地点/日期未能持久化', { evidence: actions.contentSource }) };
  actions.privateMessageComponent=await ensureXhsPrivateMessageComponent();
  if(!actions.privateMessageComponent.ok)return { ...(await inspectXiaohongshu()),actions,blocker:typedBlocker('ACTION_FAILED','私信组件检查或挂载未完成',{evidence:actions.privateMessageComponent})};
  const componentState = (await inspectXiaohongshu()).gates.privateMessageComponent;
  if (xhsPrivateMessageComponent && !componentState.ok) return { ...(await inspectXiaohongshu()), actions, blocker: typedBlocker('ACTION_FAILED', '发现私信组件但未能证明其已挂载，或尚未核对当前私信组件菜单；停止发布', { evidence: componentState.evidence }) };
  actions.cover = (await inspectXiaohongshu()).gates.cover.ok ? {ok:true,skipped:true} : await uploadXhsCover();
  if (!actions.cover.ok) return { ...(await inspectXiaohongshu()), blocker: typedBlocker('PLATFORM_REJECTED_ASSET', actions.cover.reason, { retryable: true, evidence: actions.cover }) };
  const receipts = { ...expectedReceipts, ...(actions.cover.receipt ? { cover: actions.cover.receipt } : {}) };
  const previousReceipts = { ...expectedReceipts };
  expectedReceipts.cover = receipts.cover || expectedReceipts.cover;
  const after = await inspectXiaohongshu();
  Object.assign(expectedReceipts, previousReceipts, receipts);
  actions.receiptCheckpoint = checkpointReceipts(expectedReceipts);
  return { ...after, actions, receipts };
}

async function runPlatformPhase() {
  if (phase === 'inspect' || phase === 'verify') return await inspectXiaohongshu();
  if (phase === 'upload_start') return await startXiaohongshuUpload();
  if (phase === 'prefill') return await prefillXiaohongshu();
  if (phase === 'upload') return await uploadXiaohongshu();
  if (phase === 'mutate') return await mutateXiaohongshu();
  return { ...(await inspectXiaohongshu()), blocker: typedBlocker('ACTION_FAILED', `unsupported Xiaohongshu phase: ${phase}`) };
}
