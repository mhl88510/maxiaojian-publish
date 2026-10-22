import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const IN_PROGRESS_STATUSES = ["running", "inspecting", "paused_user", "blocked"];
export const LEGACY_COLLECT_SPACE = "oil-collect-publish";

export function collectJobSpaces(state, platforms) {
  const ids = [];
  const names = [];
  for (const platform of platforms) {
    const item = state.platforms?.[platform];
    if (!item) continue;
    if (item.taskSpaceId != null) ids.push(Number(item.taskSpaceId));
    if (item.taskSpaceName) names.push(item.taskSpaceName);
  }
  return { ids, names };
}

export function collectRetiredSpaces(state) {
  const ids = [];
  const names = [];
  for (const item of state.retiredSpaces || []) {
    if (item?.id != null) ids.push(Number(item.id));
    if (item?.name) names.push(item.name);
  }
  return { ids, names };
}

export function collectCompletedSpaces(stateRoot, exceptJobId = "") {
  const ids = [];
  const names = [];
  if (!stateRoot || !fs.existsSync(stateRoot)) return { ids, names };
  for (const entry of fs.readdirSync(stateRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === exceptJobId) continue;
    const statePath = path.join(stateRoot, entry.name, "state.json");
    if (!fs.existsSync(statePath)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (state.status !== "ready" && state.status !== "inspected") continue;
      const retired = collectRetiredSpaces(state);
      ids.push(...retired.ids);
      names.push(...retired.names);
      if (state.keepSpace === true) continue;
      const listed = collectJobSpaces(state, Object.keys(state.platforms || {}));
      ids.push(...listed.ids);
      names.push(...listed.names);
    } catch {
      // ignore unreadable leftover state
    }
  }
  return { ids, names };
}

export function uniqueIds(values) {
  return [...new Set((values || []).map(Number).filter(Number.isFinite))];
}

export function uniqueNames(values) {
  return [...new Set((values || []).map(value => String(value || "").trim()).filter(Boolean))];
}

export function shouldRotateSpaces(args, state) {
  if (args.cleanupOnly) return false;
  if (args.spaceName) return false;
  if (args.forceFreshSpace) return true;
  if (!args.freshSpace) return false;
  if (args.inspectOnly) return false;
  return !IN_PROGRESS_STATUSES.includes(state.status);
}

export function shouldCloseCurrentSpaces(args, state, { complete = false, incomingInProgress = false } = {}) {
  if (args.keepSpace === true || state.keepSpace === true) return false;
  if (incomingInProgress && !args.cleanupOnly) return false;
  if (args.inspectOnly) return !incomingInProgress && args.keepSpace !== true && state.keepSpace !== true;
  if (args.cleanupOnly) {
    return complete === true && !IN_PROGRESS_STATUSES.includes(state.status);
  }
  if (args.keepSpace) return false;
  return complete === true;
}

export function buildSpaceName({ spaceName, spacePrefix, platform, taskSuffix, jobId, stamp }) {
  if (spaceName) return spaceName;
  const unique = stamp ? `-${stamp}` : "";
  return `${spacePrefix} ${platform} ${taskSuffix}-${jobId}${unique}`;
}

export function retireCurrentSpaces(state, platforms, observedAt = new Date().toISOString()) {
  state.retiredSpaces ||= [];
  for (const platform of platforms) {
    const item = state.platforms?.[platform];
    if (!item) continue;
    if (item.taskSpaceId == null && !item.taskSpaceName) continue;
    state.retiredSpaces.push({
      id: item.taskSpaceId ?? null,
      name: item.taskSpaceName || null,
      platform,
      retiredAt: observedAt,
      ...(exactCleanupBinding(item.cleanupBinding) ? { cleanupBinding: item.cleanupBinding } : {}),
    });
  }
  if (state.retiredSpaces.length > 80) state.retiredSpaces = state.retiredSpaces.slice(-80);
  return state.retiredSpaces;
}

// No name/prefix fallback. Missing original identity means skip, not account failure.
// tabs are the existing Ego target incarnation fence, not a synthetic browser epoch.
export function exactCleanupBinding(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id < 1
      || ['name','profileId','taskId'].some(k => typeof value[k] !== 'string' || !value[k].trim())
      || !Array.isArray(value.tabs) || !value.tabs.length
      || value.tabs.some(t => !t || typeof t.label !== 'string' || !t.label.trim()
        || typeof t.targetId !== 'string' || !t.targetId.trim())
      || new Set(value.tabs.map(t => t.label)).size !== value.tabs.length
      || new Set(value.tabs.map(t => t.targetId)).size !== value.tabs.length) return null;
  return {id:value.id,name:value.name,profileId:value.profileId,taskId:value.taskId,
    tabs:value.tabs.map(t => ({label:t.label,targetId:t.targetId})).sort((a,b)=>a.label.localeCompare(b.label))};
}

export function cleanupIdentityMatches(space, binding) {
  const expected = exactCleanupBinding(binding), observed = exactCleanupBinding(space);
  return !!expected && !!observed && space.ownership === 'agent'
    && ['id','name','profileId','taskId'].every(k => observed[k] === expected[k])
    && JSON.stringify(observed.tabs) === JSON.stringify(expected.tabs);
}

export function spaceShouldClose(space, policy) {
  if (policy.keepSpace === true || new Set(policy.keepIds || []).has(space?.id) || new Set(policy.keepNames || []).has(space?.name)) return false;
  return (policy.closeBindings || []).some(binding => cleanupIdentityMatches(space, binding));
}

