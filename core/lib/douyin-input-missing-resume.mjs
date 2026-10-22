import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPackage } from './content-package.mjs';
import { buildIdentity } from '../v2/lib/identity.mjs';
import { resolveSchoolAccountBinding, schoolAccountStateRoot } from './school-account.mjs';

export const DOUYIN_INPUT_MISSING_RESUME_TYPE = 'before_file_input_missing';
export const DOUYIN_UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload';

const CLAIM_NAME = 'douyin-input-missing-resume.claim';
const RESULT_SUFFIX = '.result.json';
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const ownKeys = value => Object.keys(value || {});
const isPlainEmpty = value => !isObject(value) || Object.keys(value).length === 0;
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalizeName = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();

function regularFile(filePath, code) {
  let stat;
  try { stat = fs.lstatSync(filePath); } catch { fail(code); }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code);
}

function canonicalBinding(binding) {
  return {
    platform: binding.platform,
    accountKey: binding.accountKey,
    accountId: binding.accountId,
    accountName: binding.accountName,
    apiUid: binding.apiUid,
    taskSpaceId: binding.taskSpaceId,
    taskSpaceName: binding.taskSpaceName,
    pageLabel: binding.pageLabel,
    targetId: binding.targetId,
    persistentProfile: binding.persistentProfile,
    egoProfileId: binding.egoProfileId,
  };
}

function assertKaifengBinding(binding) {
  if (binding?.platform !== 'douyin'
    || binding.accountKey !== 'kaifeng'
    || !binding.accountId
    || !binding.accountName
    || binding.apiUid !== ''
    || !Number.isSafeInteger(binding.taskSpaceId)
    || binding.taskSpaceId < 1
    || !binding.taskSpaceName
    || !/^p[1-9][0-9]*$/.test(binding.pageLabel || '')
    || !binding.targetId
    || !binding.egoProfileId
    || !binding.persistentProfile) {
    fail('DOUYIN_INPUT_MISSING_CANONICAL_BINDING_REJECTED');
  }
}

function markerPaths(statePath) {
  const directory = path.dirname(statePath);
  const claimPath = path.join(directory, CLAIM_NAME);
  return { claimPath, resultPath: `${claimPath}${RESULT_SUFFIX}` };
}

function assertNoPriorReleaseMarkers(statePath) {
  const names = fs.readdirSync(path.dirname(statePath));
  if (names.some(name => /^school-final-|final-submit/i.test(name))) {
    fail('DOUYIN_INPUT_MISSING_FINAL_MARKER_PRESENT');
  }
}

function assertNoPriorResumeSidecars(statePath) {
  const { claimPath, resultPath } = markerPaths(statePath);
  if (fs.existsSync(claimPath) || fs.existsSync(resultPath)) {
    fail('DOUYIN_INPUT_MISSING_RESUME_ALREADY_CLAIMED');
  }
}

