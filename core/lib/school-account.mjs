import {fileURLToPath} from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_ACCOUNT_MATRIX = process.env.SCHOOL_PUBLISHER_ACCOUNT_MATRIX || fileURLToPath(new URL("../../config/accounts.json", import.meta.url));

export const PLATFORM_HOST_MARKERS = Object.freeze({
  xiaohongshu: ["creator.xiaohongshu.com"],
  douyin: ["creator.douyin.com"],
  bilibili: ["member.bilibili.com"],
  wechat_channels: ["channels.weixin.qq.com"],
  youtube: ["studio.youtube.com"],
  // Creator management lives on www.zhihu.com; the actual article editor and
  // public pages remain on zhuanlan.zhihu.com. Both belong to the same native
  // account workflow, while exact Ego Space/Page and account-header checks
  // continue to gate the operation.
  zhihu: ["zhuanlan.zhihu.com", "www.zhihu.com"],
  baijiahao: ["baijiahao.baidu.com"],
  sohu: ["mp.sohu.com"],
  toutiao: ["mp.toutiao.com"],
  netease: ["mp.163.com"],
});

export function resolveAccountMatrixPath(explicitPath = "") {
  return path.resolve(explicitPath || process.env.SCHOOL_PUBLISHER_ACCOUNT_MATRIX || DEFAULT_ACCOUNT_MATRIX);
}

export function readAccountMatrix(matrixPath = resolveAccountMatrixPath()) {
  const resolved = path.resolve(matrixPath);
  if (!fs.existsSync(resolved)) throw new Error(`School account matrix not found: ${resolved}`);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (!parsed?.platforms || typeof parsed.platforms !== "object") {
    throw new Error("School account matrix is missing platforms");
  }
  return parsed;
}

export function resolveSchoolAccountBinding(target, matrix) {
  const platform = String(target?.platform || "").trim();
  const accountKey = String(target?.accountKey || "").trim();
  if (!PLATFORM_HOST_MARKERS[platform]) throw new Error(`Unsupported school publisher platform: ${platform || "(missing)"}`);
  if (!accountKey) throw new Error("schoolAccount.accountKey is required");

  const entry = matrix.platforms?.[platform];
  const accounts = Array.isArray(entry?.accounts) ? entry.accounts : [];
  const matches = accounts.filter(account => String(account?.key || "") === accountKey);
  if (matches.length !== 1) throw new Error(`Account key ${accountKey} is not uniquely registered for ${platform}`);
  const canonical = matches[0];
  // Reuse the verified persistent binding when callers specify only the account.
  // Explicit invalid fields stay invalid; never infer a space from legacy Chrome names.
  const taskSpaceId = Number(target?.taskSpaceId ?? canonical.ego?.taskSpaceId);
  const taskSpaceName = String(target?.taskSpaceName ?? canonical.ego?.taskSpaceName ?? "").trim();
  const pageLabel = String(target?.pageLabel ?? canonical.ego?.pageLabel ?? "").trim();
  if (!Number.isSafeInteger(taskSpaceId) || taskSpaceId < 1) throw new Error("schoolAccount.taskSpaceId must be a positive integer");
  if (!taskSpaceName) throw new Error("schoolAccount.taskSpaceName is required; the existing Ego space must be named exactly");
  if (!/^p[1-9][0-9]*$/.test(pageLabel)) throw new Error("schoolAccount.pageLabel must be a durable Ego Page label such as p1");
  if (!canonical.name) throw new Error(`Registered account ${accountKey} has no canonical display name`);
  if (target.accountName && String(target.accountName).trim() !== String(canonical.name).trim()) {
    throw new Error(`Account name mismatch for ${platform}/${accountKey}`);
  }
  if (target.accountId && String(target.accountId).trim() !== String(canonical.id || "").trim()) {
    throw new Error(`Account id mismatch for ${platform}/${accountKey}`);
  }

  const targetId = String(canonical.ego?.targetId || "");
  if (target.targetId !== undefined && String(target.targetId) !== targetId) throw new Error("Account target id mismatch");
  return {
    platform,
    accountKey,
    accountId: canonical.id ? String(canonical.id) : "",
    apiUid: String(canonical.ego?.apiUid || ""),
    accountName: String(canonical.name),
    taskSpaceId,
    taskSpaceName,
    pageLabel,
    targetId,
    managementPageLabel: canonical.managementEgo?.pageLabel ? String(canonical.managementEgo.pageLabel) : '',
    managementTargetId: canonical.managementEgo?.targetId ? String(canonical.managementEgo.targetId) : '',
    managementTaskSpaceId: canonical.managementEgo?.taskSpaceId ? Number(canonical.managementEgo.taskSpaceId) : 0,
    managementTaskSpaceName: canonical.managementEgo?.taskSpaceName ? String(canonical.managementEgo.taskSpaceName) : '',
    persistentProfile: canonical.profile || "",
    egoProfileId: target.egoProfileId || canonical.ego?.profileId || "",
    platformHosts: PLATFORM_HOST_MARKERS[platform],
    knownAccounts: accounts.map(account => ({
      key: String(account.key || ""),
      id: String(account.id || ""),
      name: String(account.name || ""),
    })),
  };
}