export function selectSpacesToClose(spaces, policy) {
  return (spaces || []).filter(space => spaceShouldClose(space, policy));
}

export function runEgoScript(script, command = process.env.VIDEO_PUBLISHER_V2_EGO_COMMAND || "ego-browser") {


  const isNodeScript = /\.(mjs|cjs|js)$/.test(command);
  const file = isNodeScript ? process.execPath : command;
  const args = isNodeScript ? [command] : ["nodejs"];
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(script);
  });
}

export function spaceCleanupScript({ closeBindings = [], keepIds = [], keepNames = [], keepSpace = false }) {
  return `
${exactCleanupBinding.toString()}
${cleanupIdentityMatches.toString()}
const bindings = ${JSON.stringify(closeBindings)};
const keepIds = new Set(${JSON.stringify(keepIds)}), keepNames = new Set(${JSON.stringify(keepNames)});
const closed = [], skipped = [];
for (const binding of bindings) {
  if (${JSON.stringify(keepSpace)} || !exactCleanupBinding(binding) || keepIds.has(binding.id) || keepNames.has(binding.name)) continue;
  try {
    const readExact = async () => {
      const listed = (await listTaskSpaces() || []).filter(s => s.id === binding.id);
      if (listed.length !== 1 || listed[0].ownership !== 'agent'
          || ['name','profileId','taskId'].some(k => listed[0][k] !== binding[k])) return null;
      const task = await taskSpace(binding.id);
      if (task.spaceId !== binding.id || task.name !== binding.name || task.ownership !== 'agent') return null;
      const observed = {...listed[0], tabs:await task.tabs()};
      return cleanupIdentityMatches(observed, binding) ? observed : null;
    };
    // Re-read immediately before close; no account page/navigation/claim.
    if (!await readExact() || !await readExact()) {
      skipped.push({id:binding.id, reason:'ORIGINAL_SPACE_IDENTITY_UNVERIFIED'}); continue;
    }
    await completeTaskSpace(binding.id, {keep:false});
    closed.push({id:binding.id, name:binding.name});
  } catch (error) {
    skipped.push({id:binding.id, reason:'SPACE_CLEANUP_READ_OR_CLOSE_UNVERIFIED', error:String(error?.message || error)});
  }
}
console.log('VIDEO_PUBLISHER_SPACE_CLEANUP:' + JSON.stringify({closed, skipped}));
`;
}

export function buildCleanupPlan(args, state, { complete, userControl, inputChannelBroken = false, incomingInProgress = false }) {
  if (userControl || inputChannelBroken || args.keepSpace === true || state.keepSpace === true) return null;
  const selectedPlatforms = (args.platforms && args.platforms.length)
    ? args.platforms
    : Object.keys(state.platforms || {});
  const selectedCurrent = collectJobSpaces(state, selectedPlatforms);
  const allCurrent = collectJobSpaces(state, Object.keys(state.platforms || {}));
  const retired = collectRetiredSpaces(state);
  const stale = args.cleanupStaleSpaces
    ? collectCompletedSpaces(args.stateRoot, state.jobId || "")
    : { ids: [], names: [] };
  const closeCurrent = shouldCloseCurrentSpaces(args, state, { complete, incomingInProgress });
  const selectedIds = new Set(selectedCurrent.ids);
  const selectedNames = new Set(selectedCurrent.names);
  const keepIds = uniqueIds(allCurrent.ids.filter(id => !closeCurrent || !selectedIds.has(id)));
  const keepNames = uniqueNames(allCurrent.names.filter(name => !closeCurrent || !selectedNames.has(name)));
  const protectedNames = new Set(keepNames);
  const closeNames = uniqueNames([
    ...(closeCurrent ? selectedCurrent.names : []),
    ...(args.cleanupStaleSpaces ? retired.names : []),
    ...stale.names,
    ...(args.cleanupStaleSpaces ? (args.cleanupNames || [LEGACY_COLLECT_SPACE]) : []),
  ]).filter(name => !protectedNames.has(name));
  const prefixes = args.cleanupStaleSpaces ? uniqueNames(args.cleanupPrefixes || []) : [];
  // Existing records without a complete original binding never authorize closure.
  const candidates = [
    ...(closeCurrent ? selectedPlatforms.map(platform => state.platforms?.[platform]?.cleanupBinding) : []),
    ...(args.cleanupStaleSpaces ? (state.retiredSpaces || []).map(item => item.cleanupBinding) : []),
  ];
  // Names/prefixes only select known exact bindings; they never discover new targets.
  const closeBindings = candidates.map(exactCleanupBinding).filter(Boolean)
    .filter(binding => !keepIds.includes(binding.id) && !keepNames.includes(binding.name))
    .filter(binding => closeNames.includes(binding.name) || prefixes.some(prefix => binding.name === prefix || binding.name.startsWith(prefix)));
  const uniqueBindings = [...new Map(closeBindings.map(binding => [JSON.stringify(binding), binding])).values()];
  if (!uniqueBindings.length) return null;
  return {closeNames, keepIds, keepNames, prefixes, closeCurrent, closeBindings:uniqueBindings};
}

export async function cleanupTaskSpaces(options) {
  const result = await runEgoScript(spaceCleanupScript(options));
  const match = `${result.stdout}\n${result.stderr}`.match(/VIDEO_PUBLISHER_SPACE_CLEANUP:(\{.*\})/);
  return {
    ok: result.code === 0,
    closed: match ? JSON.parse(match[1]).closed : [],
    detail: result.stderr.trim().slice(-800),
  };
}
