#!/usr/bin/env node
import {isPersonalExistingVideoContract,assertPersonalExistingVideoContract,readPersonalExistingVideoExecutionPackage,validatePersonalExistingVideoIdentity} from '../lib/douyin-personal-existing-video-resume.mjs';
import {assertChannelsBlobLockedContract} from '../lib/channels-existing-blob-resume.mjs';
import {assertChannelsResumeContract} from '../lib/channels-preflight-resume.mjs';
import {assertDouyinPristinePreflightResumeContract} from '../lib/douyin-preflight-resume.mjs';
import {assertDouyinPreparationScopeResumeContract,DOUYIN_PREPARATION_SCOPE_RESUME_ENV} from '../lib/douyin-preparation-scope-resume.mjs';
import {assertDouyinInputMissingLockedContract,assertDouyinInputMissingBeforeUpload,DOUYIN_INPUT_MISSING_RESUME_TYPE} from '../lib/douyin-input-missing-resume.mjs';
import {assertDouyinPersonalInspectFailureResumeContract,assertDouyinPersonalInspectFailureFreshObservation,DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_ENV,DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_TYPE} from '../lib/douyin-personal-inspect-failure-resume.mjs';
import {assertDouyinPersonalPostResultDraftActiveFromFile,readDouyinPersonalPostResultExecutionPackage,assertDouyinPersonalPostResultDraftContinuationContract,assertDouyinPersonalPostResultDraftStateRoot,assertDouyinPersonalPostResultLockedInitPathFailureContinuationContract,assertDouyinPersonalPostResultDraftContinuationActive,assertDouyinPersonalPostResultDraftInspectionRunnerContract,assertDouyinPersonalPostResultDraftInspectionObservation,DOUYIN_PERSONAL_POST_RESULT_DRAFT_ENV,DOUYIN_PERSONAL_POST_RESULT_DRAFT_TYPE,DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_ENV,DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_TYPE} from '../lib/douyin-personal-post-result-recovery.mjs';
import {assertDouyinWindowBindingLockedContract,assertDouyinWindowBindingFreshProof,DOUYIN_WINDOW_BINDING_RESUME_TYPE,DOUYIN_WINDOW_BINDING_RESUME_ENV} from '../lib/douyin-window-binding-resume.mjs';
import {assertXhsEmptyInputState,assertXhsInjectedBodyState} from '../lib/xhs-empty-input-resume.mjs';
import {assertPermissionResumeState,hasPermissionUploadInterruption} from '../lib/video-draft-resume.mjs';
import {finalPublishClickStatus} from './lib/final-publish-click-evidence.mjs';
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  readPackage,
  validateBilibiliPackage,
  validateDouyinPackage,
  validateWechatChannelsPackage,
  validateXiaohongshuPackage,
  validateYoutubePackage,
} from "../lib/content-package.mjs";
import { loadConfig } from "../lib/config.mjs";
import { inspectMediaFile, validateMediaForPlatform } from "../lib/media.mjs";
import { buildIdentity } from "./lib/identity.mjs";
import { acquireJobLock, JobBusyError, resolvePublisherLockDirectory } from "./lib/job-lock.mjs";
import { JobStore } from "./lib/job-store.mjs";
import { BLOCKER, PLATFORMS, classifyVerdict, compactVerdict, evaluateObservation, videoReceiptFromObservation } from "./lib/model.mjs";
import { parseV2Result } from "./lib/result-line.mjs";
import { runPool, SerialQueue } from "./lib/scheduler.mjs";
import { parsePublisherArgs, uniqueSpaceSuffix } from "./lib/cli-args.mjs";
import {
  IN_PROGRESS_STATUSES,
  buildCleanupPlan,
  buildSpaceName,
  cleanupTaskSpaces,
  retireCurrentSpaces,
  shouldRotateSpaces,
} from "./lib/spaces.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.join(os.homedir(), ".maxiaojian-publish", "v2-jobs");
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const RIGHTS_PLATFORMS = new Set(["xiaohongshu", "bilibili", "wechat_channels"]);
const EARLY_PREFILL_PLATFORMS = new Set(["xiaohongshu", "douyin", "bilibili", "wechat_channels", "youtube"]);
const validators = {
  xiaohongshu: validateXiaohongshuPackage,
  douyin: validateDouyinPackage,
  bilibili: validateBilibiliPackage,
  wechat_channels: validateWechatChannelsPackage,
  youtube: validateYoutubePackage,
};

function stripDouyinWindowUid(value, expectedUid = "") {
  if (Array.isArray(value)) return value.map(item => stripDouyinWindowUid(item, expectedUid));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(?:uid|creatoruid|apiuid)$/i.test(key))
    .map(([key, child]) => [key, stripDouyinWindowUid(child, expectedUid)]));
  if (expectedUid && typeof value === "string" && value === expectedUid) return "[redacted]";
  return value;
}

function readWindowBindingExpectedUid(contract) {
  const pin = contract?.identitySafeFields;
  if (pin?.path !== "EXCLUDED_CASE_DATA"
    || pin.selector !== "identity.uid" || !/^[a-f0-9]{64}$/.test(pin.sha256 || "")) throw new UsageError("DOUYIN_WINDOW_BINDING_SAFE_IDENTITY_PIN_INVALID");
  const raw = fs.readFileSync(pin.path);
  if (crypto.createHash("sha256").update(raw).digest("hex") !== pin.sha256) throw new UsageError("DOUYIN_WINDOW_BINDING_SAFE_IDENTITY_HASH_CHANGED");
  const uid = JSON.parse(raw.toString("utf8"))?.identity?.uid;
  if (typeof uid !== "string" || !/^\d+$/.test(uid) || /^0+$/.test(uid)) throw new UsageError("DOUYIN_WINDOW_BINDING_SAFE_IDENTITY_INVALID");
  return uid;
}

function assertWindowBindingInspectObservation(observation, contract) {
  const editor = observation?.gates?.draftIdentity?.evidence || {};
  const video = observation?.gates?.video?.evidence || {};
  if (observation?.phase !== "inspect" || Number(observation?.taskSpaceId) !== contract.executionBinding.spaceId
    || observation?.taskSpace !== contract.executionBinding.spaceName || observation?.blocker
    || observation?.gates?.authenticated?.ok !== true || observation?.gates?.draftIdentity?.ok !== true
    || editor.empty !== true || editor.title !== "" || editor.editorText !== ""
    || observation?.gates?.video?.ok !== false || video.uploaded !== false || video.uploading !== false
    || video.failed !== false || video.resumeDialog !== false
    || observation?.gates?.noBlockingDialog?.ok !== true
    || !Array.isArray(observation.gates.noBlockingDialog.evidence?.active)
    || observation.gates.noBlockingDialog.evidence.active.length !== 0
    || observation?.gates?.safety?.ok !== true || observation.gates.safety.evidence?.guardArmed !== true
    || observation.gates.safety.evidence?.blockedAttempts !== 0) throw new UsageError("DOUYIN_WINDOW_BINDING_EMPTY_UPLOAD_INSPECT_REJECTED");
}

class UsageError extends Error {}
const activeLockReleases = [];
let publisherLockToken = "";
let jobLockToken = "";

function positive(raw, name) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new UsageError(`${name} must be a positive integer`);
  return value;
}

function parseArgs(argv) {
  return parsePublisherArgs(argv, {
    loadConfig,
    PLATFORMS,
    UsageError,
    positive,
    defaultStateRoot: DEFAULT_ROOT,
  });
}

function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function initialState(jobId, identity, args) {
  return {
    schemaVersion: 4,
    jobId,
    fingerprint: identity.fingerprint,
    contentFingerprint: identity.contentFingerprint,
    coverFingerprint: identity.coverFingerprint,
    coverFingerprints: identity.coverFingerprints,
    cover: identity.cover,
    packagePath: args.packagePath,
    taskSuffix: args.taskSuffix,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "new",
    scheduler: { checkConcurrency: args.checkConcurrency, uploadConcurrency: args.uploadConcurrency, uiConcurrency: 1 },
    video: identity.video,
    assets: identity.assets,
    revisions: [{ at: new Date().toISOString(), operation: args.operation, fingerprint: identity.fingerprint, packagePath: args.packagePath }],
    platforms: Object.fromEntries(args.platforms.map(platform => [platform, { status: "new", taskSpaceId: null, taskSpaceName: null, videoReceipt: null, receipts: {}, verdict: null, history: [] }])),
  };
}

function sameVideo(left, right) {
  return left?.size === right?.size && left?.sha256 === right?.sha256;
}

async function resolveStoredIdentity(state) {
  if (state.contentFingerprint && state.coverFingerprints) return state;
  if (!state.packagePath || !fs.existsSync(state.packagePath)) return null;
  const storedPackage = readPackage(state.packagePath);
  const storedIdentity = await buildIdentity(storedPackage);
  return [storedIdentity.fingerprint, storedIdentity.previousFingerprint, storedIdentity.legacyFingerprint].includes(state.fingerprint) ? storedIdentity : null;
}

async function prepareCoverReplacement(store, state, identity, args) {
  if (state.status !== "ready") throw new UsageError(`replace-cover requires a READY draft; current status is ${state.status || "unknown"}`);
  if (identity.cover?.uploadCustomCover !== true) throw new UsageError("replace-cover requires cover.uploadCustomCover=true and explicit replacement files");
  const storedIdentity = await resolveStoredIdentity(state);
  if (!storedIdentity?.contentFingerprint || !storedIdentity?.coverFingerprints) {
    throw new UsageError("This legacy job cannot prove its original content identity. Create a fresh verified draft before using replace-cover.");
  }
  if (!sameVideo(state.video || storedIdentity.video, identity.video)) {
    throw new UsageError("replace-cover cannot change the video file");
  }
  if (storedIdentity.contentFingerprint !== identity.contentFingerprint) {
    throw new UsageError("replace-cover may change only cover settings and cover files; title, description, tags, video, and other metadata must stay unchanged");
  }
  const affectedPlatforms = Object.keys(identity.coverFingerprints)
    .filter(platform => storedIdentity.coverFingerprints[platform] !== identity.coverFingerprints[platform]);
  if (!affectedPlatforms.length) throw new UsageError("replace-cover found no changed cover asset");
  const missingTargets = affectedPlatforms.filter(platform => state.platforms[platform] && !args.platforms.includes(platform));
  if (missingTargets.length) {
    throw new UsageError(`replace-cover must include every existing draft whose cover changed: ${missingTargets.join(", ")}`);
  }
  for (const platform of args.platforms) {
    if (!state.platforms[platform]) throw new UsageError(`replace-cover cannot target a platform absent from this job: ${platform}`);
    if (!affectedPlatforms.includes(platform)) throw new UsageError(`replace-cover cover is unchanged for: ${platform}`);
    const item = state.platforms[platform];
    if (!item.taskSpaceId && !item.taskSpaceName) throw new UsageError(`replace-cover has no recorded Ego draft space for: ${platform}`);
  }
  const previous = { at: new Date().toISOString(), operation: "replace-cover", from: state.fingerprint, to: identity.fingerprint, packagePath: args.packagePath, platforms: args.platforms };
  state.schemaVersion = 4;
  state.fingerprint = identity.fingerprint;
  state.contentFingerprint = identity.contentFingerprint;
  state.coverFingerprint = identity.coverFingerprint;
  state.coverFingerprints = identity.coverFingerprints;
  state.cover = identity.cover;
  state.packagePath = args.packagePath;
  state.video = identity.video;
  state.assets = identity.assets;
  state.revisions ||= [];
  state.revisions.push(previous);
  if (state.revisions.length > 20) state.revisions = state.revisions.slice(-20);
  for (const [platform, item] of Object.entries(state.platforms)) {
    if (item.videoReceipt) item.videoReceipt = { ...item.videoReceipt, fingerprint: identity.fingerprint };
    item.receipts ||= {};
    if (item.receipts.uploadStart?.fingerprint) {
      item.receipts.uploadStart = { ...item.receipts.uploadStart, fingerprint: identity.fingerprint };
    }
    await store.clearReceiptCheckpoint(platform);
  }
  for (const platform of args.platforms) {
    const item = state.platforms[platform];
    delete item.receipts.cover;
    item.verdict = null;
    item.status = "needs_mutation";
  }
  args.freshSpace = false;
  args.forceFreshSpace = false;
  await store.save();
}

