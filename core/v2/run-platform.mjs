#!/usr/bin/env node
import {isPersonalExistingVideoContract,assertPersonalExistingVideoContract,readPersonalExistingVideoExecutionPackage,validatePersonalExistingVideoIdentity} from '../lib/douyin-personal-existing-video-resume.mjs';
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  coverForPlatform,
  readPackage,
  validateBilibiliPackage,
  validateDouyinPackage,
  validateWechatChannelsPackage,
  validateXiaohongshuPackage,
  validateYoutubePackage,
} from "../lib/content-package.mjs";
import { loadConfig } from "../lib/config.mjs";
import { inspectMediaFile, validateMediaForPlatform } from "../lib/media.mjs";
import { douyinCreatorReaderFragment } from "../lib/douyin-creator-reader-fragment.mjs";
import { acquireJobLock, assertJobLockOwner, registerJobLockMember, resolvePublisherLockDirectory } from "./lib/job-lock.mjs";
import { PLATFORMS, requiredGates } from "./lib/model.mjs";
import { acquirePlatformLock } from "./lib/platform-lock.mjs";
import { parseV2Result, sanitizeV2Diagnostic, V2_RESULT_PREFIX } from "./lib/result-line.mjs";
import { buildIdentity } from "./lib/identity.mjs";
import {
  assertDouyinPersonalInspectOnlyRunnerContract,
  buildDouyinPersonalInspectOnlyMutationEvidence,
  DOUYIN_PERSONAL_INSPECT_ONLY_ENV,
} from "./lib/douyin-personal-inspect-only.mjs";
import {
  assertDouyinPersonalPostResultSurfaceRunnerContract,
  DOUYIN_PERSONAL_POST_RESULT_SURFACE_ENV,
  assertDouyinPersonalPostResultDraftInspectionRunnerContract,
  assertDouyinPersonalPostResultDraftFreshUploadObservation,
  DOUYIN_PERSONAL_POST_RESULT_DRAFT_ENV,
} from "../lib/douyin-personal-post-result-recovery.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const validators = {
  xiaohongshu: validateXiaohongshuPackage,
  douyin: validateDouyinPackage,
  bilibili: validateBilibiliPackage,
  wechat_channels: validateWechatChannelsPackage,
  youtube: validateYoutubePackage,
};
const platformFiles = {
  xiaohongshu: "xiaohongshu.mjs",
  douyin: "douyin.mjs",
  bilibili: "bilibili.mjs",
  wechat_channels: "wechat-channels.mjs",
  youtube: "youtube.mjs",
};

function usage() {
  return "Usage: run-platform.mjs <platform> <package.json> <inspect|upload_start|prefill|upload|mutate|verify|quarantine> [task-suffix] [task-space-id] [--confirm-original-rights]";
}