export function assessEgoSpaceOwnership(spaces, binding) {
  const matches = (spaces || []).filter(space => Number(space?.id) === binding.taskSpaceId
    && String(space?.name || "") === binding.taskSpaceName);
  if (matches.length !== 1) {
    return { ok: false, code: matches.length ? "SPACE_IDENTITY_AMBIGUOUS" : "SPACE_NOT_FOUND", matchCount: matches.length };
  }
  const ownership = String(matches[0].ownership || "unknown");
  if (ownership === "user") return { ok: false, code: "WAIT_USER_CONTROL", id: binding.taskSpaceId, name: binding.taskSpaceName, ownership };
  if (ownership !== "agent") return { ok: false, code: "SPACE_OWNERSHIP_UNVERIFIED", id: binding.taskSpaceId, name: binding.taskSpaceName, ownership };
  return { ok: true, id: binding.taskSpaceId, name: binding.taskSpaceName, ownership };
}

export function assessAccountHeaderIdentity(headerText, binding) {
  const text = String(headerText || "").normalize("NFC");
  const matchedBy = [];
  if (binding.accountName && text.includes(binding.accountName.normalize("NFC"))) matchedBy.push("name");
  if (binding.accountId && text.includes(binding.accountId)) matchedBy.push("id");
  const conflicts = binding.knownAccounts
    .filter(account => account.key !== binding.accountKey)
    .filter(account => (account.name && text.includes(account.name.normalize("NFC")))
      || (account.id && text.includes(account.id)))
    .map(account => account.key);
  return {
    ok: matchedBy.length > 0 && conflicts.length === 0,
    matchedBy,
    expectedAccountKey: binding.accountKey,
    expectedAccountName: binding.accountName,
    expectedAccountId: binding.accountId,
    conflictingAccountKeys: conflicts,
    reason: conflicts.length ? "different_registered_account_visible" : matchedBy.length ? "exact_registered_identity_visible" : "account_identity_not_visible_in_page_header",
  };
}

export function schoolAccountStateRoot(base, binding) {
  const identity = binding.accountId || binding.accountName;
  const key = crypto.createHash("sha256").update(identity).digest("hex").slice(0, 12);
  return path.join(path.resolve(base), binding.platform, binding.accountKey, key);
}

export function isPlatformUrl(url, platform) {
  try { return (PLATFORM_HOST_MARKERS[platform] || []).includes(new URL(url).hostname); } catch { return false; }
}

export function assessDouyinApiIdentity(identity,binding,headerText='') {
 const header=assessAccountHeaderIdentity(headerText,binding);
 const name=x=>String(x||'').normalize('NFC').replace(/\s+/g,' ').trim();
 const pinnedUid=binding.apiUid!==undefined&&binding.apiUid!==null&&binding.apiUid!=='';
 const validUid=typeof identity?.uid==='string'&&/^\d+$/.test(identity.uid);
 const validPublicId=typeof binding.accountId==='string'&&/^\d+$/.test(binding.accountId);
 const uidPinValid=!pinnedUid||(typeof binding.apiUid==='string'&&/^\d+$/.test(binding.apiUid)&&identity?.uid===binding.apiUid);
 const ok=binding.platform==='douyin'&&validPublicId&&validUid&&uidPinValid&&identity?.status===200
  &&name(identity.nickname)===name(binding.accountName)
  &&typeof identity.unique_id==='string'&&/^\d+$/.test(identity.unique_id)&&identity.unique_id===binding.accountId
  &&header.conflictingAccountKeys.length===0;
 return {...header,ok,matchedBy:ok?['creator_api_uid','creator_api_name','creator_api_public_id']:[],reason:ok?'fresh_creator_api_identity':'creator_api_identity_mismatch'};
}
