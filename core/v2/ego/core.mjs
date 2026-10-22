const V2_RESULT_PREFIX = 'VIDEO_PUBLISHER_V2_RESULT:';
const PLATFORM_URLS = {
  xiaohongshu: 'https://creator.xiaohongshu.com/publish/publish?source=official&from=menu&target=video',
  douyin: 'https://creator.douyin.com/creator-micro/content/upload',
  bilibili: 'https://member.bilibili.com/platform/upload/video/frame?spm_id_from=333.1007.top_bar.upload',
  wechat_channels: 'https://channels.weixin.qq.com/platform/post/create',
  youtube: 'https://studio.youtube.com/',
};
const DOUYIN_UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload';
const DOUYIN_MANAGE_URL = 'https://creator.douyin.com/creator-micro/content/manage';
const DOUYIN_HOME_URL = 'https://creator.douyin.com/creator-micro/home';
const PLATFORM_HOSTS = {
  xiaohongshu: /creator\.xiaohongshu\.com/,
  douyin: /creator\.douyin\.com/,
  bilibili: /member\.bilibili\.com/,
  wechat_channels: /channels\.weixin\.qq\.com/,
  youtube: /studio\.youtube\.com|accounts\.google\.com/,
};
const FINAL_TEXT = /^(发布|发布笔记|发表|立即投稿)$/;
const YOUTUBE_FINAL_TEXT = /^(保存|发布|安排时间|Save|Publish|Schedule)$/i;
const FINAL_GUARD_KEY = '__VIDEO_PUBLISHER_FINAL_GUARD__';
let activeTaskSpace = null;
let taskSpaceRecovery = null;
let taskSpaceBlocker = null;

const compactText = value => String(value || '').replace(/\s+/g, ' ').trim();
const unique = values => [...new Set((values || []).filter(Boolean))];

function typedBlocker(code, message, options = {}) {
  return {
    code,
    message,
    retryable: options.retryable === true,
    requiresUser: options.requiresUser === true,
    evidence: options.evidence || null,
  };
}

function okGate(evidence = {}, extra = {}) {
  return { ok: true, evidence, ...extra };
}

function failedGate(evidence = {}, extra = {}) {
  return { ok: false, evidence, ...extra };
}

function isPersonalDouyinInspectOnly() {
  return platform === 'douyin'
    && typeof douyinPersonalInspectOnlyActive !== 'undefined'
    && douyinPersonalInspectOnlyActive === true;
}

function isPersonalDouyinPostResultSurfaceRecovery() {
  return platform === 'douyin'
    && typeof douyinPersonalPostResultSurfaceRecoveryActive !== 'undefined'
    && douyinPersonalPostResultSurfaceRecoveryActive === true;
}

function isPersonalDouyinPostResultDraftContinuation() {
  return platform === 'douyin'
    && typeof douyinPersonalPostResultDraftContinuationActive !== 'undefined'
    && douyinPersonalPostResultDraftContinuationActive === true;
}

function douyinCreatorPublicIdMatchField(identity, binding, platform) {
  const accountId = String(binding?.accountId || '');
  if (!/^\d+$/.test(accountId)) return null;
  if (identity?.unique_id === accountId) return 'unique_id';
  return platform === 'douyin'
    && binding?.accountKey === 'reserved_personal_route'
    && identity?.unique_id_explicitly_empty === true
    && identity?.short_id === accountId
    ? 'short_id' : null;
}

async function selectTaskSpace() {
  if (pkg.schoolAccount) {
    const binding = typeof schoolRuntimeBinding === 'function' ? schoolRuntimeBinding() : pkg.schoolAccount;
    const expectedSpaceId = Number(binding.taskSpaceId);
    const expectedSpaceName = String(binding.taskSpaceName || '');
    const listed = await listTaskSpaces();
    if (typeof douyinWindowBindingResumeActive !== 'undefined' && douyinWindowBindingResumeActive === true
        && platform === 'douyin'
        && (listed || []).some(space => Number(space?.id) === Number(douyinWindowBindingResumeContract?.oldBinding?.spaceId))) {
      taskSpaceBlocker = typedBlocker('DOUYIN_WINDOW_BINDING_OLD_SPACE_STILL_PRESENT', '原指定账号 Ego 空间仍存在；拒绝在迁移窗口执行', { evidence: { oldSpacePresent: true } });
      return null;
    }
    const exact = (listed || []).filter(space => Number(space?.id) === expectedSpaceId
      && String(space?.name || '') === expectedSpaceName);
    if (exact.length !== 1 || exact[0]?.ownership !== 'agent') {
      const evidence = { expectedSpaceId, expectedSpaceName, matches: exact.length, ownership: exact[0]?.ownership || null };
      taskSpaceBlocker = exact.length === 1 && exact[0]?.ownership !== 'agent'
        ? typedBlocker('USER_CONTROL', '学校账号原 Ego 空间仍由用户控制；不自动接管，不判定登录失效', { requiresUser: true, evidence })
        : typedBlocker('AUTH_REQUIRED', '学校账号目标 Ego 空间不存在或身份不匹配；不创建、不认领新空间', { requiresUser: true, evidence });
      return null;
    }
    if (taskSpaceRef && Number(taskSpaceRef) !== expectedSpaceId) {
      taskSpaceBlocker = typedBlocker('AUTH_REQUIRED', '任务记录的 Ego 空间 ID 与学校账号绑定不一致；停止跨空间恢复', { requiresUser: true, evidence: { taskSpaceRef, expectedSpaceId } });
      return null;
    }
    if (taskName && taskName !== expectedSpaceName) {
      taskSpaceBlocker = typedBlocker('AUTH_REQUIRED', '任务记录的 Ego 空间名称与学校账号绑定不一致', { requiresUser: true, evidence: { taskName, expectedSpaceName } });
      return null;
    }
    try {
      activeTaskSpace = await useOrCreateTaskSpace(expectedSpaceId);
      if (Number(activeTaskSpace?.id) !== expectedSpaceId || String(activeTaskSpace?.name || '') !== expectedSpaceName) {
        taskSpaceBlocker = typedBlocker('AUTH_REQUIRED', 'Ego 复用的空间身份与学校账号绑定不一致；未尝试重新创建', { requiresUser: true, evidence: { expectedSpaceId, expectedSpaceName, actualId: activeTaskSpace?.id ?? null, actualName: activeTaskSpace?.name || '' } });
        activeTaskSpace = null;
      }
    } catch (error) {
      taskSpaceBlocker = typedBlocker('AUTH_REQUIRED', 'Ego 学校账号目标空间无法复用；不切换到新空间', { requiresUser: true, evidence: { expectedSpaceId, expectedSpaceName, error: String(error?.message || error).slice(0, 400) } });
      activeTaskSpace = null;
    }
    return activeTaskSpace;
  }
  const raw = String(taskSpaceRef || '').trim();
  const ref = raw && /^\d+$/.test(raw) ? Number(raw) : (raw || taskName);
  try {
    activeTaskSpace = await useOrCreateTaskSpace(ref);
    const identityMismatch = typeof ref === 'number'
      && Boolean(taskName)
      && Boolean(activeTaskSpace?.name)
      && activeTaskSpace.name !== taskName;
    if (identityMismatch) {
      const conflictingTaskSpace = activeTaskSpace;
      activeTaskSpace = await useOrCreateTaskSpace(taskName);
      taskSpaceRecovery = {
        recreated: true,
        reason: 'task_space_identity_mismatch',
        previousTaskSpaceId: ref,
        previousTaskSpaceName: conflictingTaskSpace.name,
        taskSpaceId: activeTaskSpace?.id ?? null,
        taskSpaceName: activeTaskSpace?.name || taskName,
      };
    }
  } catch (error) {
    const missingRecordedSpace = typeof ref === 'number' && /task space not found/i.test(String(error?.message || error));
    if (!missingRecordedSpace) throw error;
    activeTaskSpace = await useOrCreateTaskSpace(taskName);
    taskSpaceRecovery = { recreated: true, reason: 'task_space_not_found', previousTaskSpaceId: ref, taskSpaceId: activeTaskSpace?.id ?? null, taskSpaceName: activeTaskSpace?.name || taskName };
  }
  return activeTaskSpace;
}

