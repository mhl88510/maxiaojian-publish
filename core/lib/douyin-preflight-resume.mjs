import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { readPackage } from './content-package.mjs';
import { resolveSchoolAccountBinding, schoolAccountStateRoot } from './school-account.mjs';
import { buildIdentity } from '../v2/lib/identity.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const RECEIPT_KEYS = [
  'contentHash', 'fingerprintVersion', 'action', 'ok', 'code', 'evidence',
  'platform', 'accountKey', 'accountName', 'backend', 'at', 'publicReadbackVerified',
];
const EVIDENCE_KEYS = [
  'ok', 'matchedBy', 'expectedAccountKey', 'expectedAccountName', 'expectedAccountId',
  'conflictingAccountKeys', 'reason', 'pageLabel', 'url',
];
const PIN_FIELDS = [
  'platform', 'accountKey', 'accountId', 'apiUid', 'accountName', 'taskSpaceId',
  'taskSpaceName', 'pageLabel', 'targetId', 'persistentProfile', 'egoProfileId',
];
const IDENTITY_URL = 'https://creator.douyin.com/creator-micro/content/upload';

function sameKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function regularFile(filePath, code = 'DOUYIN_PREFLIGHT_FILE_INVALID') {
  let stat;
  try { stat = fs.lstatSync(filePath); } catch { fail(code); }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code);
  return stat;
}