async function migrateLegacyIdentity(store, state, identity, args) {
  if (![identity.previousFingerprint, identity.legacyFingerprint].includes(state.fingerprint) || state.fingerprint === identity.fingerprint) return;
  const previousFingerprint = state.fingerprint;
  state.schemaVersion = 4;
  state.fingerprint = identity.fingerprint;
  state.contentFingerprint = identity.contentFingerprint;
  state.coverFingerprint = identity.coverFingerprint;
  state.coverFingerprints = identity.coverFingerprints;
  state.cover = identity.cover;
  state.packagePath = args.packagePath;
  state.video = identity.video;
  state.assets = identity.assets;
  state.revisions ||= [];
  state.revisions.push({ at: new Date().toISOString(), operation: "identity-migration", from: previousFingerprint, to: identity.fingerprint, packagePath: args.packagePath });
  for (const [platform, item] of Object.entries(state.platforms || {})) {
    if (item.videoReceipt) item.videoReceipt = { ...item.videoReceipt, fingerprint: identity.fingerprint };
    item.receipts ||= {};
    if (item.receipts.uploadStart?.fingerprint) item.receipts.uploadStart = { ...item.receipts.uploadStart, fingerprint: identity.fingerprint };
    if (platform === "youtube" && previousFingerprint === identity.legacyFingerprint && identity.cover?.uploadCustomCover === true) {
      delete item.receipts.cover;
      item.verdict = null;
      item.status = "needs_mutation";
      state.status = "blocked";
    }
    await store.clearReceiptCheckpoint(platform);
  }
  await store.save();
}