async function selectPlatformTab() {
  const tabs = await listTabs();
  let match = null;
  if (pkg.schoolAccount) {
    const binding = typeof schoolRuntimeBinding === 'function' ? schoolRuntimeBinding() : pkg.schoolAccount;
    if (binding.platform !== platform) {
      return { ok: false, blocker: typedBlocker('AUTH_REQUIRED', '学校账号绑定的平台与本次任务不一致', { requiresUser: true, evidence: { expected: pkg.schoolAccount.platform, actual: platform } }) };
    }
    if (isPersonalDouyinPostResultSurfaceRecovery()) {
      const labelled = tabs.filter(tab => tab.label === binding.pageLabel);
      match = labelled.length === 1 ? labelled[0] : null;
      const allowedUrl = match?.url === DOUYIN_MANAGE_URL || match?.url === DOUYIN_UPLOAD_URL;
      if (!match || match.targetId !== binding.targetId || !allowedUrl) {
        return { ok: false, blocker: typedBlocker('DOUYIN_PERSONAL_POST_RESULT_SURFACE_START_PAGE_MISMATCH', '个人抖音恢复只接受原 p1 target 的精确管理页或上传页；不会新建窗口、profile 或空间', { evidence: { exactPageMatch: Boolean(match), exactTargetMatch: match?.targetId === binding.targetId, allowedStartUrl: allowedUrl } }) };
      }
    } else if (isPersonalDouyinInspectOnly()) {
      const labelled = tabs.filter(tab => tab.label === binding.pageLabel);
      match = labelled.length === 1 ? labelled[0] : null;
      if (!match || match.targetId !== binding.targetId || match.url !== DOUYIN_UPLOAD_URL) {
        return { ok: false, blocker: typedBlocker('DOUYIN_PERSONAL_INSPECT_ONLY_TARGET_OR_URL_MISMATCH', '指定 固定业务窗口 未精确停留在原始抖音上传页；只读检查停止，不导航、不切换页面', { evidence: { exactPageMatch: Boolean(match), exactTargetMatch: match?.targetId === binding.targetId, exactUploadUrl: match?.url === DOUYIN_UPLOAD_URL } }) };
      }
    } else {
      match = tabs.find(tab => tab.label === binding.pageLabel);
    }
    if (!match || (typeof nativeRecovery !== 'undefined' && nativeRecovery && match.targetId !== binding.targetId) || !PLATFORM_HOSTS[platform].test(String(match.url || ''))) {
      return { ok: false, blocker: typedBlocker('AUTH_REQUIRED', '指定的学校账号 Ego 页面不存在或平台地址不匹配；不会新开页面', { requiresUser: true, evidence: { pageLabel: binding.pageLabel, platform, url: match?.url || '' } }) };
    }
  } else {
    match = tabs.find(tab => PLATFORM_HOSTS[platform].test(String(tab.url || '')));
  }
  if (match) {
    await switchTab(match.targetId);
  } else {
    await openOrReuseTab(PLATFORM_URLS[platform], { wait: true, timeout: 45 });
  }
  await wait(1.5);
  const info = await pageInfo();
  if (info?.dialog) {
    return { ok: false, blocker: typedBlocker('STATE_AMBIGUOUS', `浏览器原生弹窗阻塞页面: ${info.dialog.message || 'unknown dialog'}`, { retryable: true, evidence: info.dialog }) };
  }
  if (!info || info.w < 300 || info.h < 300) {
    return { ok: false, blocker: typedBlocker('INPUT_CHANNEL_BROKEN', 'Ego Lite 页面视口不可用', { retryable: true, evidence: info }) };
  }
  return { ok: true, info };
}

async function armFinalPublishGuard() {
  const activeFinalText = platform === 'youtube' ? YOUTUBE_FINAL_TEXT : FINAL_TEXT;
  return await js(String.raw`((key, finalSource, finalFlags) => {
    const existing = window[key]
    if (existing?.armed === true && existing.version === 1) {
      return { ok: true, armed: true, version: existing.version, armedAt: existing.armedAt, blockedAttempts: existing.blockedAttempts.length }
    }
    const finalText = new RegExp(finalSource, finalFlags)
    const compact = value => String(value || '').replace(/\s+/g, ' ').trim()
    const state = { armed: true, version: 1, armedAt: new Date().toISOString(), blockedAttempts: [] }
    state.releaseForConfirmedPublish = () => {
      if (!state.armed || state.blockedAttempts.length) return { ok: false, reason: 'guard not clean and armed' }
      state.armed = false
      state.releasedAt = new Date().toISOString()
      return { ok: true, releasedAt: state.releasedAt }
    }
    const buttonLabel = element => {
      if (!(element instanceof Element)) return ''
      const buttonish = element.matches('button, input[type="submit"], [role="button"], .d-button, .bcc-button')
      if (!buttonish) return ''
      return compact(element.value || element.getAttribute('aria-label') || element.innerText || element.textContent || '')
    }
    const guard = event => {
      if (!state.armed) return
      const candidates = [event.submitter, ...(typeof event.composedPath === 'function' ? event.composedPath() : []), event.target]
      const match = candidates.map(element => ({ element, label: buttonLabel(element) })).find(item => finalText.test(item.label))
      if (!match) return
      event.preventDefault()
      event.stopImmediatePropagation()
      state.blockedAttempts.push({ type: event.type, label: match.label, at: new Date().toISOString() })
    }
    document.addEventListener('click', guard, true)
    document.addEventListener('submit', guard, true)
    window[key] = state
    return { ok: true, armed: true, version: state.version, armedAt: state.armedAt, blockedAttempts: 0 }
  })(${JSON.stringify(FINAL_GUARD_KEY)}, ${JSON.stringify(activeFinalText.source)}, ${JSON.stringify(activeFinalText.flags)})`);
}

async function inspectFinalPublishGuard() {
  return await js(String.raw`((key) => {
    const state = window[key]
    return state?.armed === true && state.version === 1
      ? { armed: true, version: state.version, armedAt: state.armedAt, blockedAttempts: state.blockedAttempts.length, attempts: state.blockedAttempts.slice(-5) }
      : { armed: false, version: state?.version || null, blockedAttempts: state?.blockedAttempts?.length || 0, attempts: state?.blockedAttempts?.slice?.(-5) || [] }
  })(${JSON.stringify(FINAL_GUARD_KEY)})`);
}

