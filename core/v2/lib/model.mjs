export const PLATFORMS = ["xiaohongshu", "douyin", "bilibili", "wechat_channels", "youtube"];

export const BLOCKER = Object.freeze({
  AUTH_REQUIRED: "AUTH_REQUIRED",
  USER_CONTROL: "USER_CONTROL",
  BROWSER_PERMISSION_REQUIRED: "BROWSER_PERMISSION_REQUIRED",
  FOREIGN_DRAFT: "FOREIGN_DRAFT",
  UPLOAD_NOT_STARTED: "UPLOAD_NOT_STARTED",
  UPLOAD_STALLED: "UPLOAD_STALLED",
  RISK_CONTROL: "RISK_CONTROL",
  SELECTOR_DRIFT: "SELECTOR_DRIFT",
  STATE_AMBIGUOUS: "STATE_AMBIGUOUS",
  INPUT_CHANNEL_BROKEN: "INPUT_CHANNEL_BROKEN",
  PLATFORM_REJECTED_ASSET: "PLATFORM_REJECTED_ASSET",
  ACTION_FAILED: "ACTION_FAILED",
  DECLARATION_MISMATCH: "DECLARATION_MISMATCH",
});

const REQUIRED_GATES = Object.freeze({
  xiaohongshu: [
    "authenticated", "draftIdentity", "video", "title", "description", "tags", "original",
    "poi", "contentSource", "privateMessageComponent", "cover", "noBlockingDialog", "finalButton", "safety",
  ],
  douyin: [
    "authenticated", "draftIdentity", "video", "title", "description", "tags",
    "settings", "poi", "schedule", "cover", "noBlockingDialog", "finalButton", "safety",
  ],
  bilibili: [
    "authenticated", "draftIdentity", "video", "title", "description", "tags",
    "original", "cover", "noBlockingDialog", "finalButton", "safety",
  ],
  wechat_channels: [
    "authenticated", "draftIdentity", "video", "description", "topics", "shortTitle", "original",
    "cover", "noBlockingDialog", "finalButton", "safety",
  ],
  youtube: [
    "authenticated", "draftIdentity", "video", "title", "description", "tags",
    "audience", "settings", "cover", "visibility", "noBlockingDialog",
    "finalButton", "safety",
  ],
});

export function gate(ok, evidence = {}, extra = {}) {
  return { ok: ok === true, evidence, ...extra };
}

export function requiredGates(platform) {
  const gates = REQUIRED_GATES[platform];
  if (!gates) throw new Error(`Unsupported platform: ${platform}`);
  return [...gates];
}

