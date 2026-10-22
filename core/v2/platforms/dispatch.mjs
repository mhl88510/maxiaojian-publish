const prepared = await preparePlatform();
function douyinWindowProofFromPrepared(preparedValue) {
  const snapshots = preparedValue?.douyinWindowSnapshots;
  if (!snapshots?.before || !snapshots?.after) return null;
  const snapshot = value => ({
    binding: {
      profileId: value.profileId,
      spaceId: Number(value.spaceId),
      spaceName: String(value.spaceName || ''),
      ownership: value.ownership,
      pageLabel: value.pageLabel,
      targetId: String(value.targetId || ''),
      host: 'creator.douyin.com',
      uploadUrl: String(value.url || ''),
    },
    inventory: value.inventory,
    tabs: value.tabs,
    identity: {
      status: value.identity?.status,
      ok: value.identity?.ok === true,
      uid: value.identity?.uid,
      nickname: value.identity?.nickname,
      unique_id: value.identity?.unique_id,
    },
    dom: value.dom,
  });
  return {
    before: snapshot(snapshots.before),
    after: snapshot(snapshots.after),
    excluded_case_accountRow: snapshots.excluded_case_accountRow,
    mutation: { ...douyinWindowMutationCounters },
  };
}
if (typeof douyinPersonalInspectOnlyActive !== 'undefined' && douyinPersonalInspectOnlyActive === true) {
  const surfaceRecovery = typeof douyinPersonalPostResultSurfaceRecoveryActive !== 'undefined'
    && douyinPersonalPostResultSurfaceRecoveryActive === true;
  const draftContinuation = typeof douyinPersonalPostResultDraftContinuationActive !== 'undefined'
    && douyinPersonalPostResultDraftContinuationActive === true;
  const allowedMode = surfaceRecovery
    ? douyinPersonalPostResultSurfaceRecoveryContract?.mode === 'douyin_personal_post_result_surface_recovery'
    : draftContinuation
      ? douyinPersonalPostResultDraftContinuationContract?.mode === 'douyin_personal_post_result_draft_continuation'
      : douyinPersonalInspectOnlyContract?.mode === 'reserved_personal_route_inspect_only';
  if (platform !== 'douyin' || phase !== 'inspect' || !allowedMode) {
    await emitObservation({ blocker: typedBlocker('DOUYIN_PERSONAL_INSPECT_ONLY_PHASE_FORBIDDEN', '个人抖音恢复只允许受限 inspect 阶段', { retryable: false }), gates: {} });
  } else if (!prepared.selected.ok) {
    await emitObservation({
      blocker: prepared.selected.blocker,
      gates: {
        authenticated: failedGate({ reason: 'exact pinned original page/profile/space/target was not verified' }),
        draftIdentity: failedGate({ reason: 'inspection not run' }),
        video: failedGate({ reason: 'inspection not run' }),
      },
      evidence: { inspectOnly: true, phaseDispatched: null },
    });
  } else {
    const result = await runPlatformPhase();
    const counters = { ...douyinWindowMutationCounters };
    const inspectOnlyEvidence = douyinPersonalInspectOnlyMutationEvidence(result, counters);
    if (inspectOnlyEvidence.mutationContractBreached) {
      result.blocker = typedBlocker('DOUYIN_PERSONAL_INSPECT_ONLY_MUTATION_CONTRACT_BREACHED', '只读 inspect 未能证明零写入动作；结果不进入后续流程', { retryable: false });
      // Do not emit potentially sensitive action payloads, but preserve explicit
      // presence/count/breach evidence below so projection can never mistake
      // this guard path for a clean inspection.
      if (inspectOnlyEvidence.actionsPresent) delete result.actions;
    }
    inspectOnlyEvidence.blockerPresent = Boolean(result?.blocker);
    inspectOnlyEvidence.blockerCode = typeof result?.blocker?.code === 'string'
      && /^[A-Z0-9_:-]{1,120}$/.test(result.blocker.code) ? result.blocker.code : null;
    result.evidence = {
      ...(result.evidence || {}),
      douyinIdentityProof: prepared.douyinIdentity || null,
      uploadSurface: result.evidence?.uploadSurface || prepared.douyinUploadSurface || null,
      ...(surfaceRecovery ? { douyinPersonalPostResultSurfaceRecovery: prepared.douyinPersonalPostResultSurfaceRecovery || null } : {}),
      inspectOnly: inspectOnlyEvidence,
    };
    if (result.gates?.authenticated) {
      result.gates.authenticated.evidence = {
        ...(result.gates.authenticated.evidence || {}),
        url: await boundPage().url(),
        douyinUploadSurface: result.evidence.uploadSurface,
        douyinIdentity: prepared.douyinIdentity || null,
      };
      if (result.gates.authenticated.evidence.url !== 'https://creator.douyin.com/creator-micro/content/upload'
          || result.gates.authenticated.evidence.douyinIdentity?.ok !== true) {
        result.gates.authenticated = failedGate({ reason: 'exact pinned upload page or creator API identity changed during inspect' });
      }
    }
    await emitObservation(result);
  }
} else if (!prepared.selected.ok) {
  await emitObservation({
    blocker: prepared.selected.blocker,
    gates: {
      authenticated: failedGate({ reason: 'page unavailable' }),
      draftIdentity: failedGate({ reason: 'page unavailable' }),
      video: failedGate({ reason: 'page unavailable' }),
    },
  });
} else {
  if (typeof nativeRecovery !== 'undefined' && nativeRecovery) {
    if(platform!=='douyin'||nativeRecovery.fingerprint!==jobFingerprint||JSON.stringify(nativeRecovery.binding)!==JSON.stringify(pkg.schoolAccount)||['upload','upload_start','quarantine'].includes(phase)||(nativeRecovery.resumeType==='personal_r3_existing_video_metadata_v1'&&!['inspect','mutate','verify'].includes(phase))) {
      await emitObservation({blocker:typedBlocker('UPLOAD_STATE_UNKNOWN_DO_NOT_REINJECT','恢复合同不匹配或尝试重复注入；停止',{evidence:{phase}}),gates:{}});
    } else {
      const expected={...nativeRecovery,nativeVideoId:expectedVideoReceipt?.nativeMedia?.vid||nativeRecovery.nativeVideoId||'',nativeMedia:expectedVideoReceipt?.nativeMedia||nativeRecovery.nativeMedia};
      const preview=await ensureNativeVideoRecoveryPreview(expected);
      const proof=preview.ok?await js(`(${nativeVideoRecoveryProof.toString()})(${JSON.stringify(expected)})`):preview;
      if(!proof.ok)await emitObservation({blocker:typedBlocker(proof.code,'原页面缺少真实同文件恢复证据；不上传、不伪造回执',{evidence:proof}),gates:{}});
      else {
        const result=await runPlatformPhase();
        if(result.gates?.video?.ok!==true)result.blocker=typedBlocker('UPLOAD_STATE_UNKNOWN_DO_NOT_REINJECT','原生文件虽匹配但上传尚未证实完成；不重传');
        else {
          let postProof=proof;
          if(nativeRecovery.resumeType==='personal_r3_existing_video_metadata_v1'){
            const postPreview=await ensureNativeVideoRecoveryPreview(expected);
            postProof=postPreview.ok?await js(`(${nativeVideoRecoveryProof.toString()})(${JSON.stringify(expected)})`):postPreview;
            if(!postProof.ok||postProof.vid!==proof.vid||postProof.sha256!==proof.sha256)result.blocker=typedBlocker('PERSONAL_EXISTING_POST_MUTATION_SOURCE_CHANGED','同一原视频复核未通过；禁止保存或发表',{evidence:postProof});
          }
          if(!result.blocker)result.actions={...(result.actions||{}),upload:{mode:'recovered_original_file',proof:postProof}};
        }
        await emitObservation(result);
      }
    }
  } else {
    const hasIdentityValue = value => value !== undefined && value !== null && value !== '';
    const douyinApiIdentityActive = platform === 'douyin' && pkg.schoolAccount
      && (hasIdentityValue(pkg.schoolAccount.accountId) || hasIdentityValue(pkg.schoolAccount.apiUid));
    const scopeResumeActive = platform === 'douyin'
      && typeof douyinPreparationScopeResumeActive !== 'undefined'
      && douyinPreparationScopeResumeActive === true;
    let result;
    let douyinFreshIdentityProof = null;
    let douyinFreshUploadSurface = null;
    const douyinWindowBindingActive = typeof douyinWindowBindingResumeActive !== 'undefined'
      && douyinWindowBindingResumeActive === true
      && douyinWindowBindingResumeContract?.resumeType === 'douyin_same_job_window_binding_recovery';
    if (douyinWindowBindingActive && phase === 'upload_start') {
      result = await runPlatformPhase();
      result.evidence = { ...(result.evidence || {}), douyinWindowBinding: douyinWindowBindingResumeContract.executionBinding };
    } else if (douyinApiIdentityActive && phase === 'upload_start' && !douyinWindowBindingActive) {
      // Every API-bound Douyin upload starts with a same-phase lossless creator
      // GET, exact original binding, actual upload surface, blank-editor, and
      // clean final-action proof. Resume contracts only add lineage assertions.
      const expectedUploadUrl = 'https://creator.douyin.com/creator-micro/content/upload';
      const normalizeSurface = value => {
        const input = value?.videoFileInput;
        const area = input?.visibleUploadArea;
        return {
          ok: value?.ok === true && value?.url === expectedUploadUrl && Boolean(input) && input.disabled === false && area?.visible === true,
          url: String(value?.url || ''),
          videoInputCount: Number(value?.videoInputCount || 0),
          enabledVideoInputCount: Number(value?.enabledVideoInputCount || 0),
          videoFileInput: input ? {
            accept: String(input.accept || ''),
            disabled: Boolean(input.disabled),
            visibleUploadArea: { visible: area?.visible === true },
          } : null,
        };
      };
      const actualUrl = await boundPage().url();
      const actualSurface = normalizeSurface(await inspectDouyinUploadSurface());
      const identityBefore = await captureDouyinSchoolBinding(pkg.schoolAccount);
      let creatorIdentity = null;
      let creatorIdentityError = null;
      try {
        const data = await creatorGet(boundPage(), 'https://creator.douyin.com/web/api/media/user/info/?aid=1128');
        if ('bizstatus' in data && data.bizstatus !== 0) throw new Error('CREATOR_API_ERROR_BIZSTATUS');
        const user = data?.user_info || data?.user;
        const exactId = value => typeof value === 'string' && /^\d+$/.test(value)
          ? value
          : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
        creatorIdentity = {
          status: 200,
          uid: exactId(user?.uid),
          nickname: typeof user?.nickname === 'string' ? user.nickname : '',
          unique_id: exactId(user?.unique_id),
          unique_id_explicitly_empty: user?.unique_id === '',
          short_id: exactId(user?.short_id),
        };
      } catch (error) { creatorIdentityError = String(error?.message || error).slice(0, 160); }
      const preUpload = await inspectDouyin();
      const postGuard = await captureDouyinSchoolBinding(pkg.schoolAccount);
      const finalGuard = await inspectFinalPublishGuard();
      const compactName = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
      const guardShape = value => value && ({
        ok: value.ok,
        profileId: value.profileId,
        spaceId: value.spaceId,
        spaceName: value.spaceName,
        ownership: value.ownership,
        pageLabel: value.pageLabel,
        targetId: value.targetId,
        url: value.url,
      });
      const bindingFrom = value => value && ({
        ok: value.ok,
        profileId: value.profileId,
        spaceId: value.spaceId,
        spaceName: value.spaceName,
        ownership: value.ownership,
        pageLabel: value.pageLabel,
        targetId: value.targetId,
        url: value.url,
      });
      const beforeShape = bindingFrom(identityBefore);
      const afterShape = bindingFrom(postGuard);
      const expectedBindingMatches = value => value?.ok === true
        && value.profileId === pkg.schoolAccount.egoProfileId
        && value.spaceId === pkg.schoolAccount.taskSpaceId
        && value.spaceName === pkg.schoolAccount.taskSpaceName
        && value.ownership === 'agent'
        && value.pageLabel === pkg.schoolAccount.pageLabel
        && value.targetId === pkg.schoolAccount.targetId
        && value.url === expectedUploadUrl;
      const apiUidPinned = hasIdentityValue(pkg.schoolAccount.apiUid);
      const apiUidPinMatches = !apiUidPinned || (typeof pkg.schoolAccount.apiUid === 'string'
        && /^\d+$/.test(pkg.schoolAccount.apiUid) && creatorIdentity?.uid === pkg.schoolAccount.apiUid);
      // Reuse the serialized core's exact account-specific rule. A normalized
      // null unique_id alone is never proof that the raw API field was empty.
      const creatorPublicIdField = douyinCreatorPublicIdMatchField(creatorIdentity, pkg.schoolAccount, platform);
      const creatorIdentityMatches = !creatorIdentityError
        && creatorIdentity?.status === 200
        && typeof creatorIdentity?.uid === 'string' && /^\d+$/.test(creatorIdentity.uid)
        && apiUidPinMatches
        && compactName(creatorIdentity.nickname) === compactName(pkg.schoolAccount.accountName)
        && typeof pkg.schoolAccount.accountId === 'string' && /^\d+$/.test(pkg.schoolAccount.accountId)
        && creatorPublicIdField !== null;
      const bindingStable = expectedBindingMatches(beforeShape) && expectedBindingMatches(afterShape)
        && JSON.stringify(beforeShape) === JSON.stringify(afterShape)
        && JSON.stringify(afterShape) === JSON.stringify(bindingFrom(identityBefore));
      const platformHost = (() => { try { return new URL(actualUrl).hostname; } catch { return ''; } })();
      const preparedIdentity = prepared.douyinIdentity;
      // preparePlatform has already validated its raw API response through the
      // same core matcher. Its public proof normalizes an empty unique_id to
      // null (the ordinary path does not emit short_id). Accept that projection
      // only alongside this fresh, explicit-empty + exact-short-id proof, the
      // verified prepared identity, and the unchanged UID/name/window binding.
      const preparedPublicIdMatches = creatorPublicIdField === 'unique_id'
        ? preparedIdentity?.unique_id === pkg.schoolAccount.accountId
          && (preparedIdentity.creatorApiPublicIdField === undefined || preparedIdentity.creatorApiPublicIdField === 'unique_id')
        : creatorPublicIdField === 'short_id'
          && preparedIdentity?.ok === true && preparedIdentity.unique_id === null
          && (preparedIdentity.creatorApiPublicIdField === undefined || preparedIdentity.creatorApiPublicIdField === 'short_id');
      const preparedIdentityMatches = preparedIdentity?.source === 'creator_api'
        && preparedIdentity.uid === creatorIdentity?.uid
        && compactName(preparedIdentity.nickname) === compactName(creatorIdentity?.nickname)
        && preparedPublicIdMatches
        && JSON.stringify(guardShape(preparedIdentity.after)) === JSON.stringify(afterShape);
      const identityMatches = creatorIdentityMatches && bindingStable && preparedIdentityMatches
        && platformHost === 'creator.douyin.com' && actualUrl === expectedUploadUrl;
      douyinFreshIdentityProof = {
        source: 'creator_api',
        ok: identityMatches,
        status: creatorIdentity?.status ?? null,
        uid: creatorIdentity?.uid ?? null,
        nickname: creatorIdentity?.nickname ?? '',
        unique_id: creatorIdentity?.unique_id ?? null,
        ...(creatorPublicIdField === 'short_id' ? { creatorApiPublicIdField: 'short_id' } : {}),
        binding: afterShape || null,
        before: beforeShape || null,
        after: afterShape || null,
        platformHost,
      };
      const editor = preUpload.gates?.draftIdentity?.evidence || {};
      const video = preUpload.gates?.video?.evidence || {};
      const uploadSurface = actualSurface;
      const freshSurface = normalizeSurface(preUpload.evidence?.uploadSurface || null);
      douyinFreshUploadSurface = uploadSurface;
      const editorBlank = preUpload.gates?.draftIdentity?.ok === true
        && editor.empty === true && editor.title === '' && editor.editorText === '';
      const freshUploadSurface = preUpload.gates?.authenticated?.ok === true
        && preUpload.gates?.authenticated?.evidence?.url === actualUrl
        && freshSurface?.ok === true && freshSurface.url === actualUrl
        && uploadSurface?.ok === true && uploadSurface.url === actualUrl
        && JSON.stringify(freshSurface) === JSON.stringify(uploadSurface);
      const noUpload = preUpload.gates?.video?.ok === false
        && video.uploaded === false && video.uploading === false && video.failed === false
        && video.resumeDialog === false;
      const noBlockingDialog = preUpload.gates?.noBlockingDialog?.ok === true
        && Array.isArray(preUpload.gates.noBlockingDialog.evidence?.active)
        && preUpload.gates.noBlockingDialog.evidence.active.length === 0;
      const cleanGuard = finalGuard?.armed === true && finalGuard.blockedAttempts === 0
        && Array.isArray(finalGuard.attempts) && finalGuard.attempts.length === 0;
      const proof = {
        douyinIdentity: douyinFreshIdentityProof,
        actualUrl,
        uploadSurface,
        freshUploadSurface,
        bindingBefore: identityBefore,
        bindingAfter: postGuard,
        editor,
        video,
        noBlockingDialog,
        finalGuard,
      };
      if (actualUrl !== expectedUploadUrl || uploadSurface?.ok !== true || uploadSurface.url !== actualUrl || !freshUploadSurface) {
        const surfaceCode = scopeResumeActive ? 'DOUYIN_SCOPE_RESUME_UPLOAD_SURFACE_NOT_EXACT' : 'DOUYIN_UPLOAD_SURFACE_NOT_EXACT';
        result = {
          blocker: typedBlocker(surfaceCode, '首次上传前未能再次确认同一原始 target 正停留于真实上传页且存在唯一启用的视频文件 input 和可见上传区；已停止文件注入', {
            retryable: false,
            evidence: { expectedUrl: expectedUploadUrl, actualUrl, uploadSurface, freshUploadSurface, proof },
          }),
          gates: {
            ...(preUpload.gates || {}),
            authenticated: failedGate({ url: actualUrl, douyinUploadSurface: uploadSurface, douyinIdentity: null }),
          },
          evidence: { douyinPreparationScopeResumePreupload: proof, douyinIdentityProof: douyinFreshIdentityProof, uploadSurface },
        };
      } else if (!identityMatches || !editorBlank || !noUpload || !noBlockingDialog || !cleanGuard) {
        const gateCode = scopeResumeActive ? 'DOUYIN_SCOPE_RESUME_PREUPLOAD_GATE_FAILED' : 'DOUYIN_UPLOAD_START_GATE_FAILED';
        result = {
          blocker: typedBlocker(gateCode, '首次上传前的账号、空编辑器、未上传状态和安全守卫未能再次确认；已停止文件注入', {
            retryable: false,
            evidence: { identityMatches, creatorIdentityError, editorBlank, noUpload, noBlockingDialog, cleanGuard, proof },
          }),
          gates: {
            ...(preUpload.gates || {}),
            authenticated: identityMatches
              ? okGate({ url: actualUrl, douyinUploadSurface: uploadSurface })
              : failedGate({ reason: 'fresh_creator_api_identity_missing' }),
          },
          evidence: { douyinPreparationScopeResumePreupload: proof, douyinIdentityProof: douyinFreshIdentityProof },
        };
      } else {
        result = await runPlatformPhase();
        result.evidence = { ...(result.evidence || {}), douyinPreparationScopeResumePreupload: proof, douyinIdentityProof: douyinFreshIdentityProof, uploadSurface };
      }
    } else {
      result = await runPlatformPhase();
    }
    if (douyinWindowBindingActive) {
      result.evidence ||= {};
      result.douyinWindowBinding = douyinWindowBindingResumeContract.executionBinding;
      if (phase === 'inspect') {
        const proof = douyinWindowProofFromPrepared(prepared);
        if (proof) result.evidence.douyinWindowBindingProof = proof;
        else result.blocker = typedBlocker('DOUYIN_WINDOW_BINDING_FRESH_PROOF_UNAVAILABLE', 'Fresh exact window-binding proof was unavailable.', { retryable: false });
      }
    }
    if (douyinApiIdentityActive && prepared.douyinIdentity) {
      result.gates ||= {};
      const auth = result.gates.authenticated;
      const actualUrl = prepared.douyinIdentity.after?.url || '';
      const rawSurface = douyinFreshUploadSurface || prepared.douyinUploadSurface || result.evidence?.uploadSurface || null;
      const input = rawSurface?.videoFileInput;
      const persistedSurface = rawSurface ? {
        ok: rawSurface.ok === true,
        url: String(rawSurface.url || ''),
        videoInputCount: Number(rawSurface.videoInputCount || 0),
        enabledVideoInputCount: Number(rawSurface.enabledVideoInputCount || 0),
        videoFileInput: input ? {
          accept: String(input.accept || ''),
          disabled: Boolean(input.disabled),
          visibleUploadArea: { visible: input.visibleUploadArea?.visible === true },
        } : null,
      } : null;
      const richIdentity = douyinFreshIdentityProof || prepared.douyinIdentity;
      const persistedIdentity = {
        source: 'creator_api',
        uid: richIdentity.uid,
        nickname: richIdentity.nickname,
        unique_id: richIdentity.unique_id,
        ...(richIdentity.creatorApiPublicIdField === 'short_id' ? { creatorApiPublicIdField: 'short_id' } : {}),
        binding: richIdentity.binding,
        before: richIdentity.before,
        after: richIdentity.after,
      };
      if (auth) {
        const preuploadProof = result.evidence?.douyinPreparationScopeResumePreupload;
        const expectedUploadUrl = 'https://creator.douyin.com/creator-micro/content/upload';
        const completedUploadWithExactIdentity = phase === 'upload_start'
          && scopeResumeActive === true
          && !result.blocker
          && auth.ok !== true
          && auth.evidence?.url === expectedUploadUrl
          && auth.evidence?.loginRequired === false
          && richIdentity === douyinFreshIdentityProof
          && richIdentity?.source === 'creator_api'
          && richIdentity.ok === true
          && richIdentity.status === 200
          && richIdentity.platformHost === 'creator.douyin.com'
          && richIdentity.binding?.ok === true
          && richIdentity.before?.ok === true
          && richIdentity.after?.ok === true
          && richIdentity.before?.targetId === richIdentity.after?.targetId
          && richIdentity.before?.targetId === richIdentity.binding?.targetId
          && richIdentity.before?.url === expectedUploadUrl
          && richIdentity.after?.url === expectedUploadUrl
          && result.gates?.video?.ok === true
          && preuploadProof?.actualUrl === expectedUploadUrl
          && preuploadProof?.freshUploadSurface === true
          && preuploadProof?.uploadSurface?.ok === true
          && preuploadProof?.uploadSurface?.url === expectedUploadUrl
          && Number(preuploadProof?.uploadSurface?.videoInputCount) === 1
          && Number(preuploadProof?.uploadSurface?.enabledVideoInputCount) === 1
          && preuploadProof?.uploadSurface?.videoFileInput?.disabled === false
          && preuploadProof?.uploadSurface?.videoFileInput?.visibleUploadArea?.visible === true
          && preuploadProof?.douyinIdentity?.ok === true
          && preuploadProof?.douyinIdentity?.status === 200
          && preuploadProof?.video?.uploaded === false
          && preuploadProof?.video?.uploading === false
          && preuploadProof?.video?.failed === false
          && preuploadProof?.video?.resumeDialog === false
          && preuploadProof?.noBlockingDialog === true
          && preuploadProof?.finalGuard?.armed === true
          && preuploadProof?.finalGuard?.blockedAttempts === 0
          && Array.isArray(preuploadProof?.finalGuard?.attempts)
          && preuploadProof.finalGuard.attempts.length === 0;
        // A successful upload can move the page out of the upload surface. In
        // that one post-upload case, keep authentication bound to the fresh
        // creator identity and exact pre-input surface proof; never turn a
        // login/challenge or an incomplete/unknown upload into authenticated.
        auth.ok = richIdentity.ok === true && (auth.ok === true || completedUploadWithExactIdentity);
        auth.evidence = { ...(auth.evidence || {}), url: actualUrl, douyinIdentity: persistedIdentity, ...(persistedSurface ? { douyinUploadSurface: persistedSurface } : {}), ...(prepared.douyinNavigationOrigin ? { navigationOrigin: prepared.douyinNavigationOrigin } : {}) };
      } else result.gates.authenticated = failedGate({ reason: 'authentication_observation_missing', url: actualUrl, douyinIdentity: persistedIdentity, ...(persistedSurface ? { douyinUploadSurface: persistedSurface } : {}), ...(prepared.douyinNavigationOrigin ? { navigationOrigin: prepared.douyinNavigationOrigin } : {}) });
      result.evidence ||= {};
      result.evidence.douyinIdentityProof = richIdentity;
      if (persistedSurface) result.evidence.uploadSurface = persistedSurface;
    }
    await emitObservation(result);
  }
}