function checkpointReceipts(receipts) {
  if (!receiptCheckpointPath || !jobFingerprint || !receipts || !Object.keys(receipts).length) {
    return { ok: false, skipped: true };
  }
  const payload = {
    schemaVersion: 2,
    platform,
    fingerprint: jobFingerprint,
    taskSpaceId: activeTaskSpace?.id ?? null,
    writtenAt: new Date().toISOString(),
    receipts,
  };
  fs.mkdirSync(path.dirname(receiptCheckpointPath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(receiptCheckpointPath), 0o700);
  const temp = `${receiptCheckpointPath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, receiptCheckpointPath);
  fs.chmodSync(receiptCheckpointPath, 0o600);
  return { ok: true, path: receiptCheckpointPath, writtenAt: payload.writtenAt };
}

async function preparePlatform() {
  const task = await selectTaskSpace();
  if (taskSpaceBlocker) return { task, selected: { ok: false, blocker: taskSpaceBlocker } };
  const selected = await selectPlatformTab();
  if (!selected.ok) return { task, selected };
  let douyinIdentity = null;
  let douyinUploadSurface = null;
  let douyinNavigationOrigin = null;
  let douyinWindowSnapshots = null;
  let douyinPersonalPostResultSurfaceRecovery = null;
  if (pkg.schoolAccount) {
    const hasIdentityValue = value => value !== undefined && value !== null && value !== '';
    const douyinWindowBindingActive = platform === 'douyin'
      && typeof douyinWindowBindingResumeActive !== 'undefined'
      && douyinWindowBindingResumeActive === true
      && douyinWindowBindingResumeContract?.resumeType === 'douyin_same_job_window_binding_recovery';
    const identityBinding = douyinWindowBindingActive ? douyinExecutionBinding : pkg.schoolAccount;
    const isDouyinApiIdentity = platform === 'douyin'
      && (douyinWindowBindingActive || hasIdentityValue(identityBinding.accountId) || hasIdentityValue(identityBinding.apiUid));
    const apiUidPinned = douyinWindowBindingActive || hasIdentityValue(identityBinding.apiUid);
    const douyinScopeResume = isDouyinApiIdentity
      && typeof douyinPreparationScopeResumeActive !== 'undefined'
      && douyinPreparationScopeResumeActive === true
      && ['inspect', 'upload_start'].includes(phase);
    let douyinIdentityGuard = null;
    let douyinApiIdentity = null;
    let douyinApiIdentityError = null;
    let before = null;
    if (isDouyinApiIdentity) {
      before = douyinWindowBindingActive ? await captureDouyinWindowSnapshot(identityBinding) : await captureDouyinSchoolBinding(identityBinding);
      if (!before.ok) {
        return { task, selected: { ok: false, blocker: typedBlocker('AUTH_REQUIRED', '抖音原 Ego profile/space/target 无法精确确认；停止上传与字段修改', { requiresUser: true, evidence: { reason: before.reason, phase: 'before_creator_identity_read' } }) } };
      }
      if (isPersonalDouyinInspectOnly() && !isPersonalDouyinPostResultSurfaceRecovery() && before.url !== DOUYIN_UPLOAD_URL) {
        return { task, selected: { ok: false, blocker: typedBlocker('DOUYIN_PERSONAL_INSPECT_ONLY_TARGET_OR_URL_MISMATCH', '当前原始 p1 页面不是指定上传页；只读检查停止，不导航、不修改页面', { evidence: { exactUploadUrl: false } }) } };
      }
      if (isPersonalDouyinPostResultDraftContinuation() && before.url !== DOUYIN_UPLOAD_URL) {
        return { task, selected: { ok: false, blocker: typedBlocker('DOUYIN_PERSONAL_POST_RESULT_DRAFT_UPLOAD_SURFACE_REQUIRED', '草稿续办只允许同一原始 Profile/Space/target 的精确上传页；不导航', { evidence: { exactUploadUrl: false, observedUrl: before.url } }) } };
      }
      if (isPersonalDouyinPostResultSurfaceRecovery() && ![DOUYIN_MANAGE_URL, DOUYIN_UPLOAD_URL].includes(before.url)) {
        return { task, selected: { ok: false, blocker: typedBlocker('DOUYIN_PERSONAL_POST_RESULT_SURFACE_START_PAGE_MISMATCH', '个人抖音恢复未停在合同允许的原始管理页/上传页；停止且不导航', { evidence: { allowedStartUrl: false } }) } };
      }
      if (before.url !== await boundPage().url()) {
        return { task, selected: { ok: false, blocker: typedBlocker('AUTH_REQUIRED', '抖音原上传页面在身份核验前已变化；停止上传与字段修改', { requiresUser: true, evidence: { reason: 'page_url_changed_before_identity_read' } }) } };
      }
    }
    let current = await pageRootsState();
    const markers = identityBinding.knownAccounts || pkg.schoolAccount.knownAccounts || [];
    const headerText = String(current.headerText || '').normalize('NFC');
    const matchedBy = [];
    if (identityBinding.accountName && headerText.includes(String(identityBinding.accountName).normalize('NFC'))) matchedBy.push('name');
    if (identityBinding.accountId && headerText.includes(String(identityBinding.accountId))) matchedBy.push('id');
    const conflictingAccountKeys = markers.filter(account => account.key !== identityBinding.accountKey)
      .filter(account => (account.name && headerText.includes(String(account.name).normalize('NFC')))
        || (account.id && headerText.includes(String(account.id))))
      .map(account => account.key);
    const hostOk = platform === 'douyin'
      ? (() => { try { return new URL(current.url).hostname === 'creator.douyin.com'; } catch { return false; } })()
      : (pkg.schoolAccount.platformHosts || []).some(host => String(current.url || '').includes(host));
    let apiOk=false;
    if (isDouyinApiIdentity && hostOk) {
      const normalize = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
      const exactId = value => typeof value === 'string' && /^\d+$/.test(value)
        ? value
        : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
      const readCreatorIdentity = async () => {
        const data = await creatorGet(boundPage(), 'https://creator.douyin.com/web/api/media/user/info/?aid=1128');
        const user = data?.user_info || data?.user;
        return {
          status: 200,
          uid: exactId(user?.uid),
          nickname: typeof user?.nickname === 'string' ? user.nickname : '',
          unique_id: exactId(user?.unique_id),
          unique_id_explicitly_empty: user?.unique_id === '',
          short_id: exactId(user?.short_id),
        };
      };
      const identityExact = value => !douyinApiIdentityError
        && value?.status === 200
        && typeof value?.uid === 'string' && /^\d+$/.test(value.uid)
        && (!apiUidPinned || (douyinWindowBindingActive
          ? typeof douyinWindowExpectedUid === 'string' && /^\d+$/.test(douyinWindowExpectedUid) && value.uid === douyinWindowExpectedUid
          : typeof identityBinding.apiUid === 'string' && /^\d+$/.test(identityBinding.apiUid) && value.uid === identityBinding.apiUid))
        && normalize(value?.nickname) === normalize(identityBinding.accountName)
        && typeof identityBinding.accountId === 'string' && /^\d+$/.test(identityBinding.accountId)
        && douyinCreatorPublicIdMatchField(value, identityBinding, platform) !== null;
      const guardSameBinding = (left, right) => left?.ok === true && right?.ok === true
        && left.profileId === right.profileId
        && left.spaceId === right.spaceId && left.spaceName === right.spaceName
        && left.pageLabel === right.pageLabel && left.targetId === right.targetId
        && left.ownership === right.ownership;
      if (douyinWindowBindingActive) {
        const stage = typeof douyinWindowProofStage === 'string' ? douyinWindowProofStage : '';
        const beforeSnapshot = before;
        const beforeDom = await captureDouyinWindowDom(identityBinding, stage);
        try { douyinApiIdentity = await readCreatorIdentity(); }
        catch (error) { douyinApiIdentityError = String(error?.message || error).slice(0, 160); }
        const after = await captureDouyinWindowSnapshot(identityBinding);
        const afterDom = await captureDouyinWindowDom(identityBinding, stage);
        douyinIdentityGuard = { before: beforeSnapshot, after };
        current = await pageRootsState();
        const bindingStable = beforeSnapshot.ok === true && after.ok === true
          && JSON.stringify(windowBindingShape(beforeSnapshot)) === JSON.stringify(windowBindingShape(after))
          && JSON.stringify(beforeSnapshot.inventory) === JSON.stringify(after.inventory)
          && beforeSnapshot.url === after.url && beforeSnapshot.url === DOUYIN_UPLOAD_URL
          && current.url === after.url;
        apiOk = bindingStable && identityExact(douyinApiIdentity);
        douyinUploadSurface = afterDom.uploadSurface;
        douyinWindowSnapshots = {
          before: { ...beforeSnapshot, identity: { ...douyinApiIdentity, ok: apiOk }, dom: beforeDom.dom },
          after: { ...after, identity: { ...douyinApiIdentity, ok: apiOk }, dom: afterDom.dom },
          excluded_case_accountRow: douyinWindowCanonicalRow(pkg.schoolAccount),
        };
        if (apiOk) {
          douyinIdentity = {
            source: 'creator_api', ok: true, status: douyinApiIdentity.status, uid: douyinApiIdentity.uid,
            nickname: douyinApiIdentity.nickname, unique_id: douyinApiIdentity.unique_id,
          ...(douyinCreatorPublicIdMatchField(douyinApiIdentity, identityBinding, platform) === 'short_id' ? { creatorApiPublicIdField: 'short_id' } : {}),
            platformHost: 'creator.douyin.com',
            binding: windowBindingShape(after), before: douyinWindowSnapshots.before, after: douyinWindowSnapshots.after,
          };
        }
        if (stage !== 'before-final-click' && (beforeDom.dom?.videoInputs?.length !== 1 || beforeDom.dom?.editorCount !== 0 || beforeDom.dom?.videoCount !== 0)) apiOk = false;
      } else if (douyinScopeResume) {
        // Scope continuation starts from a pinned original manage page. Verify the
        // creator API identity there before navigating, then require an actual
        // upload route and visible upload surface, and repeat the API/binding
        // proof on that exact same target before it can reach dispatch.
        let originIdentity = null;
        try { originIdentity = await readCreatorIdentity(); }
        catch (error) { douyinApiIdentityError = String(error?.message || error).slice(0, 160); }
        const originBefore = before;
        const originAfter = await captureDouyinSchoolBinding(pkg.schoolAccount);
        const sourceRouteAllowed = originBefore?.url === DOUYIN_HOME_URL
          || originBefore?.url === DOUYIN_MANAGE_URL
          || originBefore?.url === DOUYIN_UPLOAD_URL;
        const originIdentityOk = sourceRouteAllowed && guardSameBinding(originBefore, originAfter)
          && originBefore?.url === originAfter?.url && identityExact(originIdentity);
        if (!originIdentityOk) {
          return { task, selected: { ok: false, blocker: typedBlocker('DOUYIN_SCOPE_RESUME_ORIGIN_IDENTITY_NOT_EXACT', '原始指定账号页面导航前的 creator API 身份或 Profile/Space/target 不完全匹配；停止继续', { evidence: { routeAllowed: sourceRouteAllowed, url: originBefore?.url || '', identityExact: identityExact(originIdentity), bindingStable: guardSameBinding(originBefore, originAfter), error: douyinApiIdentityError || null } }) } };
        }
        douyinNavigationOrigin = {
          url: originBefore.url,
          uid: originIdentity.uid,
          nickname: originIdentity.nickname,
          unique_id: originIdentity.unique_id,
          profileId: originBefore.profileId,
          spaceId: originBefore.spaceId,
          pageLabel: originBefore.pageLabel,
          targetId: originBefore.targetId,
        };
        if (originBefore.url !== DOUYIN_UPLOAD_URL) {
          try {
            await gotoAndWait(DOUYIN_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 45 });
          } catch {
            return { task, selected: { ok: false, blocker: typedBlocker('DOUYIN_SCOPE_RESUME_UPLOAD_SURFACE_NOT_EXACT', '从已核验的原始指定账号管理页导航到上传页失败；没有尝试上传', { evidence: { expectedUrl: DOUYIN_UPLOAD_URL, actualUrl: await boundPage().url() } }) } };
          }
        }
        let surface = null;
        let stableUploadUrl = false;
        let previousUrl = '';
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const actualUrl = await boundPage().url();
          stableUploadUrl = actualUrl === DOUYIN_UPLOAD_URL && previousUrl === DOUYIN_UPLOAD_URL;
          previousUrl = actualUrl;
          if (stableUploadUrl) {
            surface = await inspectDouyinUploadSurface();
            if (surface?.ok === true && surface.url === DOUYIN_UPLOAD_URL) break;
          }
          await wait(0.25);
        }
        if (!stableUploadUrl || surface?.ok !== true || surface.url !== DOUYIN_UPLOAD_URL) {
          return { task, selected: { ok: false, blocker: typedBlocker('DOUYIN_SCOPE_RESUME_UPLOAD_SURFACE_NOT_EXACT', '原页面未稳定停留在抖音真实上传页，或未发现可见上传区域与视频文件 input；停止注入', { evidence: { expectedUrl: DOUYIN_UPLOAD_URL, actualUrl: await boundPage().url(), stableUploadUrl, uploadSurface: surface || null } }) } };
        }
        before = await captureDouyinSchoolBinding(pkg.schoolAccount);
        if (!before.ok || before.url !== DOUYIN_UPLOAD_URL || before.targetId !== pkg.schoolAccount.targetId) {
          return { task, selected: { ok: false, blocker: typedBlocker('DOUYIN_SCOPE_RESUME_UPLOAD_SURFACE_NOT_EXACT', '导航后的原始 Profile/Space/target 未能精确绑定到上传页；停止继续', { evidence: { expectedUrl: DOUYIN_UPLOAD_URL, binding: before } }) } };
        }
        try { douyinApiIdentity = await readCreatorIdentity(); }
        catch (error) { douyinApiIdentityError = String(error?.message || error).slice(0, 160); }
        const after = await captureDouyinSchoolBinding(pkg.schoolAccount);
        douyinIdentityGuard = { before, after };
        current = await pageRootsState();
        const guardMatches = guardSameBinding(before, after) && before.url === after.url
          && before.url === DOUYIN_UPLOAD_URL && current.url === after.url;
        apiOk = guardMatches && identityExact(douyinApiIdentity);
        douyinUploadSurface = surface;
        if (apiOk) {
          douyinIdentity = {
            source: 'creator_api',
            ok: true,
            status: 200,
            uid: douyinApiIdentity.uid,
            nickname: douyinApiIdentity.nickname,
            unique_id: douyinApiIdentity.unique_id,
            platformHost: 'creator.douyin.com',
            binding: { ok: true, profileId: after.profileId, spaceId: after.spaceId, spaceName: after.spaceName, ownership: after.ownership, pageLabel: after.pageLabel, targetId: after.targetId, url: after.url },
            before,
            after,
          };
        }
      } else if (isPersonalDouyinPostResultSurfaceRecovery()) {
        // This is a one-shot, same-target, navigation-only route. The creator
        // API identity is checked on the exact origin page before navigation,
        // then checked again on the upload page before read-only inspection.
        const originBefore = before;
        let originIdentity = null;
        try { originIdentity = await readCreatorIdentity(); }
        catch (error) { douyinApiIdentityError = String(error?.message || error).slice(0, 160); }
        const originAfter = await captureDouyinSchoolBinding(identityBinding);
        const originSafe = [DOUYIN_MANAGE_URL, DOUYIN_UPLOAD_URL].includes(originBefore?.url)
          && guardSameBinding(originBefore, originAfter)
          && originBefore?.url === originAfter?.url
          && identityExact(originIdentity);
        if (!originSafe) {
          return { task, selected: { ok: false, blocker: typedBlocker('DOUYIN_PERSONAL_POST_RESULT_SURFACE_ORIGIN_IDENTITY_NOT_EXACT', '原始 Profile/Space/target 或 creator API 身份不精确；未导航、未写入', { evidence: { originUrlAllowed: [DOUYIN_MANAGE_URL, DOUYIN_UPLOAD_URL].includes(originBefore?.url), identityExact: identityExact(originIdentity), bindingStable: guardSameBinding(originBefore, originAfter) } }) } };
        }
        const navigationAttempted = originBefore.url === DOUYIN_MANAGE_URL;
        if (navigationAttempted) {
          try { await gotoAndWait(DOUYIN_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 45 }); }
          catch {
            return { task, selected: { ok: false, blocker: typedBlocker('DOUYIN_PERSONAL_POST_RESULT_SURFACE_NAVIGATION_FAILED', '同一原始 target 导航到指定上传页失败；未尝试上传或编辑', { evidence: { fromUrl: originBefore.url, expectedUrl: DOUYIN_UPLOAD_URL, actualUrl: await boundPage().url() } }) } };
          }
        }
        let uploadSurface = null;
        let stableUploadUrl = false;
        let previousUrl = '';
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const actualUrl = await boundPage().url();
          stableUploadUrl = actualUrl === DOUYIN_UPLOAD_URL && previousUrl === DOUYIN_UPLOAD_URL;
          previousUrl = actualUrl;
          if (stableUploadUrl) {
            uploadSurface = await inspectDouyinUploadSurface();
            if (uploadSurface?.ok === true && uploadSurface.url === DOUYIN_UPLOAD_URL) break;
          }
          await wait(0.25);
        }
        if (!stableUploadUrl || uploadSurface?.ok !== true || uploadSurface.url !== DOUYIN_UPLOAD_URL) {
          return { task, selected: { ok: false, blocker: typedBlocker('DOUYIN_PERSONAL_POST_RESULT_SURFACE_NOT_EXACT', '同一原始 target 未稳定停留在可见抖音上传页；不触发文件输入', { evidence: { expectedUrl: DOUYIN_UPLOAD_URL, actualUrl: await boundPage().url(), uploadSurface: uploadSurface || null } }) } };
        }
        const after = await captureDouyinSchoolBinding(identityBinding);
        try { douyinApiIdentity = await readCreatorIdentity(); }
        catch (error) { douyinApiIdentityError = String(error?.message || error).slice(0, 160); }
        douyinIdentityGuard = { before: originBefore, after };
        current = await pageRootsState();
        apiOk = after?.ok === true && guardSameBinding(originBefore, after)
          && after.url === DOUYIN_UPLOAD_URL && current.url === DOUYIN_UPLOAD_URL
          && identityExact(douyinApiIdentity);
        douyinUploadSurface = uploadSurface;
        douyinPersonalPostResultSurfaceRecovery = {
          fromUrl: originBefore.url, toUrl: DOUYIN_UPLOAD_URL,
          attempted: navigationAttempted, succeeded: apiOk,
          navigationCount: navigationAttempted ? 1 : 0,
          createdTab: false, createdProfile: false, createdSpace: false,
          sameTarget: originBefore.targetId === after?.targetId && after?.targetId === identityBinding.targetId,
          profileId: originBefore.profileId, spaceId: originBefore.spaceId,
          pageLabel: originBefore.pageLabel, targetId: originBefore.targetId,
          ownership: originBefore.ownership,
        };
        if (apiOk) {
          douyinIdentity = {
            source: 'creator_api', ok: true, status: douyinApiIdentity.status,
            uid: douyinApiIdentity.uid, nickname: douyinApiIdentity.nickname,
            unique_id: douyinApiIdentity.unique_id,
            ...(douyinCreatorPublicIdMatchField(douyinApiIdentity, identityBinding, platform) === 'short_id' ? { creatorApiPublicIdField: 'short_id' } : {}),
            platformHost: 'creator.douyin.com',
            binding: { ok: true, profileId: after.profileId, spaceId: after.spaceId, spaceName: after.spaceName, ownership: after.ownership, pageLabel: after.pageLabel, targetId: after.targetId, url: after.url },
            before: originBefore, after,
          };
        }
      } else {
        try { douyinApiIdentity = await readCreatorIdentity(); }
        catch (error) { douyinApiIdentityError = String(error?.message || error).slice(0, 160); }
        const after = await captureDouyinSchoolBinding(pkg.schoolAccount);
        douyinIdentityGuard = { before, after };
        const guardMatches = after.ok && before.profileId === after.profileId
          && before.spaceId === after.spaceId && before.spaceName === after.spaceName
          && before.pageLabel === after.pageLabel && before.targetId === after.targetId
          && before.ownership === after.ownership && before.url === after.url
          && (!isPersonalDouyinPostResultDraftContinuation() || before.url === DOUYIN_UPLOAD_URL)
          && current.url === after.url;
        apiOk = guardMatches && identityExact(douyinApiIdentity);
        if (apiOk) {
          douyinIdentity = {
            source: 'creator_api',
            ok: true,
            status: 200,
            uid: douyinApiIdentity.uid,
            nickname: douyinApiIdentity.nickname,
            unique_id: douyinApiIdentity.unique_id,
            platformHost: 'creator.douyin.com',
            binding: { ok: true, profileId: after.profileId, spaceId: after.spaceId, spaceName: after.spaceName, ownership: after.ownership, pageLabel: after.pageLabel, targetId: after.targetId, url: after.url },
            before,
            after,
          };
        }
      }
      apiOk = apiOk && !douyinApiIdentityError
        && typeof douyinApiIdentity?.uid === 'string' && /^\d+$/.test(douyinApiIdentity.uid)
        && identityExact(douyinApiIdentity);
      if (apiOk) matchedBy.push('fresh_creator_api_uid_name_public_id');
    }
    const personalInspectBindingStable = !isPersonalDouyinInspectOnly() || (isPersonalDouyinPostResultSurfaceRecovery()
      ? douyinIdentityGuard?.before?.ok === true && douyinIdentityGuard?.after?.ok === true
        && [DOUYIN_MANAGE_URL, DOUYIN_UPLOAD_URL].includes(douyinIdentityGuard.before.url)
        && douyinIdentityGuard.after.url === DOUYIN_UPLOAD_URL && current.url === DOUYIN_UPLOAD_URL
        && douyinIdentityGuard.before.profileId === pkg.schoolAccount.egoProfileId
        && douyinIdentityGuard.after.profileId === pkg.schoolAccount.egoProfileId
        && Number(douyinIdentityGuard.before.spaceId) === Number(pkg.schoolAccount.taskSpaceId)
        && Number(douyinIdentityGuard.after.spaceId) === Number(pkg.schoolAccount.taskSpaceId)
        && douyinIdentityGuard.before.spaceName === pkg.schoolAccount.taskSpaceName
        && douyinIdentityGuard.after.spaceName === pkg.schoolAccount.taskSpaceName
        && douyinIdentityGuard.before.pageLabel === pkg.schoolAccount.pageLabel
        && douyinIdentityGuard.after.pageLabel === pkg.schoolAccount.pageLabel
        && douyinIdentityGuard.before.targetId === pkg.schoolAccount.targetId
        && douyinIdentityGuard.after.targetId === pkg.schoolAccount.targetId
        && douyinIdentityGuard.before.ownership === 'agent' && douyinIdentityGuard.after.ownership === 'agent'
        && douyinPersonalPostResultSurfaceRecovery?.succeeded === true
      : douyinIdentityGuard?.before?.ok === true && douyinIdentityGuard?.after?.ok === true
        && douyinIdentityGuard.before.profileId === pkg.schoolAccount.egoProfileId
        && douyinIdentityGuard.after.profileId === pkg.schoolAccount.egoProfileId
        && Number(douyinIdentityGuard.before.spaceId) === Number(pkg.schoolAccount.taskSpaceId)
        && Number(douyinIdentityGuard.after.spaceId) === Number(pkg.schoolAccount.taskSpaceId)
        && douyinIdentityGuard.before.spaceName === pkg.schoolAccount.taskSpaceName
        && douyinIdentityGuard.after.spaceName === pkg.schoolAccount.taskSpaceName
        && douyinIdentityGuard.before.pageLabel === pkg.schoolAccount.pageLabel
        && douyinIdentityGuard.after.pageLabel === pkg.schoolAccount.pageLabel
        && douyinIdentityGuard.before.targetId === pkg.schoolAccount.targetId
        && douyinIdentityGuard.after.targetId === pkg.schoolAccount.targetId
        && douyinIdentityGuard.before.ownership === 'agent' && douyinIdentityGuard.after.ownership === 'agent'
        && douyinIdentityGuard.before.url === DOUYIN_UPLOAD_URL && douyinIdentityGuard.after.url === DOUYIN_UPLOAD_URL
        && current.url === DOUYIN_UPLOAD_URL);
    const identityOk = (isDouyinApiIdentity ? apiOk : matchedBy.length > 0) && conflictingAccountKeys.length === 0 && hostOk && personalInspectBindingStable;
    if (!identityOk) {
      return { task, selected: { ok: false, blocker: typedBlocker(platform==='wechat_channels'?'ACCOUNT_IDENTITY_UNVERIFIED':'AUTH_REQUIRED', 'Ego 页面标题栏未能证明当前学校账号身份；停止所有上传和字段修改', { requiresUser: platform!=='wechat_channels', evidence: { pageLabel: pkg.schoolAccount.pageLabel, url: current.url, hostOk, matchedBy, conflictingAccountKeys, reason: conflictingAccountKeys.length ? 'different_registered_account_visible' : douyinApiIdentityError || (isDouyinApiIdentity && !douyinIdentityGuard?.after?.ok) ? 'creator_api_or_binding_guard_failed' : matchedBy.length ? 'page_host_mismatch' : 'account_identity_not_visible_in_header', ...(isDouyinApiIdentity ? { creatorIdentityReadError: douyinApiIdentityError, identityGuard: douyinIdentityGuard, creatorIdentityMatched: apiOk } : {}) } }) } };
    }
  }
  if (isPersonalDouyinInspectOnly()) {
    const actualUrl = await boundPage().url();
    if (actualUrl !== DOUYIN_UPLOAD_URL || !douyinIdentity?.ok || douyinIdentity?.source !== 'creator_api') {
      return { task, selected: { ok: false, blocker: typedBlocker('DOUYIN_PERSONAL_INSPECT_ONLY_TARGET_OR_URL_MISMATCH', '只读身份与指定原上传页未能同时鲜读匹配；停止检查', { evidence: { exactUploadUrl: actualUrl === DOUYIN_UPLOAD_URL, creatorIdentityVerified: douyinIdentity?.ok === true } }) } };
    }
    return { task, selected, readOnlyInspection: true, guard: { ok: true, armed: false, blockedAttempts: 0 }, douyinIdentity,
      ...(douyinUploadSurface ? { douyinUploadSurface } : {}),
      ...(douyinPersonalPostResultSurfaceRecovery ? { douyinPersonalPostResultSurfaceRecovery } : {}) };
  }
  const needsExistingGuard = (typeof channelsBlobRecovery!=='undefined'&&channelsBlobRecovery)||(typeof nativeRecovery!=="undefined"&&nativeRecovery)||(typeof xhsResumeContract!=="undefined"&&xhsResumeContract?.mode==='injected_body');
  const guard=needsExistingGuard?await inspectFinalPublishGuard():await armFinalPublishGuard();
  const isXhsResume=typeof xhsResumeContract!=="undefined"&&xhsResumeContract;
  if (!(guard.ok||needsExistingGuard)||!guard.armed||((needsExistingGuard||isXhsResume)&&guard.blockedAttempts!==0)) {
    return {
      task,
      selected: {
        ok: false,
        blocker: typedBlocker('INPUT_CHANNEL_BROKEN', '最终发布按钮硬保护无法挂载', { retryable: true, evidence: guard }),
      },
    };
  }
  return { task, selected, guard, ...(douyinIdentity?.source === 'creator_api' ? { douyinIdentity } : {}), ...(douyinUploadSurface ? { douyinUploadSurface } : {}), ...(douyinNavigationOrigin ? { douyinNavigationOrigin } : {}), ...(douyinWindowSnapshots ? { douyinWindowSnapshots } : {}), ...(douyinPersonalPostResultSurfaceRecovery ? { douyinPersonalPostResultSurfaceRecovery } : {}) };
}

async function pageRootsState() {
  return await js(String.raw`(() => {
    const compact = value => String(value || '').replace(/\s+/g, ' ').trim()
    const roots = [document, ...[...document.querySelectorAll('*')].map(el => el.shadowRoot).filter(Boolean)]
    const text = roots.map(root => root.body?.innerText || root.host?.innerText || '').join('\n')
    let headerSelector = 'header, nav, [role="banner"], [class*="header"], [class*="Header"]' + ${JSON.stringify(platform === "wechat_channels" ? ", .finder-info-container" : platform === "xiaohongshu" ? ", .d-topbar .name-box" : "")}
    if (${JSON.stringify(platform)} === 'wechat_channels' && location.pathname === '/platform/post/create') headerSelector += ', .full-screen-body .operate-bar .left-area .name';
    const headerText = roots.flatMap(root => [...root.querySelectorAll(headerSelector)])
      .filter(el => { const rect = el.getBoundingClientRect(), style = getComputedStyle(el); return rect.width > 4 && rect.height > 4 && style.display !== 'none' && style.visibility !== 'hidden' })
      .map(el => compact([el.innerText, el.getAttribute('aria-label'), el.getAttribute('title'), ...[...el.querySelectorAll('img[alt], [aria-label], [title]')].map(child => [child.getAttribute('alt'), child.getAttribute('aria-label'), child.getAttribute('title')].filter(Boolean).join(' '))].filter(Boolean).join(' ')))
      .filter(Boolean).join(' | ')
    return { url: location.href, title: document.title, text: compact(text), headerText, rootCount: roots.length }
  })()`);
}

async function captureDouyinSchoolBinding(binding) {
  if (!binding?.egoProfileId || !binding?.targetId || !binding?.taskSpaceId || !binding?.taskSpaceName || !binding?.pageLabel) {
    return { ok: false, reason: 'exact_profile_space_target_binding_required' };
  }
  try {
    const spaces = await listTaskSpaces();
    const exact = (spaces || []).filter(space => Number(space?.id) === Number(binding.taskSpaceId)
      && String(space?.name || '') === String(binding.taskSpaceName));
    if (exact.length !== 1 || exact[0]?.ownership !== 'agent' || exact[0]?.profileId !== binding.egoProfileId) {
      return { ok: false, reason: exact.length === 1 && exact[0]?.ownership !== 'agent' ? 'space_not_agent_owned' : 'space_profile_mismatch' };
    }
    const task = await taskSpace(Number(binding.taskSpaceId));
    if (Number(task?.spaceId) !== Number(binding.taskSpaceId) || String(task?.name || '') !== String(binding.taskSpaceName)
        || task?.ownership !== 'agent') return { ok: false, reason: 'task_space_changed' };
    const tabs = await task.tabs();
    const exactTabs = (tabs || []).filter(tab => tab.label === binding.pageLabel);
    if (exactTabs.length !== 1 || String(exactTabs[0]?.targetId || '') !== String(binding.targetId)) {
      return { ok: false, reason: 'target_id_mismatch' };
    }
    const page = task.page(binding.pageLabel);
    const url = await page.url();
    if (url !== exactTabs[0]?.url || new URL(url).hostname !== 'creator.douyin.com') return { ok: false, reason: 'target_url_mismatch' };
    return {
      ok: true,
      profileId: exact[0].profileId,
      spaceId: Number(task.spaceId),
      spaceName: String(task.name),
      ownership: task.ownership,
      pageLabel: binding.pageLabel,
      targetId: String(exactTabs[0].targetId),
      url,
    };
  } catch {
    return { ok: false, reason: 'binding_guard_read_failed' };
  }
}

function windowBindingShape(value) {
  if (!value) return null;
  return {
    profileId: value.profileId,
    spaceId: Number(value.spaceId),
    spaceName: String(value.spaceName || ''),
    ownership: value.ownership,
    pageLabel: value.pageLabel,
    targetId: String(value.targetId || ''),
    host: 'creator.douyin.com',
    uploadUrl: DOUYIN_UPLOAD_URL,
  };
}

function douyinWindowCanonicalRow(binding) {
  return {
    platform: 'douyin',
    accountKey: String(binding?.accountKey || ''),
    accountId: String(binding?.accountId || ''),
    accountName: String(binding?.accountName || ''),
    apiUid: String(binding?.apiUid || ''),
    persistentProfile: String(binding?.persistentProfile || ''),
    profileId: String(binding?.egoProfileId || ''),
    spaceId: Number(binding?.taskSpaceId),
    spaceName: String(binding?.taskSpaceName || ''),
    ownership: 'agent',
    pageLabel: String(binding?.pageLabel || ''),
    targetId: String(binding?.targetId || ''),
    host: 'creator.douyin.com',
    uploadUrl: DOUYIN_UPLOAD_URL,
  };
}

async function captureDouyinWindowSnapshot(binding) {
  try {
    const listed = await listTaskSpaces();
    const old = douyinWindowBindingResumeContract?.oldBinding || {};
    const relevant = (listed || []).filter(space => Number(space?.id) === Number(old.spaceId)
      || Number(space?.id) === Number(binding.taskSpaceId)
      || String(space?.name || '') === String(old.spaceName || '')
      || String(space?.name || '') === String(binding.taskSpaceName || ''))
      .map(space => ({ id: Number(space.id), name: String(space.name || ''), profileId: String(space.profileId || ''), ownership: String(space.ownership || '') }));
    if (relevant.some(space => Number(space.id) === Number(old.spaceId))) return { ok: false, reason: 'old_space_still_present', inventory: relevant };
    const exactSpaces = (listed || []).filter(space => Number(space?.id) === Number(binding.taskSpaceId)
      && String(space?.name || '') === String(binding.taskSpaceName));
    if (exactSpaces.length !== 1 || exactSpaces[0]?.ownership !== 'agent' || exactSpaces[0]?.profileId !== binding.egoProfileId) {
      return { ok: false, reason: 'new_space_not_exactly_owned', inventory: relevant };
    }
    const task = await taskSpace(Number(binding.taskSpaceId));
    if (Number(task?.spaceId) !== Number(binding.taskSpaceId) || String(task?.name || '') !== String(binding.taskSpaceName)
      || task?.ownership !== 'agent') return { ok: false, reason: 'task_space_changed', inventory: relevant };
    const tabs = await task.tabs();
    const exactTabs = (tabs || []).filter(tab => tab?.label === binding.pageLabel && String(tab?.targetId || '') === String(binding.targetId));
    if (exactTabs.length !== 1) return { ok: false, reason: 'target_tab_not_unique', inventory: relevant };
    const url = await task.page(binding.pageLabel).url();
    if (url !== exactTabs[0]?.url || url !== DOUYIN_UPLOAD_URL) return { ok: false, reason: 'upload_url_not_exact', inventory: relevant, url };
    const shape = {
      ok: true,
      profileId: exactSpaces[0].profileId,
      spaceId: Number(task.spaceId),
      spaceName: String(task.name),
      ownership: task.ownership,
      pageLabel: binding.pageLabel,
      targetId: String(exactTabs[0].targetId),
      url,
      inventory: relevant,
      tabs: [{ label: String(exactTabs[0].label), targetId: String(exactTabs[0].targetId), url: String(exactTabs[0].url) }],
    };
    return shape;
  } catch {
    return { ok: false, reason: 'window_binding_snapshot_unavailable', inventory: [] };
  }
}

async function captureDouyinWindowDom(binding, stage = '') {
  const uploadSurface = await inspectDouyinUploadSurface().catch(() => null);
  const domState = await js(String.raw`(() => {
    const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
    const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>4&&r.height>4&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0;};
    const videoInputs=[...document.querySelectorAll('input[type="file"]')].map(input=>{
      const accept=String(input.accept||'');if(!/video|\.mp4|\.mov|\.mkv|\.flv|\.webm/i.test(accept))return null;
      const ancestor=[];let node=input.parentElement;
      for(let depth=0;node&&depth<10;depth+=1,node=node.parentElement){const text=compact(node.innerText||node.textContent||'');const r=node.getBoundingClientRect(),s=getComputedStyle(node);ancestor.push({visible:r.width>8&&r.height>8&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0,text:text.slice(0,500)});}
      return {accept:accept.slice(0,240),disabled:Boolean(input.disabled),fileCount:Number(input.files?.length||0),inputVisible:visible(input),ancestor};
    }).filter(Boolean);
    const editables=[...document.querySelectorAll('[contenteditable="true"],[contenteditable=""],textarea,input[placeholder*="作品标题"]')].filter(visible);
    const videos=[...document.querySelectorAll('video')].filter(el=>visible(el)&&Boolean(el.currentSrc||el.src));
    const dialogs=[...document.querySelectorAll('[role="dialog"],.semi-modal,[class*="modal-mask"],[class*="dialog-mask"]')].filter(visible).map(el=>compact(el.innerText||el.textContent||'').slice(0,500));
    return {url:location.href,videoInputs,editorCount:editables.length,videoCount:videos.length,blockingDialogs:dialogs};
  })()`);
  const guard = await inspectFinalPublishGuard().catch(() => ({ armed: false, blockedAttempts: -1 }));
  const buttons = stage === 'before-final-click' ? await inspectFinalButtons(/^发布$/).catch(() => []) : [];
  const dom = {
    url: String(domState?.url || ''),
    targetId: String(binding?.targetId || ''),
    videoInputs: Array.isArray(domState?.videoInputs) ? domState.videoInputs : [],
    editorCount: Number(domState?.editorCount ?? -1),
    videoCount: Number(domState?.videoCount ?? -1),
    blockingDialogs: Array.isArray(domState?.blockingDialogs) ? domState.blockingDialogs : ['unreadable'],
    safety: { guardArmed: guard?.armed === true, blockedAttempts: Number(guard?.blockedAttempts ?? -1), finalPublishClicked: false },
    ...(stage === 'before-final-click' ? {
      finalButtonCount: buttons.length,
      enabledFinalButtonCount: buttons.filter(button => button?.disabled !== true).length,
    } : {}),
  };
  return { uploadSurface, dom };
}

async function inspectFinalButtons(labels = FINAL_TEXT) {
  return await js(String.raw`((source, flags) => {
    const re = new RegExp(source, flags)
    const compact = value => String(value || '').replace(/\s+/g, ' ').trim()
    const roots = [document, ...[...document.querySelectorAll('*')].map(el => el.shadowRoot).filter(Boolean)]
    return roots.flatMap(root => [...root.querySelectorAll('button, [role="button"], .d-button, .bcc-button, div, span')])
      .map(el => {
        const rect = el.getBoundingClientRect(); const style = getComputedStyle(el)
        const text = compact(el.innerText || el.textContent || '')
        const buttonish = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || /button|btn|submit/i.test(String(el.className || ''))
        return { text, disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true' || /disabled|loading/.test(String(el.className || '')), buttonish, width: Math.round(rect.width), height: Math.round(rect.height), display: style.display, visibility: style.visibility }
      })
      .filter(item => re.test(item.text) && item.width > 12 && item.height > 12 && item.display !== 'none' && item.visibility !== 'hidden')
      .sort((a, b) => Number(b.buttonish) - Number(a.buttonish) || (a.width * a.height) - (b.width * b.height))
  })(${JSON.stringify(labels.source)}, ${JSON.stringify(labels.flags)})`);
}

async function inspectBlockingDialogs(allowPatterns = []) {
  return await js(String.raw`((allowSources) => {
    const compact = value => String(value || '').replace(/\s+/g, ' ').trim()
    const allowed = allowSources.map(source => new RegExp(source))
    const roots = [document, ...[...document.querySelectorAll('*')].map(el => el.shadowRoot).filter(Boolean)]
    const selectors = '.d-modal-mask, .semi-modal-mask, .bcc-dialog, .bcc-modal, [role="dialog"], [class*="modal-mask"], [class*="dialog-mask"]'
    return roots.flatMap(root => [...root.querySelectorAll(selectors)])
      .map(el => {
        const rect = el.getBoundingClientRect(); const style = getComputedStyle(el)
        const text = compact(el.innerText || el.textContent || '')
        const staleLeaving = /leave-active/.test(String(el.className || '')) && Number(style.opacity) === 0
        return { text: text.slice(0, 600), className: String(el.className || ''), width: rect.width, height: rect.height, opacity: style.opacity, pointerEvents: style.pointerEvents, display: style.display, visibility: style.visibility, staleLeaving }
      })
      .filter(item => item.width > 20 && item.height > 20 && item.display !== 'none' && item.visibility !== 'hidden' && !item.staleLeaving)
      .filter(item => !allowed.some(re => re.test(item.text)))
  })(${JSON.stringify(allowPatterns.map(pattern => pattern.source))})`);
}

async function setNativeInputValue(selector, value) {
  return await js(String.raw`((selector, value) => {
    const el = document.querySelector(selector)
    if (!el) return { ok: false, reason: 'input missing', selector }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (!setter) return { ok: false, reason: 'native value setter missing' }
    el.focus(); setter.call(el, value)
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }))
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    el.blur()
    return { ok: el.value === value, value: el.value }
  })(${JSON.stringify(selector)}, ${JSON.stringify(value)})`);
}

async function removeExactStaleMask(textPattern) {
  return await js(String.raw`((source, flags) => {
    const re = new RegExp(source, flags)
    const masks = [...document.querySelectorAll('.d-modal-mask, [class*="modal-mask"]')]
      .filter(el => re.test(el.innerText || el.textContent || ''))
      .filter(el => /leave-active/.test(String(el.className || '')) && Number(getComputedStyle(el).opacity) === 0)
    masks.forEach(el => el.remove())
    return { removed: masks.length }
  })(${JSON.stringify(textPattern.source)}, ${JSON.stringify(textPattern.flags)})`);
}

async function emitObservation(observation) {
  const inspectOnly = isPersonalDouyinInspectOnly();
  const guard = inspectOnly ? { armed: false, blockedAttempts: 0, readOnlyInspection: true } : await inspectFinalPublishGuard().catch(error => ({
    armed: false,
    blockedAttempts: 0,
    error: String(error?.message || error),
  }));
  const payload = {
    schemaVersion: 1,
    platform,
    phase,
    taskSpaceId: activeTaskSpace?.id ?? null,
    taskSpace: activeTaskSpace?.name || taskName,
    taskSpaceRecovery,
    observedAt: new Date().toISOString(),
    finalPublishClicked: false,
    ...observation,
  };
  // Safety is injected centrally and backed by a page-level capture guard.
  // A blocked attempt keeps the draft unpublished, but intentionally fails READY
  // so accidental final-button interaction cannot pass unnoticed.
  payload.gates ||= {};
  const safetyEvidence = { finalPublishClicked: false, guardArmed: guard.armed === true, blockedAttempts: guard.blockedAttempts || 0, attempts: guard.attempts || [], guardVersion: guard.version || null,
    ...(inspectOnly ? { readOnlyInspection: true, noWritePhaseDispatched: phase === 'inspect' } : {}) };
  payload.gates.safety = inspectOnly && phase === 'inspect'
    ? okGate(safetyEvidence)
    : guard.armed === true && guard.blockedAttempts === 0 ? okGate(safetyEvidence) : failedGate(safetyEvidence);
  delete payload.ready;
  cliLog(V2_RESULT_PREFIX + JSON.stringify(payload));
  return payload;
}
