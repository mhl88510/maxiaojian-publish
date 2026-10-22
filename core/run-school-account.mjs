#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assessAccountHeaderIdentity,
  assessDouyinApiIdentity,
  assessEgoSpaceOwnership,
  isPlatformUrl,
  readAccountMatrix,
  resolveAccountMatrixPath,
  resolveSchoolAccountBinding,
  schoolAccountStateRoot,
} from "./lib/school-account.mjs";
import {
  readPackage,
  validateBilibiliPackage,
  validateDouyinPackage,
  validateWechatChannelsPackage,
  validateXiaohongshuPackage,
  validateYoutubePackage,
} from "./lib/content-package.mjs";
import { douyinCreatorReaderFragment } from "./lib/douyin-creator-reader-fragment.mjs";
import { assertDouyinPristinePreflightResumeContract } from "./lib/douyin-preflight-resume.mjs";
import { assertDouyinPreparationScopeResumeContract, DOUYIN_PREPARATION_SCOPE_RESUME_ENV } from "./lib/douyin-preparation-scope-resume.mjs";
import { assertDouyinInputMissingLockedContract, DOUYIN_INPUT_MISSING_RESUME_TYPE } from "./lib/douyin-input-missing-resume.mjs";
import { assertDouyinPersonalInspectFailureResumeContract, DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_ENV, DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_TYPE } from "./lib/douyin-personal-inspect-failure-resume.mjs";
import { assertDouyinPersonalPostResultDraftContinuationContract, assertDouyinPersonalPostResultInitFailureContinuationContract, assertDouyinPersonalPostResultLockedInitFailureContinuationContract, assertDouyinPersonalPostResultLockedInitPathFailureContinuationContract, DOUYIN_PERSONAL_POST_RESULT_DRAFT_ENV, DOUYIN_PERSONAL_POST_RESULT_DRAFT_TYPE, DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_TYPE, DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_FAILURE_TYPE, DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_TYPE, DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_ENV } from "./lib/douyin-personal-post-result-recovery.mjs";
import { summarizeDouyinPersonalInspectV2Execution } from "./lib/douyin-personal-inspect-failure-diagnostics.mjs";
import { loadConfig } from "./lib/config.mjs";
import { inspectMediaFile, validateMediaForPlatform } from "./lib/media.mjs";
import { buildIdentity } from "./v2/lib/identity.mjs";
import { validatePersonalDouyinWriteAdmission } from './lib/personal-write-admission.mjs';

export const SCHOOL_EGO_MARKER = "SCHOOL_PUBLISHER_EGO_PREFLIGHT:";
const VALIDATORS = Object.freeze({
  xiaohongshu: validateXiaohongshuPackage,
  douyin: validateDouyinPackage,
  bilibili: validateBilibiliPackage,
  wechat_channels: validateWechatChannelsPackage,
  youtube: validateYoutubePackage,
});
const RIGHTS_PLATFORMS = new Set(["xiaohongshu", "bilibili", "wechat_channels"]);
const DOUYIN_WINDOW_BINDING_RESUME_TYPE = "douyin_same_job_window_binding_recovery";

function hasDouyinApiIdentityBinding(binding) {
  if (binding?.platform !== "douyin") return false;
  const present = value => value !== undefined && value !== null && value !== "";
  return present(binding.accountId) || present(binding.apiUid);
}