export function videoReceiptFromObservation(observation, fingerprint, fallbackTaskSpaceId = null, expectedVideo = null) {
  const mode = observation?.actions?.upload?.mode;
  const proof=observation?.actions?.upload?.proof;
  if(mode==='recovered_original_blob' && (proof?.ok!==true||proof.mode!=='recovered_original_blob'||proof.source!=='existing_visible_local_blob'||proof.guardArmed!==true||proof.blockedAttempts!==0||!expectedVideo||proof.sha256!==expectedVideo.sha256||proof.size!==expectedVideo.size||!/^[a-f0-9]{64}$/.test(proof.sha256||'')||!Number.isFinite(proof.width)||proof.width<=0||!Number.isFinite(proof.height)||proof.height<=0||proof.name!==undefined||proof.vid!==undefined||proof.uri!==undefined||!Number.isFinite(proof.duration)||proof.duration<=0||proof.serverContentIdKnown!==false||observation.gates?.safety?.ok!==true||observation.gates?.authenticated?.ok!==true))return null;
  if(mode==='recovered_original_file' && (proof?.ok!==true || proof.mode!=='recovered_original_file' || proof.guardArmed!==true || proof.blockedAttempts!==0 || !expectedVideo || proof.sha256!==expectedVideo.sha256 || proof.size!==expectedVideo.size || proof.name!==String(expectedVideo.path||'').split(/[\\/]/).pop() || !/^[a-f0-9]{64}$/.test(proof?.sha256||'') || !/^v[a-zA-Z0-9]{10,100}$/.test(proof.vid||'') || !/^tos-[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(proof.uri||'') || observation.gates?.safety?.ok!==true || observation.gates?.authenticated?.ok!==true))return null;
  if (!fingerprint
    || observation?.blocker
    || observation?.gates?.video?.ok !== true
    || observation?.gates?.draftIdentity?.ok !== true
    || !["injected", "resume_existing", "recovered_original_file", "recovered_original_blob"].includes(mode)) return null;
  return {
    fingerprint,
    taskSpaceId: observation.taskSpaceId ?? fallbackTaskSpaceId ?? null,
    mode,
    ...(['recovered_original_file','recovered_original_blob'].includes(mode)?{nativeMedia:proof}:{}),
    observedAt: observation.observedAt || new Date().toISOString(),
  };
}

function normalizedBlocker(blocker) {
  if (!blocker) return null;
  if (typeof blocker === "string") {
    return { code: BLOCKER.ACTION_FAILED, message: blocker, retryable: false, requiresUser: false };
  }
  return {
    code: blocker.code || BLOCKER.ACTION_FAILED,
    message: blocker.message || blocker.code || "platform action failed",
    retryable: blocker.retryable === true,
    requiresUser: blocker.requiresUser === true,
    evidence: blocker.evidence || null,
  };
}

function missingGateBlocker(observation, missing) {
  const gates = observation.gates || {};
  if (gates.authenticated?.ok === false) {
    return { code: BLOCKER.AUTH_REQUIRED, message: "平台登录态无效或遇到安全验证", retryable: false, requiresUser: true };
  }
  if (gates.original?.evidence?.unexpectedSelection === true) {
    return {
      code: BLOCKER.DECLARATION_MISMATCH,
      message: "页面已有未经本次明确选择的原创/自制声明；停止本平台自动修改",
      retryable: false,
      requiresUser: true,
      evidence: gates.original.evidence,
    };
  }
  if (gates.draftIdentity?.ok === false && gates.draftIdentity?.evidence?.foreign === true) {
    return { code: BLOCKER.FOREIGN_DRAFT, message: "当前编辑器属于其他视频草稿", retryable: observation.platform === "bilibili", requiresUser: false };
  }
  if (gates.video?.evidence?.uploading === true) {
    return { code: BLOCKER.UPLOAD_STALLED, message: "视频仍在上传或处理中", retryable: true, requiresUser: false };
  }
  return {
    code: BLOCKER.STATE_AMBIGUOUS,
    message: `以下发布条件没有被页面证据确认: ${missing.join(", ")}`,
    retryable: true,
    requiresUser: false,
    evidence: Object.fromEntries(missing.map(name => [name, gates[name] || null])),
  };
}

export function evaluateObservation(observation) {
  if (!observation || !PLATFORMS.includes(observation.platform)) {
    throw new Error("Invalid platform observation");
  }
  const required = requiredGates(observation.platform);
  const gates = { ...(observation.gates || {}) };
  const safetyEvidence = gates.safety?.evidence || {};
  const safetyVerified = gates.safety?.ok === true
    && safetyEvidence.finalPublishClicked === false
    && safetyEvidence.guardArmed === true
    && safetyEvidence.blockedAttempts === 0;
  if (!safetyVerified) {
    gates.safety = {
      ...(gates.safety || {}),
      ok: false,
      evidence: safetyEvidence,
    };
  }
  const missing = required.filter(name => gates[name]?.ok !== true);
  const actionBlocker = normalizedBlocker(observation.blocker);
  const blocker = actionBlocker || (missing.length ? missingGateBlocker(observation, missing) : null);
  const ready = missing.length === 0 && blocker === null;
  return {
    schemaVersion: 1,
    platform: observation.platform,
    taskSpaceId: observation.taskSpaceId ?? null,
    phase: observation.phase || "inspect",
    observedAt: observation.observedAt || new Date().toISOString(),
    ready,
    required,
    missing,
    blocker,
    gates,
    evidence: observation.evidence || {},
  };
}

export function classifyVerdict(verdict) {
  if (verdict.ready) return "ready";
  if (verdict.blocker?.code === BLOCKER.DECLARATION_MISMATCH) return "blocked_user";
  if (verdict.blocker?.code === BLOCKER.AUTH_REQUIRED || [BLOCKER.USER_CONTROL, BLOCKER.BROWSER_PERMISSION_REQUIRED].includes(verdict.blocker?.code)) return "blocked_user";
  if (verdict.blocker?.code === BLOCKER.INPUT_CHANNEL_BROKEN) return "blocked";
  if (verdict.blocker?.code === BLOCKER.FOREIGN_DRAFT) {
    return verdict.platform === "bilibili" ? "needs_quarantine" : "blocked_foreign_draft";
  }
  if (verdict.gates.draftIdentity?.ok !== true) return "blocked";
  if (verdict.gates.video?.ok !== true) return "needs_upload";
  return "needs_mutation";
}

export function compactVerdict(verdict) {
  return {
    platform: verdict.platform,
    phase: verdict.phase,
    taskSpaceId: verdict.taskSpaceId,
    ready: verdict.ready,
    missing: verdict.missing,
    blocker: verdict.blocker,
  };
}