function assertHistoricalObservation(entry, evidence, binding, index) {
  const observation = evidence?.observation;
  const expectedPhase = index === 0 ? 'inspect' : 'upload_start';
  if (!isObject(observation)
    || observation.platform !== 'douyin'
    || observation.phase !== expectedPhase
    || observation.taskSpaceId !== binding.taskSpaceId
    || observation.taskSpace !== binding.taskSpaceName
    || observation.finalPublishClicked !== false
    || evidence.verdict?.ready !== false
    || !sameJson(evidence.verdict?.blocker, entry.blocker)
    || !observation.gates?.authenticated?.ok
    || !observation.gates?.draftIdentity?.ok
    || observation.gates?.safety?.ok !== true
    || observation.gates.safety.evidence?.guardArmed !== true
    || observation.gates.safety.evidence?.blockedAttempts !== 0
    || observation.gates.noBlockingDialog?.ok !== true
    || !Array.isArray(observation.gates.noBlockingDialog.evidence?.active)
    || observation.gates.noBlockingDialog.evidence.active.length !== 0
    || observation.gates.video?.ok !== false
    || observation.gates.video.evidence?.uploaded !== false
    || observation.gates.video.evidence?.uploading !== false
    || observation.gates.video.evidence?.failed !== false
    || observation.gates.video.evidence?.resumeDialog !== false
    || !isPlainEmpty(observation.actions)
    || !isPlainEmpty(observation.receipts)) {
    fail('DOUYIN_INPUT_MISSING_HISTORY_EVIDENCE_REJECTED');
  }
  if (observation.blocker && !sameJson(observation.blocker, entry.blocker)) {
    fail('DOUYIN_INPUT_MISSING_HISTORY_BLOCKER_MISMATCH');
  }

  const uploadSurface = observation.gates.authenticated.evidence?.douyinUploadSurface;
  if (index === 0) {
    if (entry.blocker?.code !== 'STATE_AMBIGUOUS'
      || uploadSurface?.ok !== false
      || uploadSurface?.url !== 'https://creator.douyin.com/creator-micro/home'
      || uploadSurface?.reason !== 'douyin_upload_url_not_exact'
      || uploadSurface?.videoInputCount !== 0) {
      fail('DOUYIN_INPUT_MISSING_ORIGINAL_INSPECT_NOT_PROVED');
    }
  } else if (entry.blocker?.code !== 'SELECTOR_DRIFT'
    || entry.blocker?.message !== 'douyin video input missing'
    || uploadSurface?.ok !== false
    || uploadSurface?.url !== 'https://creator.douyin.com/creator-micro/home'
    || uploadSurface?.reason !== 'douyin_upload_url_not_exact'
    || uploadSurface?.videoInputCount !== 0) {
    fail('DOUYIN_INPUT_MISSING_ORIGINAL_FAILURE_NOT_PROVED');
  }
}

function readAndAssertState(statePath, binding, stateBase, { allowMatchingClaim = false } = {}) {
  assertKaifengBinding(binding);
  regularFile(statePath, 'DOUYIN_INPUT_MISSING_STATE_FILE_REQUIRED');
  const computedStateRoot = schoolAccountStateRoot(stateBase, binding);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const item = state.platforms?.douyin;
  if (state.schemaVersion !== 4
    || state.status !== 'blocked'
    || item?.status !== 'blocked'
    || state.jobId !== state.fingerprint?.slice(0, 16)
    || !/^[a-f0-9]{16}$/.test(state.jobId || '')
    || !/^[a-f0-9]{64}$/.test(state.fingerprint || '')
    || state.taskSuffix !== 'school-kaifeng'
    || !Array.isArray(state.revisions)
    || state.revisions.length !== 1
    || state.revisions[0]?.operation !== 'auto'
    || state.revisions[0]?.fingerprint !== state.fingerprint
    || Object.keys(state.platforms || {}).join(',') !== 'douyin'
    || item.taskSpaceId !== binding.taskSpaceId
    || item.taskSpaceName !== binding.taskSpaceName
    || item.videoReceipt !== null
    || !isPlainEmpty(item.receipts)
    || item.verdict?.ready !== false
    || item.verdict?.phase !== 'upload_start'
    || item.verdict?.blocker?.code !== 'SELECTOR_DRIFT'
    || item.verdict?.blocker?.message !== 'douyin video input missing'
    || !state.video?.path
    || !/^[a-f0-9]{64}$/.test(state.video?.sha256 || '')
    || !Number.isSafeInteger(state.video?.size)
    || state.video.size < 1) {
    fail('DOUYIN_INPUT_MISSING_STATE_SCOPE_REJECTED');
  }
  if (path.resolve(statePath) !== path.join(computedStateRoot, state.jobId, 'state.json')) {
    fail('DOUYIN_INPUT_MISSING_STATE_ROOT_REJECTED');
  }
  if (!Array.isArray(item.history)
    || item.history.length !== 2
    || item.history.map(entry => entry.phase).join(',') !== 'inspect,upload_start') {
    fail('DOUYIN_INPUT_MISSING_HISTORY_SHAPE_REJECTED');
  }

  const evidenceRoot = path.join(path.dirname(statePath), 'evidence');
  const evidenceHashes = [];
  for (const [index, entry] of item.history.entries()) {
    const evidencePath = path.resolve(entry.evidencePath || '');
    if (!evidencePath.startsWith(`${evidenceRoot}${path.sep}`)) {
      fail('DOUYIN_INPUT_MISSING_EVIDENCE_PATH_REJECTED');
    }
    regularFile(evidencePath, 'DOUYIN_INPUT_MISSING_EVIDENCE_FILE_REQUIRED');
    const raw = fs.readFileSync(evidencePath);
    const evidence = JSON.parse(raw);
    assertHistoricalObservation(entry, evidence, binding, index);
    evidenceHashes.push({ path: evidencePath, sha256: sha256(raw) });
  }
  if (item.verdict?.blocker?.code !== item.history[1].blocker?.code
    || item.verdict?.blocker?.message !== item.history[1].blocker?.message) {
    fail('DOUYIN_INPUT_MISSING_LAST_VERDICT_MISMATCH');
  }

  assertNoPriorReleaseMarkers(statePath);
  const sidecars = markerPaths(statePath);
  if (allowMatchingClaim) {
    regularFile(sidecars.claimPath, 'DOUYIN_INPUT_MISSING_CLAIM_REQUIRED');
    const claim = JSON.parse(fs.readFileSync(sidecars.claimPath, 'utf8'));
    if (claim.resumeType !== DOUYIN_INPUT_MISSING_RESUME_TYPE
      || claim.jobId !== state.jobId
      || claim.fingerprint !== state.fingerprint) {
      fail('DOUYIN_INPUT_MISSING_CLAIM_CHANGED');
    }
    if (fs.existsSync(sidecars.resultPath)) fail('DOUYIN_INPUT_MISSING_RESULT_ALREADY_EXISTS');
  } else {
    assertNoPriorResumeSidecars(statePath);
  }

  const rawState = fs.readFileSync(statePath);
  const stateSha = sha256(rawState);
  if (path.resolve(statePath) !== path.join(path.resolve(computedStateRoot), state.jobId, 'state.json')) {
    fail('DOUYIN_INPUT_MISSING_STATE_PATH_REJECTED');
  }
  return { state, item, stateSha, evidenceHashes, stateRoot: computedStateRoot, stateBase: path.resolve(stateBase) };
}

