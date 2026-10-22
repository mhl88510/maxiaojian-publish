import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finalPublishClickStatus } from '../lib/final-publish-click-evidence.mjs';

function fixture(observations) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'final-click-evidence-'));
  const history = observations.map((observation, index) => {
    const evidencePath = path.join(root, `${index}.json`);
    fs.writeFileSync(evidencePath, JSON.stringify({ observation }));
    return { phase: observation.phase || 'verify', evidencePath };
  });
  return { root, state: { platforms: { douyin: { history } } } };
}

const observation = (phase, { top = false, safety = false, guard = true, actions } = {}) => ({
  phase,
  finalPublishClicked: top,
  actions,
  gates: { safety: { evidence: { finalPublishClicked: safety, guardArmed: guard } } },
});

test('returns false only when every saved phase explicitly records no final click', () => {
  const f = fixture([
    observation('inspect', { guard: false }),
    observation('upload_start'),
    observation('prefill'),
    observation('upload'),
    observation('mutate'),
    observation('verify'),
  ]);
  assert.equal(finalPublishClickStatus(f.state, ['douyin']), false);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('missing evidence remains unknown rather than being coerced to no click', () => {
  const f = fixture([observation('inspect', { guard: false }), {
    phase: 'upload_start', finalPublishClicked: false, gates: { safety: { evidence: { guardArmed: true } } },
  }]);
  assert.equal(finalPublishClickStatus(f.state, ['douyin']), null);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('any explicit final click in persisted action evidence wins over other phases', () => {
  const f = fixture([
    observation('inspect', { guard: false }),
    observation('mutate', { actions: { submit: { finalPublishClickCount: 1 } } }),
  ]);
  assert.equal(finalPublishClickStatus(f.state, ['douyin']), true);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('missing files and non-inspect phases without an armed guard stay unknown', () => {
  const f = fixture([observation('inspect', { guard: false }), observation('upload_start', { guard: false })]);
  assert.equal(finalPublishClickStatus(f.state, ['douyin']), null);
  f.state.platforms.douyin.history[1].evidencePath = path.join(f.root, 'missing.json');
  assert.equal(finalPublishClickStatus(f.state, ['douyin']), null);
  fs.rmSync(f.root, { recursive: true, force: true });
});