function existingPath(filePath) {
  try { return fs.lstatSync(filePath); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function assertDouyinPinnedBinding(target, matrix) {
  if (target?.platform !== 'douyin' || !target.accountKey) fail('DOUYIN_PREFLIGHT_SCOPE_REJECTED');
  let binding;
  let canonical;
  try {
    binding = resolveSchoolAccountBinding(target, matrix);
    canonical = resolveSchoolAccountBinding({ platform: 'douyin', accountKey: target.accountKey }, matrix);
  } catch { fail('DOUYIN_PREFLIGHT_BINDING_INVALID'); }
  const currentPin = Object.fromEntries(PIN_FIELDS.map(key => [key, binding[key] ?? '']));
  const canonicalPin = Object.fromEntries(PIN_FIELDS.map(key => [key, canonical[key] ?? '']));
  if (!sameJson(currentPin, canonicalPin)
      || !binding.accountId || !/^[0-9]+$/.test(binding.apiUid || '')
      || !binding.accountName || !binding.egoProfileId || !binding.targetId
      || !binding.taskSpaceId || !binding.taskSpaceName || !binding.pageLabel || !binding.persistentProfile) {
    fail('DOUYIN_PREFLIGHT_BINDING_NOT_PINNED');
  }
  return binding;
}

function assertSourceTargetMatchesPin(source, binding) {
  const target = source?.schoolAccount;
  if (target?.platform !== 'douyin' || target?.accountKey !== binding.accountKey) fail('DOUYIN_PREFLIGHT_SOURCE_TARGET_MISMATCH');
  const fields = {
    accountId: binding.accountId,
    apiUid: binding.apiUid,
    accountName: binding.accountName,
    taskSpaceId: binding.taskSpaceId,
    taskSpaceName: binding.taskSpaceName,
    pageLabel: binding.pageLabel,
    targetId: binding.targetId,
    profileId: binding.egoProfileId,
    egoProfileId: binding.egoProfileId,
    profile: binding.persistentProfile,
  };
  for (const record of [target, target.ego || {}]) {
    for (const [key, expected] of Object.entries(fields)) {
      if (Object.prototype.hasOwnProperty.call(record, key)
          && String(record[key]) !== String(expected)) fail('DOUYIN_PREFLIGHT_SOURCE_PIN_MISMATCH');
    }
  }
}

function assertNativePathUnstarted(nativePath, { allowOrchestratorLock = false } = {}) {
  if (existingPath(nativePath)) fail('DOUYIN_PREFLIGHT_NATIVE_JOB_PRESENT');
  const jobDir = path.dirname(nativePath);
  const stat = existingPath(jobDir);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('DOUYIN_PREFLIGHT_NATIVE_JOB_PATH_INVALID');
  const names = fs.readdirSync(jobDir);
  if (names.some(name => /^school-final-|^final-submit|receipt-checkpoint|state(?:\.backup)?\.json/.test(name))) {
    fail('DOUYIN_PREFLIGHT_FINAL_OR_UNKNOWN_MARKER');
  }
  if (names.length && !(allowOrchestratorLock && names.length === 1 && names[0] === 'orchestrator.lock')) {
    fail('DOUYIN_PREFLIGHT_NATIVE_JOB_ACTIVITY_PRESENT');
  }
  if (allowOrchestratorLock && names[0] === 'orchestrator.lock') {
    const lockPath = path.join(jobDir, 'orchestrator.lock');
    const lockStat = existingPath(lockPath);
    if (!lockStat?.isDirectory() || lockStat.isSymbolicLink()) fail('DOUYIN_PREFLIGHT_NATIVE_LOCK_INVALID');
    const lockNames = fs.readdirSync(lockPath);
    if (lockNames.some(name => name !== 'owner.json' && name !== 'members')) fail('DOUYIN_PREFLIGHT_NATIVE_LOCK_UNKNOWN');
  }
}

function assertNoOuterResumeArtifacts(statePath, ownClaimPath = '') {
  const directory = path.dirname(statePath);
  const basename = path.basename(statePath);
  if (fs.readdirSync(directory).some(name => name.startsWith(`${basename}.resume-result.json`))) {
    fail('DOUYIN_PREFLIGHT_ALREADY_RESUMED');
  }
  const claimPath = `${statePath}.resume-claim`;
  if (claimPath !== ownClaimPath && existingPath(claimPath)) fail('DOUYIN_PREFLIGHT_ALREADY_CLAIMED');
}

function readOuterReceipt(statePath, expected, binding) {
  regularFile(statePath);
  const priorRaw = fs.readFileSync(statePath, 'utf8');
  let receipt;
  try { receipt = JSON.parse(priorRaw); } catch { fail('DOUYIN_PREFLIGHT_RECEIPT_INVALID'); }
  if (!sameKeys(receipt, RECEIPT_KEYS)
      || receipt.contentHash !== expected.contentHash
      || receipt.fingerprintVersion !== 2
      || receipt.action !== 'draft'
      || receipt.ok !== false
      || receipt.code !== 'ACCOUNT_IDENTITY_UNVERIFIED'
      || receipt.platform !== 'douyin'
      || receipt.accountKey !== binding.accountKey
      || receipt.accountName !== binding.accountName
      || receipt.backend !== 'ego_video'
      || typeof receipt.at !== 'string' || !Number.isFinite(Date.parse(receipt.at))
      || receipt.publicReadbackVerified !== false) fail('DOUYIN_PREFLIGHT_RECEIPT_NOT_EXACT');
  const evidence = receipt.evidence;
  if (!sameKeys(evidence, EVIDENCE_KEYS)
      || evidence.ok !== false
      || !Array.isArray(evidence.matchedBy) || evidence.matchedBy.length !== 0
      || evidence.expectedAccountKey !== binding.accountKey
      || evidence.expectedAccountName !== binding.accountName
      || String(evidence.expectedAccountId || '') !== binding.accountId
      || !Array.isArray(evidence.conflictingAccountKeys) || evidence.conflictingAccountKeys.length !== 0
      || evidence.reason !== 'account_identity_not_visible_in_page_header'
      || evidence.pageLabel !== binding.pageLabel
      || evidence.url !== IDENTITY_URL) fail('DOUYIN_PREFLIGHT_IDENTITY_FAILURE_NOT_EXACT');
  return { priorRaw, priorReceipt: receipt, receiptSha256: sha(priorRaw) };
}

function twoPassPackageIdentity(sourcePath, binding) {
  const first = readPackage(sourcePath);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-preflight-resume-'));
  try {
    const normalizedPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(normalizedPath, JSON.stringify({ ...first, schoolAccount: binding }), { mode: 0o600 });
    return readPackage(normalizedPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertIdentityFilesAreRegular(identity) {
  for (const filePath of [identity.video?.path, ...(identity.assets || []).map(asset => asset.path)]) {
    if (!filePath) fail('DOUYIN_PREFLIGHT_ASSET_IDENTITY_INVALID');
    regularFile(filePath, 'DOUYIN_PREFLIGHT_ASSET_INVALID');
  }
}

function assertOuterScope(pkg, options, stateBase, fingerprintPackage, matrix) {
  const target = pkg?.schoolAccount || {};
  const binding = assertDouyinPinnedBinding(target, matrix);
  if (pkg.backend !== 'ego_video'
      || options.action !== 'draft'
      || options.executeWrites !== true
      || options.preparedState
      || !options.resumePreflightReceipt
      || typeof fingerprintPackage !== 'function') fail('DOUYIN_PREFLIGHT_SCOPE_REJECTED');
  const sourcePath = path.resolve(options.file || '');
  if (!sourcePath || sourcePath === path.resolve('.')) fail('DOUYIN_PREFLIGHT_SOURCE_PATH_INVALID');
  regularFile(sourcePath, 'DOUYIN_PREFLIGHT_SOURCE_INVALID');
  let source;
  try { source = JSON.parse(fs.readFileSync(sourcePath, 'utf8')); } catch { fail('DOUYIN_PREFLIGHT_SOURCE_INVALID'); }
  if (source?.backend !== 'ego_video') fail('DOUYIN_PREFLIGHT_SOURCE_BACKEND_MISMATCH');
  assertSourceTargetMatchesPin(source, binding);
  let packageHash;
  try { packageHash = fingerprintPackage(pkg).contentHash; } catch { fail('DOUYIN_PREFLIGHT_PACKAGE_HASH_FAILED'); }
  let sourceHash;
  try { sourceHash = fingerprintPackage(source).contentHash; } catch { fail('DOUYIN_PREFLIGHT_SOURCE_HASH_FAILED'); }
  if (!packageHash || packageHash !== sourceHash) fail('DOUYIN_PREFLIGHT_PACKAGE_SOURCE_MISMATCH');
  const expectedReceipt = path.resolve(
    stateBase,
    'douyin',
    binding.accountKey,
    `draft-v2-${packageHash}.json`,
  );
  const receiptPath = path.resolve(options.resumePreflightReceipt);
  if (receiptPath !== expectedReceipt) fail('DOUYIN_PREFLIGHT_RECEIPT_PATH_MISMATCH');
  return { binding, sourcePath, source, contentHash: packageHash, receiptPath };
}

async function inspectContext(pkg, options, stateBase, fingerprintPackage, matrix, {
  nativeStateBase = path.join(os.homedir(), '.maxiaojian-publish', 'school-accounts'),
  ownClaimPath = '',
  expected = null,
  requireUnstarted = true,
} = {}) {
  const base = assertOuterScope(pkg, options, stateBase, fingerprintPackage, matrix);
  const sourceBytes = fs.readFileSync(base.sourcePath);
  const sourceSha256 = sha(sourceBytes);
  const receipt = readOuterReceipt(base.receiptPath, { contentHash: base.contentHash }, base.binding);
  assertNoOuterResumeArtifacts(base.receiptPath, ownClaimPath);
  const normalized = twoPassPackageIdentity(base.sourcePath, base.binding);
  const identity = await buildIdentity(normalized);
  assertIdentityFilesAreRegular(identity);
  if (expected && (expected.sourceSha256 !== sourceSha256
      || expected.contentHash !== base.contentHash
      || expected.fingerprint !== identity.fingerprint
      || !sameJson(expected.video || expected.identity?.video, identity.video)
      || !sameJson(expected.assets || expected.identity?.assets, identity.assets)
      || expected.receiptSha256 !== receipt.receiptSha256)) fail('DOUYIN_PREFLIGHT_LOCKED_INPUT_CHANGED');
  const nativeRoot = schoolAccountStateRoot(nativeStateBase, base.binding);
  const jobId = identity.fingerprint.slice(0, 16);
  const nativePath = path.join(nativeRoot, jobId, 'state.json');
  if (requireUnstarted) assertNativePathUnstarted(nativePath);
  else assertNativePathUnstarted(nativePath, { allowOrchestratorLock: true });
  return {
    ...base,
    stateBase: path.resolve(stateBase),
    priorRaw: receipt.priorRaw,
    priorReceipt: receipt.priorReceipt,
    receiptSha256: receipt.receiptSha256,
    sourceSha256,
    nativeStateBase: path.resolve(nativeStateBase),
    nativeRoot,
    nativePath,
    identity,
    fingerprint: identity.fingerprint,
    jobId,
  };
}

export async function prepareDouyinPristinePreflightResume(pkg, options, stateBase, fingerprintPackage, matrix, config = {}) {
  const context = await inspectContext(pkg, options, stateBase, fingerprintPackage, matrix, config);
  const resultPath = `${context.receiptPath}.resume-result.json`;
  const claimPath = `${context.receiptPath}.resume-claim`;
  if (existingPath(resultPath)) fail('DOUYIN_PREFLIGHT_ALREADY_RESUMED');
  if (existingPath(claimPath)) fail('DOUYIN_PREFLIGHT_ALREADY_CLAIMED');
  return {
    statePath: context.receiptPath,
    priorRaw: context.priorRaw,
    priorReceipt: context.priorReceipt,
    contentHash: context.contentHash,
    sourcePath: context.sourcePath,
    sourceSha256: context.sourceSha256,
    binding: context.binding,
    stateBase: context.stateBase,
    nativeStateBase: context.nativeStateBase,
    nativeRoot: context.nativeRoot,
    nativePath: context.nativePath,
    nativeSha: '',
    fingerprint: context.fingerprint,
    jobId: context.jobId,
    video: context.identity.video,
    assets: context.identity.assets,
    receiptSha256: context.receiptSha256,
    mode: 'identity_preflight',
  };
}

export async function claimDouyinPristinePreflightResume(pkg, options, stateBase, fingerprintPackage, matrix, config = {}) {
  const context = await inspectContext(pkg, options, stateBase, fingerprintPackage, matrix, config);
  const resumeResultPath = `${context.receiptPath}.resume-result.json`;
  const claimPath = `${context.receiptPath}.resume-claim`;
  if (existingPath(resumeResultPath)) fail('DOUYIN_PREFLIGHT_ALREADY_RESUMED');
  const claimToken = crypto.randomBytes(16).toString('hex');
  let fd;
  try {
    fd = fs.openSync(claimPath, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({
      token: claimToken,
      contentHash: context.contentHash,
      platform: 'douyin',
      accountKey: context.binding.accountKey,
      action: 'draft',
      at: new Date().toISOString(),
    }));
    fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    if (error?.code === 'EEXIST') fail('DOUYIN_PREFLIGHT_ALREADY_CLAIMED');
    try { fs.unlinkSync(claimPath); } catch {}
    throw error;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
  try {
    await inspectContext(pkg, options, stateBase, fingerprintPackage, matrix, {
      ...config,
      ownClaimPath: claimPath,
      expected: context,
    });
    const currentClaim = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
    if (currentClaim.token !== claimToken
        || currentClaim.contentHash !== context.contentHash
        || currentClaim.platform !== 'douyin'
        || currentClaim.accountKey !== context.binding.accountKey
        || currentClaim.action !== 'draft') fail('DOUYIN_PREFLIGHT_CLAIM_CHANGED');
  } catch (error) {
    try {
      const currentClaim = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
      if (currentClaim.token === claimToken) fs.unlinkSync(claimPath);
    } catch {}
    throw error;
  }
  const contract = {
    version: 1,
    mode: 'identity_preflight',
    platform: 'douyin',
    action: 'draft',
    binding: context.binding,
    stateBase: context.stateBase,
    contentHash: context.contentHash,
    sourcePath: context.sourcePath,
    sourceSha256: context.sourceSha256,
    receiptPath: context.receiptPath,
    receiptSha256: context.receiptSha256,
    claimPath,
    claimToken,
    nativeStateBase: context.nativeStateBase,
    nativeRoot: context.nativeRoot,
    nativePath: context.nativePath,
    fingerprint: context.fingerprint,
    jobId: context.jobId,
    video: context.identity.video,
    assets: context.identity.assets,
  };
  return {
    statePath: context.receiptPath,
    resumeResultPath,
    claimPath,
    claimToken,
    contentHash: context.contentHash,
    action: 'draft',
    fingerprintVersion: 2,
    resume: true,
    priorReceipt: context.priorReceipt,
    priorRaw: context.priorRaw,
    binding: context.binding,
    stateBase: context.stateBase,
    sourcePath: context.sourcePath,
    sourceSha256: context.sourceSha256,
    nativeStateBase: context.nativeStateBase,
    nativePath: context.nativePath,
    nativeSha: '',
    fingerprint: context.fingerprint,
    jobId: context.jobId,
    douyinPreflightContract: contract,
  };
}

export async function assertDouyinPristinePreflightResumeContract(contract, pkg, identity, args, stateExisted, {
  fingerprintPackage,
  binding = pkg?.schoolAccount,
  nativeStateBase = contract?.nativeStateBase,
  allowOrchestratorLock = false,
} = {}) {
  if (contract?.version !== 1
      || contract.mode !== 'identity_preflight'
      || contract.platform !== 'douyin'
      || contract.action !== 'draft'
      || !binding
      || !contract.binding?.accountKey
      || !/^[a-f0-9]{64}$/.test(contract.contentHash || '')
      || !contract.stateBase
      || !contract.nativeRoot
      || !contract.nativePath
      || !contract.sourcePath
      || !contract.receiptPath
      || !contract.claimPath
      || !contract.claimToken
      || !sameJson(Object.fromEntries(PIN_FIELDS.map(key => [key, binding[key] ?? ''])),
        Object.fromEntries(PIN_FIELDS.map(key => [key, contract.binding?.[key] ?? ''])))
      || (pkg?.backend !== 'ego_video')
      || !sameJson(Object.fromEntries(PIN_FIELDS.map(key => [key, pkg?.schoolAccount?.[key] ?? ''])),
        Object.fromEntries(PIN_FIELDS.map(key => [key, contract.binding?.[key] ?? ''])))
      || args?.platforms?.length !== 1
      || args.platforms[0] !== 'douyin'
      || args.operation !== 'auto'
      || args.inspectOnly
      || args.jobId !== contract.jobId
      || path.resolve(args.stateRoot || '') !== contract.nativeRoot
      || stateExisted !== false
      || !identity
      || typeof identity.fingerprint !== 'string'
      || identity.fingerprint !== contract.fingerprint
      || identity.fingerprint.slice(0, 16) !== contract.jobId
      || path.resolve(contract.nativePath) !== path.join(contract.nativeRoot, contract.jobId, 'state.json')
      || path.resolve(contract.receiptPath) !== path.resolve(contract.stateBase, 'douyin', contract.binding?.accountKey || '', `draft-v2-${contract.contentHash}.json`)) fail('DOUYIN_PREFLIGHT_LOCKED_SCOPE_MISMATCH');
  if (nativeStateBase && schoolAccountStateRoot(nativeStateBase, contract.binding) !== contract.nativeRoot) fail('DOUYIN_PREFLIGHT_LOCKED_SCOPE_MISMATCH');
  regularFile(contract.sourcePath, 'DOUYIN_PREFLIGHT_SOURCE_INVALID');
  regularFile(contract.receiptPath);
  regularFile(contract.claimPath, 'DOUYIN_PREFLIGHT_CLAIM_INVALID');
  const sourceBytes = fs.readFileSync(contract.sourcePath);
  const sourceRaw = sourceBytes.toString('utf8');
  let source;
  try { source = JSON.parse(sourceRaw); } catch { fail('DOUYIN_PREFLIGHT_SOURCE_INVALID'); }
  if (sha(sourceBytes) !== contract.sourceSha256
      || (typeof fingerprintPackage === 'function' && fingerprintPackage(source).contentHash !== contract.contentHash)) fail('DOUYIN_PREFLIGHT_LOCKED_INPUT_CHANGED');
  const receiptRaw = fs.readFileSync(contract.receiptPath, 'utf8');
  if (sha(receiptRaw) !== contract.receiptSha256
      || fs.existsSync(contract.resumeResultPath || `${contract.receiptPath}.resume-result.json`)) fail('DOUYIN_PREFLIGHT_LOCKED_RECEIPT_CHANGED');
  const claim = JSON.parse(fs.readFileSync(contract.claimPath, 'utf8'));
  if (claim.token !== contract.claimToken
      || claim.contentHash !== contract.contentHash
      || claim.platform !== 'douyin'
      || claim.accountKey !== contract.binding.accountKey
      || claim.action !== 'draft') fail('DOUYIN_PREFLIGHT_CLAIM_CHANGED');
  const expectedIdentity = await buildIdentity(twoPassPackageIdentity(contract.sourcePath, contract.binding));
  assertIdentityFilesAreRegular(expectedIdentity);
  if (expectedIdentity.fingerprint !== contract.fingerprint
      || identity.fingerprint !== expectedIdentity.fingerprint
      || !sameJson(expectedIdentity.video, contract.video)
      || !sameJson(expectedIdentity.assets, contract.assets)
      || !sameJson(identity.video, expectedIdentity.video)
      || !sameJson(identity.assets, expectedIdentity.assets)) fail('DOUYIN_PREFLIGHT_LOCKED_ASSETS_CHANGED');
  assertNativePathUnstarted(contract.nativePath, { allowOrchestratorLock });
  return true;
}

export function releaseDouyinPristinePreflightResumeClaim(reservation) {
  try {
    const claim = JSON.parse(fs.readFileSync(reservation.claimPath, 'utf8'));
    if (claim.token === reservation.claimToken) fs.unlinkSync(reservation.claimPath);
  } catch {}
}