async function persistKeepSpace(store, state, args, closeCurrent) {
  if (args.keepSpace) state.keepSpace = true;
  else if (closeCurrent) state.keepSpace = false;
  await store.save();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.cleanupOnly) {
    let state = { jobId: args.jobId || "", platforms: {}, retiredSpaces: [] };
    let statePath = "";
    if (args.packagePath) {
      if (!fs.existsSync(args.packagePath)) throw new Error(`Package JSON not found: ${args.packagePath}`);
      const pkg = readPackage(args.packagePath);
      const identity = await buildIdentity(pkg);
      const jobId = args.jobId || identity.fingerprint.slice(0, 16);
      const jobDir = path.join(args.stateRoot, jobId);
      const release = acquireJobLock(jobDir, { jobId, packagePath: args.packagePath });
      try {
        const store = new JobStore(jobDir, initialState(jobId, identity, args));
        state = await store.initialize();
        statePath = store.statePath;
        const inProgress = IN_PROGRESS_STATUSES.includes(state.status);
        const plan = await maybeCleanupSpaces(args, state, {
          complete: !inProgress,
          userControl: false,
          incomingInProgress: inProgress,
        });
        if (plan?.closeCurrent) state.keepSpace = false;
        await store.save();
        await store.close();
      } finally {
        release();
      }
    } else {
      await maybeCleanupSpaces(args, state, { complete: false, userControl: false, incomingInProgress: false });
    }
    console.log(JSON.stringify({ ok: true, cleanupOnly: true, jobId: state.jobId || "", statePath, stateRoot: args.stateRoot }, null, 2));
    return;
  }
  if (!fs.existsSync(args.packagePath)) throw new Error(`Package JSON not found: ${args.packagePath}`);
  const pkg = readPackage(args.packagePath);
  const media = inspectMediaFile(pkg.videoPath);
  const preflightErrors = Object.fromEntries(args.platforms.map(platform => [platform, [
    ...validators[platform](pkg),
    ...validateMediaForPlatform(pkg, platform, media),
  ]]));
  const runnablePlatforms = args.platforms.filter(platform => preflightErrors[platform].length === 0);
  if (!runnablePlatforms.length) {
    throw new Error(args.platforms
      .map(platform => `Package preflight failed for ${platform}: ${preflightErrors[platform].join("; ")}`)
      .join("\n"));
  }
  const rightsTargets = runnablePlatforms.filter(platform => RIGHTS_PLATFORMS.has(platform));
  const standingOriginalityPolicy = args.originalityPolicy === "all_videos_original";
  if (!args.inspectOnly && rightsTargets.length && !standingOriginalityPolicy && !args.originalRightsConfirmed) {
    throw new UsageError(`Originality confirmation is required before browser mutation for: ${rightsTargets.join(", ")}. Complete onboarding with declarations.originalityPolicy=all_videos_original, or confirm this run and add --confirm-original-rights.`);
  }
  const personalExistingNativeContract=JSON.parse(process.env.VIDEO_PUBLISHER_NATIVE_RECOVERY||'null');
  const personalExistingActive=isPersonalExistingVideoContract(personalExistingNativeContract);
  const identityPackage = personalExistingActive ? readPersonalExistingVideoExecutionPackage(args.packagePath,personalExistingNativeContract) : Object.hasOwn(process.env, DOUYIN_PERSONAL_POST_RESULT_DRAFT_ENV)
    ? readDouyinPersonalPostResultExecutionPackage(args.packagePath)
    : pkg;
  const identity = await buildIdentity(identityPackage);
  if(personalExistingActive){
    await validatePersonalExistingVideoIdentity(identity,personalExistingNativeContract);
    if(args.operation!=="resume"||args.jobId!==personalExistingNativeContract.jobId||args.platforms.length!==1||args.platforms[0]!=="douyin"||path.join(args.stateRoot,args.jobId,"state.json")!==personalExistingNativeContract.statePath||args.taskSuffix!=="school-reserved_personal_route"||args.spaceName!==personalExistingNativeContract.binding.taskSpaceName||args.inspectOnly)throw new UsageError("PERSONAL_EXISTING_RUNNER_SCOPE_INVALID");
  }
  const jobId = args.jobId || (args.operation === "repost"
    ? `${identity.fingerprint.slice(0, 12)}-${uniqueSpaceSuffix()}`
    : identity.fingerprint.slice(0, 16));
  const jobDir = path.join(args.stateRoot, jobId);
  const stateExisted = fs.existsSync(path.join(jobDir, "state.json"));
  if (args.operation === "replace-cover" && !stateExisted) throw new UsageError(`replace-cover job does not exist: ${jobId}`);
  if (["resume"].includes(args.operation) && !stateExisted) throw new UsageError(`${args.operation} requires an existing job: ${jobId}`);
  if (["create", "repost"].includes(args.operation) && stateExisted) throw new UsageError(`${args.operation} requires a new job id; job already exists: ${jobId}`);
  const publisherRelease = acquireJobLock(resolvePublisherLockDirectory(), {
    jobId,
    packagePath: args.packagePath,
    scope: "publisher",
  });
  publisherLockToken = publisherRelease.token;
  activeLockReleases.push(publisherRelease);
  const jobRelease = acquireJobLock(jobDir, { jobId, packagePath: args.packagePath });
  jobLockToken = jobRelease.token;
  activeLockReleases.push(jobRelease);
  let douyinPreparationScopeResumeContract = null;
  if (Object.hasOwn(process.env, DOUYIN_PREPARATION_SCOPE_RESUME_ENV)) {
    const raw = process.env[DOUYIN_PREPARATION_SCOPE_RESUME_ENV];
    if (typeof raw !== "string" || !raw || raw.length > 262144) throw new UsageError("DOUYIN_SCOPE_RESUME_CONTRACT_INVALID");
    try { douyinPreparationScopeResumeContract = JSON.parse(raw); }
    catch { throw new UsageError("DOUYIN_SCOPE_RESUME_CONTRACT_INVALID"); }
    if (!douyinPreparationScopeResumeContract || typeof douyinPreparationScopeResumeContract !== "object" || Array.isArray(douyinPreparationScopeResumeContract)) {
      throw new UsageError("DOUYIN_SCOPE_RESUME_CONTRACT_INVALID");
    }
    if (args.platforms.length !== 1 || args.platforms[0] !== "douyin" || args.operation !== "resume"
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_NATIVE_RECOVERY")
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_DOUYIN_PREFLIGHT_RESUME")
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_CHANNELS_PREFLIGHT_RESUME")
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY")
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_EMPTY_INPUT_RESUME")) {
      throw new UsageError("DOUYIN_SCOPE_RESUME_MUTUALLY_EXCLUSIVE_REQUIRED");
    }
    try {
      await assertDouyinPreparationScopeResumeContract(
        douyinPreparationScopeResumeContract, pkg, identity, args, stateExisted, { stage: "init" },
      );
    } catch (error) {
      const failure = new UsageError(error?.code || "DOUYIN_SCOPE_RESUME_INIT_ASSERTION_FAILED");
      failure.douyinPreparationFailure = {
        stage: "init",
        code: String(error?.code || error?.message || "DOUYIN_SCOPE_RESUME_INIT_ASSERTION_FAILED").slice(0, 120),
        reason: String(error?.message || "DOUYIN_SCOPE_RESUME_INIT_ASSERTION_FAILED").slice(0, 400),
      };
      throw failure;
    }
  }
  let douyinInputMissingResumeContract=null;
  if(Object.hasOwn(process.env,'VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME')){
    const raw=process.env.VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME;
    if(typeof raw!=='string'||!raw||raw.length>262144)throw new UsageError('DOUYIN_INPUT_MISSING_CONTRACT_INVALID');
    try{douyinInputMissingResumeContract=JSON.parse(raw);}catch{throw new UsageError('DOUYIN_INPUT_MISSING_CONTRACT_INVALID');}
    if(!douyinInputMissingResumeContract||typeof douyinInputMissingResumeContract!=='object'||Array.isArray(douyinInputMissingResumeContract)||douyinInputMissingResumeContract.resumeType!==DOUYIN_INPUT_MISSING_RESUME_TYPE)throw new UsageError('DOUYIN_INPUT_MISSING_CONTRACT_INVALID');
    if(args.platforms.length!==1||args.platforms[0]!=='douyin'||args.operation!=='resume'
      ||Object.hasOwn(process.env,DOUYIN_PREPARATION_SCOPE_RESUME_ENV)
      ||Object.hasOwn(process.env,'VIDEO_PUBLISHER_NATIVE_RECOVERY')
      ||Object.hasOwn(process.env,'VIDEO_PUBLISHER_DOUYIN_PREFLIGHT_RESUME')
      ||Object.hasOwn(process.env,'VIDEO_PUBLISHER_CHANNELS_PREFLIGHT_RESUME')
      ||Object.hasOwn(process.env,'VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY')
      ||Object.hasOwn(process.env,'VIDEO_PUBLISHER_EMPTY_INPUT_RESUME'))throw new UsageError('DOUYIN_INPUT_MISSING_MUTUALLY_EXCLUSIVE_REQUIRED');
    try{
      const statePath=path.join(jobDir,'state.json');
      const lockedState=JSON.parse(await fs.promises.readFile(statePath,'utf8'));
      await assertDouyinInputMissingLockedContract(douyinInputMissingResumeContract,pkg,identity,args,lockedState,statePath,pkg.schoolAccount);
    }catch(error){
      const failure=new UsageError(error?.code||'DOUYIN_INPUT_MISSING_LOCKED_CONTRACT_MISMATCH');
      failure.douyinPreparationFailure={stage:'init',code:String(error?.code||error?.message||'DOUYIN_INPUT_MISSING_LOCKED_CONTRACT_MISMATCH').slice(0,120),reason:String(error?.message||'DOUYIN_INPUT_MISSING_LOCKED_CONTRACT_MISMATCH').slice(0,400)};
      throw failure;
    }
  }
  let douyinWindowBindingResumeContract = null;
  let douyinWindowExpectedUid = "";
  let douyinWindowLockedInitObservation = null;
  if (Object.hasOwn(process.env, DOUYIN_WINDOW_BINDING_RESUME_ENV)) {
    const raw = process.env[DOUYIN_WINDOW_BINDING_RESUME_ENV];
    if (typeof raw !== "string" || !raw || raw.length > 262144) throw new UsageError("DOUYIN_WINDOW_BINDING_CONTRACT_INVALID");
    try { douyinWindowBindingResumeContract = JSON.parse(raw); }
    catch { throw new UsageError("DOUYIN_WINDOW_BINDING_CONTRACT_INVALID"); }
    if (!douyinWindowBindingResumeContract || typeof douyinWindowBindingResumeContract !== "object"
      || Array.isArray(douyinWindowBindingResumeContract)
      || douyinWindowBindingResumeContract.resumeType !== DOUYIN_WINDOW_BINDING_RESUME_TYPE
      || args.platforms.length !== 1 || args.platforms[0] !== "douyin" || args.operation !== "resume"
      || douyinWindowBindingResumeContract.jobId !== jobId
      || douyinWindowBindingResumeContract.fingerprint !== identity.fingerprint
      || Object.hasOwn(process.env, "VIDEO_PUBLISHER_NATIVE_RECOVERY")
      || Object.hasOwn(process.env, "VIDEO_PUBLISHER_DOUYIN_PREFLIGHT_RESUME")
      || Object.hasOwn(process.env, "VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME")
      || Object.hasOwn(process.env, DOUYIN_PREPARATION_SCOPE_RESUME_ENV)
      || Object.hasOwn(process.env, "VIDEO_PUBLISHER_CHANNELS_PREFLIGHT_RESUME")
      || Object.hasOwn(process.env, "VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY")
      || Object.hasOwn(process.env, "VIDEO_PUBLISHER_EMPTY_INPUT_RESUME")) {
      throw new UsageError("DOUYIN_WINDOW_BINDING_MUTUALLY_EXCLUSIVE_SCOPE_INVALID");
    }
  }
  let douyinPersonalInspectFailureResumeContract = null;
  if (Object.hasOwn(process.env, DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_ENV)) {
    const raw = process.env[DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_ENV];
    if (typeof raw !== "string" || !raw || raw.length > 262144) throw new UsageError("DOUYIN_PERSONAL_INSPECT_RESUME_CONTRACT_INVALID");
    try { douyinPersonalInspectFailureResumeContract = JSON.parse(raw); }
    catch { throw new UsageError("DOUYIN_PERSONAL_INSPECT_RESUME_CONTRACT_INVALID"); }
    if (!douyinPersonalInspectFailureResumeContract || typeof douyinPersonalInspectFailureResumeContract !== "object"
        || Array.isArray(douyinPersonalInspectFailureResumeContract)
        || douyinPersonalInspectFailureResumeContract.resumeType !== DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_TYPE
        || args.platforms.length !== 1 || args.platforms[0] !== "douyin" || args.operation !== "resume"
        || douyinPersonalInspectFailureResumeContract.jobId !== jobId
        || douyinPersonalInspectFailureResumeContract.fingerprint !== identity.fingerprint
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_NATIVE_RECOVERY")
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_DOUYIN_PREFLIGHT_RESUME")
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME")
        || Object.hasOwn(process.env, DOUYIN_PREPARATION_SCOPE_RESUME_ENV)
        || Object.hasOwn(process.env, DOUYIN_WINDOW_BINDING_RESUME_ENV)
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_CHANNELS_PREFLIGHT_RESUME")
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY")
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_EMPTY_INPUT_RESUME")) {
      throw new UsageError("DOUYIN_PERSONAL_INSPECT_RESUME_MUTUALLY_EXCLUSIVE_SCOPE_INVALID");
    }
    try {
      await assertDouyinPersonalInspectFailureResumeContract(
        douyinPersonalInspectFailureResumeContract, pkg, identity, args, stateExisted,
        { binding: pkg.schoolAccount, orchestratorLockToken: jobLockToken, orchestratorLockPackagePath: args.packagePath },
      );
    } catch (error) {
      throw new UsageError(error?.code || "DOUYIN_PERSONAL_INSPECT_RESUME_LOCKED_CONTRACT_MISMATCH");
    }
  }
  let douyinPersonalPostResultDraftContinuationContract = null;
  let douyinPersonalPostResultDraftRunnerContract = null;
  let douyinPersonalPostResultDraftLockedInitObservation = null;
  let douyinPersonalPostResultLockedInitPathFailureContinuationContract = null;
  if (Object.hasOwn(process.env, DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_ENV)) {
    const raw = process.env[DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_ENV];
    if (typeof raw !== 'string' || !raw || raw.length > 262144) throw new UsageError('DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_CONTRACT_INVALID');
    try { douyinPersonalPostResultLockedInitPathFailureContinuationContract = JSON.parse(raw); }
    catch { throw new UsageError('DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_CONTRACT_INVALID'); }
    if (!Object.hasOwn(process.env, DOUYIN_PERSONAL_POST_RESULT_DRAFT_ENV)
        || douyinPersonalPostResultLockedInitPathFailureContinuationContract?.resumeType !== DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_TYPE) {
      throw new UsageError('DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_CONTRACT_INVALID');
    }
  }
  if (Object.hasOwn(process.env, DOUYIN_PERSONAL_POST_RESULT_DRAFT_ENV)) {
    const raw = process.env[DOUYIN_PERSONAL_POST_RESULT_DRAFT_ENV];
    if (typeof raw !== "string" || !raw || raw.length > 262144) throw new UsageError("DOUYIN_PERSONAL_POST_RESULT_DRAFT_CONTRACT_INVALID");
    try { douyinPersonalPostResultDraftContinuationContract = JSON.parse(raw); }
    catch { throw new UsageError("DOUYIN_PERSONAL_POST_RESULT_DRAFT_CONTRACT_INVALID"); }
    if (!douyinPersonalPostResultDraftContinuationContract || typeof douyinPersonalPostResultDraftContinuationContract !== "object"
        || Array.isArray(douyinPersonalPostResultDraftContinuationContract)
        || douyinPersonalPostResultDraftContinuationContract.resumeType !== DOUYIN_PERSONAL_POST_RESULT_DRAFT_TYPE
        || pkg.schoolAccount?.platform !== "douyin" || pkg.schoolAccount?.accountKey !== "reserved_personal_route"
        || args.platforms.length !== 1 || args.platforms[0] !== "douyin" || args.operation !== "resume"
        || douyinPersonalPostResultDraftContinuationContract.jobId !== jobId
        || douyinPersonalPostResultDraftContinuationContract.executionFingerprint !== identity.fingerprint
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_NATIVE_RECOVERY")
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_DOUYIN_PREFLIGHT_RESUME")
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME")
        || Object.hasOwn(process.env, DOUYIN_PREPARATION_SCOPE_RESUME_ENV)
        || Object.hasOwn(process.env, DOUYIN_WINDOW_BINDING_RESUME_ENV)
        || Object.hasOwn(process.env, DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_ENV)
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_CHANNELS_PREFLIGHT_RESUME")
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY")
        || Object.hasOwn(process.env, "VIDEO_PUBLISHER_EMPTY_INPUT_RESUME")) {
      throw new UsageError("DOUYIN_PERSONAL_POST_RESULT_DRAFT_MUTUALLY_EXCLUSIVE_SCOPE_INVALID");
    }
    const nativeStatePath = path.join(jobDir, "state.json");
    try {
      assertDouyinPersonalPostResultDraftStateRoot(args.stateRoot, douyinPersonalPostResultDraftContinuationContract);
      if (!stateExisted) throw new UsageError("DOUYIN_PERSONAL_POST_RESULT_DRAFT_LOCKED_PATH_MISMATCH");
      const lockedState = JSON.parse(await fs.promises.readFile(nativeStatePath, "utf8"));
      await assertDouyinPersonalPostResultDraftContinuationContract(douyinPersonalPostResultDraftContinuationContract, {
        packagePath: douyinPersonalPostResultDraftContinuationContract.packagePath,
        pkg, identity, args, stateExisted, statePath: nativeStatePath, state: lockedState,
        matrix: null, nativeStateBase: douyinPersonalPostResultDraftContinuationContract.nativeStateBase,
      });
      if (douyinPersonalPostResultLockedInitPathFailureContinuationContract) {
        assertDouyinPersonalPostResultLockedInitPathFailureContinuationContract(
          douyinPersonalPostResultLockedInitPathFailureContinuationContract,
          { packagePath: douyinPersonalPostResultDraftContinuationContract.packagePath,
            pkg, identity, args, stateExisted, statePath: nativeStatePath, state: lockedState,
            matrix: null, nativeStateBase: douyinPersonalPostResultDraftContinuationContract.nativeStateBase },
        );
      }
      const runner = path.join(DIR, "run-platform.mjs");
      const packageBytes = await fs.promises.readFile(args.packagePath);
      douyinPersonalPostResultDraftRunnerContract = {
        schemaVersion: 1, mode: DOUYIN_PERSONAL_POST_RESULT_DRAFT_TYPE,
        platform: "douyin", accountKey: "reserved_personal_route", packagePath: args.packagePath,
        packageSha256: crypto.createHash("sha256").update(packageBytes).digest("hex"),
        jobId, originalJobFingerprint: douyinPersonalPostResultDraftContinuationContract.fingerprint,
        executionFingerprint: identity.fingerprint, binding: douyinPersonalPostResultDraftContinuationContract.binding,
        token: douyinPersonalPostResultDraftContinuationContract.token,
        claimPath: douyinPersonalPostResultDraftContinuationContract.claimPath,
        claimSha256: douyinPersonalPostResultDraftContinuationContract.claimSha256,
        surfaceResultPath: douyinPersonalPostResultDraftContinuationContract.surfaceResultPath,
        surfaceResultSha256: douyinPersonalPostResultDraftContinuationContract.surfaceResultSha256,
        sourcePackagePath: douyinPersonalPostResultDraftContinuationContract.packagePath,
        sourcePackageSha256: douyinPersonalPostResultDraftContinuationContract.packageSha256,
        nativeStatePath: douyinPersonalPostResultDraftContinuationContract.nativeStatePath,
        nativeStateBase: douyinPersonalPostResultDraftContinuationContract.nativeStateBase,
        outerStateBase: douyinPersonalPostResultDraftContinuationContract.outerStateBase,
        nativeStateSha256: douyinPersonalPostResultDraftContinuationContract.nativeStateSha256,
        nativeBackupSha256: douyinPersonalPostResultDraftContinuationContract.nativeBackupSha256,
        priorResultSha256: douyinPersonalPostResultDraftContinuationContract.priorResultSha256,
        evidenceSha256: douyinPersonalPostResultDraftContinuationContract.evidenceSha256,
        ...(douyinPersonalPostResultDraftContinuationContract.preBrowserInitFailureAttempt
          ? { preBrowserInitFailureAttempt: douyinPersonalPostResultDraftContinuationContract.preBrowserInitFailureAttempt } : {}),
        ...(douyinPersonalPostResultLockedInitPathFailureContinuationContract
          ? { lockedInitPathFailureContinuation: douyinPersonalPostResultLockedInitPathFailureContinuationContract } : {}),
        ...(douyinPersonalPostResultDraftContinuationContract.beforeUploadIdentityRecovery ? {beforeUploadIdentityRecovery:douyinPersonalPostResultDraftContinuationContract.beforeUploadIdentityRecovery} : {}),
        finalPublishAllowed: false, contentWriteFlagChanged: false,
      };
      const inspectEnv = {
        ...process.env,
        VIDEO_PUBLISHER_V2_TASK_NAME: douyinPersonalPostResultDraftContinuationContract.binding.taskSpaceName,
        VIDEO_PUBLISHER_V2_FINGERPRINT: identity.fingerprint,
        VIDEO_PUBLISHER_V2_RECEIPTS: JSON.stringify({}),
        VIDEO_PUBLISHER_V2_VIDEO_RECEIPT: JSON.stringify(null),
        VIDEO_PUBLISHER_V2_CHECKPOINT_PATH: path.join(jobDir, "checkpoints", "douyin.receipts.json"),
        VIDEO_PUBLISHER_V2_PUBLISHER_LOCK_TOKEN: publisherLockToken,
        [DOUYIN_PERSONAL_POST_RESULT_DRAFT_ENV]: JSON.stringify(douyinPersonalPostResultDraftRunnerContract),
      };
      const inspection = await runCapture(process.execPath, [runner, "douyin", args.packagePath, "inspect", `${args.taskSuffix}-${jobId}`, String(douyinPersonalPostResultDraftContinuationContract.binding.taskSpaceId)], { env: inspectEnv });
      if (inspection.code !== 0) throw new UsageError("DOUYIN_PERSONAL_POST_RESULT_DRAFT_FRESH_INSPECT_RUNNER_FAILED");
      const fresh = parseV2Result(`${inspection.stdout}\n${inspection.stderr}`, "Ego post-result draft inspection");
      assertDouyinPersonalPostResultDraftInspectionObservation(fresh, douyinPersonalPostResultDraftContinuationContract.binding);
      const latestState = JSON.parse(await fs.promises.readFile(nativeStatePath, "utf8"));
      await assertDouyinPersonalPostResultDraftContinuationContract(douyinPersonalPostResultDraftContinuationContract, {
        packagePath: douyinPersonalPostResultDraftContinuationContract.packagePath,
        pkg, identity, args, stateExisted, statePath: nativeStatePath, state: latestState,
        matrix: null, nativeStateBase: douyinPersonalPostResultDraftContinuationContract.nativeStateBase,
      });
      douyinPersonalPostResultDraftLockedInitObservation = fresh;
    } catch (error) {
      const code = String(error?.code || error?.message || "DOUYIN_PERSONAL_POST_RESULT_DRAFT_LOCKED_INSPECT_REJECTED").slice(0,120);
      console.log(JSON.stringify({ ok: false, status: "BLOCKED", jobId, fingerprint: identity.fingerprint,
        statePath: nativeStatePath,
        preparationFailure: { stage: "locked-init", code, reason: String(error?.message || code).slice(0,400) },
        contentWriteFlagChanged: false, finalPublishAllowed: false,
      }, null, 2));
      process.exitCode = 10;
      return;
    }
  }
  const channelsPreflightContract=process.env.VIDEO_PUBLISHER_CHANNELS_PREFLIGHT_RESUME?JSON.parse(process.env.VIDEO_PUBLISHER_CHANNELS_PREFLIGHT_RESUME):null;
  const channelsBlobContract=process.env.VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY?JSON.parse(process.env.VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY):null;
  let douyinPreflightContract=null;
  if(Object.prototype.hasOwnProperty.call(process.env,'VIDEO_PUBLISHER_DOUYIN_PREFLIGHT_RESUME')){
    const raw=process.env.VIDEO_PUBLISHER_DOUYIN_PREFLIGHT_RESUME;
    if(typeof raw!=='string'||!raw||raw.length>262144)throw new UsageError('DOUYIN_PREFLIGHT_CONTRACT_INVALID');
    try{douyinPreflightContract=JSON.parse(raw);}catch{throw new UsageError('DOUYIN_PREFLIGHT_CONTRACT_INVALID');}
    if(!douyinPreflightContract||typeof douyinPreflightContract!=='object'||Array.isArray(douyinPreflightContract))throw new UsageError('DOUYIN_PREFLIGHT_CONTRACT_INVALID');
    try{
      await assertDouyinPristinePreflightResumeContract(douyinPreflightContract,pkg,identity,args,stateExisted,{
        binding:pkg.schoolAccount,
        nativeStateBase:douyinPreflightContract.nativeStateBase,
        allowOrchestratorLock:true,
      });
    }catch(error){throw new UsageError(error?.code||'DOUYIN_PREFLIGHT_LOCKED_SCOPE_MISMATCH');}
  }
  if(channelsBlobContract)assertChannelsBlobLockedContract(channelsBlobContract,pkg,identity,args);
  if(channelsPreflightContract)assertChannelsResumeContract(channelsPreflightContract,pkg,identity,args,stateExisted);
  if (douyinWindowBindingResumeContract) {
    const contract = douyinWindowBindingResumeContract;
    let failureCode = "DOUYIN_WINDOW_BINDING_LOCKED_PREFLIGHT_REJECTED";
    let failureReason = "Fresh locked source/state/window inspection failed before JobStore.initialize.";
    try {
      if (!stateExisted || path.resolve(args.stateRoot) !== path.resolve(contract.stateRoot)
        || path.resolve(path.join(jobDir, "state.json")) !== path.resolve(contract.statePath)) throw new UsageError("DOUYIN_WINDOW_BINDING_LOCKED_PATH_MISMATCH");
      const lockedState = JSON.parse(await fs.promises.readFile(contract.statePath, "utf8"));
      await assertDouyinWindowBindingLockedContract(contract, {
        statePath: contract.statePath, pkg, identity, args, state: lockedState,
        oldBinding: pkg.schoolAccount, executionBinding: contract.executionBinding,
      });
      douyinWindowExpectedUid = readWindowBindingExpectedUid(contract);
      const inspectEnv = {
        ...process.env,
        VIDEO_PUBLISHER_V2_TASK_NAME: contract.executionBinding.spaceName,
        VIDEO_PUBLISHER_V2_FINGERPRINT: identity.fingerprint,
        VIDEO_PUBLISHER_V2_RECEIPTS: JSON.stringify({}),
        VIDEO_PUBLISHER_V2_VIDEO_RECEIPT: JSON.stringify(null),
        VIDEO_PUBLISHER_V2_CHECKPOINT_PATH: contract.checkpoint.path,
        VIDEO_PUBLISHER_V2_PUBLISHER_LOCK_TOKEN: publisherLockToken,
        [DOUYIN_WINDOW_BINDING_RESUME_ENV]: JSON.stringify(contract),
        VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_EXPECTED_UID: douyinWindowExpectedUid,
        VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_STAGE: "locked-init",
      };
      const runner = path.join(DIR, "run-platform.mjs");
      const inspection = await runCapture(process.execPath, [runner, "douyin", args.packagePath, "inspect", `${args.taskSuffix}-${jobId}`, String(contract.executionBinding.spaceId)], { env: inspectEnv });
      if (inspection.code !== 0) throw new UsageError("DOUYIN_WINDOW_BINDING_LOCKED_INSPECT_RUNNER_FAILED");
      const observation = parseV2Result(`${inspection.stdout}\n${inspection.stderr}`, "Ego locked-init inspection", { expectedUid: douyinWindowBindingResumeContract ? douyinWindowExpectedUid : "" });
      assertWindowBindingInspectObservation(observation, contract);
      const proof = observation?.evidence?.douyinWindowBindingProof;
      const checked = await assertDouyinWindowBindingFreshProof({ stage: "locked-init", proof }, contract);
      const stableObservation = stripDouyinWindowUid(observation, douyinWindowExpectedUid);
      delete stableObservation?.evidence?.douyinWindowBindingProof;
      delete stableObservation?.evidence?.douyinIdentityProof;
      const authIdentity = stableObservation?.gates?.authenticated?.evidence?.douyinIdentity;
      if (authIdentity && typeof authIdentity === "object") delete authIdentity.uid;
      stableObservation.douyinWindowBinding = contract.executionBinding;
      stableObservation.douyinWindowBindingProofSha256 = checked.proofSha256;
      douyinWindowLockedInitObservation = stableObservation;
    } catch (error) {
      failureCode = error?.causeCode || error?.code || failureCode;
      failureReason = String(error?.message || error || failureReason).slice(0, 400);
    }
    if (!douyinWindowLockedInitObservation) {
      console.log(JSON.stringify({ ok: false, status: "BLOCKED", jobId, fingerprint: identity.fingerprint,
        statePath: contract.statePath,
        preparationFailure: { stage: "locked-init", code: "DOUYIN_WINDOW_BINDING_LOCKED_PREFLIGHT_REJECTED", reason: `${failureCode}: ${failureReason}`.slice(0, 400) },
      }, null, 2));
      process.exitCode = 10;
      return;
    }
  }
  const expectedState = initialState(jobId, identity, args);
  if (args.operation === "replace-cover") expectedState.fingerprint = null;
  const store = new JobStore(jobDir, expectedState, {
    acceptedFingerprints: args.operation === "replace-cover" ? [] : [identity.previousFingerprint, identity.legacyFingerprint,
      ...(douyinPersonalPostResultDraftContinuationContract ? [douyinPersonalPostResultDraftContinuationContract.fingerprint] : [])],
  });
  const state = await store.initialize();
  if (douyinPersonalPostResultDraftContinuationContract?.beforeUploadIdentityRecovery) {
    assertDouyinPersonalPostResultDraftContinuationActive(douyinPersonalPostResultDraftContinuationContract,
      {pkg:identityPackage,identity,state,statePath:store.statePath,nativeStateBase:douyinPersonalPostResultDraftContinuationContract.nativeStateBase});
  } else if (douyinPersonalPostResultDraftContinuationContract) {
    const contract = douyinPersonalPostResultDraftContinuationContract;
    if (state.jobId !== contract.jobId || state.fingerprint !== contract.fingerprint
        || !sameJson(state.video, identity.video) || !sameJson(state.assets, identity.assets)) {
      throw new UsageError("DOUYIN_PERSONAL_POST_RESULT_DRAFT_IDENTITY_BRIDGE_SOURCE_MISMATCH");
    }
    state.schemaVersion = 4;
    state.fingerprint = identity.fingerprint;
    state.contentFingerprint = identity.contentFingerprint;
    state.coverFingerprint = identity.coverFingerprint;
    state.coverFingerprints = identity.coverFingerprints;
    state.cover = identity.cover;
    state.packagePath = args.packagePath;
    state.taskSuffix = args.taskSuffix;
    state.revisions ||= [];
    state.revisions.push({ at: new Date().toISOString(), operation: "personal-post-result-identity-bridge",
      from: contract.fingerprint, to: identity.fingerprint, packagePath: args.packagePath,
      surfaceResultSha256: contract.surfaceResultSha256, priorResultSha256: contract.priorResultSha256 });
    await store.save();
  } else if (args.operation !== "replace-cover") await migrateLegacyIdentity(store, state, identity, args);
  const recoveryContract=JSON.parse(process.env.VIDEO_PUBLISHER_NATIVE_RECOVERY||'null');
  const emptyContract=process.env.VIDEO_PUBLISHER_EMPTY_INPUT_RESUME?JSON.parse(process.env.VIDEO_PUBLISHER_EMPTY_INPUT_RESUME):null;
  if(emptyContract){
   if(emptyContract.version!==1||args.operation!=='resume'||args.platforms.length!==1||args.platforms[0]!=='xiaohongshu'||emptyContract.jobId!==jobId||emptyContract.fingerprint!==state.fingerprint||emptyContract.statePath!==store.statePath)throw new UsageError('XHS_EMPTY_RESUME_LOCKED_MISMATCH');
   if(JSON.stringify(pkg.schoolAccount)!==JSON.stringify(emptyContract.binding))throw new UsageError('XHS_EMPTY_RESUME_BINDING_CHANGED');
   if(emptyContract.mode==='injected_body'){const proof=assertXhsInjectedBodyState(state,pkg.schoolAccount,store.statePath,emptyContract.stateBase);if(proof.injectionEvidencePath!==emptyContract.injectionEvidencePath)throw new UsageError('XHS_BODY_SOURCE_EVIDENCE_CHANGED');}
   else if(emptyContract.mode==='empty_input')assertXhsEmptyInputState(state,pkg.schoolAccount,store.statePath,emptyContract.stateBase);
   else throw new UsageError('XHS_RESUME_MODE_INVALID');
  }
  if(recoveryContract && (args.operation!=='resume'||args.platforms.length!==1||args.platforms[0]!=='douyin'||recoveryContract.jobId!==jobId||recoveryContract.fingerprint!==state.fingerprint||recoveryContract.video.sha256!==state.video.sha256||Number(state.platforms.douyin?.taskSpaceId)!==recoveryContract.binding.taskSpaceId||state.platforms.douyin?.taskSpaceName!==recoveryContract.binding.taskSpaceName))throw new UsageError('VIDEO_RESUME_LOCKED_STATE_MISMATCH');
  if(recoveryContract){
    if(personalExistingActive)assertPersonalExistingVideoContract(recoveryContract,{packagePath:args.packagePath,state});
    else assertPermissionResumeState(state,recoveryContract.binding,store.statePath,path.resolve(args.stateRoot,'../../..'));
    if(JSON.stringify(pkg.schoolAccount)!==JSON.stringify(recoveryContract.binding))throw new UsageError('VIDEO_RESUME_BINDING_CHANGED');
  }
  if(!recoveryContract && !args.inspectOnly && ['auto','resume'].includes(args.operation) && hasPermissionUploadInterruption(state.platforms?.douyin))throw new UsageError('BROWSER_PERMISSION_RESUME_REQUIRED_USE_PREPARED_STATE');
  const incomingStatus = state.status;
  const incomingInProgress = IN_PROGRESS_STATUSES.includes(incomingStatus);
  if (args.operation === "auto" && stateExisted && incomingStatus === "ready") {
    throw new UsageError(`Job ${jobId} is already READY. Use --operation inspect, --operation replace-cover, or --operation repost --confirm-new-copy.`);
  }
  if (args.operation === "resume" && incomingStatus === "ready" && channelsBlobContract?.recoveryMode!=="ready_topics" && channelsBlobContract?.recoveryMode!=="ready_source_proof") {
    throw new UsageError(`Job ${jobId} is already READY; resume will not create another draft`);
  }
  if (args.operation === "replace-cover") await prepareCoverReplacement(store, state, identity, args);
  else {
    state.schemaVersion = 4;
    state.contentFingerprint ||= identity.contentFingerprint;
    state.coverFingerprint ||= identity.coverFingerprint;
    state.coverFingerprints ||= identity.coverFingerprints;
    state.cover ||= identity.cover;
  }
  if (args.operation === "inspect" && stateExisted) args.freshSpace = false;
  if (args.keepSpace) state.keepSpace = true;
  if (shouldRotateSpaces(args, state)) {
    const stamp = args.spaceSuffix || uniqueSpaceSuffix();
    retireCurrentSpaces(state, args.platforms);
    for (const platform of args.platforms) {
      const item = state.platforms[platform];
      if (!item) continue;
      item.taskSpaceId = null;
      item.taskSpaceName = buildSpaceName({
        spaceName: args.spaceName,
        spacePrefix: args.spacePrefix,
        platform,
        taskSuffix: args.taskSuffix,
        jobId,
        stamp,
      });
      item.receipts = {};
      item.receiptTaskSpaceId = null;
      item.videoReceipt = null;
      await store.clearReceiptCheckpoint(platform);
    }
  } else if (args.spaceName) {
    for (const platform of args.platforms) {
      const item = state.platforms[platform];
      if (!item) continue;
      if (item.taskSpaceName && item.taskSpaceName !== args.spaceName) {
        retireCurrentSpaces(state, [platform]);
        item.taskSpaceId = null;
        item.receipts = {};
        item.receiptTaskSpaceId = null;
        item.videoReceipt = null;
        await store.clearReceiptCheckpoint(platform);
      }
      item.taskSpaceName = args.spaceName;
    }
  }
  await store.save();
  if (store.lastRecovery) {
    console.error(`[video-publisher-v2] restored corrupt job state from atomic backup; preserved=${store.lastRecovery.corruptPath}`);
  }
  if (state.fingerprint !== identity.fingerprint) throw new Error(`Job ${jobId} belongs to another package`);
  for (const platform of args.platforms) state.platforms[platform] ||= { status: "new", taskSpaceId: null, taskSpaceName: null, videoReceipt: null, receipts: {}, verdict: null, history: [] };
  for (const platform of args.platforms) {
    const item = state.platforms[platform];
    if (!item.taskSpaceName && item.lastEvidencePath && fs.existsSync(item.lastEvidencePath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(item.lastEvidencePath, "utf8"));
        const observation = saved.observation || saved;
        if (observation.taskSpace && (item.taskSpaceId == null || Number(observation.taskSpaceId) === Number(item.taskSpaceId))) {
          item.taskSpaceName = observation.taskSpace;
        }
      } catch {}
    }
    if (item.receiptTaskSpaceId != null && item.taskSpaceId != null && Number(item.receiptTaskSpaceId) !== Number(item.taskSpaceId)) {
      item.receipts = {};
      item.receiptTaskSpaceId = null;
      await store.clearReceiptCheckpoint(platform);
    }
    if (item.videoReceipt?.taskSpaceId != null && item.taskSpaceId != null
      && Number(item.videoReceipt.taskSpaceId) !== Number(item.taskSpaceId)) item.videoReceipt = null;
    const checkpoint = await store.loadReceiptCheckpoint(platform, state.fingerprint, item.taskSpaceId);
    if (checkpoint) {
      item.receipts = { ...checkpoint.receipts, ...(item.receipts || {}) };
      item.receiptTaskSpaceId = checkpoint.taskSpaceId ?? item.receiptTaskSpaceId ?? item.taskSpaceId ?? null;
    }
  }
  for (const platform of args.platforms.filter(key => preflightErrors[key].length > 0)) {
    const item = state.platforms[platform];
    const observedAt = new Date().toISOString();
    const blocker = {
      code: BLOCKER.PLATFORM_REJECTED_ASSET,
      message: preflightErrors[platform].join("; "),
      retryable: false,
      requiresUser: false,
      evidence: { errors: preflightErrors[platform], media },
    };
    const observation = {
      schemaVersion: 1,
      platform,
      phase: "preflight",
      taskSpaceId: item.taskSpaceId ?? null,
      observedAt,
      finalPublishClicked: false,
      gates: {},
      blocker,
      evidence: { media },
    };
    const verdict = { platform, phase: "preflight", taskSpaceId: item.taskSpaceId ?? null, ready: false, missing: ["preflight"], blocker };
    item.status = "blocked";
    await store.record(platform, "preflight", observation, verdict);
  }
  state.status = args.inspectOnly ? "inspecting" : "running";
  await store.save();

  const runnerPath = path.resolve(process.env.VIDEO_PUBLISHER_V2_RUNNER || path.join(DIR, "run-platform.mjs"));
  let inputChannelBroken = false;
  let userControl = false;
  const verifiedPlatforms = new Set();
  let douyinPreparationScopeResumeBeforeUploadProven = false;
  let douyinPreparationScopeFailure = null;
  let douyinPersonalInspectFailure = null;
  let douyinPersonalPostResultDraftFailure = null;
  let douyinInputMissingPreuploadProven=false;
  let douyinInputMissingFailure=null;
  async function invoke(platform, phase) {
    if (douyinPreparationScopeResumeContract
        && (platform !== "douyin" || (!douyinPreparationScopeResumeBeforeUploadProven && phase !== "inspect"))) {
      throw new UsageError("DOUYIN_SCOPE_RESUME_PHASE_NOT_ALLOWED");
    }
    if (["ready_source_proof", "ready_source_proof_safety_retry"].includes(channelsBlobContract?.recoveryMode)
        && (platform !== "wechat_channels" || !["inspect", "verify"].includes(phase))) {
      throw new UsageError("CHANNELS_READY_SOURCE_PROOF_READ_ONLY_PHASE_REQUIRED");
    }
    if(channelsBlobContract&&['upload','upload_start','quarantine'].includes(phase))throw new UsageError('CHANNELS_BLOB_RECOVERY_NEVER_REINJECT');
    if(emptyContract?.mode==='injected_body'&&['upload','upload_start','quarantine'].includes(phase))throw new UsageError('XHS_BODY_RESUME_NEVER_REINJECT');
    if(douyinInputMissingResumeContract&&platform==='douyin'&&phase==='upload_start'&&!douyinInputMissingPreuploadProven)throw new UsageError('DOUYIN_INPUT_MISSING_FRESH_PROOF_REQUIRED');
    const item = state.platforms[platform];
    if(douyinInputMissingResumeContract&&platform==='douyin'&&phase==='upload_start'){
      let changed=false;
      try{
        // Re-hash the same already-normalized V2 package immediately before
        // the input-capable runner phase. This closes the inspect -> injection
        // gap without fingerprinting a differently normalized source object.
        const currentIdentity=await buildIdentity(readPackage(args.packagePath));
        changed=currentIdentity.fingerprint!==identity.fingerprint
          ||currentIdentity.fingerprint!==douyinInputMissingResumeContract.fingerprint
          ||!sameJson(currentIdentity.video,identity.video)
          ||!sameJson(currentIdentity.video,douyinInputMissingResumeContract.video)
          ||!sameJson(currentIdentity.video,state.video)
          ||!sameJson(currentIdentity.assets,identity.assets)
          ||!sameJson(currentIdentity.assets,state.assets);
      }catch{changed=true;}
      if(changed){
        const code='DOUYIN_INPUT_MISSING_SOURCE_ASSET_CHANGED_AFTER_INSPECT';
        const blocker={code,message:'Source package, video, or cover bytes changed after the fresh blank-upload inspect; file input was not invoked.',retryable:false,requiresUser:false,evidence:{fingerprintLocked:identity.fingerprint}};
        const observation={schemaVersion:1,platform:'douyin',phase:'upload_start',taskSpace:item.taskSpaceName,taskSpaceId:item.taskSpaceId,observedAt:new Date().toISOString(),finalPublishClicked:false,blocker,gates:{safety:{ok:true,evidence:{finalPublishClicked:false,guardArmed:true,blockedAttempts:0}}},actions:{},receipts:{}};
        const verdict={...evaluateObservation(observation),blocker,ready:false};
        item.status='blocked';
        state.status='blocked';
        await store.record(platform,phase,observation,compactVerdict(verdict));
        await store.save();
        douyinInputMissingFailure={stage:'before-upload',code,reason:blocker.message,lastEvidencePath:item.lastEvidencePath};
        console.error(`[video-publisher-v2] Douyin input-missing continuation blocked before runner dispatch: ${code}`);
        return {observation,verdict};
      }
    }
    const previousTaskSpaceId = item.taskSpaceId;
    const runnerArgs = [runnerPath, platform, args.packagePath, phase, `${args.taskSuffix}-${jobId}`, item.taskSpaceId ? String(item.taskSpaceId) : ""];
    if (args.originalRightsConfirmed) runnerArgs.push("--confirm-original-rights");
    let observation;
    if (douyinPersonalPostResultDraftContinuationContract && platform === "douyin" && phase === "inspect" && douyinPersonalPostResultDraftLockedInitObservation) {
      observation = douyinPersonalPostResultDraftLockedInitObservation;
      douyinPersonalPostResultDraftLockedInitObservation = null;
    } else if (douyinWindowBindingResumeContract && platform === "douyin" && phase === "inspect" && douyinWindowLockedInitObservation) {
      observation = douyinWindowLockedInitObservation;
      douyinWindowLockedInitObservation = null;
    } else {
      let beforeUploadFailure = null;
      if (douyinPersonalPostResultDraftContinuationContract && platform === "douyin" && phase === "upload_start") {
        try {
          await assertDouyinPersonalPostResultDraftActiveFromFile(douyinPersonalPostResultDraftContinuationContract, {
            packagePath:args.packagePath,state,statePath:store.statePath,
            nativeStateBase:douyinPersonalPostResultDraftContinuationContract.nativeStateBase,
          });
        } catch (error) {
          const code = String(error?.code || error?.message || "DOUYIN_PERSONAL_POST_RESULT_DRAFT_BEFORE_UPLOAD_RECHECK_FAILED").slice(0, 120);
          const reason = "The original one-shot claim, source lineage, current identity, or migrated same-job state changed before file input; no video upload was dispatched.";
          beforeUploadFailure = { code, reason };
          douyinPersonalPostResultDraftFailure = { stage: "before-upload", code, reason };
        }
      }
      if (douyinWindowBindingResumeContract && platform === "douyin" && phase === "upload_start") {
        try {
          const contract = douyinWindowBindingResumeContract;
          const inspectEnv = {
            ...process.env,
            VIDEO_PUBLISHER_V2_TASK_NAME: contract.executionBinding.spaceName,
            VIDEO_PUBLISHER_V2_FINGERPRINT: state.fingerprint,
            VIDEO_PUBLISHER_V2_RECEIPTS: JSON.stringify({}),
            VIDEO_PUBLISHER_V2_VIDEO_RECEIPT: JSON.stringify(item.videoReceipt || null),
            VIDEO_PUBLISHER_V2_CHECKPOINT_PATH: store.receiptCheckpointPath("douyin"),
            VIDEO_PUBLISHER_V2_PUBLISHER_LOCK_TOKEN: publisherLockToken,
            [DOUYIN_WINDOW_BINDING_RESUME_ENV]: JSON.stringify(contract),
            VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_EXPECTED_UID: douyinWindowExpectedUid,
            VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_STAGE: "before-upload",
          };
          const inspection = await runCapture(process.execPath, [runnerPath, "douyin", args.packagePath, "inspect", `${args.taskSuffix}-${jobId}`, String(contract.executionBinding.spaceId)], { env: inspectEnv });
          if (inspection.code !== 0) throw new UsageError("DOUYIN_WINDOW_BINDING_BEFORE_UPLOAD_INSPECT_FAILED");
          const fresh = parseV2Result(`${inspection.stdout}\n${inspection.stderr}`, "Ego before-upload inspection", { expectedUid: douyinWindowBindingResumeContract ? douyinWindowExpectedUid : "" });
          assertWindowBindingInspectObservation(fresh, contract);
          await assertDouyinWindowBindingFreshProof({ stage: "before-upload", proof: fresh?.evidence?.douyinWindowBindingProof }, contract);
        } catch (error) {
          beforeUploadFailure = { code: String(error?.code || error?.message || "DOUYIN_WINDOW_BINDING_BEFORE_UPLOAD_PROOF_REJECTED").slice(0, 120), reason: String(error?.message || error || "Fresh before-upload proof rejected.").slice(0, 300) };
        }
      }
      if (beforeUploadFailure) {
        observation = {
          schemaVersion: 1, platform: "douyin", phase: "upload_start", taskSpaceId: item.taskSpaceId,
          taskSpace: item.taskSpaceName, observedAt: new Date().toISOString(), finalPublishClicked: false,
          blocker: { code: beforeUploadFailure.code, message: beforeUploadFailure.reason, retryable: false, requiresUser: false },
          gates: { authenticated: { ok: false, evidence: { freshWindowBindingProof: false } }, draftIdentity: { ok: false, evidence: {} }, video: { ok: false, evidence: { uploaded: false, uploading: false, failed: false, resumeDialog: false } } },
          actions: {}, receipts: {},
        };
      } else {
    const execution = await runCapture(process.execPath, runnerArgs, {
      env: {
        ...process.env,
        VIDEO_PUBLISHER_V2_RECEIPTS: JSON.stringify(item.receipts || {}),
        VIDEO_PUBLISHER_V2_CHECKPOINT_PATH: store.receiptCheckpointPath(platform),
        VIDEO_PUBLISHER_V2_FINGERPRINT: state.fingerprint,
        ...(douyinInputMissingResumeContract && platform === "douyin" ? {
          VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_EXPECTED_IDENTITY: JSON.stringify({
            jobId: state.jobId,
            fingerprint: identity.fingerprint,
            video: identity.video,
            assets: identity.assets,
          }),
        } : {}),
        ...(douyinWindowBindingResumeContract && platform === "douyin" && phase === "upload_start" ? {
          [DOUYIN_WINDOW_BINDING_RESUME_ENV]: JSON.stringify(douyinWindowBindingResumeContract),
          VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_EXPECTED_UID: douyinWindowExpectedUid,
          VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_STAGE: "before-upload",
        } : {}),
        ...(douyinPersonalPostResultDraftContinuationContract ? {
          [DOUYIN_PERSONAL_POST_RESULT_DRAFT_ENV]: JSON.stringify(douyinPersonalPostResultDraftRunnerContract),
        } : {}),
        VIDEO_PUBLISHER_V2_TASK_NAME: item.taskSpaceName || "",
        VIDEO_PUBLISHER_V2_VIDEO_RECEIPT: JSON.stringify(item.videoReceipt || null),
        VIDEO_PUBLISHER_V2_PUBLISHER_LOCK_TOKEN: publisherLockToken,
      },
    });
    observation = parseV2Result(`${execution.stdout}\n${execution.stderr}`, "v2 runner", { expectedUid: douyinWindowBindingResumeContract ? douyinWindowExpectedUid : "" });
      }
    }
    if (douyinPersonalInspectFailureResumeContract && platform === "douyin" && phase === "inspect") {
      try {
        assertDouyinPersonalInspectFailureFreshObservation(observation, douyinPersonalInspectFailureResumeContract.binding);
      } catch (error) {
        const code = String(error?.code || "DOUYIN_PERSONAL_INSPECT_RESUME_FRESH_INSPECT_NOT_SAFE").slice(0, 120);
        douyinPersonalInspectFailure = { stage: "fresh-inspect", code, reason: "The original Ego target did not prove a clean, authenticated exact upload surface; no file input was invoked." };
        // The general classifier treats a blank home page as needs_upload.
        // Make this one-shot recovery terminal unless the fresh inspect proves
        // the original target and exact native upload surface.
        observation.blocker = {
          code: BLOCKER.AUTH_REQUIRED,
          message: "Fresh same-window Douyin inspection did not prove the exact original upload surface; stop before file input.",
          retryable: false,
          requiresUser: false,
          evidence: { resumeGuardCode: code },
        };
      }
    }
    if (douyinPersonalPostResultDraftContinuationContract && platform === "douyin" && phase === "inspect") {
      try {
        assertDouyinPersonalPostResultDraftInspectionObservation(observation, douyinPersonalPostResultDraftContinuationContract.binding);
      } catch (error) {
        const code = String(error?.code || "DOUYIN_PERSONAL_POST_RESULT_DRAFT_FRESH_INSPECT_NOT_SAFE").slice(0, 120);
        douyinPersonalPostResultDraftFailure = { stage: "fresh-inspect", code,
          reason: "The exact original upload page did not prove a clean editor before any file input; no upload was attempted." };
        observation.blocker = { code, message: douyinPersonalPostResultDraftFailure.reason, retryable: false, requiresUser: false };
      }
    }
    if (douyinWindowBindingResumeContract && platform === "douyin") {
      observation = stripDouyinWindowUid(observation, douyinWindowExpectedUid);
      if (observation?.evidence && typeof observation.evidence === "object") {
        delete observation.evidence.douyinWindowBindingProof;
        delete observation.evidence.douyinIdentityProof;
      }
      const authIdentity = observation?.gates?.authenticated?.evidence?.douyinIdentity;
      if (authIdentity && typeof authIdentity === "object") delete authIdentity.uid;
      observation.douyinWindowBinding = douyinWindowBindingResumeContract.executionBinding;
    }
    if(emptyContract?.mode==='empty_input'&&phase==='inspect'){
      const v=observation.gates?.video;
      if(v?.ok!==false||v.evidence?.uploaded!==false||v.evidence?.uploading!==false||observation.taskSpaceId!==emptyContract.binding.taskSpaceId)observation.blocker={code:'XHS_EMPTY_RESUME_CURRENT_VIDEO_PRESENT_OR_UNKNOWN',message:'Empty-input recovery requires a freshly verified empty original editor.',retryable:false,requiresUser:false};
    }

    if(emptyContract?.mode==='empty_input'&&phase==='upload_start'&&observation.actions?.upload?.mode!=='injected')observation.blocker={code:'XHS_EMPTY_RESUME_INJECTION_NOT_PROVED',message:'This recovery only permits the original source injection path.',retryable:false,requiresUser:false};
    if(emptyContract?.mode==='injected_body'&&phase==='inspect'){
      const g=observation.gates;
      if(g?.video?.ok!==true||g.draftIdentity?.ok!==true||g.title?.ok!==true||g.description?.ok!==true||observation.taskSpaceId!==emptyContract.binding.taskSpaceId)observation.blocker={code:'XHS_BODY_RESUME_ORIGINAL_EDITOR_UNPROVED',message:'Original uploaded editor and exact body/title must be freshly proved before mutation.',retryable:false,requiresUser:false};
      else observation.actions={...(observation.actions||{}),upload:{mode:'resume_existing',stage:'complete',originalInjectionEvidence:emptyContract.injectionEvidencePath}};
    }
    if(emptyContract){const g=observation.gates?.safety;if(g?.ok!==true||g.evidence?.guardArmed!==true||g.evidence?.blockedAttempts!==0)observation.blocker={code:'XHS_RESUME_FRESH_GUARD_UNCLEAN',message:'Original clean final-action guard is mandatory before continuation.',retryable:false,requiresUser:false};}
    if (observation.taskSpace) item.taskSpaceName = observation.taskSpace;
    const taskSpaceChanged = previousTaskSpaceId != null && observation.taskSpaceId != null
      && Number(previousTaskSpaceId) !== Number(observation.taskSpaceId);
    const taskSpaceRecreated = observation.taskSpaceRecovery?.recreated === true;
    if (taskSpaceChanged || taskSpaceRecreated) {
      item.receipts = {};
      item.videoReceipt = null;
      item.receiptTaskSpaceId = null;
      await store.clearReceiptCheckpoint(platform);
      observation.recovery = {
        ...(observation.recovery || {}),
        taskSpaceRecreated: {
          previousTaskSpaceId: observation.taskSpaceRecovery?.previousTaskSpaceId ?? previousTaskSpaceId,
          taskSpaceId: observation.taskSpaceId,
          numericIdChanged: taskSpaceChanged,
        },
      };
    }
    if (observation.receipts) {
      item.receipts = { ...(item.receipts || {}), ...observation.receipts };
      item.receiptTaskSpaceId = observation.taskSpaceId ?? item.taskSpaceId ?? null;
    }
    const videoReceipt = (phase === "upload" || phase === "upload_start" || ((recoveryContract||channelsBlobContract||emptyContract?.mode==='injected_body') && phase === "inspect"))
      ? videoReceiptFromObservation(observation, state.fingerprint, item.taskSpaceId, state.video)
      : null;
    if (videoReceipt) item.videoReceipt = videoReceipt;
    let verdict = evaluateObservation(observation);
    if(douyinInputMissingResumeContract&&platform==='douyin'&&phase==='upload_start'
      &&String(observation.blocker?.message||'').startsWith('DOUYIN_INPUT_MISSING_SOURCE_ASSET_CHANGED_AT_UPLOADFILE')){
      const code='DOUYIN_INPUT_MISSING_SOURCE_ASSET_CHANGED_AT_UPLOADFILE';
      observation.blocker={...observation.blocker,code,message:'Source video or cover bytes changed immediately before file input; no file was injected.',retryable:false,requiresUser:false};
      verdict={...evaluateObservation(observation),blocker:observation.blocker,ready:false};
      douyinInputMissingFailure={stage:'before-upload',code,reason:observation.blocker.message,lastEvidencePath:null};
    }
    if (verdict.blocker?.code === BLOCKER.INPUT_CHANNEL_BROKEN) inputChannelBroken = true;
    if ([BLOCKER.USER_CONTROL, BLOCKER.BROWSER_PERMISSION_REQUIRED].includes(verdict.blocker?.code)) userControl = true;
    if (phase === "verify"
      && verdict.blocker?.code !== BLOCKER.INPUT_CHANNEL_BROKEN
      && ![BLOCKER.USER_CONTROL, BLOCKER.BROWSER_PERMISSION_REQUIRED].includes(verdict.blocker?.code)) verifiedPlatforms.add(platform);
    item.status = classifyVerdict(verdict);
    if (observation.blocker) item.status = verdict.blocker?.requiresUser ? "blocked_user" : "blocked";
    if(douyinInputMissingResumeContract&&platform==='douyin'&&phase==='inspect'){
      try{
        if(item.status!=='needs_upload')throw Object.assign(new Error('The actual current V2 observation is not classified as an initial upload.'),{code:'DOUYIN_INPUT_MISSING_NOT_NEEDS_UPLOAD'});
        assertDouyinInputMissingBeforeUpload({stage:'before-upload',identityProof:observation?.evidence?.douyinIdentityProof,observation},pkg.schoolAccount,douyinInputMissingResumeContract);
        douyinInputMissingPreuploadProven=true;
      }catch(error){
        const code=String(error?.code||error?.message||'DOUYIN_INPUT_MISSING_FRESH_PROOF_REJECTED').slice(0,120);
        const reason=String(error?.message||code).slice(0,400);
        douyinInputMissingFailure={stage:'before-upload',code,reason,lastEvidencePath:null};
        observation.blocker={code,message:reason,retryable:false,requiresUser:false};
        verdict={...evaluateObservation(observation),blocker:observation.blocker,ready:false};
        item.status='blocked';
      }
    }
    if(douyinInputMissingResumeContract||douyinPersonalInspectFailureResumeContract){
      // The fresh exact UID is an in-memory check only. Persist stable account
      // guards and UI state, but not the transient creator UID or proof object.
      observation = stripDouyinWindowUid(observation, douyinPersonalInspectFailureResumeContract?.binding?.apiUid || "");
      if(observation.evidence&&typeof observation.evidence==='object')delete observation.evidence.douyinIdentityProof;
      const authIdentity=observation.gates?.authenticated?.evidence?.douyinIdentity;
      if(authIdentity&&typeof authIdentity==='object')delete authIdentity.uid;
    }
    await store.record(platform, phase, observation, compactVerdict(verdict));
    if(douyinInputMissingFailure&&platform==='douyin'&&['inspect','upload_start'].includes(phase))douyinInputMissingFailure.lastEvidencePath=typeof item.lastEvidencePath==='string'?item.lastEvidencePath:null;
    console.error(`[video-publisher-v2] ${platform} ${phase}: ${verdict.ready ? "READY" : verdict.missing.join(",") || verdict.blocker?.code}`);
    return { observation, verdict };
  }

  console.error(`[video-publisher-v2] inspect parallel=${args.checkConcurrency}`);
  await runPool(runnablePlatforms, args.checkConcurrency, platform => invoke(platform, "inspect"));
  if(douyinInputMissingResumeContract&&douyinInputMissingFailure){
    state.platforms.douyin.status='blocked';state.status='blocked';
    await store.save();await store.close();
    console.log(JSON.stringify(summary(state,args.platforms,store.statePath,douyinInputMissingFailure),null,2));
    process.exitCode=10;return;
  }
  if (douyinPreparationScopeResumeContract) {
    const item = state.platforms.douyin;
    try {
      const evidence = JSON.parse(await fs.promises.readFile(item.lastEvidencePath, "utf8"));
      const observation = evidence?.observation;
      if (observation?.blocker?.code === "DOUYIN_SCOPE_RESUME_UPLOAD_SURFACE_NOT_EXACT") {
        const failure = new UsageError("DOUYIN_SCOPE_RESUME_UPLOAD_SURFACE_NOT_EXACT");
        failure.code = "DOUYIN_SCOPE_RESUME_UPLOAD_SURFACE_NOT_EXACT";
        failure.message = String(observation.blocker.message || failure.message).slice(0, 400);
        failure.detail = {
          expectedUrl: observation.blocker.evidence?.expectedUrl || "https://creator.douyin.com/creator-micro/content/upload",
          actualUrl: observation.blocker.evidence?.actualUrl || observation.blocker.evidence?.uploadSurface?.url || observation.gates?.authenticated?.evidence?.url || "",
          surfaceReason: observation.blocker.evidence?.uploadSurface?.reason || observation.gates?.authenticated?.evidence?.douyinUploadSurface?.reason || "",
        };
        throw failure;
      }
      if (item.status !== "needs_upload") throw new UsageError(observation?.blocker?.code || "DOUYIN_SCOPE_RESUME_INSPECT_NOT_NEEDS_UPLOAD");
      if (observation?.gates?.video?.evidence?.resumeDialog !== false) {
        throw new UsageError("DOUYIN_SCOPE_RESUME_UNEXPECTED_RESUME_DIALOG");
      }
      await assertDouyinPreparationScopeResumeContract(
        douyinPreparationScopeResumeContract, pkg, identity, args, stateExisted,
        {
          stage: "before-upload",
          freshIdentity: observation?.gates?.authenticated?.evidence?.douyinIdentity,
          emptyEditor: observation?.gates?.draftIdentity?.evidence,
          observation,
        },
      );
      douyinPreparationScopeResumeBeforeUploadProven = true;
    } catch (error) {
      item.status = "blocked";
      state.status = "blocked";
      const safeDetail = error?.detail && typeof error.detail === "object" && !Array.isArray(error.detail)
        ? Object.fromEntries(["expectedUrl", "actualUrl", "surfaceReason"].filter(key => typeof error.detail[key] === "string").map(key => [key, error.detail[key].slice(0, 300)]))
        : null;
      douyinPreparationScopeFailure = {
        stage: "before-upload",
        code: String(error?.code || error?.message || "DOUYIN_SCOPE_RESUME_BEFORE_UPLOAD_ASSERTION_FAILED").slice(0, 120),
        reason: String(error?.message || "DOUYIN_SCOPE_RESUME_BEFORE_UPLOAD_ASSERTION_FAILED").slice(0, 400),
        detail: safeDetail,
        lastEvidencePath: typeof item.lastEvidencePath === "string" ? item.lastEvidencePath : null,
      };
      await store.save();
      await store.close();
      console.error(`[video-publisher-v2] Douyin preparation-scope continuation blocked before upload: ${douyinPreparationScopeFailure.code}`);
      console.log(JSON.stringify(summary(state, args.platforms, store.statePath, douyinPreparationScopeFailure), null, 2));
      process.exitCode = 10;
      return;
    }
  }
  if (["ready_source_proof", "ready_source_proof_safety_retry"].includes(channelsBlobContract?.recoveryMode)) {
    // This recovery exists only to obtain a fresh source-byte receipt for the
    // already-uploaded original video. It is deliberately narrower than the
    // other READY recoveries: a second read-only verification is the only next
    // operation, even when inspect finds a repairable field.
    if (!userControl && !inputChannelBroken) await invoke("wechat_channels", "verify");
    const complete = !userControl && !inputChannelBroken
      && state.platforms.wechat_channels.verdict?.ready === true;
    state.status = userControl ? "paused_user" : complete ? "ready" : "blocked";
    const plan = await maybeCleanupSpaces(args, state, { complete: false, userControl, inputChannelBroken, incomingInProgress });
    await persistKeepSpace(store, state, args, plan?.closeCurrent === true);
    await store.close();
    console.log(JSON.stringify(summary(state, args.platforms, store.statePath), null, 2));
    if (!complete || userControl) process.exitCode = 10;
    return;
  }
  if (args.inspectOnly) {
    const hardBlocked = args.platforms.some(platform => ["blocked", "blocked_user", "blocked_foreign_draft"].includes(state.platforms[platform].status));
    const allReady = Object.values(state.platforms).every(item => item.verdict?.ready === true);
    state.status = incomingStatus === "ready"
      ? (allReady ? "ready" : "blocked")
      : incomingInProgress ? incomingStatus : (hardBlocked ? "blocked" : "inspected");
    const plan = await maybeCleanupSpaces(args, state, { complete: false, userControl, inputChannelBroken, incomingInProgress });
    await persistKeepSpace(store, state, args, plan?.closeCurrent === true);
    await store.close();
    console.log(JSON.stringify(summary(state, args.platforms, store.statePath), null, 2));
    if (hardBlocked || userControl) process.exitCode = 10;
    return;
  }

  if (userControl) {
    state.status = "paused_user";
    await store.save(); await store.close();
    console.log(JSON.stringify(summary(state, args.platforms, store.statePath), null, 2));
    process.exitCode = 10; return;
  }

  const ui = new SerialQueue();
  const quarantineTargets = inputChannelBroken ? [] : runnablePlatforms.filter(key => state.platforms[key].status === "needs_quarantine");
  for (const platform of quarantineTargets) {
    if (inputChannelBroken || userControl) break;
    await ui.enqueue(async () => {
      if (inputChannelBroken || userControl) return;
      const result = await invoke(platform, "quarantine");
      if (!inputChannelBroken && !userControl && result.observation.quarantine?.safeToUpload) await invoke(platform, "inspect");
    });
  }

  const terminalStatuses = new Set(["blocked", "blocked_user", "blocked_foreign_draft"]);
  const canAdvance = platform => !terminalStatuses.has(state.platforms[platform].status)
    && ["ready", "needs_mutation"].includes(state.platforms[platform].status);
  const advancementTasks = new Map();

  function scheduleAdvance(platform) {
    if (advancementTasks.has(platform)) return advancementTasks.get(platform);
    const task = ui.enqueue(async () => {
      if (inputChannelBroken || userControl || !canAdvance(platform)) return;

      if (state.platforms[platform].status === "needs_mutation") {
        await invoke(platform, "mutate");
        if (inputChannelBroken || userControl || terminalStatuses.has(state.platforms[platform].status)) return;
      }

      await invoke(platform, "verify");
      if (inputChannelBroken || userControl || terminalStatuses.has(state.platforms[platform].status)) return;

      // One targeted retry is allowed only for an idempotent mutation whose fresh
      // verifier returned STATE_AMBIGUOUS. Typed action/auth/risk-control failures
      // freeze only that platform and are never looped.
      const verdict = state.platforms[platform].verdict;
      if (state.platforms[platform].status === "needs_mutation"
        && verdict?.blocker?.code === BLOCKER.STATE_AMBIGUOUS) {
        await invoke(platform, "mutate");
        if (inputChannelBroken || userControl || terminalStatuses.has(state.platforms[platform].status)) return;
        await invoke(platform, "verify");
      }
    }).then(
      () => ({ platform, error: null }),
      error => ({ platform, error }),
    );
    advancementTasks.set(platform, task);
    return task;
  }

  // Start every missing upload first. Platforms with live-proven editable upload
  // states may prefill metadata through the same one-wide UI queue, then resume
  // their completion wait before final mutation and verification.
  const uploadTargets = recoveryContract || channelsBlobContract || emptyContract?.mode==='injected_body' || inputChannelBroken || userControl || args.operation === "replace-cover" ? [] : runnablePlatforms.filter(platform => state.platforms[platform].status === "needs_upload");
  console.error(`[video-publisher-v2] upload parallel=${args.uploadConcurrency}: ${uploadTargets.join(",") || "none"}`);
  const uploadPool = runPool(uploadTargets, args.uploadConcurrency, async platform => {
    if (inputChannelBroken || userControl) return;
    if (EARLY_PREFILL_PLATFORMS.has(platform)) {
      const started=await invoke(platform, "upload_start");
      if (inputChannelBroken || userControl || terminalStatuses.has(state.platforms[platform].status)) return;
      if (started.observation.actions?.upload?.stage === "editable_uploading") {
        let prefillResult = null;
        await ui.enqueue(async () => {
          if (inputChannelBroken || userControl || terminalStatuses.has(state.platforms[platform].status)) return;
          prefillResult = await invoke(platform, "prefill");
        });
        if (inputChannelBroken || userControl) return;
        if (terminalStatuses.has(state.platforms[platform].status)) {
          const prefillVerdict = prefillResult?.verdict;
          const safeToDefer = prefillVerdict?.blocker?.retryable === true
            && prefillVerdict?.gates?.video?.evidence?.uploading === true
            && ![BLOCKER.AUTH_REQUIRED, BLOCKER.USER_CONTROL, BLOCKER.BROWSER_PERMISSION_REQUIRED, BLOCKER.INPUT_CHANNEL_BROKEN, BLOCKER.RISK_CONTROL]
              .includes(prefillVerdict?.blocker?.code);
          if (!safeToDefer) return;
          state.platforms[platform].status = "needs_upload";
          await store.save();
          console.error(`[video-publisher-v2] ${platform} prefill deferred until upload completion: ${prefillVerdict.blocker.code}`);
        }
      }
      if (canAdvance(platform)) {
        // XHS early prefill can finish processing before the completion phase.
        // Obtain the same uploaded file's native completion observation/receipt,
        // without reinjecting it, before advancing the final fields.
        if (platform === "xiaohongshu" && !state.platforms[platform].videoReceipt) {
          await invoke(platform, "upload");
          if (inputChannelBroken || userControl || !canAdvance(platform)) return;
        }
        scheduleAdvance(platform);
        return;
      }
      if (state.platforms[platform].status !== "needs_upload") return;
    }
    await invoke(platform, "upload");
    if (!inputChannelBroken && !userControl && canAdvance(platform)) scheduleAdvance(platform);
  });

  const immediateTargets = runnablePlatforms.filter(platform => canAdvance(platform));
  console.error(`[video-publisher-v2] rolling UI serial: ${immediateTargets.join(",") || "waiting for uploads"}`);
  for (const platform of immediateTargets) {
    if (platform === "xiaohongshu" && !state.platforms[platform].videoReceipt) {
      if (inputChannelBroken || userControl) break;
      await invoke(platform, "upload");
      if (inputChannelBroken || userControl || !canAdvance(platform)) continue;
    }
    scheduleAdvance(platform);
  }

  await uploadPool;
  const advancementResults = await Promise.all([...advancementTasks.values()]);
  const advancementFailure = advancementResults.find(result => result.error);
  if (advancementFailure) throw advancementFailure.error;
  await ui.idle();

  // INPUT_CHANNEL_BROKEN remains invocation-wide. Work already completed before the
  // signal stays recorded; no new mutation starts after it. One final read-only pass
  // covers only platforms that have not already completed their rolling verification.
  if (inputChannelBroken && !userControl) {
    const verifyTargets = runnablePlatforms.filter(platform => !verifiedPlatforms.has(platform));
    console.error(`[video-publisher-v2] input channel broken; final verify parallel=${args.checkConcurrency}: ${verifyTargets.join(",") || "none"}`);
    await runPool(verifyTargets, args.checkConcurrency, platform => userControl ? null : invoke(platform, "verify"));
  }

  const complete = args.platforms.every(platform => state.platforms[platform].verdict?.ready === true);
  const allReady = Object.values(state.platforms).every(item => item.verdict?.ready === true);
  state.status = userControl ? "paused_user" : allReady ? "ready" : "blocked";
  const plan = await maybeCleanupSpaces(args, state, { complete, userControl, inputChannelBroken, incomingInProgress });
  await persistKeepSpace(store, state, args, plan?.closeCurrent === true);
  await store.close();
  console.log(JSON.stringify(summary(state, args.platforms, store.statePath, douyinPersonalInspectFailure||douyinPersonalPostResultDraftFailure||douyinPreparationScopeFailure||douyinInputMissingFailure), null, 2));
  if (!complete) process.exitCode = 10;
}

