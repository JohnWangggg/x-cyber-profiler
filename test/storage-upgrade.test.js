import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../src/storage.js';
import { createGM } from './gm-stub.js';

function make(gm, now) {
  return createStorage(gm, {
    now: () => now,
    setTimeout: () => ({ unref() {} }),
    clearTimeout() {}
  });
}

test('userscript reload/upgrade keeps existing label, history, dossier and settings', () => {
  const gm = createGM();
  const a = make(gm, 1000);
  a.init();
  a.saveSettings({ namerModel: 'auto/deepseek-v4.1-flash', labelLang: 'ja' });
  const p = a.get('alice');
  Object.assign(p, {
    handle: 'alice',
    stage: 4,
    label: {
      text: '旧标签', vibe: 'ember', archetype: 'ad', confidence: 0.9,
      reason: '旧理由', lang: 'ja', tone: 'sharp', stage: 4, updatedAt: 900
    },
    dossier: '旧笔记',
    history: [{ text: '更旧标签', stage: 2, ts: 800 }],
    assessment: {
      archetype: { bot: 0, ad: 1, toxic: 0, organic: 0, unknown: 0 },
      traits: {}, confidence: 0.9, sampleCount: 4, ts: 900
    },
    updatedAt: 900
  });
  a.commit(p);
  a.flush();

  const b = make(gm, 2000);
  b.init();
  const q = b.peek('alice');
  assert.equal(q.label.text, '旧标签');
  assert.equal(q.stage, 4);
  assert.equal(q.dossier, '旧笔记');
  assert.equal(q.history[0].text, '更旧标签');
  assert.equal(q.assessment.confidence, 0.9);
  assert.equal(b.loadSettings().namerModel, 'auto/deepseek-v4.1-flash');
  assert.equal(b.loadSettings().labelLang, 'ja');
});