function runEgo(script, onSpawn) {
  return new Promise((resolve, reject) => {
    const child = spawn(isPersonalExistingVideoContract(personalExistingContract)?"ego-browser":process.env.VIDEO_PUBLISHER_V2_EGO_COMMAND || "ego-browser", ["nodejs"], { stdio: ["pipe", "pipe", "pipe"] });
    let releaseMember = () => {};
    let settled = false;
    const fail = error => {
      releaseMember();
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.on("error", fail);
    try {
      releaseMember = onSpawn(child.pid);
    } catch (error) {
      child.kill("SIGTERM");
      fail(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", code => {
      releaseMember();
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(script);
  });
}

const rawArgs = process.argv.slice(2);
const originalRightsConfirmed = rawArgs.includes("--confirm-original-rights");
const positional = rawArgs.filter(arg => arg !== "--confirm-original-rights");
if (positional.some(arg => arg.startsWith("--"))) {
  console.error(usage());
  process.exit(2);
}
const [platform, rawPackagePath, phase, taskSuffix = "manual", taskSpaceRef = ""] = positional;
if (!PLATFORMS.includes(platform) || !rawPackagePath || !["inspect", "upload_start", "prefill", "upload", "mutate", "verify", "quarantine"].includes(phase)) {
  console.error(usage());
  process.exit(2);
}
if (phase === "quarantine" && platform !== "bilibili") {
  console.error("quarantine is supported only for bilibili");
  process.exit(2);
}
const config = loadConfig({ requireOnboarded: true });
if (!config.availablePlatforms.includes(platform)) {
  console.error(`Platform is not configured as available: ${platform}. Update Video Publisher onboarding before browser work.`);
  process.exit(2);
}
const standingOriginalityPolicy = config.declarations.originalityPolicy === "all_videos_original";
if (phase === "mutate" && ["xiaohongshu", "bilibili", "wechat_channels"].includes(platform) && !standingOriginalityPolicy && !originalRightsConfirmed) {
  console.error(`Originality confirmation is required before ${platform} mutation; set declarations.originalityPolicy=all_videos_original during onboarding, or add --confirm-original-rights after confirming this run.`);
  process.exit(2);
}
const packagePath = path.resolve(rawPackagePath);
if (!fs.existsSync(packagePath)) throw new Error(`Package JSON not found: ${packagePath}`);
const pkg = readPackage(packagePath);
const personalExistingContract=JSON.parse(process.env.VIDEO_PUBLISHER_NATIVE_RECOVERY||'null');
if(isPersonalExistingVideoContract(personalExistingContract)){
 assertPersonalExistingVideoContract(personalExistingContract,{packagePath,phase,platform,taskSpaceRef,taskSuffix});
 const exact=readPersonalExistingVideoExecutionPackage(packagePath,personalExistingContract);
 await validatePersonalExistingVideoIdentity(await buildIdentity(exact),personalExistingContract);
 if(process.env.VIDEO_PUBLISHER_V2_FINGERPRINT!==personalExistingContract.fingerprint)throw new Error('PERSONAL_EXISTING_RUNNER_FINGERPRINT_CHANGED');
}
let douyinPersonalInspectOnlyContract = null;
let douyinPersonalPostResultSurfaceContract = null;
let douyinPersonalPostResultDraftContinuationContract = null;
if (Object.hasOwn(process.env, DOUYIN_PERSONAL_POST_RESULT_SURFACE_ENV)) {
  if (Object.hasOwn(process.env, DOUYIN_PERSONAL_INSPECT_ONLY_ENV)) throw new Error("DOUYIN_PERSONAL_INSPECT_ONLY_CONFLICTING_SCOPE");
  if (platform !== "douyin" || phase !== "inspect") throw new Error("DOUYIN_PERSONAL_POST_RESULT_SURFACE_PHASE_FORBIDDEN");
  try { douyinPersonalPostResultSurfaceContract = JSON.parse(process.env[DOUYIN_PERSONAL_POST_RESULT_SURFACE_ENV]); }
  catch { throw new Error("DOUYIN_PERSONAL_POST_RESULT_SURFACE_CONTRACT_INVALID"); }
  const identity = await buildIdentity(pkg);
  assertDouyinPersonalPostResultSurfaceRunnerContract({
    contract: douyinPersonalPostResultSurfaceContract,
    platform, phase, taskSuffix, taskSpaceRef, packagePath,
    packageBytes: fs.readFileSync(packagePath), pkg, fingerprint: identity.fingerprint,
  });
  const forbiddenResumeEnvs = [
    "VIDEO_PUBLISHER_NATIVE_RECOVERY", "VIDEO_PUBLISHER_DOUYIN_PREFLIGHT_RESUME",
    "VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME", "VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_RESUME",
    "VIDEO_PUBLISHER_DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME", "VIDEO_PUBLISHER_DOUYIN_PERSONAL_INSPECT_ONLY",
    "VIDEO_PUBLISHER_DOUYIN_PREPARATION_SCOPE_RESUME", "VIDEO_PUBLISHER_CHANNELS_PREFLIGHT_RESUME",
    "VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY", "VIDEO_PUBLISHER_EMPTY_INPUT_RESUME",
  ];
  if (forbiddenResumeEnvs.some(name => Object.hasOwn(process.env, name))) throw new Error("DOUYIN_PERSONAL_POST_RESULT_SURFACE_CONFLICTING_SCOPE");
}
if (Object.hasOwn(process.env, DOUYIN_PERSONAL_POST_RESULT_DRAFT_ENV)) {
  if (Object.hasOwn(process.env, DOUYIN_PERSONAL_INSPECT_ONLY_ENV)
      || Object.hasOwn(process.env, DOUYIN_PERSONAL_POST_RESULT_SURFACE_ENV)) throw new Error("DOUYIN_PERSONAL_POST_RESULT_DRAFT_CONFLICTING_SCOPE");
  if (platform !== "douyin") throw new Error("DOUYIN_PERSONAL_POST_RESULT_DRAFT_PLATFORM_FORBIDDEN");
  try { douyinPersonalPostResultDraftContinuationContract = JSON.parse(process.env[DOUYIN_PERSONAL_POST_RESULT_DRAFT_ENV]); }
  catch { throw new Error("DOUYIN_PERSONAL_POST_RESULT_DRAFT_CONTRACT_INVALID"); }
  const exactPackageForIdentity = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const identity = await buildIdentity(exactPackageForIdentity);
  assertDouyinPersonalPostResultDraftInspectionRunnerContract({
    contract: douyinPersonalPostResultDraftContinuationContract,
    platform, phase, taskSuffix, taskSpaceRef, packagePath,
    packageBytes: fs.readFileSync(packagePath), pkg: exactPackageForIdentity, fingerprint: identity.fingerprint,
  });
  const forbiddenResumeEnvs = [
    "VIDEO_PUBLISHER_NATIVE_RECOVERY", "VIDEO_PUBLISHER_DOUYIN_PREFLIGHT_RESUME",
    "VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME", "VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_RESUME",
    "VIDEO_PUBLISHER_DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME", "VIDEO_PUBLISHER_DOUYIN_PREPARATION_SCOPE_RESUME",
    "VIDEO_PUBLISHER_DOUYIN_PERSONAL_INSPECT_ONLY",
    "VIDEO_PUBLISHER_CHANNELS_PREFLIGHT_RESUME", "VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY",
    "VIDEO_PUBLISHER_EMPTY_INPUT_RESUME",
  ];
  if (forbiddenResumeEnvs.some(name => Object.hasOwn(process.env, name))) throw new Error("DOUYIN_PERSONAL_POST_RESULT_DRAFT_CONFLICTING_SCOPE");
}
if (Object.hasOwn(process.env, DOUYIN_PERSONAL_INSPECT_ONLY_ENV)) {
  if (platform !== "douyin" || phase !== "inspect") throw new Error("DOUYIN_PERSONAL_INSPECT_ONLY_PHASE_FORBIDDEN");
  try { douyinPersonalInspectOnlyContract = JSON.parse(process.env[DOUYIN_PERSONAL_INSPECT_ONLY_ENV]); }
  catch { throw new Error("DOUYIN_PERSONAL_INSPECT_ONLY_CONTRACT_INVALID"); }
  const identity = await buildIdentity(pkg);
  assertDouyinPersonalInspectOnlyRunnerContract({
    contract: douyinPersonalInspectOnlyContract,
    platform, phase, taskSuffix, taskSpaceRef, packagePath,
    packageBytes: fs.readFileSync(packagePath), pkg, fingerprint: identity.fingerprint,
  });
  const forbiddenResumeEnvs = [
    "VIDEO_PUBLISHER_NATIVE_RECOVERY", "VIDEO_PUBLISHER_DOUYIN_PREFLIGHT_RESUME",
    "VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME", "VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_RESUME",
    "VIDEO_PUBLISHER_DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME",
    "VIDEO_PUBLISHER_DOUYIN_PREPARATION_SCOPE_RESUME", "VIDEO_PUBLISHER_CHANNELS_PREFLIGHT_RESUME",
    "VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY", "VIDEO_PUBLISHER_EMPTY_INPUT_RESUME",
  ];
  if (forbiddenResumeEnvs.some(name => Object.hasOwn(process.env, name))) throw new Error("DOUYIN_PERSONAL_INSPECT_ONLY_CONFLICTING_SCOPE");
}
let douyinWindowBindingResumeContract = null;
let douyinWindowExpectedUid = "";
let douyinWindowProofStage = "";
if (Object.hasOwn(process.env, "VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_RESUME")) {
  if (platform !== "douyin" || !["inspect", "verify", "upload_start"].includes(phase)) {
    throw new Error("DOUYIN_WINDOW_BINDING_PHASE_SCOPE_INVALID");
  }
  try {
    douyinWindowBindingResumeContract = JSON.parse(process.env.VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_RESUME);
  } catch {
    throw new Error("DOUYIN_WINDOW_BINDING_CONTRACT_INVALID");
  }
  if (!douyinWindowBindingResumeContract || typeof douyinWindowBindingResumeContract !== "object"
      || douyinWindowBindingResumeContract.resumeType !== "douyin_same_job_window_binding_recovery"
      || douyinWindowBindingResumeContract.platform !== "douyin"
      || !douyinWindowBindingResumeContract.oldBinding || !douyinWindowBindingResumeContract.executionBinding) {
    throw new Error("DOUYIN_WINDOW_BINDING_CONTRACT_INVALID");
  }
  douyinWindowExpectedUid = process.env.VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_EXPECTED_UID || "";
  douyinWindowProofStage = process.env.VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_STAGE || "";
  if (!/^\d+$/.test(douyinWindowExpectedUid) || !["preclaim", "locked-init", "before-upload", "before-final-click"].includes(douyinWindowProofStage)) {
    throw new Error("DOUYIN_WINDOW_BINDING_EPHEMERAL_PROOF_INPUT_INVALID");
  }
}
const media = inspectMediaFile(pkg.videoPath);
const errors = [...validators[platform](pkg), ...validateMediaForPlatform(pkg, platform, media)];
if (errors.length) throw new Error(`Package preflight failed for ${platform}: ${errors.join("; ")}`);

const header = [
  'import fs from "node:fs";',
  'import path from "node:path";',
  'import crypto from "node:crypto";',
  ...(platform === "douyin" ? [`import { compareDouyinCoverPixels, probeDouyinCoverPixels } from ${JSON.stringify(path.resolve(DIR, "../lib/douyin-cover-native.mjs"))};`] : []),
  ...(platform === "douyin" ? [`import { DOUYIN_POI_NATIVE_CONTRACT, validateDouyinPoiReceipt, probeDouyinPoiMounted, readDouyinPoiReactOption, readDouyinPoiMountedRecord, assessDouyinPoiCandidate, verifyDouyinPoiIntent } from ${JSON.stringify(path.resolve(DIR, "../lib/douyin-poi-native.mjs"))};`] : []),
  `const platform = ${JSON.stringify(platform)};`,
  `const phase = ${JSON.stringify(phase)};`,
  `const taskName = ${JSON.stringify(douyinWindowBindingResumeContract?.executionBinding?.spaceName || process.env.VIDEO_PUBLISHER_V2_TASK_NAME || `video publisher v2 ${platform} ${taskSuffix}`)};`,
  `const taskSpaceRef = ${JSON.stringify(douyinWindowBindingResumeContract?.executionBinding?.spaceId == null ? taskSpaceRef : String(douyinWindowBindingResumeContract.executionBinding.spaceId))};`,
  `const packagePath = ${JSON.stringify(packagePath)};`,
  `const pkg = ${JSON.stringify({ ...pkg, cover: coverForPlatform(pkg, platform) })};`,
  `const videoPath = ${JSON.stringify(path.resolve(pkg.videoPath))};`,
  `const expectedReceipts = ${JSON.stringify(JSON.parse(process.env.VIDEO_PUBLISHER_V2_RECEIPTS || "{}"))};`,
  `const expectedVideoReceipt = ${JSON.stringify(JSON.parse(process.env.VIDEO_PUBLISHER_V2_VIDEO_RECEIPT || "null"))};`,
  `const receiptCheckpointPath = ${JSON.stringify(process.env.VIDEO_PUBLISHER_V2_CHECKPOINT_PATH || "")};`,
  `const channelsBlobRecovery = ${JSON.stringify(JSON.parse(process.env.VIDEO_PUBLISHER_CHANNELS_BLOB_RECOVERY||'null'))};`,
  `const nativeRecovery = ${JSON.stringify(JSON.parse(process.env.VIDEO_PUBLISHER_NATIVE_RECOVERY || "null"))};`,
  `const xhsResumeContract = ${JSON.stringify(JSON.parse(process.env.VIDEO_PUBLISHER_EMPTY_INPUT_RESUME||'null'))};`,
  `const emptyInputResume = ${JSON.stringify(JSON.parse(process.env.VIDEO_PUBLISHER_EMPTY_INPUT_RESUME||'null')?.mode==='empty_input')};`,
  `const jobFingerprint = ${JSON.stringify(process.env.VIDEO_PUBLISHER_V2_FINGERPRINT || "")};`,
  ...(platform === "douyin" ? [
    `const douyinPersonalInspectOnlyActive = ${JSON.stringify(douyinPersonalInspectOnlyContract !== null || douyinPersonalPostResultSurfaceContract !== null || (douyinPersonalPostResultDraftContinuationContract !== null && phase === "inspect"))};`,
    `const douyinPersonalInspectOnlyContract = ${JSON.stringify(douyinPersonalInspectOnlyContract)};`,
    `const douyinPersonalPostResultSurfaceRecoveryActive = ${JSON.stringify(douyinPersonalPostResultSurfaceContract !== null)};`,
    `const douyinPersonalPostResultSurfaceRecoveryContract = ${JSON.stringify(douyinPersonalPostResultSurfaceContract)};`,
    `const douyinPersonalPostResultDraftContinuationActive = ${JSON.stringify(douyinPersonalPostResultDraftContinuationContract !== null)};`,
    `const douyinPersonalPostResultDraftContinuationContract = ${JSON.stringify(douyinPersonalPostResultDraftContinuationContract)};`,
    `const assertDouyinPersonalPostResultDraftFreshUploadObservation = ${assertDouyinPersonalPostResultDraftFreshUploadObservation.toString()};`,
    `const douyinPersonalInspectOnlyMutationEvidence = ${buildDouyinPersonalInspectOnlyMutationEvidence.toString()};`,
    `const douyinPreparationScopeResumeActive = ${JSON.stringify(Object.hasOwn(process.env, "VIDEO_PUBLISHER_DOUYIN_PREPARATION_SCOPE_RESUME") && Boolean(process.env.VIDEO_PUBLISHER_DOUYIN_PREPARATION_SCOPE_RESUME))};`,
    `const douyinInputMissingResumeActive = ${JSON.stringify(Object.hasOwn(process.env, "VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME"))};`,
    `const douyinInputMissingResumeContract = ${JSON.stringify(Object.hasOwn(process.env, "VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME") ? JSON.parse(process.env.VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME) : null)};`,
    `const douyinInputMissingExpectedIdentity = ${JSON.stringify(Object.hasOwn(process.env, "VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME") ? JSON.parse(process.env.VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_EXPECTED_IDENTITY || "null") : null)};`,
    ...(douyinWindowBindingResumeContract ? [
      `const douyinWindowBindingResumeActive = true;`,
      `const douyinWindowBindingResumeContract = ${JSON.stringify(douyinWindowBindingResumeContract)};`,
      `const douyinExecutionBinding = ${JSON.stringify({
        ...pkg.schoolAccount,
        egoProfileId: douyinWindowBindingResumeContract.executionBinding.profileId,
        taskSpaceId: douyinWindowBindingResumeContract.executionBinding.spaceId,
        taskSpaceName: douyinWindowBindingResumeContract.executionBinding.spaceName,
        pageLabel: douyinWindowBindingResumeContract.executionBinding.pageLabel,
        targetId: douyinWindowBindingResumeContract.executionBinding.targetId,
      })};`,
      `const douyinWindowExpectedUid = ${JSON.stringify(douyinWindowExpectedUid)};`,
      `const douyinWindowProofStage = ${JSON.stringify(douyinWindowProofStage)};`,
    ] : []),
  ] : []),
].join("\n");
const fragments = [
  header,
  ...(pkg.schoolAccount ? [fs.readFileSync(path.join(DIR, "ego", "school-runtime.mjs"), "utf8")] : []),
  ...(platform === "douyin" && (pkg.schoolAccount?.accountId || pkg.schoolAccount?.apiUid) ? [douyinCreatorReaderFragment(platform, pkg)] : []),
  fs.readFileSync(path.join(DIR, "ego", "core.mjs"), "utf8"),
  fs.readFileSync(path.join(DIR, "ego", "native-video-recovery.mjs"), "utf8").replace(/^export /mg,""),
  fs.readFileSync(path.join(DIR, "platforms", platformFiles[platform]), "utf8"),
  fs.readFileSync(path.join(DIR, "platforms", "dispatch.mjs"), "utf8"),
].join("\n\n");

const publisherLockDirectory = resolvePublisherLockDirectory();
const inheritedPublisherToken = process.env.VIDEO_PUBLISHER_V2_PUBLISHER_LOCK_TOKEN || "";
const releasePublisherLock = inheritedPublisherToken
  ? (assertJobLockOwner(publisherLockDirectory, inheritedPublisherToken), () => {})
  : acquireJobLock(publisherLockDirectory, {
    jobId: `direct-${platform}-${phase}`,
    packagePath,
    scope: "publisher",
  });
const activePublisherToken = inheritedPublisherToken || releasePublisherLock.token;
let releasePlatformLock = () => {};
let execution;
try {
  releasePlatformLock = acquirePlatformLock(platform, phase);
  try {
    execution = await runEgo(fragments, pid => registerJobLockMember(publisherLockDirectory, activePublisherToken, {
      pid,
      role: `${platform}:${phase}:ego`,
    }));
  } catch (error) {
    execution = { code: 1, stdout: "", stderr: String(error?.stack || error) };
  }
} finally {
  releasePlatformLock();
  releasePublisherLock();
}
const combined = `${execution.stdout}\n${execution.stderr}`;
let result;
try {
  result = parseV2Result(combined, "Ego runner", { expectedUid: douyinWindowBindingResumeContract ? douyinWindowExpectedUid : "" });
} catch (error) {
  const detail = sanitizeV2Diagnostic(combined.trim().slice(-1600), { expectedUid: douyinWindowBindingResumeContract ? douyinWindowExpectedUid : "" });
  const permissionPrompt = /browser permission prompt|permission prompt.*(?:location|access)|resume only after the user confirms/i.test(detail);
  const userControl = permissionPrompt || /user (?:has|had) taken control|user took control|user is controlling|user controls|用户.*控制|not assigned to an agent|task space.*inactive/i.test(detail);
  if (execution.code === 0 && detail) {
    console.error(detail);
    throw new Error("EGO_RUNNER_STRUCTURED_OBSERVATION_INVALID", { cause: error });
  }
  const failureEvidence = { reason: "ego runner unavailable", exitCode: execution.code, detail };
  const gates = Object.fromEntries(requiredGates(platform).map(name => [name, { ok: false, evidence: failureEvidence }]));
  gates.safety = { ok: false, evidence: { finalPublishClicked: false, guardArmed: false, blockedAttempts: 0 } };
  result = {
    schemaVersion: 1,
    platform,
    phase,
    taskSpaceId: Number(taskSpaceRef) || null,
    observedAt: new Date().toISOString(),
    finalPublishClicked: false,
    gates,
    blocker: {
      code: permissionPrompt ? "BROWSER_PERMISSION_REQUIRED" : userControl ? "USER_CONTROL" : "INPUT_CHANNEL_BROKEN",
      message: permissionPrompt ? "浏览器权限提示已将原空间交还用户；等待用户处理，不自动修改权限或重传" : userControl ? "Ego Lite 任务空间已由用户接管" : "Ego Lite 已退出或无法返回页面证据",
      retryable: !userControl,
      requiresUser: userControl,
      evidence: failureEvidence,
    },
  };
}
console.log(V2_RESULT_PREFIX + JSON.stringify(result));
