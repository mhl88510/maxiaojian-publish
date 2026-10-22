import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyVerdict, evaluateObservation, requiredGates } from "../lib/model.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = path.join(HERE, "..", "platforms");

test("Xiaohongshu honors only explicit original declaration; other school adapters remain neutral", () => {
  const xhs = fs.readFileSync(path.join(PLATFORM_DIR, "xiaohongshu.mjs"), "utf8");
  const xhsMutation = xhs.slice(xhs.indexOf("async function mutateXiaohongshu"), xhs.indexOf("async function runPlatformPhase"));
  assert.match(xhs, /xhsDeclarationChoice === 'original'/);
  assert.match(xhs, /ensureXhsOriginalDeclaration\(\)/);
  assert.match(xhs, /choice: 'none'/);
  assert.doesNotMatch(xhsMutation, /school_policy_no_declaration/);

  const channels = fs.readFileSync(path.join(PLATFORM_DIR, "wechat-channels.mjs"), "utf8");
  const channelsMutation = channels.slice(channels.indexOf("async function mutateWechatChannels"), channels.indexOf("async function runPlatformPhase"));
  assert.doesNotMatch(channels, /ensureWechatOriginal/);
  assert.match(channelsMutation, /school_policy_no_declaration/);
  assert.match(channels, /unexpectedSelection\s*:\s*true/);

  const bilibili = fs.readFileSync(path.join(PLATFORM_DIR, "bilibili.mjs"), "utf8");
  const bilibiliMutation = bilibili.slice(bilibili.indexOf("async function mutateBilibili"), bilibili.indexOf("async function quarantineBilibili"));
  assert.doesNotMatch(bilibiliMutation, /ensureBilibiliDeclarationV2\(\)/);
  assert.match(bilibiliMutation, /school_policy_no_declaration/);
  assert.match(bilibili, /unexpectedSelection\s*:\s*true/);
});

test("an unexpected preselected declaration blocks the platform before upload", () => {
  for (const platform of ["xiaohongshu", "bilibili", "wechat_channels"]) {
    const gates = Object.fromEntries(requiredGates(platform).map(name => [name, { ok: true, evidence: {} }]));
    gates.original = { ok: false, evidence: { unexpectedSelection: true, enabled: true } };
    gates.safety = { ok: true, evidence: { finalPublishClicked: false, guardArmed: true, blockedAttempts: 0 } };
    const verdict = evaluateObservation({ platform, phase: "inspect", gates });
    assert.equal(verdict.ready, false);
    assert.equal(verdict.blocker?.code, "DECLARATION_MISMATCH");
    assert.equal(verdict.blocker?.requiresUser, true);
    assert.equal(classifyVerdict(verdict), "blocked_user");
  }
});