export function assertDouyinInputMissingResumeState(state, binding, statePath, stateBase = path.join(os.homedir(), '.maxiaojian-publish', 'school-accounts')) {
  const result = readAndAssertState(statePath, binding, stateBase);
  if (state !== result.state && !sameJson(state, result.state)) fail('DOUYIN_INPUT_MISSING_STATE_OBJECT_CHANGED');
  return { statePath: path.resolve(statePath), stateRoot: result.stateRoot, stateSha: result.stateSha, evidenceHashes: result.evidenceHashes, item: result.item };
}

export async function prepareDouyinInputMissingResumeContext(file, statePath, matrix, options = {}) {
  regularFile(file, 'DOUYIN_INPUT_MISSING_PACKAGE_FILE_REQUIRED');
  const stateBase = path.resolve(options.stateBase || path.join(os.homedir(), '.maxiaojian-publish', 'school-accounts'));
  const initialPackage = readPackage(file);
  const binding = resolveSchoolAccountBinding(initialPackage.schoolAccount, matrix);
  assertKaifengBinding(binding);
  const admission = readAndAssertState(statePath, binding, stateBase);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-input-missing-resume-'));
  fs.chmodSync(directory, 0o700);
  const packagePath = path.join(directory, 'package.json');
  try {
    fs.writeFileSync(packagePath, JSON.stringify({ ...initialPackage, schoolAccount: binding }), { mode: 0o600 });
    const normalizedPackage = readPackage(packagePath);
    const identity = await buildIdentity(normalizedPackage);
    if (identity.fingerprint !== admission.state.fingerprint
      || !sameJson(identity.video, admission.state.video)
      || !sameJson(identity.assets, admission.state.assets)) {
      fail('DOUYIN_INPUT_MISSING_DOUBLE_NORMALIZED_IDENTITY_MISMATCH');
    }
    const claim = markerPaths(statePath);
    const contract = {
      version: 1,
      resumeType: DOUYIN_INPUT_MISSING_RESUME_TYPE,
      platform: 'douyin',
      jobId: admission.state.jobId,
      fingerprint: admission.state.fingerprint,
      packageFingerprint: identity.fingerprint,
      statePath: path.resolve(statePath),
      stateRoot: admission.stateRoot,
      stateBase,
      stateSha: admission.stateSha,
      evidenceHashes: admission.evidenceHashes,
      binding: canonicalBinding(binding),
      video: { path: identity.video.path, size: identity.video.size, sha256: identity.video.sha256 },
      noPriorVideoInjection: true,
      allowInitialUploadStart: true,
      claimPath: claim.claimPath,
      resultPath: claim.resultPath,
    };
    return { state: admission.state, binding, identity, normalizedPackage, packagePath, directory, statePath: path.resolve(statePath), stateRoot: admission.stateRoot, contract };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function assertIdentityGuard(guard, binding, label) {
  if (guard?.ok !== true
    || guard.profileId !== binding.egoProfileId
    || guard.spaceId !== binding.taskSpaceId
    || guard.spaceName !== binding.taskSpaceName
    || guard.ownership !== 'agent'
    || guard.pageLabel !== binding.pageLabel
    || guard.targetId !== binding.targetId
    || guard.url !== DOUYIN_UPLOAD_URL) {
    fail(`DOUYIN_INPUT_MISSING_${label}_IDENTITY_SCOPE_REJECTED`);
  }
}

function assertIdentityEvidence(identityProof, binding) {
  if (identityProof?.source !== 'creator_api'
    || identityProof.ok !== true
    || identityProof.status !== 200
    || identityProof.platformHost !== 'creator.douyin.com'
    || typeof identityProof.uid !== 'string'
    || !/^[0-9]+$/.test(identityProof.uid)
    || /^0+$/.test(identityProof.uid)
    || (binding.apiUid && identityProof.uid !== String(binding.apiUid))
    || normalizeName(identityProof.nickname) !== normalizeName(binding.accountName)
    || identityProof.unique_id !== binding.accountId) {
    fail('DOUYIN_INPUT_MISSING_FRESH_CREATOR_IDENTITY_REJECTED');
  }
  assertIdentityGuard(identityProof.binding, binding, 'BINDING');
  assertIdentityGuard(identityProof.before, binding, 'BEFORE');
  assertIdentityGuard(identityProof.after, binding, 'AFTER');
  for (const field of ['profileId', 'spaceId', 'spaceName', 'ownership', 'pageLabel', 'targetId', 'url']) {
    if (identityProof.before[field] !== identityProof.after[field]
      || identityProof.binding[field] !== identityProof.before[field]) {
      fail('DOUYIN_INPUT_MISSING_FRESH_CREATOR_IDENTITY_DRIFT');
    }
  }
}

function assertIdentityEvidenceMatchesObservation(identityProof, evidence) {
  if (!isObject(evidence)) fail('DOUYIN_INPUT_MISSING_IDENTITY_OBSERVATION_REQUIRED');
  for (const key of ['source', 'uid', 'nickname', 'unique_id', 'binding', 'before', 'after']) {
    if (!sameJson(evidence[key], identityProof[key])) fail('DOUYIN_INPUT_MISSING_IDENTITY_OBSERVATION_MISMATCH');
  }
}

function assertFreshObservation(observation, binding, identityProof) {
  if (!isObject(observation)
    || observation.platform !== 'douyin'
    || observation.phase !== 'inspect'
    || observation.taskSpaceId !== binding.taskSpaceId
    || observation.taskSpace !== binding.taskSpaceName
    || observation.finalPublishClicked !== false
    || observation.blocker != null
    || !isPlainEmpty(observation.actions)
    || !isPlainEmpty(observation.receipts)) {
    fail('DOUYIN_INPUT_MISSING_FRESH_OBSERVATION_SCOPE_REJECTED');
  }
  const gates = observation.gates || {};
  const authenticated = gates.authenticated;
  const authEvidence = authenticated?.evidence;
  const surface = authEvidence?.douyinUploadSurface;
  if (authenticated?.ok !== true
    || authEvidence?.url !== DOUYIN_UPLOAD_URL
    || surface?.ok !== true
    || surface.url !== DOUYIN_UPLOAD_URL
    || surface.videoInputCount !== 1
    || surface.enabledVideoInputCount !== 1
    || surface.videoFileInput?.disabled !== false
    || typeof surface.videoFileInput?.accept !== 'string'
    || !/(video|\.mp4|\.mov|\.mkv|\.flv|\.webm)/i.test(surface.videoFileInput.accept)
    || surface.videoFileInput?.visibleUploadArea?.visible !== true) {
    fail('DOUYIN_INPUT_MISSING_FRESH_UPLOAD_SURFACE_REJECTED');
  }
  assertIdentityEvidenceMatchesObservation(identityProof, authEvidence.douyinIdentity);

  const draft = gates.draftIdentity;
  if (draft?.ok !== true
    || draft.evidence?.empty !== true
    || draft.evidence?.title !== ''
    || draft.evidence?.editorText !== ''
    || draft.evidence?.recovery !== null) {
    fail('DOUYIN_INPUT_MISSING_FRESH_EDITOR_NOT_EMPTY');
  }
  const video = gates.video;
  if (video?.ok !== false
    || video.evidence?.uploaded !== false
    || video.evidence?.uploading !== false
    || video.evidence?.failed !== false
    || video.evidence?.resumeDialog !== false) {
    fail('DOUYIN_INPUT_MISSING_FRESH_VIDEO_STATE_NOT_EMPTY');
  }
  const dialogs = gates.noBlockingDialog;
  if (dialogs?.ok !== true
    || !Array.isArray(dialogs.evidence?.active)
    || dialogs.evidence.active.length !== 0) {
    fail('DOUYIN_INPUT_MISSING_FRESH_DIALOG_PRESENT');
  }
  const safety = gates.safety;
  if (safety?.ok !== true
    || safety.evidence?.guardArmed !== true
    || safety.evidence?.blockedAttempts !== 0
    || safety.evidence?.finalPublishClicked !== false) {
    fail('DOUYIN_INPUT_MISSING_FRESH_SAFETY_GUARD_REJECTED');
  }
  return true;
}

export function assertDouyinInputMissingBeforeUpload(input, binding, contract) {
  assertKaifengBinding(binding);
  if (input?.stage !== 'before-upload') fail('DOUYIN_INPUT_MISSING_STAGE_REJECTED');
  if (contract?.resumeType !== DOUYIN_INPUT_MISSING_RESUME_TYPE
    || contract.platform !== 'douyin'
    || contract.binding?.accountKey !== binding.accountKey
    || !/^[a-f0-9]{16}$/.test(contract.jobId || '')
    || !/^[a-f0-9]{64}$/.test(contract.fingerprint || '')
    || contract.jobId !== contract.fingerprint.slice(0, 16)
    || !sameJson(contract.binding, canonicalBinding(binding))) {
    fail('DOUYIN_INPUT_MISSING_CONTRACT_TYPE_REJECTED');
  }
  assertIdentityEvidence(input.identityProof, binding);
  assertFreshObservation(input.observation, binding, input.identityProof);
  return true;
}

export function assertDouyinInputMissingLockedContract(contract, pkg, identity, args, state, statePath, binding) {
  assertKaifengBinding(binding);
  if (contract?.version !== 1
    || contract.resumeType !== DOUYIN_INPUT_MISSING_RESUME_TYPE
    || contract.platform !== 'douyin'
    || contract.jobId !== state?.jobId
    || contract.fingerprint !== state?.fingerprint
    || contract.packageFingerprint !== identity?.fingerprint
    || contract.fingerprint !== identity?.fingerprint
    || contract.statePath !== path.resolve(statePath)
    || contract.stateRoot !== path.resolve(args?.stateRoot || '')
    || !sameJson(contract.binding, canonicalBinding(binding))
    || !sameJson(contract.video, { path: identity.video?.path, size: identity.video?.size, sha256: identity.video?.sha256 })
    || contract.noPriorVideoInjection !== true
    || contract.allowInitialUploadStart !== true
    || args?.operation !== 'resume'
    || args?.platforms?.length !== 1
    || args.platforms[0] !== 'douyin'
    || args.jobId !== state.jobId) {
    fail('DOUYIN_INPUT_MISSING_LOCKED_CONTRACT_MISMATCH');
  }
  if (pkg?.schoolAccount?.platform !== 'douyin' || pkg.schoolAccount.accountKey !== 'kaifeng') {
    fail('DOUYIN_INPUT_MISSING_LOCKED_PACKAGE_SCOPE_MISMATCH');
  }
  const current = readAndAssertState(statePath, binding, contract.stateBase, { allowMatchingClaim: true });
  if (current.stateSha !== contract.stateSha
    || !sameJson(current.evidenceHashes, contract.evidenceHashes)
    || !sameJson(current.state.video, contract.video)
    || current.state.jobId !== contract.jobId
    || current.state.fingerprint !== contract.fingerprint) {
    fail('DOUYIN_INPUT_MISSING_LOCKED_EVIDENCE_CHANGED');
  }
  if (contract.claimPath !== markerPaths(statePath).claimPath
    || contract.resultPath !== markerPaths(statePath).resultPath) {
    fail('DOUYIN_INPUT_MISSING_LOCKED_SIDECAR_PATH_MISMATCH');
  }
  return true;
}

export function createDouyinInputMissingResumeClaim(context, freshProof) {
  const { contract, binding, statePath, identity, normalizedPackage } = context || {};
  assertKaifengBinding(binding);
  if (!contract || contract.resumeType !== DOUYIN_INPUT_MISSING_RESUME_TYPE) fail('DOUYIN_INPUT_MISSING_CONTEXT_REQUIRED');
  assertDouyinInputMissingBeforeUpload(freshProof, binding, contract);
  if (identity?.fingerprint !== contract.fingerprint
    || normalizedPackage?.schoolAccount?.platform !== 'douyin'
    || normalizedPackage.schoolAccount.accountKey !== 'kaifeng') {
    fail('DOUYIN_INPUT_MISSING_CONTEXT_IDENTITY_CHANGED');
  }
  const current = readAndAssertState(statePath, binding, contract.stateBase);
  if (current.stateSha !== contract.stateSha || !sameJson(current.evidenceHashes, contract.evidenceHashes)) {
    fail('DOUYIN_INPUT_MISSING_CLAIM_EVIDENCE_CHANGED');
  }
  const claim = {
    version: 1,
    resumeType: DOUYIN_INPUT_MISSING_RESUME_TYPE,
    jobId: contract.jobId,
    fingerprint: contract.fingerprint,
    stateSha: contract.stateSha,
    createdAt: new Date().toISOString(),
  };
  let fd;
  try {
    fd = fs.openSync(contract.claimPath, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(claim));
    fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    throw error;
  }
  fs.closeSync(fd);
  return { claimPath: contract.claimPath, resultPath: contract.resultPath, claim };
}

export function writeDouyinInputMissingResumeResult(context, claimInfo, result) {
  const contract = context?.contract;
  if (!contract || claimInfo?.claimPath !== contract.claimPath || claimInfo?.resultPath !== contract.resultPath) {
    fail('DOUYIN_INPUT_MISSING_RESULT_CLAIM_MISMATCH');
  }
  regularFile(contract.claimPath, 'DOUYIN_INPUT_MISSING_CLAIM_REQUIRED');
  const claim = JSON.parse(fs.readFileSync(contract.claimPath, 'utf8'));
  if (claim.resumeType !== DOUYIN_INPUT_MISSING_RESUME_TYPE
    || claim.jobId !== contract.jobId
    || claim.fingerprint !== contract.fingerprint
    || claim.stateSha !== contract.stateSha
    || !sameJson(claim, claimInfo.claim)) {
    fail('DOUYIN_INPUT_MISSING_RESULT_CLAIM_CHANGED');
  }
  const allowed = new Set(['ok', 'status', 'code', 'jobId', 'fingerprint', 'preparedStatePath', 'publicationPerformed', 'reuploaded']);
  if (!isObject(result)
    || ownKeys(result).some(key => !allowed.has(key))
    || typeof result.ok !== 'boolean'
    || typeof result.status !== 'string'
    || result.jobId !== contract.jobId
    || result.fingerprint !== contract.fingerprint
    || result.preparedStatePath !== contract.statePath
    || result.publicationPerformed !== false
    || result.reuploaded !== false) {
    fail('DOUYIN_INPUT_MISSING_RESULT_PAYLOAD_REJECTED');
  }
  let fd;
  try {
    fd = fs.openSync(contract.resultPath, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(result));
    fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    throw error;
  }
  fs.closeSync(fd);
  return contract.resultPath;
}

export function cleanupDouyinInputMissingResumeContext(context) {
  if (context?.directory) fs.rmSync(context.directory, { recursive: true, force: true });
}
