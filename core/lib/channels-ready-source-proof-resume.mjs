import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readPackage } from './content-package.mjs';
import { buildIdentity } from '../v2/lib/identity.mjs';
import { requiredGates } from '../v2/lib/model.mjs';
import { resolveSchoolAccountBinding, schoolAccountStateRoot } from './school-account.mjs';
import { runEgoPreflight } from '../run-school-account.mjs';

const DEFAULT_STATE_BASE = path.join(os.homedir(), '.maxiaojian-publish', 'school-accounts');
const PHASES = ['inspect', 'inspect', 'upload_start', 'prefill', 'mutate', 'verify'];
const READY_SOURCE_PROOF_MODE = 'ready_source_proof';
const READY_SOURCE_PROOF_SAFETY_RETRY_MODE = 'ready_source_proof_safety_retry';
const READY_SOURCE_PROOF_SAFETY_RETRY_KIND = 'safety_only_false_block';
const READY_SOURCE_FALSE_SAFETY_BLOCKER = 'CHANNELS_READY_SOURCE_CURRENT_GATES_NOT_READY';
const fail = code => { throw new Error(code); };
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const compact = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const isDigest = value => /^[a-f0-9]{64}$/.test(String(value || ''));

function regularFile(file) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail('CHANNELS_READY_SOURCE_FILE_REQUIRED'); }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('CHANNELS_READY_SOURCE_REGULAR_FILE_REQUIRED');
  return stat;
}