async function maybeCleanupSpaces(args, state, { complete, userControl, inputChannelBroken = false, incomingInProgress = false }) {
  const plan = buildCleanupPlan(args, state, { complete, userControl, inputChannelBroken, incomingInProgress });
  if (!plan) return null;
  try {
    const cleaned = await cleanupTaskSpaces(plan);
    if (cleaned.closed.length) {
      console.error(`[video-publisher-v2] closed task spaces: ${cleaned.closed.map(item => item.name || item.id).join(", ")}`);
    }
  } catch (error) {
    console.error(`[video-publisher-v2] task space cleanup skipped: ${String(error?.message || error)}`);
  }
  return plan;
}

function summary(state, platforms, statePath, preparationFailure = null) {
  return {
    schemaVersion: 4,
    jobId: state.jobId,
    operation: state.revisions?.at(-1)?.operation || "unknown",
    status: state.status,
    ready: platforms.every(platform => state.platforms[platform].verdict?.ready === true),
    finalPublishClicked: finalPublishClickStatus(state, platforms),
    statePath,
    ...(preparationFailure ? { preparationFailure } : {}),
    scheduler: state.scheduler,
    platforms: Object.fromEntries(platforms.map(platform => {
      const item = state.platforms[platform];
      return [platform, { status: item.status, taskSpaceId: item.taskSpaceId, ready: item.verdict?.ready === true, missing: item.verdict?.missing || [], blocker: item.verdict?.blocker || null, evidencePath: item.lastEvidencePath || null }];
    })),
  };
}

main()
  .catch(error => {
    if (error?.douyinPreparationFailure) {
      console.log(JSON.stringify({ ok: false, status: "BLOCKED", preparationFailure: error.douyinPreparationFailure }, null, 2));
      console.error(`[video-publisher-v2] Douyin preparation-scope init blocked: ${error.douyinPreparationFailure.code}`);
    } else console.error(`[video-publisher-v2] fatal: ${String(error?.stack || error)}`);
    process.exitCode = error instanceof UsageError ? 2 : error instanceof JobBusyError ? 1 : 1;
  })
  .finally(() => {
    for (const release of activeLockReleases.reverse()) release();
  });