function parseArgs(argv) {
  let prepareDraft = false;
  let confirmOriginalRights = false;
  const positional = [];
  for (const arg of argv) {
    if (arg === "--prepare-draft") prepareDraft = true;
    else if (arg === "--confirm-original-rights") confirmOriginalRights = true;
    else if (arg.startsWith("--")) throw new Error(`Unsupported option: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw new Error("Usage: run-school-account.mjs <package.json> [--prepare-draft] [--confirm-original-rights]");
  return { packagePath: path.resolve(positional[0]), prepareDraft, confirmOriginalRights };
}

function runEgoScript(script, command = process.env.VIDEO_PUBLISHER_V2_EGO_COMMAND || "ego-browser") {
  const isScript = /\.(mjs|cjs|js)$/.test(command);
  return new Promise((resolve, reject) => {
    const child = spawn(isScript ? process.execPath : command, isScript ? [command] : ["nodejs"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(script);
  });
}

function parseEgoSnapshot(result) {
  const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
  const line = combined.split(/\r?\n/).find(item => item.startsWith(SCHOOL_EGO_MARKER));
  if (result.code !== 0 || !line) {
    return { ok: false, code: "EGO_PREFLIGHT_UNAVAILABLE", detail: combined.trim().slice(-1200) };
  }
  try {
    return JSON.parse(line.slice(SCHOOL_EGO_MARKER.length));
  } catch (error) {
    return { ok: false, code: "EGO_PREFLIGHT_INVALID", detail: String(error?.message || error) };
  }
}

export function assessEgoPreflightSnapshot(snapshot, binding) {
  if (!snapshot || snapshot.ok !== true) {
    return { ok: false, code: snapshot?.code || "EGO_PREFLIGHT_UNAVAILABLE", evidence: snapshot || null };
  }
  const space = assessEgoSpaceOwnership(snapshot.spaces || [], binding);
  if (!space.ok) return { ok: false, code: space.code, evidence: space };
  if (binding.egoProfileId && !(snapshot.spaces || []).some(s => Number(s.id) === binding.taskSpaceId && s.profileId === binding.egoProfileId)) return { ok: false, code: "PROFILE_BINDING_MISMATCH", evidence: { expectedProfileId: binding.egoProfileId } };
  if (Number(snapshot.task?.id) !== binding.taskSpaceId
    || String(snapshot.task?.name || "") !== binding.taskSpaceName
    || snapshot.task?.ownership !== "agent") {
    return { ok: false, code: "SPACE_IDENTITY_CHANGED", evidence: { task: snapshot.task || null } };
  }
  const page = snapshot.page;
  if (!page || page.label !== binding.pageLabel) {
    return { ok: false, code: "PAGE_NOT_FOUND", evidence: { expectedPageLabel: binding.pageLabel, page: page || null } };
  }
  if (!isPlatformUrl(page.url, binding.platform)) {
    return { ok: false, code: "PLATFORM_PAGE_MISMATCH", evidence: { expectedPlatform: binding.platform, url: page.url || "" } };
  }
  const usesDouyinApiIdentity = hasDouyinApiIdentityBinding(binding);
  if (usesDouyinApiIdentity) {
    const expectedGuard = {
      spaceId: binding.taskSpaceId,
      spaceName: binding.taskSpaceName,
      profileId: binding.egoProfileId,
      pageLabel: binding.pageLabel,
      targetId: binding.targetId,
      ownership: "agent",
    };
    const guard = snapshot.bindingGuard;
    const matchesExpected = record => record && Object.entries(expectedGuard).every(([key, value]) =>
      value !== undefined && value !== "" && record[key] === value);
    if (!binding.egoProfileId || !binding.targetId || !matchesExpected(guard?.before)
        || !matchesExpected(guard?.after) || guard.before.url !== guard.after.url
        || guard.after.url !== page.url || page.targetId !== binding.targetId
        || page.apiIdentityError) {
      return {
        ok: false,
        code: "ACCOUNT_IDENTITY_GUARD_FAILED",
        evidence: {
          before: guard?.before || null,
          after: guard?.after || null,
          expectedProfileId: binding.egoProfileId || null,
          expectedTargetId: binding.targetId || null,
          pageTargetId: page.targetId || null,
          identityReadError: page.apiIdentityError || null,
        },
      };
    }
  }
  const identity = usesDouyinApiIdentity
    ? assessDouyinApiIdentity(page.apiIdentity,binding,page.headerText)
    : assessAccountHeaderIdentity(page.headerText, binding);
  if (!identity.ok) return { ok: false, code: "ACCOUNT_IDENTITY_UNVERIFIED", evidence: { ...identity, pageLabel: page.label, url: page.url } };
  if (binding.platform === "douyin" && binding.accountKey === "reserved_personal_route") {
    const apiUid = page.apiIdentity?.uid;
    if (typeof apiUid !== "string" || !/^\d+$/.test(apiUid) || /^0+$/.test(apiUid)) {
      return { ok: false, code: "PERSONAL_DOUYIN_CREATOR_API_UID_UNAVAILABLE", evidence: { pageLabel: page.label, url: page.url } };
    }
  }
  return {
    ok: true,
    code: "PREFLIGHT_PASSED",
    evidence: {
      platform: binding.platform,
      accountKey: binding.accountKey,
      accountName: binding.accountName,
      taskSpaceId: binding.taskSpaceId,
      taskSpaceName: binding.taskSpaceName,
      pageLabel: page.label,
      url: page.url,
      identityMatchedBy: identity.matchedBy,
      ...(usesDouyinApiIdentity ? {creatorApiPublicIdField: page.apiIdentity?.publicIdField || "unique_id"} : {}),
      ownership: "agent",
      ...(binding.platform === "douyin" && binding.accountKey === "reserved_personal_route"
        ? {apiUid: page.apiIdentity.uid}
        : {}),
    },
  };
}

export async function runEgoPreflight(binding, { command } = {}) {


  const usesDouyinApiIdentity = hasDouyinApiIdentityBinding(binding);
  const apiUidPinned = binding.apiUid !== undefined && binding.apiUid !== null && binding.apiUid !== "";
  const apiUidFormatValid = !apiUidPinned || (typeof binding.apiUid === "string" && /^\d+$/.test(binding.apiUid));
  const accountIdFormatValid = typeof binding.accountId === "string" && /^\d+$/.test(binding.accountId);
  if (usesDouyinApiIdentity && (!accountIdFormatValid || !binding.egoProfileId || !binding.targetId || !apiUidFormatValid)) {
    return { ok: false, code: "ACCOUNT_IDENTITY_BINDING_INCOMPLETE", evidence: { profileBound: Boolean(binding.egoProfileId), targetBound: Boolean(binding.targetId), accountIdFormatValid, apiUidPinned, apiUidFormatValid } };
  }
  const creatorReaderFragment = douyinCreatorReaderFragment(binding.platform, { schoolAccount: { accountId: binding.accountId, apiUid: binding.apiUid } });
  const creatorInfoUrl = "https://creator.douyin.com/web/api/media/user/info/?aid=1128";
  const script = `
const marker = ${JSON.stringify(SCHOOL_EGO_MARKER)};
const expectedId = ${JSON.stringify(binding.taskSpaceId)};
const expectedName = ${JSON.stringify(binding.taskSpaceName)};
const expectedPage = ${JSON.stringify(binding.pageLabel)};
const expectedProfileId = ${JSON.stringify(binding.egoProfileId || "")};
const expectedTargetId = ${JSON.stringify(binding.targetId || "")};
const usesDouyinApiIdentity = ${JSON.stringify(usesDouyinApiIdentity)};
const allowPersonalShortIdFallback = ${JSON.stringify(binding.accountKey === "reserved_personal_route")};
const creatorInfoUrl = ${JSON.stringify(creatorInfoUrl)};
${creatorReaderFragment}
const spaces = await listTaskSpaces();
const matches = (spaces || []).filter(space => Number(space?.id) === expectedId && String(space?.name || '') === expectedName);
if (matches.length !== 1 || matches[0]?.ownership !== 'agent') {
  console.log(marker + JSON.stringify({ ok: true, spaces: matches, task: null, page: null }));
} else if (usesDouyinApiIdentity && matches[0]?.profileId !== expectedProfileId) {
  console.log(marker + JSON.stringify({ ok: false, code: 'PROFILE_BINDING_MISMATCH', evidence: { observedProfileId: matches[0]?.profileId || null } }));
} else {
  // taskSpace is only called after the read-only list proves this exact space is agent-owned.
  const task = await taskSpace(expectedId);
  if (Number(task?.spaceId) !== expectedId || String(task?.name || '') !== expectedName || task?.ownership !== 'agent') {
    console.log(marker + JSON.stringify({ ok: true, spaces: matches, task: { id: task?.spaceId ?? null, name: task?.name || '', ownership: task?.ownership || 'unknown' }, page: null }));
  } else {
    const tabs = await task.tabs();
    const tab = (tabs || []).find(item => item.label === expectedPage);
    if (!tab) {
      console.log(marker + JSON.stringify({ ok: true, spaces: matches, task: { id: task.spaceId, name: task.name, ownership: task.ownership }, page: null }));
  } else {
      const page = task.page(expectedPage);
      const captureBinding = async () => {
        const listed = await listTaskSpaces();
        const exactSpaces = (listed || []).filter(space => Number(space?.id) === expectedId && String(space?.name || '') === expectedName);
        if (exactSpaces.length !== 1 || exactSpaces[0]?.ownership !== 'agent') return { ok: false, reason: 'SPACE_NOT_EXACT_AGENT' };
        if (expectedProfileId && exactSpaces[0]?.profileId !== expectedProfileId) return { ok: false, reason: 'PROFILE_BINDING_MISMATCH' };
        const currentTask = await taskSpace(expectedId);
        if (Number(currentTask?.spaceId) !== expectedId || String(currentTask?.name || '') !== expectedName || currentTask?.ownership !== 'agent') return { ok: false, reason: 'SPACE_CHANGED' };
        const tabs = await currentTask.tabs();
        const pageTabs = (tabs || []).filter(item => item.label === expectedPage);
        if (pageTabs.length !== 1 || String(pageTabs[0]?.targetId || '') !== expectedTargetId) return { ok: false, reason: 'TARGET_BINDING_MISMATCH' };
        const currentPage = currentTask.page(expectedPage);
        const url = await currentPage.url();
        if (url !== pageTabs[0]?.url || new URL(url).hostname !== 'creator.douyin.com') return { ok: false, reason: 'TARGET_URL_MISMATCH' };
        return { ok: true, spaceId: Number(currentTask.spaceId), spaceName: String(currentTask.name), ownership: currentTask.ownership, profileId: exactSpaces[0].profileId, pageLabel: expectedPage, targetId: String(pageTabs[0].targetId), url };
      };
      const bindingBefore = usesDouyinApiIdentity ? await captureBinding() : null;
      if (usesDouyinApiIdentity && !bindingBefore?.ok) {
        console.log(marker + JSON.stringify({ ok: false, code: 'ACCOUNT_IDENTITY_GUARD_FAILED', evidence: { before: bindingBefore } }));
      } else {
      const state = await page.evaluate(async () => {
        const compact = value => String(value || '').replace(/\\s+/g, ' ').trim();
        const roots = [document, ...[...document.querySelectorAll('*')].map(el => el.shadowRoot).filter(Boolean)];
        let selectors = 'header, nav, [role="banner"], [class*="header"], [class*="Header"]' + ${JSON.stringify(binding.platform === "wechat_channels" ? ", .finder-info-container" : binding.platform === "xiaohongshu" ? ", .d-topbar .name-box" : "")};
    if (${JSON.stringify(binding.platform)} === 'wechat_channels' && location.pathname === '/platform/post/create') selectors += ', .full-screen-body .operate-bar .left-area .name';
        const headerText = roots.flatMap(root => [...root.querySelectorAll(selectors)])
          .filter(el => { const rect = el.getBoundingClientRect(), style = getComputedStyle(el); return rect.width > 4 && rect.height > 4 && style.display !== 'none' && style.visibility !== 'hidden'; })
          .map(el => compact([el.innerText, el.getAttribute('aria-label'), el.getAttribute('title'), ...[...el.querySelectorAll('img[alt], [aria-label], [title]')].map(child => [child.getAttribute('alt'), child.getAttribute('aria-label'), child.getAttribute('title')].filter(Boolean).join(' '))].filter(Boolean).join(' ')))
          .filter(Boolean).join(' | ');
        return { url: location.href, title: document.title, headerText };
      });
      let apiIdentity = null, apiIdentityError = null;
      if (usesDouyinApiIdentity) {
        try {
          const data = await creatorGet(page, creatorInfoUrl);
          const user = data?.user_info || data?.user;
          const exactId = value => typeof value === 'string' && /^\\d+$/.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
          // Personal creator API currently returns an empty unique_id while short_id matches the visible public Douyin ID.
          // Use that fallback only for reserved_personal_route and only when unique_id is explicitly blank; never hide a conflicting nonblank ID.
          const uniqueIdIsExplicitlyBlank = typeof user?.unique_id === 'string' && user.unique_id.trim() === '';
          const publicIdField = allowPersonalShortIdFallback && uniqueIdIsExplicitlyBlank ? 'short_id' : 'unique_id';
          apiIdentity = { status: 200, uid: exactId(user?.uid), nickname: typeof user?.nickname === 'string' ? user.nickname : '', unique_id: exactId(publicIdField === 'short_id' ? user?.short_id : user?.unique_id), publicIdField };
        } catch (error) { apiIdentityError = String(error?.message || error).slice(0, 160); }
      }
      const bindingAfter = usesDouyinApiIdentity ? await captureBinding() : null;
      const identityGuard = usesDouyinApiIdentity ? { before: bindingBefore?.ok ? (({ ok, ...record }) => record)(bindingBefore) : bindingBefore, after: bindingAfter?.ok ? (({ ok, ...record }) => record)(bindingAfter) : bindingAfter } : null;
      console.log(marker + JSON.stringify({ ok: true, spaces: matches, task: { id: task.spaceId, name: task.name, ownership: task.ownership }, bindingGuard: identityGuard, page: { label: expectedPage, targetId: bindingAfter?.targetId || null, ...state, apiIdentity, apiIdentityError } }));
      }
    }
  }
}
`;
  const result = await runEgoScript(script, command);
  return assessEgoPreflightSnapshot(parseEgoSnapshot(result), binding);
}

function loadWindowBindingExpectedUid(contract) {
  const pin=contract?.identitySafeFields;
  if(!pin?.path||pin.selector!=="identity.uid")throw Object.assign(new Error("DOUYIN_WINDOW_BINDING_SAFE_IDENTITY_PIN_INVALID"),{code:"DOUYIN_WINDOW_BINDING_SAFE_IDENTITY_PIN_INVALID"});
  const raw=fs.readFileSync(pin.path);
  if(crypto.createHash("sha256").update(raw).digest("hex")!==pin.sha256)throw Object.assign(new Error("DOUYIN_WINDOW_BINDING_SAFE_IDENTITY_HASH_CHANGED"),{code:"DOUYIN_WINDOW_BINDING_SAFE_IDENTITY_HASH_CHANGED"});
  const uid=JSON.parse(raw.toString("utf8"))?.identity?.uid;
  if(typeof uid!=="string"||!/^\d+$/.test(uid)||/^0+$/.test(uid))throw Object.assign(new Error("DOUYIN_WINDOW_BINDING_SAFE_IDENTITY_INVALID"),{code:"DOUYIN_WINDOW_BINDING_SAFE_IDENTITY_INVALID"});
  return uid;
}

export function buildDouyinWindowBindingResumePreflightScript(binding,contract,expectedUid) {
  if(!binding||binding.platform!=="douyin"||contract?.resumeType!==DOUYIN_WINDOW_BINDING_RESUME_TYPE||typeof expectedUid!=="string"||!/^\d+$/.test(expectedUid))throw Object.assign(new Error("DOUYIN_WINDOW_BINDING_PREFLIGHT_INPUT_INVALID"),{code:"DOUYIN_WINDOW_BINDING_PREFLIGHT_INPUT_INVALID"});
  const old=contract.oldBinding,execution=contract.executionBinding;
  const accountBinding={...binding,egoProfileId:execution.profileId,taskSpaceId:execution.spaceId,taskSpaceName:execution.spaceName,pageLabel:execution.pageLabel,targetId:execution.targetId};
  const creatorReaderFragment=douyinCreatorReaderFragment("douyin",{schoolAccount:accountBinding});
  return `
const marker=${JSON.stringify(SCHOOL_EGO_MARKER)};
const oldBinding=${JSON.stringify(old)};
const expected=${JSON.stringify({platform:"douyin",accountKey:"excluded_case_account",accountName:binding.accountName,accountId:binding.accountId,profileId:execution.profileId,spaceId:execution.spaceId,spaceName:execution.spaceName,ownership:"agent",pageLabel:execution.pageLabel,targetId:execution.targetId,url:"https://creator.douyin.com/creator-micro/content/upload"})};
const expectedUid=${JSON.stringify(expectedUid)};
const infoUrl="https://creator.douyin.com/web/api/media/user/info/?aid=1128";
${creatorReaderFragment}
const compact=value=>String(value||'').normalize('NFC').replace(/\\s+/g,' ').trim();
const exactId=value=>typeof value==='string'&&/^\\d+$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):null;
const inspect=async()=>{
 const inventory=await listTaskSpaces();
 const oldMatches=(inventory||[]).filter(space=>Number(space?.id)===Number(oldBinding.spaceId)||String(space?.name||'')===String(oldBinding.spaceName));
 const spaces=(inventory||[]).filter(space=>Number(space?.id)===Number(expected.spaceId)||String(space?.name||'')===String(expected.spaceName));
 const task=spaces.length===1?await taskSpace(expected.spaceId):null;
 const tabs=task?await task.tabs():[];
 const targets=(tabs||[]).filter(tab=>tab?.label===expected.pageLabel&&String(tab?.targetId||'')===expected.targetId);
 const page=targets.length===1?task.page(expected.pageLabel):null;
 const url=page?await page.url():'';
 return {inventory:(inventory||[]).map(space=>({id:Number(space.id),name:String(space.name||''),profileId:String(space.profileId||''),ownership:String(space.ownership||'')})),oldAbsent:oldMatches.length===0,newSpaceUnique:spaces.length===1&&spaces[0]?.ownership==='agent'&&spaces[0]?.profileId===expected.profileId&&Number(task?.spaceId)===expected.spaceId&&String(task?.name||'')===expected.spaceName&&task?.ownership==='agent',targetUnique:targets.length===1&&url===targets[0]?.url&&url===expected.url,binding:{profileId:spaces[0]?.profileId||'',spaceId:Number(task?.spaceId),spaceName:String(task?.name||''),ownership:task?.ownership||'',pageLabel:targets[0]?.label||'',targetId:String(targets[0]?.targetId||''),url}};
};
try {
 const before=await inspect();
 const page=before.targetUnique?(await taskSpace(expected.spaceId)).page(expected.pageLabel):null;
 let identity=null; if(page){const data=await creatorGet(page,infoUrl);const user=data?.user_info||data?.user;identity={status:200,uid:exactId(user?.uid),nickname:String(user?.nickname||''),unique_id:exactId(user?.unique_id)};}
 const after=await inspect();
 const identityOk=identity?.status===200&&identity.uid===expectedUid&&compact(identity.nickname)===compact(expected.accountName)&&identity.unique_id===expected.accountId;
 const stable=JSON.stringify(before)===JSON.stringify(after);
 console.log(marker+JSON.stringify({ok:before.oldAbsent&&before.newSpaceUnique&&before.targetUnique&&after.oldAbsent&&after.newSpaceUnique&&after.targetUnique&&stable&&identityOk,code:identityOk&&stable?'PREFLIGHT_PASSED':'DOUYIN_WINDOW_BINDING_PREFLIGHT_FAILED',before,after,identity}));
} catch(error) { console.log(marker+JSON.stringify({ok:false,code:'DOUYIN_WINDOW_BINDING_PREFLIGHT_FAILED',detail:String(error?.message||error).slice(0,160)})); }
`;
}

export async function runDouyinWindowBindingResumePreflight(binding,contract,{command}={}) {


  const expectedUid=loadWindowBindingExpectedUid(contract);
  const script=buildDouyinWindowBindingResumePreflightScript(binding,contract,expectedUid);
  const result=await runEgoScript(script,command);
  const snapshot=parseEgoSnapshot(result);
  const proof=snapshot?.identity;
  if(snapshot?.ok!==true||snapshot.before?.oldAbsent!==true||snapshot.after?.oldAbsent!==true
    ||snapshot.before?.newSpaceUnique!==true||snapshot.after?.newSpaceUnique!==true
    ||snapshot.before?.targetUnique!==true||snapshot.after?.targetUnique!==true
    ||JSON.stringify(snapshot.before?.binding)!==JSON.stringify(snapshot.after?.binding)
    ||proof?.status!==200||proof?.uid!==expectedUid
    ||String(proof?.nickname||'').normalize('NFC').replace(/\s+/g,' ').trim()!==String(binding.accountName||'').normalize('NFC').replace(/\s+/g,' ').trim()
    ||proof?.unique_id!==String(binding.accountId||'')) {
    return {ok:false,code:snapshot?.code||"DOUYIN_WINDOW_BINDING_PREFLIGHT_FAILED",readOnly:true,oldSpaceAbsent:false};
  }
  const proofForHash={before:snapshot.before,after:snapshot.after,identity:{status:proof.status,nickname:proof.nickname,unique_id:proof.unique_id}};
  const safe={ok:true,code:"PREFLIGHT_PASSED",oldSpaceAbsent:true,executionBinding:{...contract.executionBinding},identityMatched:true};
  return {...safe,proofSha256:crypto.createHash("sha256").update(JSON.stringify(proofForHash)).digest("hex")};
}

async function makeSecureTempPackage(pkg, binding) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "video-publisher-school-"));
  await fs.promises.chmod(directory, 0o700);
  const packagePath = path.join(directory, "package.json");
  await fs.promises.writeFile(packagePath, `${JSON.stringify({ ...pkg, schoolAccount: binding }, null, 2)}\n`, { mode: 0o600 });
  await fs.promises.chmod(packagePath, 0o600);
  return { directory, packagePath };
}

export async function runSchoolAccount(argv = process.argv.slice(2), dependencies = {}) {


  const options = parseArgs(argv);
  if (!fs.existsSync(options.packagePath)) throw new Error(`Package JSON not found: ${options.packagePath}`);
  const parsed = JSON.parse(await fs.promises.readFile(options.packagePath, "utf8"));
  const matrixPath = resolveAccountMatrixPath(dependencies.matrixPath || "");
  const matrix = dependencies.matrix || readAccountMatrix(matrixPath);
  const binding = resolveSchoolAccountBinding(parsed.schoolAccount, matrix);
  if (binding.accountKey === "reserved_personal_route" && options.prepareDraft) {
    const account = (matrix.platforms?.douyin?.accounts || []).find(row => row?.key === "reserved_personal_route");
    const checked = dependencies.personalDouyinAdmission ? validatePersonalDouyinWriteAdmission({
      admission: dependencies.personalDouyinAdmission,
      packagePath: options.packagePath,
      pkg: parsed,
      action: "draft",
      account,
    }) : { ok: false, code: "PERSONAL_DOUYIN_ROUTE_READ_ONLY_ONLY" };
    if (!checked.ok) return {
      ok: false,
      status: "BLOCKED",
      code: checked.code || "PERSONAL_DOUYIN_ROUTE_READ_ONLY_ONLY",
      platform: binding.platform,
      accountKey: binding.accountKey,
      readOnly: true,
      contentWriteEnabled: false,
      contentReviewVerified: false,
      uploadVerified: false,
      draftCreated: false,
      publicationPerformed: false,
      publicReadbackVerified: false,
    };
  }
  if (!VALIDATORS[binding.platform]) return { ok: false, code: "VIDEO_PLATFORM_NOT_SUPPORTED", platform: binding.platform };
  const pkg = (dependencies.readPackage || readPackage)(options.packagePath);
  const errors = [
    ...VALIDATORS[binding.platform](pkg),
    ...(dependencies.validateMediaForPlatform || validateMediaForPlatform)(pkg, binding.platform, (dependencies.inspectMediaFile || inspectMediaFile)(pkg.videoPath)),
  ];
  if (binding.platform === "youtube" && pkg.youtubeAlteredContentExplicit !== true) {
    errors.push("youtubeAlteredContent must be explicitly set to true or false for the school publisher; no AI/altered-content declaration is inferred");
  }
  if (errors.length) return { ok: false, code: "PACKAGE_PREFLIGHT_FAILED", errors };
  if (options.prepareDraft && RIGHTS_PLATFORMS.has(binding.platform) && !options.confirmOriginalRights) {
    return { ok: false, code: "ORIGINAL_RIGHTS_CONFIRMATION_REQUIRED", message: "草稿准备需要单独确认当前视频的原创权利；此确认与平台原创声明分开，程序不会勾选原创/自制。" };
  }

  let config = null;
  if (options.prepareDraft) {
    config = (dependencies.loadConfig || loadConfig)({ requireOnboarded: true });
    if (!(config.availablePlatforms || []).includes(binding.platform)) {
      return { ok: false, code: "PLATFORM_NOT_ONBOARDED", platform: binding.platform };
    }
  }

  const douyinResume = dependencies.douyinPreflightResume || null;
  const douyinScopeResume = dependencies.douyinPreparationScopeResume || null;
  const douyinInputMissingResume = dependencies.douyinInputMissingResume || null;
  const douyinWindowBindingResume = dependencies.douyinWindowBindingResume || null;
  const douyinPersonalInspectFailureResume = dependencies.douyinPersonalInspectFailureResume || null;
  const douyinPersonalPostResultDraftContinuation = dependencies.douyinPersonalPostResultDraftContinuation || null;
  const douyinPersonalPostResultInitFailureContinuation = dependencies.douyinPersonalPostResultInitFailureContinuation || null;
  const douyinPersonalPostResultLockedInitFailureContinuation = dependencies.douyinPersonalPostResultLockedInitFailureContinuation || null;
  const douyinPersonalPostResultLockedInitPathFailureContinuation = dependencies.douyinPersonalPostResultLockedInitPathFailureContinuation || null;
  if (douyinPersonalInspectFailureResume && (!options.prepareDraft || binding.platform !== "douyin"
      || binding.accountKey !== "reserved_personal_route"
      || douyinPersonalInspectFailureResume.resumeType !== DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_TYPE
      || douyinResume || douyinScopeResume || douyinInputMissingResume || douyinWindowBindingResume
      || douyinPersonalPostResultDraftContinuation || douyinPersonalPostResultInitFailureContinuation
      || douyinPersonalPostResultLockedInitFailureContinuation || douyinPersonalPostResultLockedInitPathFailureContinuation
      || dependencies.channelsPreflightResume)) {
    return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code: "DOUYIN_PERSONAL_INSPECT_RESUME_SCOPE_INVALID", platform: binding.platform, accountKey: binding.accountKey, preparationFailure: { stage: "init", code: "DOUYIN_PERSONAL_INSPECT_RESUME_SCOPE_INVALID", reason: "This continuation is limited to the exact same-job personal Douyin draft-preparation route." } };
  }
  if (douyinPersonalPostResultDraftContinuation && (!options.prepareDraft || binding.platform !== "douyin"
      || binding.accountKey !== "reserved_personal_route"
      || douyinPersonalPostResultDraftContinuation.resumeType !== DOUYIN_PERSONAL_POST_RESULT_DRAFT_TYPE
      || douyinResume || douyinScopeResume || douyinInputMissingResume || douyinWindowBindingResume
      || douyinPersonalInspectFailureResume || dependencies.channelsPreflightResume)) {
    return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code: "DOUYIN_PERSONAL_POST_RESULT_DRAFT_SCOPE_INVALID", platform: binding.platform, accountKey: binding.accountKey, preparationFailure: { stage: "init", code: "DOUYIN_PERSONAL_POST_RESULT_DRAFT_SCOPE_INVALID", reason: "The post-result continuation is one exact personal-Douyin draft-only route and cannot combine with another resume contract." } };
  }
  if (douyinInputMissingResume && (!options.prepareDraft || binding.platform !== "douyin" || douyinResume || douyinScopeResume || dependencies.channelsPreflightResume || douyinInputMissingResume.resumeType !== DOUYIN_INPUT_MISSING_RESUME_TYPE)) {
    return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code: "DOUYIN_INPUT_MISSING_RESUME_SCOPE_INVALID", accountKey: binding.accountKey, platform: binding.platform, preparationFailure: { stage: "init", code: "DOUYIN_INPUT_MISSING_RESUME_SCOPE_INVALID", reason: "The input-missing continuation is limited to the exact Douyin draft-only route." } };
  }
  if (douyinResume && (!options.prepareDraft || binding.platform !== "douyin" || dependencies.channelsPreflightResume || douyinScopeResume)) {
    return { ok: false, code: "DOUYIN_PREFLIGHT_RESUME_SCOPE_INVALID" };
  }
  if (douyinScopeResume && (!options.prepareDraft || binding.platform !== "douyin" || dependencies.channelsPreflightResume || douyinResume)) {
    return { ok: false, code: "DOUYIN_SCOPE_RESUME_SCOPE_INVALID", preparationFailure: { stage: "init", code: "DOUYIN_SCOPE_RESUME_SCOPE_INVALID", reason: "The scoped continuation is not an exact Douyin draft-only run." } };
  }
  if (douyinWindowBindingResume && (!options.prepareDraft || binding.platform !== "douyin" || binding.accountKey !== "excluded_case_account"
      || douyinWindowBindingResume.resumeType !== DOUYIN_WINDOW_BINDING_RESUME_TYPE
      || douyinResume || douyinScopeResume || douyinInputMissingResume || dependencies.channelsPreflightResume)) {
    return { ok:false,status:"DRAFT_PREPARATION_NOT_READY",code:"DOUYIN_WINDOW_BINDING_RESUME_SCOPE_INVALID",platform:binding.platform,accountKey:binding.accountKey,preparationFailure:{stage:"init",code:"DOUYIN_WINDOW_BINDING_RESUME_SCOPE_INVALID",reason:"The window-binding continuation is limited to the exact same-job Kaifeng Douyin draft-preparation route."} };
  }
  if (douyinPersonalPostResultInitFailureContinuation && (!options.prepareDraft || binding.platform !== "douyin"
      || binding.accountKey !== "reserved_personal_route"
      || douyinPersonalPostResultInitFailureContinuation.resumeType !== DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_TYPE
      || !douyinPersonalPostResultDraftContinuation
      || douyinPersonalPostResultDraftContinuation !== douyinPersonalPostResultInitFailureContinuation.legacyContinuation
      || douyinResume || douyinScopeResume || douyinInputMissingResume || douyinWindowBindingResume
      || douyinPersonalInspectFailureResume || douyinPersonalPostResultLockedInitFailureContinuation
      || douyinPersonalPostResultLockedInitPathFailureContinuation || dependencies.channelsPreflightResume)) {
    return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code: "DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_SCOPE_INVALID", platform: binding.platform, accountKey: binding.accountKey, preparationFailure: { stage: "init", code: "DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_SCOPE_INVALID", reason: "This continuation is limited to the exact one-shot personal-Douyin draft-only init-failure route." } };
  }
  if (douyinPersonalPostResultLockedInitFailureContinuation && (!options.prepareDraft || binding.platform !== "douyin"
      || binding.accountKey !== "reserved_personal_route"
      || douyinPersonalPostResultLockedInitFailureContinuation.resumeType !== DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_FAILURE_TYPE
      || !douyinPersonalPostResultDraftContinuation
      || douyinPersonalPostResultDraftContinuation !== douyinPersonalPostResultLockedInitFailureContinuation.legacyContinuation
      || douyinPersonalPostResultInitFailureContinuation || douyinResume || douyinScopeResume || douyinInputMissingResume
      || douyinWindowBindingResume || douyinPersonalInspectFailureResume
      || douyinPersonalPostResultLockedInitPathFailureContinuation || dependencies.channelsPreflightResume)) {
    return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code: "DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_FAILURE_SCOPE_INVALID", platform: binding.platform, accountKey: binding.accountKey, preparationFailure: { stage: "init", code: "DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_FAILURE_SCOPE_INVALID", reason: "This continuation is limited to the exact one-shot personal-Douyin locked-init draft-only route." } };
  }
  if (douyinPersonalPostResultLockedInitPathFailureContinuation && (!options.prepareDraft || binding.platform !== "douyin"
      || binding.accountKey !== "reserved_personal_route"
      || douyinPersonalPostResultLockedInitPathFailureContinuation.resumeType !== DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_TYPE
      || !douyinPersonalPostResultDraftContinuation
      || douyinPersonalPostResultDraftContinuation !== douyinPersonalPostResultLockedInitPathFailureContinuation.legacyContinuation
      || douyinPersonalPostResultInitFailureContinuation || douyinPersonalPostResultLockedInitFailureContinuation
      || douyinResume || douyinScopeResume || douyinInputMissingResume || douyinWindowBindingResume
      || douyinPersonalInspectFailureResume || dependencies.channelsPreflightResume)) {
    return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code: "DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_SCOPE_INVALID", platform: binding.platform, accountKey: binding.accountKey, preparationFailure: { stage: "init", code: "DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_SCOPE_INVALID", reason: "This continuation is limited to the exact one-shot personal-Douyin locked-init-path draft-only route." } };
  }
  if (douyinPersonalPostResultDraftContinuation?.beforeUploadIdentityRecovery && (!options.prepareDraft
      || binding.platform !== "douyin" || binding.accountKey !== "reserved_personal_route"
      || douyinPersonalPostResultInitFailureContinuation || douyinPersonalPostResultLockedInitFailureContinuation
      || douyinPersonalPostResultLockedInitPathFailureContinuation || douyinResume || douyinScopeResume
      || douyinInputMissingResume || douyinWindowBindingResume || douyinPersonalInspectFailureResume || dependencies.channelsPreflightResume)) {
    return {ok:false,status:"DRAFT_PREPARATION_NOT_READY",code:"DOUYIN_PERSONAL_BEFORE_UPLOAD_SCOPE_INVALID"};
  }
  if (douyinPersonalPostResultDraftContinuation?.preBrowserInitFailureAttempt
      && !douyinPersonalPostResultInitFailureContinuation && !douyinPersonalPostResultLockedInitFailureContinuation
      && !douyinPersonalPostResultLockedInitPathFailureContinuation && !douyinPersonalPostResultDraftContinuation?.beforeUploadIdentityRecovery) {
    return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code: "DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_SCOPE_INVALID", platform: binding.platform, accountKey: binding.accountKey, preparationFailure: { stage: "init", code: "DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_SCOPE_INVALID", reason: "The old draft continuation cannot carry an init-failure retry attempt outside its typed wrapper route." } };
  }
  const douyinPersonalInitRetry = douyinPersonalPostResultInitFailureContinuation;
  const nativeStateBase = (douyinResume || douyinScopeResume || douyinInputMissingResume || douyinWindowBindingResume || douyinPersonalInspectFailureResume || douyinPersonalPostResultDraftContinuation || douyinPersonalInitRetry || douyinPersonalPostResultLockedInitFailureContinuation || douyinPersonalPostResultLockedInitPathFailureContinuation)
    ? path.resolve(dependencies.nativeStateBase || douyinPersonalPostResultDraftContinuation?.nativeStateBase || douyinPersonalInspectFailureResume?.nativeStateBase || douyinScopeResume?.nativeStateBase || douyinResume?.nativeStateBase || douyinInputMissingResume?.stateBase || douyinWindowBindingResume?.stateBase || "")
    : path.resolve(dependencies.stateBase || path.join(os.homedir(), ".maxiaojian-publish", "school-accounts"));
  if ((douyinResume || douyinScopeResume || douyinInputMissingResume || douyinWindowBindingResume || douyinPersonalInspectFailureResume || douyinPersonalPostResultDraftContinuation || douyinPersonalInitRetry || douyinPersonalPostResultLockedInitFailureContinuation || douyinPersonalPostResultLockedInitPathFailureContinuation) && (!nativeStateBase || nativeStateBase === path.resolve(".") || typeof dependencies.fingerprintPackage !== "function")) {
    const code = douyinPersonalPostResultLockedInitPathFailureContinuation ? "DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_DEPENDENCY_MISSING" : douyinPersonalPostResultLockedInitFailureContinuation ? "DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_FAILURE_DEPENDENCY_MISSING" : douyinPersonalInitRetry ? "DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_DEPENDENCY_MISSING" : douyinPersonalPostResultDraftContinuation ? "DOUYIN_PERSONAL_POST_RESULT_DRAFT_DEPENDENCY_MISSING" : douyinPersonalInspectFailureResume ? "DOUYIN_PERSONAL_INSPECT_RESUME_DEPENDENCY_MISSING" : douyinWindowBindingResume ? "DOUYIN_WINDOW_BINDING_RESUME_DEPENDENCY_MISSING" : douyinInputMissingResume ? "DOUYIN_INPUT_MISSING_RESUME_DEPENDENCY_MISSING" : douyinScopeResume ? "DOUYIN_SCOPE_RESUME_DEPENDENCY_MISSING" : "DOUYIN_PREFLIGHT_RESUME_DEPENDENCY_MISSING";
    return { ok: false, code, ...((douyinScopeResume || douyinInputMissingResume || douyinWindowBindingResume || douyinPersonalInspectFailureResume || douyinPersonalPostResultDraftContinuation || douyinPersonalInitRetry || douyinPersonalPostResultLockedInitFailureContinuation || douyinPersonalPostResultLockedInitPathFailureContinuation) ? { preparationFailure: { stage: "init", code, reason: "The locked native state base or package fingerprint dependency is unavailable." } } : {}) };
  }
  let securePackage = null;
  const stateRoot = schoolAccountStateRoot(nativeStateBase, binding);
  const scopeFailure = (stage, error, fallback) => ({
    stage,
    code: String(error?.code || error?.message || fallback).slice(0, 120),
    reason: String(error?.message || fallback).slice(0, 400),
  });
  try {
    if (options.prepareDraft) securePackage = await makeSecureTempPackage(
      (douyinPersonalInitRetry || douyinPersonalPostResultLockedInitFailureContinuation || douyinPersonalPostResultLockedInitPathFailureContinuation || douyinPersonalPostResultDraftContinuation?.beforeUploadIdentityRecovery) ? parsed : pkg,
      binding,
    );
    if (douyinPersonalPostResultLockedInitPathFailureContinuation) {
      try {
        const exactV2Package = JSON.parse(await fs.promises.readFile(securePackage.packagePath, "utf8"));
        const identity = await buildIdentity(exactV2Package);
        const lockedStatePath = douyinPersonalPostResultLockedInitPathFailureContinuation.nativeStatePath;
        const lockedState = JSON.parse(await fs.promises.readFile(lockedStatePath, "utf8"));
        await (dependencies.assertDouyinPersonalPostResultLockedInitPathFailureContinuationContract || assertDouyinPersonalPostResultLockedInitPathFailureContinuationContract)(
          douyinPersonalPostResultLockedInitPathFailureContinuation,
          { packagePath: options.packagePath, pkg: exactV2Package, identity,
            args: { operation: "resume", inspectOnly: false, platforms: ["douyin"], jobId: douyinPersonalPostResultLockedInitPathFailureContinuation.jobId, stateRoot },
            stateExisted: true, statePath: lockedStatePath, state: lockedState, matrix, nativeStateBase },
        );
      } catch (error) {
        const code = error?.code || String(error?.message || "DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_LOCKED_CONTRACT_MISMATCH");
        return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code, accountKey: binding.accountKey,
          platform: binding.platform, stateRoot, jobId: douyinPersonalPostResultLockedInitPathFailureContinuation.jobId,
          preparationFailure: { stage: "locked-init", code: String(code).slice(0,120), reason: String(error?.message || code).slice(0,400) } };
      }
    } else if (douyinPersonalPostResultLockedInitFailureContinuation) {
      try {
        const exactV2Package = JSON.parse(await fs.promises.readFile(securePackage.packagePath, "utf8"));
        const identity = await buildIdentity(exactV2Package);
        const lockedStatePath = douyinPersonalPostResultLockedInitFailureContinuation.nativeStatePath;
        const lockedState = JSON.parse(await fs.promises.readFile(lockedStatePath, "utf8"));
        await (dependencies.assertDouyinPersonalPostResultLockedInitFailureContinuationContract || assertDouyinPersonalPostResultLockedInitFailureContinuationContract)(
          douyinPersonalPostResultLockedInitFailureContinuation,
          { packagePath: options.packagePath, pkg: exactV2Package, identity,
            args: { operation: "resume", inspectOnly: false, platforms: ["douyin"], jobId: douyinPersonalPostResultLockedInitFailureContinuation.jobId },
            stateExisted: true, statePath: lockedStatePath, state: lockedState, matrix, nativeStateBase },
        );
      } catch (error) {
        const code = error?.code || String(error?.message || "DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_FAILURE_LOCKED_CONTRACT_MISMATCH");
        return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code, accountKey: binding.accountKey,
          platform: binding.platform, stateRoot, jobId: douyinPersonalPostResultLockedInitFailureContinuation.jobId,
          preparationFailure: { stage: "locked-init", code: String(code).slice(0,120), reason: String(error?.message || code).slice(0,400) } };
      }
    } else if (douyinPersonalInitRetry) {
      try {
        const exactV2Package = JSON.parse(await fs.promises.readFile(securePackage.packagePath, "utf8"));
        const identity = await buildIdentity(exactV2Package);
        const lockedStatePath = douyinPersonalInitRetry.nativeStatePath;
        const lockedState = JSON.parse(await fs.promises.readFile(lockedStatePath, "utf8"));
        await (dependencies.assertDouyinPersonalPostResultInitFailureContinuationContract || assertDouyinPersonalPostResultInitFailureContinuationContract)(
          douyinPersonalInitRetry,
          { packagePath: options.packagePath, pkg: exactV2Package, identity,
            args: { operation: "resume", inspectOnly: false, platforms: ["douyin"], jobId: douyinPersonalInitRetry.jobId },
            stateExisted: true, statePath: lockedStatePath, state: lockedState, matrix, nativeStateBase },
        );
      } catch (error) {
        const code = error?.code || String(error?.message || "DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_LOCKED_CONTRACT_MISMATCH");
        return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code, accountKey: binding.accountKey,
          platform: binding.platform, stateRoot, jobId: douyinPersonalInitRetry.jobId,
          preparationFailure: { stage: "locked-init", code: String(code).slice(0,120), reason: String(error?.message || code).slice(0,400) } };
      }
    } else if (douyinPersonalPostResultDraftContinuation) {
      try {
        const exactV2Package = (douyinPersonalPostResultDraftContinuation?.preBrowserInitFailureAttempt
          ? JSON.parse(await fs.promises.readFile(securePackage.packagePath, "utf8"))
          : (dependencies.readPackage || readPackage)(securePackage.packagePath));
        const identity = await buildIdentity(exactV2Package);
        const lockedStatePath = douyinPersonalPostResultDraftContinuation.nativeStatePath;
        const lockedState = JSON.parse(await fs.promises.readFile(lockedStatePath, "utf8"));
        await (dependencies.assertDouyinPersonalPostResultDraftContinuationContract || assertDouyinPersonalPostResultDraftContinuationContract)(
          douyinPersonalPostResultDraftContinuation,
          { packagePath: options.packagePath, pkg: exactV2Package, identity,
            args: { operation: "resume", inspectOnly: false, platforms: ["douyin"], jobId: douyinPersonalPostResultDraftContinuation.jobId, stateRoot },
            stateExisted: true, statePath: lockedStatePath, state: lockedState, matrix, nativeStateBase },
        );
      } catch (error) {
        const code = error?.code || String(error?.message || "DOUYIN_PERSONAL_POST_RESULT_DRAFT_LOCKED_CONTRACT_MISMATCH");
        return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code, accountKey: binding.accountKey,
          platform: binding.platform, stateRoot, jobId: douyinPersonalPostResultDraftContinuation.jobId,
          preparationFailure: { stage: "locked-init", code: String(code).slice(0,120), reason: String(error?.message || code).slice(0,400) } };
      }
    }
    if (douyinResume) {
      try {
        const normalizedV2Package = (dependencies.readPackage || readPackage)(securePackage.packagePath);
        const identity = await buildIdentity(normalizedV2Package);
        await (dependencies.assertDouyinPristinePreflightResumeContract || assertDouyinPristinePreflightResumeContract)(douyinResume, normalizedV2Package, identity, {
          platforms: ["douyin"],
          operation: "auto",
          inspectOnly: false,
          jobId: douyinResume.jobId,
          stateRoot,
        }, false, {
          fingerprintPackage: dependencies.fingerprintPackage,
          binding,
          nativeStateBase,
        });
      } catch (error) {
        return { ok: false, code: error?.code || String(error?.message || "DOUYIN_PREFLIGHT_RESUME_ASSERTION_FAILED") };
      }
    }
    if (douyinScopeResume) {
      try {
        const normalizedV2Package = (dependencies.readPackage || readPackage)(securePackage.packagePath);
        const identity = await buildIdentity(normalizedV2Package);
        await (dependencies.assertDouyinPreparationScopeResumeContract || assertDouyinPreparationScopeResumeContract)(
          douyinScopeResume,
          normalizedV2Package,
          identity,
          {
            platforms: ["douyin"],
            operation: "resume",
            inspectOnly: false,
            jobId: douyinScopeResume.jobId,
            stateRoot,
            taskSuffix: `school-${binding.accountKey}`,
          },
          true,
          { stage: "init" },
        );
      } catch (error) {
        const code = error?.code || String(error?.message || "DOUYIN_SCOPE_RESUME_INIT_ASSERTION_FAILED");
        return { ok: false, code, preparationFailure: scopeFailure("init", error, "DOUYIN_SCOPE_RESUME_INIT_ASSERTION_FAILED") };
      }
    }
    if (douyinInputMissingResume) {
      try {
        const normalizedV2Package = (dependencies.readPackage || readPackage)(securePackage.packagePath);
        const identity = await buildIdentity(normalizedV2Package);
        const statePath = path.join(stateRoot, douyinInputMissingResume.jobId, "state.json");
        const state = JSON.parse(await fs.promises.readFile(statePath, "utf8"));
        await (dependencies.assertDouyinInputMissingLockedContract || assertDouyinInputMissingLockedContract)(
          douyinInputMissingResume, normalizedV2Package, identity,
          { platforms: ["douyin"], operation: "resume", inspectOnly: false, jobId: douyinInputMissingResume.jobId, stateRoot },
          state, statePath, binding,
        );
      } catch (error) {
        const code = error?.code || String(error?.message || "DOUYIN_INPUT_MISSING_LOCKED_CONTRACT_MISMATCH");
        return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code, accountKey: binding.accountKey, platform: binding.platform, stateRoot, jobId: douyinInputMissingResume.jobId, preparationFailure: { stage: "init", code: String(code).slice(0,120), reason: String(error?.message || code).slice(0,400) } };
      }
    }

    if (douyinWindowBindingResume) {
      try {
        const expectedOld = douyinWindowBindingResume.oldBinding;
        const actualOld = {
          platform: binding.platform, accountKey: binding.accountKey, accountId: binding.accountId,
          accountName: binding.accountName, persistentProfile: binding.persistentProfile,
          profileId: binding.egoProfileId, spaceId: binding.taskSpaceId, spaceName: binding.taskSpaceName,
          ownership: "agent", pageLabel: binding.pageLabel, targetId: binding.targetId,
          host: "creator.douyin.com", uploadUrl: "https://creator.douyin.com/creator-micro/content/upload",
        };
        if (JSON.stringify(actualOld) !== JSON.stringify(expectedOld)) throw Object.assign(new Error("DOUYIN_WINDOW_BINDING_OLD_BINDING_CHANGED"), { code: "DOUYIN_WINDOW_BINDING_OLD_BINDING_CHANGED" });
        const safePackage = (dependencies.readPackage || readPackage)(securePackage.packagePath);
        const safeIdentity = await buildIdentity(safePackage);
        if (safeIdentity.fingerprint !== douyinWindowBindingResume.fingerprint
          || path.resolve(douyinWindowBindingResume.statePath || "") !== path.join(stateRoot, douyinWindowBindingResume.jobId, "state.json")) {
          throw Object.assign(new Error("DOUYIN_WINDOW_BINDING_LOCKED_LINEAGE_CHANGED"), { code: "DOUYIN_WINDOW_BINDING_LOCKED_LINEAGE_CHANGED" });
        }
      } catch (error) {
        const code = error?.code || "DOUYIN_WINDOW_BINDING_LOCKED_LINEAGE_CHANGED";
        return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code, accountKey: binding.accountKey, platform: binding.platform, stateRoot, jobId: douyinWindowBindingResume.jobId, preparationFailure: { stage: "locked-init", code, reason: String(error?.message || code).slice(0, 400) } };
      }
      const preflight = await (dependencies.runDouyinWindowBindingResumePreflight || runDouyinWindowBindingResumePreflight)(binding, douyinWindowBindingResume, { command: dependencies.egoCommand });
      if (!preflight.ok) {
        return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code: "DOUYIN_WINDOW_BINDING_LOCKED_PREFLIGHT_REJECTED", accountKey: binding.accountKey, platform: binding.platform, stateRoot, jobId: douyinWindowBindingResume.jobId, preparationFailure: { stage: "locked-init", code: "DOUYIN_WINDOW_BINDING_LOCKED_PREFLIGHT_REJECTED", reason: "Fresh read-only old-Space-absent, new target and creator identity proof failed before JobStore.initialize." } };
      }
    }

    if (douyinPersonalInspectFailureResume) {
      try {
        const normalizedV2Package = (dependencies.readPackage || readPackage)(securePackage.packagePath);
        const identity = await buildIdentity(normalizedV2Package);
        await (dependencies.assertDouyinPersonalInspectFailureResumeContract || assertDouyinPersonalInspectFailureResumeContract)(
          douyinPersonalInspectFailureResume,
          normalizedV2Package,
          identity,
          {
            platforms: ["douyin"], operation: "resume", inspectOnly: false,
            jobId: douyinPersonalInspectFailureResume.jobId,
            stateRoot,
            taskSuffix: `school-${binding.accountKey}`,
          },
          true,
          { nativeStateBase, binding },
        );
      } catch (error) {
        const code = error?.code || String(error?.message || "DOUYIN_PERSONAL_INSPECT_RESUME_LOCKED_CONTRACT_MISMATCH");
        return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code, accountKey: binding.accountKey, platform: binding.platform, stateRoot, jobId: douyinPersonalInspectFailureResume.jobId, preparationFailure: { stage: "init", code: String(code).slice(0, 120), reason: String(error?.message || code).slice(0, 400) } };
      }
    }

    // The recovery contract proves the pristine prior receipt and locked source lineage only.
    // Every attempt still performs a fresh, exact live creator-API identity preflight.
    const preflight = douyinWindowBindingResume
      ? { ok: true, evidence: { douyinWindowBindingResume: { oldSpaceAbsent: true, executionBinding: douyinWindowBindingResume.executionBinding, proofSha256: "ephemeral" } } }
      : douyinPersonalInspectFailureResume
        ? { ok: true, evidence: { sameJobRecovery: true, firstBrowserAction: "fresh_read_only_inspect", publicationPerformed: false } }
        : (douyinPersonalInitRetry || douyinPersonalPostResultLockedInitFailureContinuation || douyinPersonalPostResultLockedInitPathFailureContinuation)
          ? await (dependencies.runEgoPreflight || runEgoPreflight)(binding, { command: dependencies.egoCommand })
        : douyinPersonalPostResultDraftContinuation
          ? { ok: true, evidence: { sameJobRecovery: true, firstBrowserAction: "fresh_read_only_inspect", phase: "draft_continuation", finalPublishAllowed: false, publicationPerformed: false } }
        : await (dependencies.runEgoPreflight || runEgoPreflight)(binding, { command: dependencies.egoCommand });
    if (!preflight.ok) return {
      ok: false,
      code: preflight.code,
      ...((douyinScopeResume || douyinPersonalInitRetry || douyinPersonalPostResultLockedInitFailureContinuation)
        ? { preparationFailure: { stage: "fresh-identity-preflight", code: String(preflight.code || "DOUYIN_SCOPE_RESUME_FRESH_IDENTITY_FAILED").slice(0, 120), reason: "Fresh creator API/profile/space/target preflight failed before V2; no upload was attempted." } }
        : { evidence: preflight.evidence || null }),
    };
    if (!options.prepareDraft) {
      return { ok: true, status: "PREFLIGHT_PASSED", mode: "check-only", ...preflight.evidence };
    }

    const packagePath = securePackage.packagePath;
    const publisherPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "v2", "publisher.mjs");
    const args = [
      "--package", packagePath,
      "--platform", binding.platform,
      "--task-suffix", `school-${binding.accountKey}`,
      "--operation", douyinWindowBindingResume || douyinScopeResume || douyinInputMissingResume || douyinPersonalInspectFailureResume || douyinPersonalPostResultDraftContinuation || douyinPersonalInitRetry || (dependencies.channelsPreflightResume&&dependencies.channelsPreflightResume.mode!=="preflight")?"resume":"auto",
      "--space-name", douyinWindowBindingResume?.executionBinding?.spaceName || binding.taskSpaceName,
      "--reuse-space",
      "--no-cleanup-stale-spaces",
      "--state-root", stateRoot,
      "--keep-space",
    ];
    if (dependencies.channelsPreflightResume) args.push("--job-id", dependencies.channelsPreflightResume.jobId);
    if (douyinResume) args.push("--job-id", douyinResume.jobId);
    if (douyinScopeResume) args.push("--job-id", douyinScopeResume.jobId);
    if (douyinInputMissingResume) args.push("--job-id", douyinInputMissingResume.jobId);
    if (douyinWindowBindingResume) args.push("--job-id", douyinWindowBindingResume.jobId);
    if (douyinPersonalInspectFailureResume) args.push("--job-id", douyinPersonalInspectFailureResume.jobId);
    if (douyinPersonalPostResultDraftContinuation) args.push("--job-id", douyinPersonalPostResultDraftContinuation.jobId);
    if (options.confirmOriginalRights) args.push("--confirm-original-rights");
    const execute = dependencies.runPublisher || ((file, commandArgs, executionOptions={}) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [file, ...commandArgs], { stdio: ['ignore','pipe','pipe'],env:executionOptions.env||process.env });
      let stdout="",stderr="";child.stdout.on("data", chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
      child.on("error", reject);
      child.on("close", code => resolve({code:code??1,stdout,stderr}));
    }));
    const executionEnv = {};
    if (dependencies.channelsPreflightResume) executionEnv.VIDEO_PUBLISHER_CHANNELS_PREFLIGHT_RESUME = JSON.stringify(dependencies.channelsPreflightResume);
    if (douyinResume) executionEnv.VIDEO_PUBLISHER_DOUYIN_PREFLIGHT_RESUME = JSON.stringify(douyinResume);
    if (douyinScopeResume) executionEnv[DOUYIN_PREPARATION_SCOPE_RESUME_ENV] = JSON.stringify(douyinScopeResume);
    if (douyinInputMissingResume) executionEnv.VIDEO_PUBLISHER_DOUYIN_INPUT_MISSING_RESUME = JSON.stringify(douyinInputMissingResume);
    if (douyinWindowBindingResume) executionEnv.VIDEO_PUBLISHER_DOUYIN_WINDOW_BINDING_RESUME = JSON.stringify(douyinWindowBindingResume);
    if (douyinPersonalInspectFailureResume) executionEnv[DOUYIN_PERSONAL_INSPECT_FAILURE_RESUME_ENV] = JSON.stringify(douyinPersonalInspectFailureResume);
    if (douyinPersonalPostResultDraftContinuation) executionEnv[DOUYIN_PERSONAL_POST_RESULT_DRAFT_ENV] = JSON.stringify(douyinPersonalPostResultDraftContinuation);
    if (douyinPersonalPostResultLockedInitPathFailureContinuation) executionEnv[DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_ENV] = JSON.stringify(douyinPersonalPostResultLockedInitPathFailureContinuation);
    let execution;
    try { execution = await execute(publisherPath, args, Object.keys(executionEnv).length ? { env: { ...process.env, ...executionEnv } } : {}); }
    catch (error) {
      if (douyinWindowBindingResume || douyinScopeResume || douyinInputMissingResume || douyinPersonalInspectFailureResume || douyinPersonalPostResultDraftContinuation || douyinPersonalInitRetry || douyinPersonalPostResultLockedInitFailureContinuation || douyinPersonalPostResultLockedInitPathFailureContinuation) { const code=douyinPersonalPostResultLockedInitPathFailureContinuation?"DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_PATH_FAILURE_V2_LAUNCH_FAILED":douyinPersonalPostResultLockedInitFailureContinuation?"DOUYIN_PERSONAL_POST_RESULT_LOCKED_INIT_FAILURE_V2_LAUNCH_FAILED":douyinPersonalInitRetry?"DOUYIN_PERSONAL_POST_RESULT_INIT_FAILURE_V2_LAUNCH_FAILED":douyinPersonalPostResultDraftContinuation?"DOUYIN_PERSONAL_POST_RESULT_DRAFT_V2_LAUNCH_FAILED":douyinPersonalInspectFailureResume?"DOUYIN_PERSONAL_INSPECT_RESUME_V2_LAUNCH_FAILED":douyinWindowBindingResume?"DOUYIN_WINDOW_BINDING_RESUME_V2_LAUNCH_FAILED":douyinInputMissingResume?"DOUYIN_INPUT_MISSING_V2_LAUNCH_FAILED":"DOUYIN_SCOPE_RESUME_V2_LAUNCH_FAILED";const contract=douyinPersonalPostResultLockedInitPathFailureContinuation||douyinPersonalPostResultLockedInitFailureContinuation||douyinPersonalInitRetry||douyinPersonalPostResultDraftContinuation||douyinPersonalInspectFailureResume||douyinWindowBindingResume||douyinInputMissingResume||douyinScopeResume;return { ok: false, status: "DRAFT_PREPARATION_NOT_READY", code, accountKey: binding.accountKey, platform: binding.platform, stateRoot, jobId: contract.jobId, preparationFailure: { stage: "locked-init", code, reason: "The V2 continuation process did not start or complete transport." } }; }
      throw error;
    }
    const code=typeof execution==="number"?execution:execution.code;
    let summary; if(typeof execution!=="number"){try{summary=JSON.parse(execution.stdout.trim());}catch{}}
    const ready=code===0&&(typeof execution==="number"||summary?.ready===true);
    return {
      ok: ready,
      status: ready ? "DRAFT_PREPARATION_COMPLETE" : "DRAFT_PREPARATION_NOT_READY",
      exitCode: code,
      accountKey: binding.accountKey,
      platform: binding.platform,
      stateRoot,
      preparedStatePath:summary?.statePath,
      jobId:summary?.jobId,
      ...(douyinPersonalPostResultDraftContinuation ? {
        ...(typeof summary?.finalPublishClicked === "boolean" ? {finalPublishClicked:summary.finalPublishClicked} : {}),
        contentWriteFlagChanged:false,finalPublishAllowed:false,
      } : {}),
      ...((douyinWindowBindingResume||douyinScopeResume||douyinInputMissingResume||douyinPersonalInspectFailureResume||douyinPersonalPostResultDraftContinuation||douyinPersonalInitRetry||douyinPersonalPostResultLockedInitFailureContinuation||douyinPersonalPostResultLockedInitPathFailureContinuation) && summary?.preparationFailure ? { preparationFailure: summary.preparationFailure } : {}),
      ...(douyinPersonalInspectFailureResume ? { v2ExecutionDiagnostic: summarizeDouyinPersonalInspectV2Execution(execution) } : {}),
    };
  } finally {
    if (securePackage) await fs.promises.rm(securePackage.directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runSchoolAccount().then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = result.code === "WAIT_USER_CONTROL" ? 10 : 2;
  }).catch(error => {
    console.error(`[school-publisher] ${String(error?.stack || error)}`);
    process.exitCode = 2;
  });
}