function readJson(file, code = 'CHANNELS_READY_SOURCE_JSON_INVALID') {
  regularFile(file);
  try { return { raw: fs.readFileSync(file), value: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { fail(code); }
}

function safeEvidencePath(statePath, entry) {
  const root = path.join(path.dirname(statePath), 'evidence') + path.sep;
  const evidencePath = path.resolve(entry?.evidencePath || '');
  if (!evidencePath.startsWith(root)) fail('CHANNELS_READY_SOURCE_EVIDENCE_PATH_REJECTED');
  regularFile(evidencePath);
  return evidencePath;
}

function assertCleanSafety(gate) {
  const evidence = gate?.evidence || {};
  return gate?.ok === true && evidence.finalPublishClicked === false
    && evidence.guardArmed === true && evidence.blockedAttempts === 0;
}

function assertNativeTopicsEvidence(gates) {
  const description = gates.description?.evidence || {};
  const topic = gates.topics?.evidence || {};
  const actual = compact(description.actual);
  const expected = Array.isArray(topic.expected) ? topic.expected.map(compact) : [];
  const spans = Array.isArray(topic.nativeTopicSpans) ? topic.nativeTopicSpans : [];
  if (!actual || compact(description.expected) !== actual || compact(topic.description) !== actual
      || !expected.length || spans.length !== expected.length
      || spans.some((span, index) => span?.dataType !== 'topic'
        || !Array.isArray(span.classes) || !span.classes.includes('hl') || !span.classes.includes('topic')
        || compact(span.text) !== `#${expected[index].replace(/^#+\s*/, '')}`)) {
    fail('CHANNELS_READY_SOURCE_NATIVE_TOPICS_NOT_PROVED');
  }
}

function assertReadyObservation(evidence, phase, taskSpaceId, { requireAllGates = false } = {}) {
  const o = evidence?.observation;
  const v = evidence?.verdict;
  if (o?.platform !== 'wechat_channels' || o.phase !== phase
      || Number(o.taskSpaceId) !== Number(taskSpaceId) || o.finalPublishClicked !== false
      || v?.platform !== 'wechat_channels' || v.phase !== phase
      || Number(v.taskSpaceId) !== Number(taskSpaceId) || v.ready !== true
      || (Array.isArray(v.missing) && v.missing.length) || v.blocker) fail('CHANNELS_READY_SOURCE_PHASE_NOT_READY');
  const gates = o.gates || {};
  if (!assertCleanSafety(gates.safety)) fail('CHANNELS_READY_SOURCE_CLEAN_GUARD_REQUIRED');
  if (requireAllGates) {
    for (const name of requiredGates('wechat_channels')) {
      if (gates[name]?.ok !== true) fail('CHANNELS_READY_SOURCE_REQUIRED_GATE_MISSING');
    }
    assertNativeTopicsEvidence(gates);
    const d = gates.description?.evidence || {};
    const st = gates.shortTitle?.evidence || {};
    if (compact(d.expected) !== compact(d.actual) || compact(st.expected) !== compact(st.actual)) {
      fail('CHANNELS_READY_SOURCE_REQUIRED_FIELD_MISMATCH');
    }
  }
  return o;
}

function assertSourceProof(proof, video, { requireReadySourceMode = false } = {}) {
  if (proof?.ok !== true || proof.mode !== 'recovered_original_blob'
      || proof.source !== 'existing_visible_local_blob' || proof.sha256 !== video?.sha256
      || proof.size !== video?.size || !isDigest(proof.sha256)
      || !Number.isSafeInteger(proof.size) || proof.size <= 0
      || !Number.isFinite(proof.duration) || proof.duration <= 0
      || !Number.isFinite(proof.width) || proof.width <= 0
      || !Number.isFinite(proof.height) || proof.height <= 0
      || (requireReadySourceMode && proof.recoveryMode !== READY_SOURCE_PROOF_MODE)
      || proof.guardArmed !== true || proof.blockedAttempts !== 0
      || proof.serverContentIdKnown !== false
      || proof.name !== undefined || proof.vid !== undefined || proof.uri !== undefined) {
    fail('CHANNELS_READY_SOURCE_BLOB_PROOF_INVALID');
  }
  return proof;
}

function assertNoFinalMarker(statePath) {
  const names = fs.readdirSync(path.dirname(statePath));
  if (names.some(name => name.startsWith('school-final-') || name.startsWith('final-submit'))) {
    fail('CHANNELS_READY_SOURCE_FINAL_MARKER_PRESENT');
  }
}

function assertCoverReceipt(slotName, receipt, asset, lastObservation) {
  const ratio = slotName === 'vertical' ? 3 / 4 : 4 / 3;
  const ratioName = slotName === 'vertical' ? '3:4' : '4:3';
  const ratioMatches = image => Number.isFinite(image?.width) && image.width > 0
    && Number.isFinite(image?.height) && image.height > 0
    && Math.abs(image.width / image.height - ratio) < 0.01;
  const selected = receipt?.selectedFile;
  if (!asset || receipt?.assetPath !== asset.path || receipt?.ratio !== ratioName
      || selected?.name !== path.basename(asset.path) || selected?.size !== asset.size
      || selected?.sha256 !== asset.sha256 || selected?.byteLength !== asset.size
      || selected?.capturedBy !== 'native_input_capture' || selected?.eventCount !== 1
      || receipt.previewProof?.editorMatched !== true || receipt.previewProof.image?.loaded !== true
      || !ratioMatches(receipt.previewProof.image) || !ratioMatches(receipt.acceptedImage)
      || typeof receipt.afterUrl !== 'string' || !receipt.afterUrl
      || receipt.acceptedImage.url !== receipt.afterUrl
      || !Array.isArray(receipt.beforeUrls) || receipt.beforeUrls.includes(receipt.afterUrl)) {
    fail('CHANNELS_READY_SOURCE_COVER_RECEIPT_INVALID');
  }
  const images = lastObservation?.gates?.cover?.evidence?.imagesBySlot?.[slotName];
  if (!Array.isArray(images) || !images.some(image => image?.url === receipt.afterUrl && ratioMatches(image))) {
    fail('CHANNELS_READY_SOURCE_COVER_ACCEPTANCE_NOT_OBSERVED');
  }
}

function assertNoForeignSourceMutation(observation, phase) {
  const actions = observation?.actions || {};
  const receipts = observation?.receipts || {};
  if (phase === 'inspect' || phase === 'verify') {
    if (Object.keys(actions).length || Object.keys(receipts).length) fail('CHANNELS_READY_SOURCE_HISTORY_ACTION_UNEXPECTED');
    return;
  }
  if (phase === 'upload_start') {
    if (Object.keys(actions).sort().join() !== 'receiptCheckpoint,upload'
        || Object.keys(receipts).join() !== 'uploadStart' || actions.upload?.mode !== 'injected'
        || actions.upload?.stage !== 'editable_uploading') fail('CHANNELS_READY_SOURCE_INJECTION_HISTORY_INVALID');
    return;
  }
  if (phase === 'prefill') {
    if (!actions.description?.ok || !actions.shortTitle?.ok || Object.keys(receipts).length
        || actions.upload || actions.covers) fail('CHANNELS_READY_SOURCE_PREFILL_HISTORY_INVALID');
    return;
  }
  if (phase === 'mutate') {
    const covers = Array.isArray(actions.covers) ? actions.covers : [];
    if (!actions.original?.ok || actions.original.skipped !== true || covers.length !== 2
        || covers.some(item => item?.ok !== true) || Object.keys(receipts).join() !== 'cover'
        || actions.upload) fail('CHANNELS_READY_SOURCE_MUTATION_HISTORY_INVALID');
  }
}

export function assertChannelsReadyInjectedState(state, binding, statePath, stateBase = DEFAULT_STATE_BASE) {
  regularFile(statePath);
  const item = state?.platforms?.wechat_channels;
  const stateDir = path.dirname(statePath);
  if (binding?.platform !== 'wechat_channels' || !binding.targetId || !binding.egoProfileId
      || state.schemaVersion !== 4 || state.status !== 'ready' || item?.status !== 'ready'
      || item.videoReceipt !== null || item.taskSpaceId !== binding.taskSpaceId
      || item.taskSpaceName !== binding.taskSpaceName || item.receiptTaskSpaceId !== binding.taskSpaceId
      || !isDigest(state.fingerprint) || state.jobId !== state.fingerprint.slice(0, 16)
      || path.resolve(statePath) !== path.join(schoolAccountStateRoot(stateBase, binding), state.jobId, 'state.json')
      || state.revisions?.length !== 1 || state.revisions[0]?.operation !== 'auto'
      || state.revisions[0]?.fingerprint !== state.fingerprint
      || item.history?.map(entry => entry.phase).join() !== PHASES.join()
      || item.verdict?.phase !== 'verify' || item.verdict?.ready !== true
      || item.verdict?.missing?.length || item.verdict?.blocker) fail('CHANNELS_READY_SOURCE_HISTORY_SCOPE_REJECTED');
  assertNoFinalMarker(statePath);

  const videoStat = regularFile(state.video?.path);
  const videoBytes = fs.readFileSync(state.video.path);
  if (videoStat.size !== state.video.size || sha256(videoBytes) !== state.video.sha256) {
    fail('CHANNELS_READY_SOURCE_VIDEO_ASSET_CHANGED');
  }
  const assets = state.assets || [];
  if (assets.length !== 2 || new Set(assets.map(asset => asset.path)).size !== 2) {
    fail('CHANNELS_READY_SOURCE_COVER_ASSET_SET_INVALID');
  }
  for (const asset of assets) {
    const stat = regularFile(asset.path);
    if (stat.size !== asset.size || sha256(fs.readFileSync(asset.path)) !== asset.sha256) {
      fail('CHANNELS_READY_SOURCE_COVER_ASSET_CHANGED');
    }
  }

  const receipt = item.receipts || {};
  const uploadStart = receipt.uploadStart;
  const slots = receipt.cover?.slots || {};
  if (Object.keys(receipt).sort().join() !== 'cover,uploadStart'
      || uploadStart?.fingerprint !== state.fingerprint || uploadStart.taskSpaceId !== binding.taskSpaceId
      || uploadStart.mode !== 'injected' || Object.keys(slots).sort().join() !== 'horizontal,vertical') {
    fail('CHANNELS_READY_SOURCE_RECEIPTS_INVALID');
  }

  const evidenceHashes = [];
  const observations = [];
  let injectedCount = 0;
  let coverActionReceipts = null;
  for (const [index, entry] of item.history.entries()) {
    const evidencePath = safeEvidencePath(statePath, entry);
    const { raw, value } = readJson(evidencePath);
    const observation = value.observation;
    if (observation?.platform !== 'wechat_channels' || observation.phase !== entry.phase
        || Number(observation.taskSpaceId) !== binding.taskSpaceId
        || observation.finalPublishClicked !== false
        || JSON.stringify(value.verdict?.blocker ?? null) !== JSON.stringify(entry.blocker ?? null)) {
      fail('CHANNELS_READY_SOURCE_HISTORY_EVIDENCE_MISMATCH');
    }
    assertNoForeignSourceMutation(observation, entry.phase);
    if (observation.actions?.upload?.mode === 'injected') injectedCount += 1;
    if (index === 2 && (entry.blocker?.code !== 'UPLOAD_STALLED'
        || observation.receipts?.uploadStart?.fingerprint !== state.fingerprint
        || observation.receipts.uploadStart.taskSpaceId !== binding.taskSpaceId
        || observation.receipts.uploadStart.mode !== 'injected'
        || JSON.stringify(observation.receipts.uploadStart) !== JSON.stringify(uploadStart))) {
      fail('CHANNELS_READY_SOURCE_ORIGINAL_UPLOAD_NOT_PROVED');
    }
    if (index === 4 && entry.blocker) fail('CHANNELS_READY_SOURCE_COVER_MUTATION_NOT_COMPLETE');
    if (index === 4) {
      coverActionReceipts = observation.actions?.covers?.map(action => [action.slot || action.asset?.slot, action.receipt]);
      if (!Array.isArray(coverActionReceipts) || coverActionReceipts.length !== 2) fail('CHANNELS_READY_SOURCE_COVER_ACTIONS_MISSING');
    }
    if (index === 5) {
      assertReadyObservation(value, 'verify', binding.taskSpaceId, { requireAllGates: true });
      if (JSON.stringify(value.verdict) !== JSON.stringify(item.verdict)) fail('CHANNELS_READY_SOURCE_LAST_VERDICT_MISMATCH');
      for (const [slot, coverReceipt] of coverActionReceipts || []) {
        if (JSON.stringify(coverReceipt) !== JSON.stringify(slots[slot])) fail('CHANNELS_READY_SOURCE_COVER_ACTION_RECEIPT_MISMATCH');
      }
      for (const slot of ['vertical', 'horizontal']) {
        const asset = assets.find(candidate => candidate.path === slots[slot]?.assetPath);
        assertCoverReceipt(slot, slots[slot], asset, observation);
      }
    }
    observations.push(observation);
    evidenceHashes.push({ path: evidencePath, sha256: sha256(raw) });
  }
  if (injectedCount !== 1) fail('CHANNELS_READY_SOURCE_MULTIPLE_OR_MISSING_INJECTION');

  const checkpointPath = path.join(stateDir, 'checkpoints/wechat_channels.receipts.json');
  const checkpoint = readJson(checkpointPath);
  if (checkpoint.value.schemaVersion !== 2 || checkpoint.value.platform !== 'wechat_channels'
      || checkpoint.value.fingerprint !== state.fingerprint
      || checkpoint.value.taskSpaceId !== binding.taskSpaceId
      || JSON.stringify(checkpoint.value.receipts) !== JSON.stringify(receipt)) {
    fail('CHANNELS_READY_SOURCE_CHECKPOINT_MISMATCH');
  }
  evidenceHashes.push({ path: checkpointPath, sha256: sha256(checkpoint.raw) });
  for (const asset of assets) evidenceHashes.push({ path: asset.path, sha256: asset.sha256 });
  evidenceHashes.push({ path: state.video.path, sha256: state.video.sha256 });
  return evidenceHashes;
}

function projectOriginalReadyState(state, statePath, binding, stateBase) {
  const history = state.platforms.wechat_channels.history.slice(0, PHASES.length);
  const last = readJson(history.at(-1).evidencePath).value;
  const projected = structuredClone(state);
  projected.status = 'ready';
  projected.platforms.wechat_channels.status = 'ready';
  projected.platforms.wechat_channels.videoReceipt = null;
  projected.platforms.wechat_channels.history = history;
  projected.platforms.wechat_channels.verdict = last.verdict;
  assertChannelsReadyInjectedState(projected, binding, statePath, stateBase);
  return projected;
}

function assertFalseSafetyOnlyObservation(value, entry, phase, state, taskSpaceId) {
  const observation = value?.observation;
  const blocker = value?.verdict?.blocker;
  const gateBlocker = {
    code: READY_SOURCE_FALSE_SAFETY_BLOCKER,
    message: 'Fresh source proof is not enough unless the unchanged native draft is fully READY',
    retryable: false,
    requiresUser: false,
    evidence: { missing: ['safety'] },
  };
  const missing = requiredGates('wechat_channels').filter(name => observation?.gates?.[name]?.ok !== true);
  if (observation?.platform !== 'wechat_channels' || observation.phase !== phase
      || Number(observation.taskSpaceId) !== Number(taskSpaceId) || observation.finalPublishClicked !== false
      || value.verdict?.phase !== phase || value.verdict.ready !== false
      || JSON.stringify(value.verdict.missing) !== JSON.stringify([])
      || JSON.stringify(blocker) !== JSON.stringify(gateBlocker)
      || JSON.stringify(entry.blocker) !== JSON.stringify(gateBlocker)
      || JSON.stringify(observation.blocker) !== JSON.stringify(gateBlocker)
      || JSON.stringify(missing) !== JSON.stringify([])
      || !assertCleanSafety(observation.gates?.safety)) {
    fail('CHANNELS_READY_SOURCE_FALSE_SAFETY_BLOCK_NOT_EXACT');
  }
  assertNativeTopicsEvidence(observation.gates);
  const description = observation.gates.description?.evidence || {};
  const shortTitle = observation.gates.shortTitle?.evidence || {};
  if (compact(description.expected) !== compact(description.actual)
      || compact(shortTitle.expected) !== compact(shortTitle.actual)) {
    fail('CHANNELS_READY_SOURCE_FALSE_SAFETY_FIELDS_CHANGED');
  }
  const actions = observation.actions || {};
  const upload = actions.upload;
  if (Object.keys(actions).join() !== 'upload' || Object.keys(observation.receipts || {}).length
      || upload?.mode !== 'recovered_original_blob' || upload.reuploaded !== false) {
    fail('CHANNELS_READY_SOURCE_FALSE_SAFETY_MUTATION_DETECTED');
  }
  const proof = assertSourceProof(upload.proof, state.video, { requireReadySourceMode: true });
  if (!Number.isSafeInteger(proof.videoElementCount) || proof.videoElementCount < 1
      || !Number.isSafeInteger(proof.blobVideoElementCount) || proof.blobVideoElementCount < 1
      || proof.blobVideoElementCount > proof.videoElementCount || proof.uniqueBlobSourceCount !== 1
      || proof.visiblePrimaryId !== 'fullScreenVideo') {
    fail('CHANNELS_READY_SOURCE_FALSE_SAFETY_DUPLICATE_VIDEO_PROOF_INVALID');
  }
  return proof;
}

function assertSameSourceProof(left, right, code = 'CHANNELS_READY_SOURCE_FRESH_BLOB_INCONSISTENT') {
  const fields = ['sha256', 'size', 'duration', 'width', 'height', 'source', 'guardArmed',
    'blockedAttempts', 'serverContentIdKnown', 'videoElementCount', 'blobVideoElementCount',
    'uniqueBlobSourceCount', 'visiblePrimaryId', 'recoveryMode'];
  if (fields.some(field => left?.[field] !== right?.[field])) fail(code);
}

function assertReadySafetyRetryObservation(value, entry, phase, state, taskSpaceId) {
  const observation = assertReadyObservation(value, phase, taskSpaceId, { requireAllGates: true });
  if (entry.blocker || Object.keys(observation.actions || {}).join() !== 'upload'
      || Object.keys(observation.receipts || {}).length
      || observation.actions.upload?.mode !== 'recovered_original_blob'
      || observation.actions.upload.reuploaded !== false) {
    fail('CHANNELS_READY_SOURCE_RETRY_FRESH_MUTATION_DETECTED');
  }
  const proof = assertSourceProof(observation.actions.upload.proof, state.video, { requireReadySourceMode: true });
  if (!Number.isSafeInteger(proof.videoElementCount) || proof.videoElementCount < 1
      || !Number.isSafeInteger(proof.blobVideoElementCount) || proof.blobVideoElementCount < 1
      || proof.blobVideoElementCount > proof.videoElementCount || proof.uniqueBlobSourceCount !== 1
      || proof.visiblePrimaryId !== 'fullScreenVideo') fail('CHANNELS_READY_SOURCE_RETRY_DUPLICATE_VIDEO_PROOF_INVALID');
  return proof;
}

function sourceProofSafetyRetryPaths(statePath) {
  const dir = path.dirname(statePath);
  const oldClaimPath = path.join(dir, 'channels-ready-source-proof-resume.claim');
  const oldResultPath = `${oldClaimPath}.result.json`;
  const claimPath = path.join(dir, 'channels-ready-source-proof-safety-retry.claim');
  return { oldClaimPath, oldResultPath, claimPath, resultPath: `${claimPath}.result.json` };
}

function assertOldSourceProofFalseBlockSidecar(state, statePath, baselineHashes) {
  const paths = sourceProofSafetyRetryPaths(statePath);
  const claimRecord = readJson(paths.oldClaimPath, 'CHANNELS_READY_SOURCE_OLD_CLAIM_INVALID');
  const resultRecord = readJson(paths.oldResultPath, 'CHANNELS_READY_SOURCE_OLD_RESULT_INVALID');
  const claim = claimRecord.value;
  const result = resultRecord.value;
  const stateSha256 = sha256(fs.readFileSync(statePath));
  if (claim.mode !== READY_SOURCE_PROOF_MODE || claim.jobId !== state.jobId
      || claim.fingerprint !== state.fingerprint || claim.statePath !== path.resolve(statePath)
      || !isDigest(claim.stateSha) || !claim.claimToken
      || JSON.stringify(claim.evidenceHashes) !== JSON.stringify(baselineHashes)
      || result.ok !== false || result.status !== 'READY_SOURCE_PROOF_BLOCKED'
      || result.mode !== READY_SOURCE_PROOF_MODE || result.jobId !== state.jobId
      || result.fingerprint !== state.fingerprint || result.statePath !== path.resolve(statePath)
      || result.initialStateSha !== claim.stateSha || result.finalStateSha !== stateSha256
      || result.sourceClaimPath !== paths.oldClaimPath || result.claimToken !== claim.claimToken
      || JSON.stringify(result.initialEvidenceHashes) !== JSON.stringify(claim.evidenceHashes)
      || JSON.stringify(result.proofEvidenceHashes) !== JSON.stringify([])
      || result.sourceSha256 !== null || result.sourceSize !== null
      || result.error !== 'CHANNELS_READY_SOURCE_FRESH_HISTORY_REJECTED'
      || result.publicationPerformed !== false || result.reuploaded !== false) {
    fail('CHANNELS_READY_SOURCE_OLD_FALSE_BLOCK_LINEAGE_REJECTED');
  }
  return {
    ...paths,
    oldClaim: claim,
    oldResult: result,
    oldClaimSha256: sha256(claimRecord.raw),
    oldResultSha256: sha256(resultRecord.raw),
    initialBlockedStateSha256: stateSha256,
  };
}

export function assertChannelsReadySourceProofSafetyBlockedState(state, binding, statePath, stateBase = DEFAULT_STATE_BASE) {
  regularFile(statePath);
  const item = state?.platforms?.wechat_channels;
  const expectedPhases = [...PHASES, 'inspect', 'verify'];
  if (state.schemaVersion !== 4 || state.status !== 'blocked' || item?.status !== 'blocked'
      || item.taskSpaceId !== binding.taskSpaceId || item.taskSpaceName !== binding.taskSpaceName
      || item.videoReceipt !== null || item.history?.map(entry => entry.phase).join() !== expectedPhases.join()
      || item.verdict?.phase !== 'verify' || item.verdict?.ready !== false
      || JSON.stringify(item.verdict?.missing) !== JSON.stringify([])
      || item.verdict?.blocker?.code !== READY_SOURCE_FALSE_SAFETY_BLOCKER
      || JSON.stringify(item.verdict?.blocker?.evidence?.missing) !== JSON.stringify(['safety'])
      || JSON.stringify(item.verdict?.blocker) !== JSON.stringify(item.history.at(-1)?.blocker)) {
    fail('CHANNELS_READY_SOURCE_SAFETY_BLOCKED_HISTORY_REJECTED');
  }
  assertNoFinalMarker(statePath);
  const baselineHashes = assertChannelsReadyInjectedState(
    projectOriginalReadyState(state, statePath, binding, stateBase), binding, statePath, stateBase,
  );
  const falseBlockHashes = [];
  const proofs = [];
  for (const [offset, entry] of item.history.slice(PHASES.length).entries()) {
    const phase = offset === 0 ? 'inspect' : 'verify';
    const evidencePath = safeEvidencePath(statePath, entry);
    const { raw, value } = readJson(evidencePath);
    proofs.push(assertFalseSafetyOnlyObservation(value, entry, phase, state, binding.taskSpaceId));
    falseBlockHashes.push({ path: evidencePath, sha256: sha256(raw) });
  }
  if (proofs.length !== 2) fail('CHANNELS_READY_SOURCE_FALSE_SAFETY_PROOF_COUNT_INVALID');
  assertSameSourceProof(proofs[0], proofs[1], 'CHANNELS_READY_SOURCE_FALSE_SAFETY_PROOFS_DIFFER');
  const originalVerify = readJson(item.history[PHASES.length - 1].evidencePath).value.observation;
  const currentVerify = readJson(item.history.at(-1).evidencePath).value.observation;
  for (const gateName of ['description', 'shortTitle']) {
    if (compact(originalVerify.gates?.[gateName]?.evidence?.actual)
        !== compact(currentVerify.gates?.[gateName]?.evidence?.actual)) {
      fail('CHANNELS_READY_SOURCE_FALSE_SAFETY_NATIVE_FIELDS_CHANGED');
    }
  }
  const sidecar = assertOldSourceProofFalseBlockSidecar(state, statePath, baselineHashes);
  return { baselineHashes, falseBlockHashes, blockedProof: proofs[0], stateSha256: sidecar.initialBlockedStateSha256,
    oldClaimPath: sidecar.oldClaimPath, oldResultPath: sidecar.oldResultPath,
    oldClaimSha256: sidecar.oldClaimSha256, oldResultSha256: sidecar.oldResultSha256,
    oldClaimToken: sidecar.oldClaim.claimToken, oldClaim: sidecar.oldClaim };
}

export async function prepareChannelsReadySourceProofSafetyRetryContext(file, statePath, matrix, options = {}) {
  const binding = resolveSchoolAccountBinding(JSON.parse(fs.readFileSync(file, 'utf8')).schoolAccount, matrix);
  const stateRaw = fs.readFileSync(statePath);
  const state = JSON.parse(stateRaw.toString('utf8'));
  const stateBase = options.stateBase || DEFAULT_STATE_BASE;
  const admission = assertChannelsReadySourceProofSafetyBlockedState(state, binding, statePath, stateBase);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'channels-ready-safety-retry-'));
  fs.chmodSync(directory, 0o700);
  const packagePath = path.join(directory, 'package.json');
  try {
    fs.writeFileSync(packagePath, JSON.stringify({ ...readPackage(file), schoolAccount: binding }), { mode: 0o600 });
    const pkg = readPackage(packagePath);
    const identity = await buildIdentity(pkg);
    if (identity.fingerprint !== state.fingerprint || JSON.stringify(identity.video) !== JSON.stringify(state.video)
        || JSON.stringify(identity.assets) !== JSON.stringify(state.assets)) fail('CHANNELS_READY_SOURCE_PACKAGE_OR_ASSET_CHANGED');
    const retryPaths = sourceProofSafetyRetryPaths(statePath);
    if (fs.existsSync(retryPaths.claimPath) || fs.existsSync(retryPaths.resultPath)) {
      fail('CHANNELS_READY_SOURCE_SAFETY_RETRY_ALREADY_CLAIMED');
    }
    const evidenceHashes = [...admission.baselineHashes, ...admission.falseBlockHashes];
    const contract = {
      version: 1, recoveryMode: READY_SOURCE_PROOF_SAFETY_RETRY_MODE,
      retryKind: READY_SOURCE_PROOF_SAFETY_RETRY_KIND, neverInject: true,
      jobId: state.jobId, fingerprint: state.fingerprint, binding, video: state.video,
      statePath: path.resolve(statePath), stateBase, stateSha: sha256(stateRaw), evidenceHashes,
      sourceClaimPath: retryPaths.claimPath, oldSourceClaimPath: admission.oldClaimPath,
      oldSourceResultPath: admission.oldResultPath, oldSourceClaimSha256: admission.oldClaimSha256,
      oldSourceResultSha256: admission.oldResultSha256, oldSourceClaimToken: admission.oldClaimToken,
      originalBlockedStateSha256: admission.stateSha256,
    };
    return { directory, packagePath, binding, state, stateRoot: path.dirname(path.dirname(statePath)),
      contract, identity, stateBase, admission, retryPaths };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function assertChannelsReadySourceProofSafetyRetryLockedContract(contract, pkg, identity, args) {
  if (contract?.version !== 1 || contract.recoveryMode !== READY_SOURCE_PROOF_SAFETY_RETRY_MODE
      || contract.retryKind !== READY_SOURCE_PROOF_SAFETY_RETRY_KIND || contract.neverInject !== true
      || args.operation !== 'resume' || args.inspectOnly || args.platforms?.join() !== 'wechat_channels'
      || args.jobId !== contract.jobId || JSON.stringify(pkg.schoolAccount) !== JSON.stringify(contract.binding)
      || identity.fingerprint !== contract.fingerprint || JSON.stringify(identity.video) !== JSON.stringify(contract.video)
      || path.join(args.stateRoot, contract.jobId, 'state.json') !== contract.statePath
      || sha256(fs.readFileSync(contract.statePath)) !== contract.stateSha) {
    fail('CHANNELS_READY_SOURCE_SAFETY_RETRY_LOCKED_CONTRACT_REJECTED');
  }
  const state = JSON.parse(fs.readFileSync(contract.statePath, 'utf8'));
  const admission = assertChannelsReadySourceProofSafetyBlockedState(state, contract.binding, contract.statePath, contract.stateBase);
  const hashes = [...admission.baselineHashes, ...admission.falseBlockHashes];
  if (JSON.stringify(hashes) !== JSON.stringify(contract.evidenceHashes)
      || admission.oldClaimPath !== contract.oldSourceClaimPath || admission.oldResultPath !== contract.oldSourceResultPath
      || admission.oldClaimSha256 !== contract.oldSourceClaimSha256 || admission.oldResultSha256 !== contract.oldSourceResultSha256
      || admission.oldClaimToken !== contract.oldSourceClaimToken
      || admission.stateSha256 !== contract.originalBlockedStateSha256
      || path.resolve(contract.sourceClaimPath) !== sourceProofSafetyRetryPaths(contract.statePath).claimPath) {
    fail('CHANNELS_READY_SOURCE_SAFETY_RETRY_LINEAGE_CHANGED');
  }
  const marker = readJson(contract.sourceClaimPath, 'CHANNELS_READY_SOURCE_SAFETY_RETRY_CLAIM_REQUIRED');
  const activeClaim = marker.value;
  if (!contract.claimToken || !isDigest(contract.sourceClaimSha256)
      || sha256(marker.raw) !== contract.sourceClaimSha256
      || activeClaim.mode !== READY_SOURCE_PROOF_MODE
      || activeClaim.retryMode !== READY_SOURCE_PROOF_SAFETY_RETRY_KIND
      || activeClaim.jobId !== contract.jobId || activeClaim.fingerprint !== contract.fingerprint
      || activeClaim.statePath !== contract.statePath || activeClaim.stateSha !== contract.stateSha
      || activeClaim.claimToken !== contract.claimToken
      || JSON.stringify(activeClaim.evidenceHashes) !== JSON.stringify(contract.evidenceHashes)
      || activeClaim.oldSourceClaimSha256 !== contract.oldSourceClaimSha256
      || activeClaim.oldSourceResultSha256 !== contract.oldSourceResultSha256
      || activeClaim.oldSourceClaimToken !== contract.oldSourceClaimToken
      || activeClaim.originalBlockedStateSha256 !== contract.originalBlockedStateSha256
      || fs.existsSync(`${contract.sourceClaimPath}.result.json`)) {
    fail('CHANNELS_READY_SOURCE_SAFETY_RETRY_CLAIM_LINEAGE_CHANGED');
  }
  return true;
}

export function assertChannelsReadySourceProofSafetyRetryState(state, binding, statePath, stateBase = DEFAULT_STATE_BASE) {
  regularFile(statePath);
  const item = state?.platforms?.wechat_channels;
  const phases = [...PHASES, 'inspect', 'verify', 'inspect', 'verify'];
  if (state.status !== 'ready' || item?.status !== 'ready' || item.taskSpaceId !== binding.taskSpaceId
      || item.taskSpaceName !== binding.taskSpaceName || item.history?.map(entry => entry.phase).join() !== phases.join()
      || item.verdict?.phase !== 'verify' || item.verdict?.ready !== true || item.verdict?.missing?.length
      || item.verdict?.blocker) fail('CHANNELS_READY_SOURCE_SAFETY_RETRY_FINAL_HISTORY_REJECTED');
  assertNoFinalMarker(statePath);
  const baselineHashes = assertChannelsReadyInjectedState(
    projectOriginalReadyState(state, statePath, binding, stateBase), binding, statePath, stateBase,
  );
  const falseBlockHashes = [];
  const blockedProofs = [];
  for (const [offset, entry] of item.history.slice(PHASES.length, PHASES.length + 2).entries()) {
    const phase = offset === 0 ? 'inspect' : 'verify';
    const evidencePath = safeEvidencePath(statePath, entry);
    const { raw, value } = readJson(evidencePath);
    blockedProofs.push(assertFalseSafetyOnlyObservation(value, entry, phase, state, binding.taskSpaceId));
    falseBlockHashes.push({ path: evidencePath, sha256: sha256(raw) });
  }
  if (blockedProofs.length !== 2) fail('CHANNELS_READY_SOURCE_SAFETY_RETRY_ORIGINAL_BLOCK_COUNT_INVALID');
  assertSameSourceProof(blockedProofs[0], blockedProofs[1], 'CHANNELS_READY_SOURCE_SAFETY_RETRY_ORIGINAL_PROOFS_DIFFER');
  const freshHashes = [];
  const freshProofs = [];
  for (const [offset, entry] of item.history.slice(PHASES.length + 2).entries()) {
    const phase = offset === 0 ? 'inspect' : 'verify';
    const evidencePath = safeEvidencePath(statePath, entry);
    const { raw, value } = readJson(evidencePath);
    freshProofs.push(assertReadySafetyRetryObservation(value, entry, phase, state, binding.taskSpaceId));
    freshHashes.push({ path: evidencePath, sha256: sha256(raw) });
  }
  if (freshProofs.length !== 2) fail('CHANNELS_READY_SOURCE_SAFETY_RETRY_FRESH_PROOF_COUNT_INVALID');
  assertSameSourceProof(freshProofs[0], freshProofs[1], 'CHANNELS_READY_SOURCE_SAFETY_RETRY_FRESH_PROOFS_DIFFER');
  assertSameSourceProof(blockedProofs[0], freshProofs[0], 'CHANNELS_READY_SOURCE_SAFETY_RETRY_SOURCE_CHANGED');
  const videoReceipt = item.videoReceipt;
  if (videoReceipt?.fingerprint !== state.fingerprint || videoReceipt.taskSpaceId !== binding.taskSpaceId
      || videoReceipt.mode !== 'recovered_original_blob'
      || JSON.stringify(videoReceipt.nativeMedia) !== JSON.stringify(freshProofs[0])) {
    fail('CHANNELS_READY_SOURCE_SAFETY_RETRY_VIDEO_RECEIPT_INVALID');
  }
  if (JSON.stringify(item.verdict) !== JSON.stringify(readJson(item.history.at(-1).evidencePath).value.verdict)) {
    fail('CHANNELS_READY_SOURCE_SAFETY_RETRY_FINAL_VERDICT_MISMATCH');
  }
  const checkpoint = readJson(path.join(path.dirname(statePath), 'checkpoints/wechat_channels.receipts.json'));
  const receipt = item.receipts || {};
  if (JSON.stringify(checkpoint.value.receipts) !== JSON.stringify(receipt)) fail('CHANNELS_READY_SOURCE_SAFETY_RETRY_CHECKPOINT_CHANGED');
  return { baselineHashes, falseBlockHashes, freshHashes, sourceProof: freshProofs[0],
    stateSha256: sha256(fs.readFileSync(statePath)) };
}

export async function runChannelsReadySourceProofSafetyRetry(file, statePath, matrix, execute, options = {}) {
  let context = null;
  let claimPath = null;
  let claimToken = null;
  try {
    context = await prepareChannelsReadySourceProofSafetyRetryContext(file, statePath, matrix, options);
    const preflight = await (options.runEgoPreflight || runEgoPreflight)(context.binding);
    if (!preflight.ok) return { ...preflight, status: 'BLOCKED', publicationPerformed: false, reuploaded: false };
    claimPath = context.contract.sourceClaimPath;
    claimToken = crypto.randomBytes(16).toString('hex');
    const claim = {
      schemaVersion: 1, mode: READY_SOURCE_PROOF_MODE, retryMode: READY_SOURCE_PROOF_SAFETY_RETRY_KIND,
      jobId: context.state.jobId, fingerprint: context.state.fingerprint,
      statePath: path.resolve(statePath), stateSha: context.contract.stateSha,
      evidenceHashes: context.contract.evidenceHashes, oldSourceClaimPath: context.contract.oldSourceClaimPath,
      oldSourceResultPath: context.contract.oldSourceResultPath,
      oldSourceClaimSha256: context.contract.oldSourceClaimSha256,
      oldSourceResultSha256: context.contract.oldSourceResultSha256,
      oldSourceClaimToken: context.contract.oldSourceClaimToken,
      originalBlockedStateSha256: context.contract.originalBlockedStateSha256,
      claimToken, at: new Date().toISOString(),
    };
    writeJsonExclusive(claimPath, claim);
    context.contract.claimToken = claimToken;
    context.contract.sourceClaimSha256 = sha256(fs.readFileSync(claimPath));
    if (sha256(fs.readFileSync(statePath)) !== context.contract.stateSha) fail('CHANNELS_READY_SOURCE_SAFETY_RETRY_STATE_CHANGED_AFTER_CLAIM');
    const args = [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../v2/publisher.mjs'),
      '--package', context.packagePath, '--platform', 'wechat_channels', '--job-id', context.state.jobId,
      '--task-suffix', context.state.taskSuffix, '--operation', 'resume', '--space-name', context.binding.taskSpaceName,
      '--reuse-space', '--keep-space', '--no-cleanup-stale-spaces', '--state-root', context.stateRoot,
      '--confirm-original-rights'];
    const runner = execute || options.execute;
    const result = await runner(process.execPath, args, {
      timeoutMs: 300000,
      env: { ...process.env, VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY: JSON.stringify(context.contract) },
    });
    let summary;
    try { summary = JSON.parse(result.stdout.trim()); } catch { summary = null; }
    const after = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    let proofResult = null;
    let validationError = null;
    try { proofResult = assertChannelsReadySourceProofSafetyRetryState(after, context.binding, statePath, context.stateBase); }
    catch (error) { validationError = String(error.message || error); }
    const ok = result.code === 0 && summary?.ready === true && summary.jobId === context.state.jobId
      && !validationError && after.fingerprint === context.state.fingerprint;
    const record = {
      schemaVersion: 1, ok, status: ok ? 'READY_SOURCE_PROOF_COMPLETE' : 'READY_SOURCE_PROOF_SAFETY_RETRY_BLOCKED',
      mode: READY_SOURCE_PROOF_MODE, retryMode: READY_SOURCE_PROOF_SAFETY_RETRY_KIND,
      jobId: context.state.jobId, fingerprint: context.state.fingerprint, statePath: path.resolve(statePath),
      initialStateSha: context.contract.stateSha, finalStateSha: sha256(fs.readFileSync(statePath)),
      initialEvidenceHashes: context.contract.evidenceHashes, proofEvidenceHashes: proofResult?.freshHashes || [],
      blockedEvidenceHashes: proofResult?.falseBlockHashes || context.admission.falseBlockHashes,
      sourceSha256: proofResult?.sourceProof?.sha256 || null, sourceSize: proofResult?.sourceProof?.size || null,
      sourceClaimPath: claimPath, claimToken, oldSourceClaimPath: context.contract.oldSourceClaimPath,
      oldSourceResultPath: context.contract.oldSourceResultPath,
      oldSourceClaimSha256: context.contract.oldSourceClaimSha256,
      oldSourceResultSha256: context.contract.oldSourceResultSha256,
      oldSourceClaimToken: context.contract.oldSourceClaimToken,
      originalBlockedStateSha256: context.contract.originalBlockedStateSha256,
      publicationPerformed: false, reuploaded: false, error: validationError,
      summary: summary ? { ready: summary.ready === true, jobId: summary.jobId } : null,
      at: new Date().toISOString(),
    };
    writeJsonExclusive(claimPath + '.result.json', record);
    return { ok, status: record.status, jobId: context.state.jobId, preparedStatePath: statePath,
      publicationPerformed: false, reuploaded: false, sourceSha256: record.sourceSha256,
      sourceSize: record.sourceSize, resultPath: claimPath + '.result.json', error: validationError };
  } catch (error) {
    return { ok: false, status: 'BLOCKED', code: String(error.message || error), publicationPerformed: false,
      reuploaded: false, ...(claimPath ? { claimPath, claimRetained: fs.existsSync(claimPath) } : {}) };
  } finally {
    if (context) fs.rmSync(context.directory, { recursive: true, force: true });
  }
}

export function assertChannelsReadySourceProofState(state, binding, statePath, stateBase = DEFAULT_STATE_BASE, { requireReceipt = true } = {}) {
  regularFile(statePath);
  const item = state?.platforms?.wechat_channels;
  if (state.schemaVersion !== 4 || state.status !== 'ready' || item?.status !== 'ready'
      || item.taskSpaceId !== binding.taskSpaceId || item.taskSpaceName !== binding.taskSpaceName
      || item.history?.map(entry => entry.phase).join() !== [...PHASES, 'inspect', 'verify'].join()
      || item.verdict?.phase !== 'verify' || item.verdict?.ready !== true
      || item.verdict?.missing?.length || item.verdict?.blocker) fail('CHANNELS_READY_SOURCE_FRESH_HISTORY_REJECTED');
  assertNoFinalMarker(statePath);
  const baselineHashes = assertChannelsReadyInjectedState(
    projectOriginalReadyState(state, statePath, binding, stateBase), binding, statePath, stateBase,
  );
  const fresh = [];
  const freshHashes = [];
  for (const entry of item.history.slice(PHASES.length)) {
    const evidencePath = safeEvidencePath(statePath, entry);
    const { raw, value } = readJson(evidencePath);
    const observation = assertReadyObservation(value, entry.phase, binding.taskSpaceId, { requireAllGates: true });
    if (entry.blocker || value.verdict?.blocker) fail('CHANNELS_READY_SOURCE_FRESH_BLOCKER_PRESENT');
    if (Object.keys(observation.actions || {}).sort().join() !== 'upload'
        || Object.keys(observation.receipts || {}).length
        || observation.actions.upload.mode !== 'recovered_original_blob'
        || observation.actions.upload.reuploaded !== false) fail('CHANNELS_READY_SOURCE_FRESH_MUTATION_DETECTED');
    assertSourceProof(observation.actions.upload.proof, state.video, { requireReadySourceMode: true });
    fresh.push(observation.actions.upload.proof);
    freshHashes.push({ path: evidencePath, sha256: sha256(raw) });
  }
  if (fresh.length !== 2 || fresh[0].sha256 !== fresh[1].sha256 || fresh[0].size !== fresh[1].size) {
    fail('CHANNELS_READY_SOURCE_FRESH_BLOB_INCONSISTENT');
  }
  if (fresh[0].width !== fresh[1].width || fresh[0].height !== fresh[1].height
      || Math.abs(fresh[0].duration - fresh[1].duration) > 0.05) {
    fail('CHANNELS_READY_SOURCE_FRESH_MEDIA_DIMENSIONS_INCONSISTENT');
  }
  const originalReceipt = item.receipts || {};
  const checkpoint = readJson(path.join(path.dirname(statePath), 'checkpoints/wechat_channels.receipts.json'));
  if (JSON.stringify(checkpoint.value.receipts) !== JSON.stringify(originalReceipt)) fail('CHANNELS_READY_SOURCE_FRESH_COVER_CHECKPOINT_CHANGED');
  const videoReceipt = item.videoReceipt;
  if (requireReceipt && (videoReceipt?.fingerprint !== state.fingerprint
      || videoReceipt.taskSpaceId !== binding.taskSpaceId || videoReceipt.mode !== 'recovered_original_blob'
      || videoReceipt.nativeMedia?.sha256 !== state.video.sha256
      || videoReceipt.nativeMedia?.size !== state.video.size
      || videoReceipt.nativeMedia?.source !== 'existing_visible_local_blob'
      || videoReceipt.nativeMedia?.recoveryMode !== READY_SOURCE_PROOF_MODE
      || videoReceipt.nativeMedia?.guardArmed !== true
      || videoReceipt.nativeMedia?.blockedAttempts !== 0
      || videoReceipt.nativeMedia?.serverContentIdKnown !== false)) fail('CHANNELS_READY_SOURCE_VIDEO_RECEIPT_MISSING');
  if (JSON.stringify(item.verdict) !== JSON.stringify(readJson(item.history.at(-1).evidencePath).value.verdict)) {
    fail('CHANNELS_READY_SOURCE_FRESH_VERDICT_MISMATCH');
  }
  return { baselineHashes, freshHashes, sourceProof: fresh[0], stateSha256: sha256(fs.readFileSync(statePath)) };
}

export async function prepareChannelsReadySourceProofContext(file, statePath, matrix, options = {}) {
  const sourcePkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const binding = resolveSchoolAccountBinding(sourcePkg.schoolAccount, matrix);
  const stateRaw = fs.readFileSync(statePath);
  const state = JSON.parse(stateRaw);
  const stateBase = options.stateBase || DEFAULT_STATE_BASE;
  const evidenceHashes = assertChannelsReadyInjectedState(state, binding, statePath, stateBase);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'channels-ready-source-proof-'));
  fs.chmodSync(directory, 0o700);
  const packagePath = path.join(directory, 'package.json');
  try {
    fs.writeFileSync(packagePath, JSON.stringify({ ...readPackage(file), schoolAccount: binding }), { mode: 0o600 });
    const pkg = readPackage(packagePath);
    const identity = await buildIdentity(pkg);
    if (identity.fingerprint !== state.fingerprint
        || JSON.stringify(identity.video) !== JSON.stringify(state.video)
        || JSON.stringify(identity.assets) !== JSON.stringify(state.assets)) fail('CHANNELS_READY_SOURCE_PACKAGE_OR_ASSET_CHANGED');
    const sourceClaimPath = path.join(path.dirname(statePath), 'channels-ready-source-proof-resume.claim');
    if (fs.existsSync(sourceClaimPath) || fs.existsSync(sourceClaimPath + '.result.json')) fail('CHANNELS_READY_SOURCE_ALREADY_CLAIMED');
    const contract = {
      version: 1,
      recoveryMode: READY_SOURCE_PROOF_MODE,
      neverInject: true,
      jobId: state.jobId,
      fingerprint: state.fingerprint,
      binding,
      video: state.video,
      statePath: path.resolve(statePath),
      stateBase,
      stateSha: sha256(stateRaw),
      evidenceHashes,
      sourceClaimPath,
    };
    return { directory, packagePath, binding, state, stateRoot: path.dirname(path.dirname(statePath)), contract, identity, stateBase };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function assertChannelsReadySourceProofLockedContract(contract, pkg, identity, args) {
  if (contract?.version !== 1 || contract.recoveryMode !== READY_SOURCE_PROOF_MODE
      || contract.neverInject !== true || args.operation !== 'resume' || args.inspectOnly
      || args.platforms?.join() !== 'wechat_channels' || args.jobId !== contract.jobId
      || JSON.stringify(pkg.schoolAccount) !== JSON.stringify(contract.binding)
      || identity.fingerprint !== contract.fingerprint
      || JSON.stringify(identity.video) !== JSON.stringify(contract.video)
      || path.join(args.stateRoot, contract.jobId, 'state.json') !== contract.statePath
      || sha256(fs.readFileSync(contract.statePath)) !== contract.stateSha) {
    fail('CHANNELS_READY_SOURCE_LOCKED_CONTRACT_REJECTED');
  }
  const current = JSON.parse(fs.readFileSync(contract.statePath, 'utf8'));
  const currentHashes = assertChannelsReadyInjectedState(current, contract.binding, contract.statePath, contract.stateBase);
  if (JSON.stringify(currentHashes) !== JSON.stringify(contract.evidenceHashes)) fail('CHANNELS_READY_SOURCE_EVIDENCE_LOCK_CHANGED');
  const marker = path.resolve(contract.sourceClaimPath);
  if (marker !== path.join(path.dirname(contract.statePath), 'channels-ready-source-proof-resume.claim')) {
    fail('CHANNELS_READY_SOURCE_CLAIM_PATH_REJECTED');
  }
  return true;
}

function writeJsonExclusive(file, value) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

export async function runChannelsReadySourceProofResume(file, statePath, matrix, execute, options = {}) {
  let context = null;
  let claimToken = null;
  let claimPath = null;
  try {
    context = await prepareChannelsReadySourceProofContext(file, statePath, matrix, options);
    const preflight = await (options.runEgoPreflight || runEgoPreflight)(context.binding);
    if (!preflight.ok) return { ...preflight, status: 'BLOCKED', publicationPerformed: false, reuploaded: false };
    claimPath = context.contract.sourceClaimPath;
    claimToken = crypto.randomBytes(16).toString('hex');
    const claim = {
      schemaVersion: 1,
      mode: READY_SOURCE_PROOF_MODE,
      jobId: context.state.jobId,
      fingerprint: context.state.fingerprint,
      statePath: path.resolve(statePath),
      stateSha: context.contract.stateSha,
      evidenceHashes: context.contract.evidenceHashes,
      claimToken,
      at: new Date().toISOString(),
    };
    writeJsonExclusive(claimPath, claim);
    if (sha256(fs.readFileSync(statePath)) !== context.contract.stateSha) fail('CHANNELS_READY_SOURCE_STATE_CHANGED_AFTER_CLAIM');
    const args = [
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../v2/publisher.mjs'),
      '--package', context.packagePath, '--platform', 'wechat_channels', '--job-id', context.state.jobId,
      '--task-suffix', context.state.taskSuffix, '--operation', 'resume', '--space-name', context.binding.taskSpaceName,
      '--reuse-space', '--keep-space', '--no-cleanup-stale-spaces', '--state-root', context.stateRoot,
      '--confirm-original-rights',
    ];
    const runner = execute || options.execute;
    const result = await runner(process.execPath, args, {
      timeoutMs: 300000,
      env: { ...process.env, VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY: JSON.stringify(context.contract) },
    });
    let summary;
    try { summary = JSON.parse(result.stdout.trim()); } catch { summary = null; }
    const after = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    let proofResult = null;
    let validationError = null;
    try { proofResult = assertChannelsReadySourceProofState(after, context.binding, statePath, context.stateBase); }
    catch (error) { validationError = String(error.message || error); }
    const ok = result.code === 0 && summary?.ready === true && summary.jobId === context.state.jobId
      && !validationError && after.fingerprint === context.state.fingerprint;
    const record = {
      schemaVersion: 1,
      ok,
      status: ok ? 'READY_SOURCE_PROOF_COMPLETE' : 'READY_SOURCE_PROOF_BLOCKED',
      mode: READY_SOURCE_PROOF_MODE,
      jobId: context.state.jobId,
      fingerprint: context.state.fingerprint,
      statePath: path.resolve(statePath),
      initialStateSha: context.contract.stateSha,
      finalStateSha: sha256(fs.readFileSync(statePath)),
      initialEvidenceHashes: context.contract.evidenceHashes,
      proofEvidenceHashes: proofResult?.freshHashes || [],
      sourceSha256: proofResult?.sourceProof?.sha256 || null,
      sourceSize: proofResult?.sourceProof?.size || null,
      sourceClaimPath: claimPath,
      claimToken,
      publicationPerformed: false,
      reuploaded: false,
      error: validationError,
      summary: summary ? { ready: summary.ready === true, jobId: summary.jobId } : null,
      at: new Date().toISOString(),
    };
    writeJsonExclusive(claimPath + '.result.json', record);
    return { ok, status: record.status, jobId: context.state.jobId, preparedStatePath: statePath,
      publicationPerformed: false, reuploaded: false, sourceSha256: record.sourceSha256,
      sourceSize: record.sourceSize, resultPath: claimPath + '.result.json', error: validationError };
  } catch (error) {
    return { ok: false, status: 'BLOCKED', code: String(error.message || error), publicationPerformed: false, reuploaded: false,
      ...(claimPath ? { claimPath, claimRetained: fs.existsSync(claimPath) } : {}) };
  } finally {
    if (context) fs.rmSync(context.directory, { recursive: true, force: true });
  }
}

function resumeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertFreshSourceProofSidecar(statePath, binding, stateBase) {
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const item = state?.platforms?.wechat_channels;
  const isSafetyRetry = item?.history?.length === [...PHASES, 'inspect', 'verify', 'inspect', 'verify'].length;
  if (!isSafetyRetry) {
    const proof = assertChannelsReadySourceProofState(state, binding, statePath, stateBase);
    const claimPath = path.join(path.dirname(statePath), 'channels-ready-source-proof-resume.claim');
    const resultPath = claimPath + '.result.json';
    const claim = readJson(claimPath, 'CHANNELS_READY_SOURCE_CLAIM_INVALID').value;
    const result = readJson(resultPath, 'CHANNELS_READY_SOURCE_RESULT_INVALID').value;
    if (claim.mode !== READY_SOURCE_PROOF_MODE || claim.jobId !== path.basename(path.dirname(statePath))
        || claim.statePath !== path.resolve(statePath) || claim.fingerprint !== result.fingerprint
        || result.ok !== true || result.status !== 'READY_SOURCE_PROOF_COMPLETE'
        || result.mode !== READY_SOURCE_PROOF_MODE || result.jobId !== claim.jobId
        || result.statePath !== path.resolve(statePath) || result.claimToken !== claim.claimToken
        || result.initialStateSha !== claim.stateSha || result.finalStateSha !== proof.stateSha256
        || JSON.stringify(result.initialEvidenceHashes) !== JSON.stringify(claim.evidenceHashes)
        || JSON.stringify(result.proofEvidenceHashes) !== JSON.stringify(proof.freshHashes)
        || result.sourceSha256 !== proof.sourceProof.sha256 || result.sourceSize !== proof.sourceProof.size
        || result.publicationPerformed !== false || result.reuploaded !== false) {
      fail('CHANNELS_READY_SOURCE_RESULT_LINEAGE_REJECTED');
    }
    if (JSON.stringify(proof.baselineHashes) !== JSON.stringify(claim.evidenceHashes)) {
      fail('CHANNELS_READY_SOURCE_ORIGINAL_EVIDENCE_LINEAGE_REJECTED');
    }
    return { proof, claimPath, resultPath, claim, result, priorSidecars: [] };
  }

  const proof = assertChannelsReadySourceProofSafetyRetryState(state, binding, statePath, stateBase);
  const retryPaths = sourceProofSafetyRetryPaths(statePath);
  const claimRecord = readJson(retryPaths.claimPath, 'CHANNELS_READY_SOURCE_SAFETY_RETRY_CLAIM_INVALID');
  const resultRecord = readJson(retryPaths.resultPath, 'CHANNELS_READY_SOURCE_SAFETY_RETRY_RESULT_INVALID');
  const claim = claimRecord.value;
  const result = resultRecord.value;
  const oldClaimRecord = readJson(retryPaths.oldClaimPath, 'CHANNELS_READY_SOURCE_OLD_CLAIM_INVALID');
  const oldResultRecord = readJson(retryPaths.oldResultPath, 'CHANNELS_READY_SOURCE_OLD_RESULT_INVALID');
  const expectedEvidenceHashes = [...proof.baselineHashes, ...proof.falseBlockHashes];
  if (claim.mode !== READY_SOURCE_PROOF_MODE || claim.retryMode !== READY_SOURCE_PROOF_SAFETY_RETRY_KIND
      || claim.jobId !== state.jobId || claim.fingerprint !== state.fingerprint
      || claim.statePath !== path.resolve(statePath) || claim.stateSha !== oldResultRecord.value.finalStateSha
      || claim.originalBlockedStateSha256 !== claim.stateSha || !claim.claimToken
      || JSON.stringify(claim.evidenceHashes) !== JSON.stringify(expectedEvidenceHashes)
      || claim.oldSourceClaimPath !== retryPaths.oldClaimPath || claim.oldSourceResultPath !== retryPaths.oldResultPath
      || claim.oldSourceClaimSha256 !== sha256(oldClaimRecord.raw)
      || claim.oldSourceResultSha256 !== sha256(oldResultRecord.raw)
      || claim.oldSourceClaimToken !== oldClaimRecord.value.claimToken
      || result.ok !== true || result.status !== 'READY_SOURCE_PROOF_COMPLETE'
      || result.mode !== READY_SOURCE_PROOF_MODE || result.retryMode !== READY_SOURCE_PROOF_SAFETY_RETRY_KIND
      || result.jobId !== claim.jobId || result.fingerprint !== claim.fingerprint
      || result.statePath !== path.resolve(statePath) || result.claimToken !== claim.claimToken
      || result.sourceClaimPath !== retryPaths.claimPath || result.initialStateSha !== claim.stateSha
      || result.finalStateSha !== proof.stateSha256
      || JSON.stringify(result.initialEvidenceHashes) !== JSON.stringify(claim.evidenceHashes)
      || JSON.stringify(result.proofEvidenceHashes) !== JSON.stringify(proof.freshHashes)
      || JSON.stringify(result.blockedEvidenceHashes) !== JSON.stringify(proof.falseBlockHashes)
      || result.sourceSha256 !== proof.sourceProof.sha256 || result.sourceSize !== proof.sourceProof.size
      || result.oldSourceClaimPath !== retryPaths.oldClaimPath || result.oldSourceResultPath !== retryPaths.oldResultPath
      || result.oldSourceClaimSha256 !== claim.oldSourceClaimSha256
      || result.oldSourceResultSha256 !== claim.oldSourceResultSha256
      || result.oldSourceClaimToken !== claim.oldSourceClaimToken
      || result.originalBlockedStateSha256 !== claim.originalBlockedStateSha256
      || result.publicationPerformed !== false || result.reuploaded !== false
      || oldResultRecord.value.ok !== false || oldResultRecord.value.error !== 'CHANNELS_READY_SOURCE_FRESH_HISTORY_REJECTED') {
    fail('CHANNELS_READY_SOURCE_SAFETY_RETRY_RESULT_LINEAGE_REJECTED');
  }
  const priorSidecars = [
    { path: retryPaths.oldClaimPath, sha256: sha256(oldClaimRecord.raw) },
    { path: retryPaths.oldResultPath, sha256: sha256(oldResultRecord.raw) },
  ];
  return { proof, claimPath: retryPaths.claimPath, resultPath: retryPaths.resultPath, claim, result, priorSidecars };
}

export function assertChannelsReadySourceProofReleaseContext({ preparedStatePath, sourceStateBase = DEFAULT_STATE_BASE,
  binding, resume, identity }) {
  const preparedPath = path.resolve(preparedStatePath || '');
  const expectedClaimPath = `${path.resolve(resume?.statePath || '')}.resume-claim`;
  if (resume?.resumeType !== 'channels_ready_source_proof' || resume.action !== 'publish'
      || resume.platform !== 'wechat_channels' || resume.binding?.platform !== 'wechat_channels'
      || resume.preparedStatePath !== preparedPath || !resume.claimPath || !resume.claimToken
      || path.resolve(resume.claimPath) !== expectedClaimPath || !resume.resumeResultPath
      || path.resolve(resume.resumeResultPath) !== `${path.resolve(resume.statePath || '')}.resume-result.json`) {
    fail('CHANNELS_READY_SOURCE_TYPED_RELEASE_CLAIM_REQUIRED');
  }
  const stateStat = regularFile(preparedPath);
  if (stateStat.isSymbolicLink()) fail('CHANNELS_READY_SOURCE_STATE_INVALID');
  const stateRaw = fs.readFileSync(preparedPath);
  const stateSha = sha256(stateRaw);
  if (stateSha !== resume.preparedStateSha256 || sha256(fs.readFileSync(resume.claimPath)) !== resume.outerClaimSha256) {
    fail('CHANNELS_READY_SOURCE_RELEASE_STATE_OR_CLAIM_CHANGED');
  }
  const state = JSON.parse(stateRaw.toString('utf8'));
  if (state.fingerprint !== identity?.fingerprint || state.status !== 'ready'
      || state.platforms?.wechat_channels?.status !== 'ready'
      || state.platforms.wechat_channels.videoReceipt?.mode !== 'recovered_original_blob'
      || state.platforms.wechat_channels.videoReceipt?.nativeMedia?.recoveryMode !== READY_SOURCE_PROOF_MODE) {
    fail('CHANNELS_READY_SOURCE_RELEASE_RECEIPT_MODE_CHANGED');
  }
  const checked = assertFreshSourceProofSidecar(preparedPath, binding, sourceStateBase);
  const item = state.platforms.wechat_channels;
  if (item.videoReceipt.nativeMedia.sha256 !== checked.proof.sourceProof.sha256
      || item.videoReceipt.nativeMedia.size !== checked.proof.sourceProof.size
      || resume.sourceProofClaimToken !== checked.claim.claimToken
      || path.resolve(resume.sourceProofClaimPath || '') !== path.resolve(checked.claimPath)
      || path.resolve(resume.sourceProofResultPath || '') !== path.resolve(checked.resultPath)
      || sha256(fs.readFileSync(checked.resultPath)) !== resume.sourceProofResultSha256
      || sha256(fs.readFileSync(checked.claimPath)) !== resume.sourceProofClaimSha256) {
    fail('CHANNELS_READY_SOURCE_RELEASE_PROOF_LINEAGE_CHANGED');
  }
  const outerClaim = readJson(resume.claimPath, 'CHANNELS_READY_SOURCE_OUTER_CLAIM_INVALID').value;
  if (outerClaim.status !== 'SOURCE_PROOF_PUBLISH_RESUME_CLAIMED' || outerClaim.token !== resume.claimToken
      || outerClaim.contentHash !== resume.contentHash || outerClaim.platform !== 'wechat_channels'
      || outerClaim.accountKey !== binding.accountKey || outerClaim.action !== 'publish'
      || outerClaim.preparedState !== preparedPath || outerClaim.preparedStateSha256 !== stateSha
      || outerClaim.sourceProofSha256 !== checked.proof.sourceProof.sha256
      || outerClaim.sourceProofStateSha256 !== stateSha
      || outerClaim.sourceProofClaimToken !== resume.sourceProofClaimToken
      || outerClaim.sourceProofClaimPath !== checked.claimPath
      || outerClaim.sourceProofResultPath !== checked.resultPath
      || outerClaim.sourceProofResultSha256 !== resume.sourceProofResultSha256
      || outerClaim.sourceProofClaimSha256 !== resume.sourceProofClaimSha256
      || outerClaim.originalReservationSha256 !== resume.originalReservationSha256) {
    fail('CHANNELS_READY_SOURCE_OUTER_CLAIM_LINEAGE_INVALID');
  }
  if (checked.claim.retryMode === READY_SOURCE_PROOF_SAFETY_RETRY_KIND
      && (outerClaim.sourceProofPriorClaimPath !== resume.sourceProofPriorClaimPath
        || outerClaim.sourceProofPriorResultPath !== resume.sourceProofPriorResultPath
        || outerClaim.sourceProofPriorClaimSha256 !== resume.sourceProofPriorClaimSha256
        || outerClaim.sourceProofPriorResultSha256 !== resume.sourceProofPriorResultSha256
        || !checked.priorSidecars.some(row => row.path === resume.sourceProofPriorClaimPath && row.sha256 === resume.sourceProofPriorClaimSha256)
        || !checked.priorSidecars.some(row => row.path === resume.sourceProofPriorResultPath && row.sha256 === resume.sourceProofPriorResultSha256))) {
    fail('CHANNELS_READY_SOURCE_PRIOR_FALSE_BLOCK_LINEAGE_INVALID');
  }
  if (fs.existsSync(resume.resumeResultPath)) fail('CHANNELS_READY_SOURCE_PUBLISH_ALREADY_RESUMED');
  const priorStat = regularFile(resume.statePath);
  if (priorStat.isSymbolicLink() || fs.readFileSync(resume.statePath, 'utf8') !== resume.priorRaw
      || sha256(fs.readFileSync(resume.statePath)) !== resume.originalReservationSha256) {
    fail('CHANNELS_READY_SOURCE_ORIGINAL_RESERVATION_CHANGED');
  }
  const proofHashes = [...checked.proof.baselineHashes, ...(checked.proof.falseBlockHashes || []), ...checked.proof.freshHashes, ...checked.priorSidecars];
  for (const evidence of proofHashes) {
    if (sha256(fs.readFileSync(evidence.path)) !== evidence.sha256) fail('CHANNELS_READY_SOURCE_PROOF_EVIDENCE_CHANGED');
  }
  return {
    mode: READY_SOURCE_PROOF_MODE, ...(checked.claim.retryMode ? { retryMode: checked.claim.retryMode } : {}), preparedStatePath: preparedPath, preparedStateSha256: stateSha,
    sourceStateBase: path.resolve(sourceStateBase), sourceSha256: checked.proof.sourceProof.sha256,
    sourceSize: checked.proof.sourceProof.size, sourceProofClaimPath: checked.claimPath,
    sourceProofClaimToken: resume.sourceProofClaimToken, sourceProofClaimSha256: resume.sourceProofClaimSha256,
    sourceProofPriorClaimPath: resume.sourceProofPriorClaimPath || null,
    sourceProofPriorResultPath: resume.sourceProofPriorResultPath || null,
    sourceProofPriorClaimSha256: resume.sourceProofPriorClaimSha256 || null,
    sourceProofPriorResultSha256: resume.sourceProofPriorResultSha256 || null,
    sourceProofResultPath: checked.resultPath, sourceProofResultSha256: resume.sourceProofResultSha256,
    sourceProofEvidenceHashes: proofHashes, outerClaimPath: resume.claimPath, outerClaimToken: resume.claimToken,
    outerClaimSha256: resume.outerClaimSha256, originalReservationPath: resume.statePath,
    originalReservationSha256: resume.originalReservationSha256, contentHash: resume.contentHash,
    platform: 'wechat_channels', accountKey: binding.accountKey, fingerprint: identity.fingerprint,
    taskSpaceId: binding.taskSpaceId, resumeResultPath: resume.resumeResultPath,
  };
}

export async function claimChannelsReadySourceProofPublishResume(file, pkg, action, stateBase, preparedState, matrix, fingerprintPackage, sourceStateBase = DEFAULT_STATE_BASE) {
  const target = pkg?.schoolAccount || {};
  if (target.platform !== 'wechat_channels' || action !== 'publish' || !preparedState
      || (pkg.backend && pkg.backend !== 'ego_video')) {
    throw resumeError('CHANNELS_READY_SOURCE_PUBLISH_RESUME_NOT_ALLOWED', 'Only WeChat Channels ego_video publish may resume the exact known pre-click receipt.');
  }
  const binding = resolveSchoolAccountBinding(target, matrix);
  const { contentHash } = fingerprintPackage(pkg);
  const packageForIdentity = { ...readPackage(file), schoolAccount: binding };
  const safe = value => {
    if (!/^[a-zA-Z0-9_-]+$/.test(value || '')) throw resumeError('CHANNELS_READY_SOURCE_PUBLISH_RESUME_NOT_ALLOWED', 'Unsafe platform/account key.');
    return value;
  };
  const expectedReceipt = path.resolve(path.join(stateBase, safe(target.platform), safe(target.accountKey), `publish-v2-${contentHash}.json`));
  const preparedPath = path.resolve(preparedState);
  let preparedStat;
  try { preparedStat = fs.lstatSync(preparedPath); }
  catch { throw resumeError('CHANNELS_READY_SOURCE_STATE_UNAVAILABLE', 'The exact prepared V2 state is missing.'); }
  if (!preparedStat.isFile() || preparedStat.isSymbolicLink()) throw resumeError('CHANNELS_READY_SOURCE_STATE_INVALID', 'Prepared V2 state must be a regular file.');
  let checkedSourceProof;
  try {
    const initialState = JSON.parse(fs.readFileSync(preparedPath, 'utf8'));
    let identity = await buildIdentity(packageForIdentity);
    if (identity.fingerprint !== initialState.fingerprint
        && target.platform !== 'youtube'
        && packageForIdentity.youtubeAlteredContentExplicit === false
        && typeof packageForIdentity.youtubeAlteredContent === 'boolean') {
      // run-school-account serializes its normalized package before starting V2;
      // V2's second readPackage pass marks this irrelevant YouTube default explicit.
      // Match releaseContext's same narrow fallback, but only accept it when the
      // resulting full fingerprint and the media/assets identity match the READY state.
      const v2EquivalentIdentity = await buildIdentity({ ...packageForIdentity, youtubeAlteredContentExplicit: true });
      if (v2EquivalentIdentity.fingerprint === initialState.fingerprint) identity = v2EquivalentIdentity;
    }
    if (identity.fingerprint !== initialState.fingerprint
        || JSON.stringify(identity.video) !== JSON.stringify(initialState.video)
        || JSON.stringify(identity.assets) !== JSON.stringify(initialState.assets)) fail('CHANNELS_READY_SOURCE_PACKAGE_OR_ASSET_CHANGED');
    checkedSourceProof = assertFreshSourceProofSidecar(preparedPath, binding, sourceStateBase);
  }
  catch (error) { throw resumeError('CHANNELS_READY_SOURCE_PROOF_REQUIRED', String(error.message || error)); }

  let stat;
  try { stat = fs.lstatSync(expectedReceipt); }
  catch { throw resumeError('CHANNELS_READY_SOURCE_ORIGINAL_RESERVATION_REQUIRED', 'No exact prior publish reservation exists for this package fingerprint.'); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw resumeError('CHANNELS_READY_SOURCE_ORIGINAL_RESERVATION_INVALID', 'Prior publish reservation must be a regular non-symlink file.');
  const priorRaw = fs.readFileSync(expectedReceipt, 'utf8');
  let priorReceipt;
  try { priorReceipt = JSON.parse(priorRaw); }
  catch { throw resumeError('CHANNELS_READY_SOURCE_ORIGINAL_RESERVATION_INVALID', 'Prior publish reservation is not valid JSON.'); }
  const eligible = priorReceipt.ok === false && priorReceipt.status === 'SUBMISSION_UNCERTAIN'
    && priorReceipt.code === 'BACKEND_ERROR'
    && priorReceipt.message === 'PREPARED_VIDEO_UPLOAD_RECEIPT_REQUIRED'
    && priorReceipt.platform === 'wechat_channels' && priorReceipt.accountKey === target.accountKey
    && priorReceipt.action === 'publish' && priorReceipt.backend === 'ego_video'
    && priorReceipt.fingerprintVersion === 2 && priorReceipt.contentHash === contentHash
    && priorReceipt.publicReadbackVerified === false && priorReceipt.submitted !== true;
  if (!eligible) throw resumeError('CHANNELS_READY_SOURCE_ORIGINAL_RESERVATION_NOT_ELIGIBLE', 'Only the exact known pre-click upload-receipt failure may continue.');

  const resumeResultPath = expectedReceipt + '.resume-result.json';
  if (fs.existsSync(resumeResultPath)) throw resumeError('CHANNELS_READY_SOURCE_PUBLISH_ALREADY_RESUMED', 'A continuation result already exists for this exact publish reservation.');
  const claimPath = expectedReceipt + '.resume-claim';
  const claimToken = crypto.randomBytes(16).toString('hex');
  const sourceProofClaimPath = checkedSourceProof.claimPath;
  const sourceProofResultPath = checkedSourceProof.resultPath;
  const sourceProofClaim = checkedSourceProof.claim;
  const preparedStateSha256 = sha256(fs.readFileSync(preparedPath));
  const sourceProofClaimSha256 = sha256(fs.readFileSync(sourceProofClaimPath));
  const sourceProofResultSha256 = sha256(fs.readFileSync(sourceProofResultPath));
  const originalReservationSha256 = sha256(Buffer.from(priorRaw));
  const claim = { status: 'SOURCE_PROOF_PUBLISH_RESUME_CLAIMED', token: claimToken,
    contentHash, platform: target.platform, accountKey: target.accountKey, action,
    preparedState: preparedPath, preparedStateSha256,
    sourceProofSha256: JSON.parse(fs.readFileSync(preparedPath, 'utf8')).platforms.wechat_channels.videoReceipt.nativeMedia.sha256,
    sourceProofStateSha256: preparedStateSha256, sourceProofClaimToken: sourceProofClaim.claimToken,
    sourceProofClaimPath, sourceProofClaimSha256, sourceProofResultPath, sourceProofResultSha256, originalReservationSha256,
    ...(checkedSourceProof.claim.retryMode === READY_SOURCE_PROOF_SAFETY_RETRY_KIND ? {
      sourceProofPriorClaimPath: checkedSourceProof.claim.oldSourceClaimPath,
      sourceProofPriorResultPath: checkedSourceProof.claim.oldSourceResultPath,
      sourceProofPriorClaimSha256: checkedSourceProof.claim.oldSourceClaimSha256,
      sourceProofPriorResultSha256: checkedSourceProof.claim.oldSourceResultSha256,
    } : {}),
    at: new Date().toISOString() };
  let fd;
  try {
    fd = fs.openSync(claimPath, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(claim));
    fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    if (error.code === 'EEXIST') throw resumeError('CHANNELS_READY_SOURCE_PUBLISH_ALREADY_CLAIMED', 'A continuation for this exact publish reservation is already claimed.');
    throw error;
  } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  try {
    if (fs.readFileSync(expectedReceipt, 'utf8') !== priorRaw) throw resumeError('CHANNELS_READY_SOURCE_ORIGINAL_RESERVATION_CHANGED', 'Prior publish reservation changed during claim.');
    const afterSourceProof = assertFreshSourceProofSidecar(preparedPath, binding, sourceStateBase);
    if (afterSourceProof.proof.stateSha256 !== claim.sourceProofStateSha256) throw resumeError('CHANNELS_READY_SOURCE_STATE_CHANGED_DURING_CLAIM', 'Prepared state changed during claim.');
    if (fs.existsSync(resumeResultPath)) throw resumeError('CHANNELS_READY_SOURCE_PUBLISH_ALREADY_RESUMED', 'A continuation result appeared while claiming.');
  } catch (error) {
    try { if (JSON.parse(fs.readFileSync(claimPath, 'utf8')).token === claimToken) fs.unlinkSync(claimPath); } catch {}
    throw error;
  }
  return { statePath: expectedReceipt, resumeResultPath, contentHash, action, fingerprintVersion: 2,
    resume: true, resumeType: 'channels_ready_source_proof', priorReceipt, priorRaw, claimPath, claimToken,
    preparedStatePath: preparedPath, preparedStateSha256, binding, platform: target.platform,
    sourceProofClaimToken: sourceProofClaim.claimToken, sourceProofClaimPath, sourceProofClaimSha256, sourceProofResultPath, sourceProofResultSha256,
    ...(sourceProofClaim.retryMode === READY_SOURCE_PROOF_SAFETY_RETRY_KIND ? {
      sourceProofPriorClaimPath: sourceProofClaim.oldSourceClaimPath,
      sourceProofPriorResultPath: sourceProofClaim.oldSourceResultPath,
      sourceProofPriorClaimSha256: sourceProofClaim.oldSourceClaimSha256,
      sourceProofPriorResultSha256: sourceProofClaim.oldSourceResultSha256,
    } : {}),
    originalReservationSha256, outerClaimSha256: sha256(fs.readFileSync(claimPath)), sourceStateBase: path.resolve(sourceStateBase) };
}
