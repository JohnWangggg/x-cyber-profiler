import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../src/storage.js';
import { createGM } from './gm-stub.js';
import { XCP, profileKey } from '../src/constants.js';

const T = 1800000000000;

function makeStorage(gm, extra) {
  const opts = Object.assign({
    now: () => T,
    setTimeout() {
      return { unref() {} };
    },
    clearTimeout() {}
  }, extra || {});
  const storage = createStorage(gm, opts);
  return storage;
}

function localDate(ts) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function keepSample(id, text, ts) {
  return { id, text, links: [], promoted: false, ts };
}

function spamSample(id, token, ts) {
  return { id, text: token, links: [], promoted: false, spamToken: token, ts };
}

test('peek does not create or index; get creates without indexing', () => {
  const gm = createGM();
  const storage = makeStorage(gm);
  storage.init();

  assert.equal(storage.peek('ghost'), null);
  assert.deepEqual(storage.listProfiles(), []);
  assert.equal(gm._dump()[profileKey('ghost')], undefined);

  const profile = storage.get('alice');
  assert.equal(profile.handle, 'alice');
  assert.deepEqual(profile.samples, []);
  assert.deepEqual(storage.listProfiles(), []);
  assert.equal(gm._dump()[profileKey('alice')], undefined);
  assert.equal(storage.peek('alice'), profile);
});

test('commit makes index visible and flush writes an isolated snapshot', () => {
  const gm = createGM();
  const storage = makeStorage(gm);
  storage.init();

  const profile = storage.get('alice');
  profile.displayName = 'Alice';
  profile.sampleCount = 1;
  profile.samples = [keepSample('1', 'hello world', 1)];
  profile.updatedAt = T;

  assert.equal(storage.commit(profile), true);
  assert.deepEqual(storage.listProfiles(), ['alice']);
  assert.equal(gm._dump()[profileKey('alice')], undefined);

  assert.equal(storage.flush(), true);
  const snapshot = gm._dump()[profileKey('alice')];
  assert.equal(snapshot.displayName, 'Alice');
  assert.equal(snapshot.samples.length, 1);
  assert.deepEqual(gm._dump()[XCP.KEY_INDEX], ['alice']);

  profile.displayName = 'Changed after flush';
  assert.equal(gm._dump()[profileKey('alice')].displayName, 'Alice');
  assert.equal(storage.flush(), true);
  assert.equal(gm._dump()[profileKey('alice')].displayName, 'Alice');
});

test('loadSettings and saveSettings preserve false, 0, and empty strings', () => {
  const gm = createGM({
    [XCP.KEY_SETTINGS]: {
      enabled: false,
      dwellMs: 0,
      temperature: 0,
      jevUrl: '',
      namerKey: ''
    }
  });
  const storage = makeStorage(gm);
  storage.init();

  const settings = storage.loadSettings();
  assert.equal(settings.enabled, false);
  assert.equal(settings.dwellMs, 0);
  assert.equal(settings.temperature, 0);
  assert.equal(settings.jevUrl, '');
  assert.equal(settings.namerKey, '');

  storage.saveSettings({ enabled: true, dwellMs: 0, jevUrl: '' });
  const saved = storage.loadSettings();
  assert.equal(saved.enabled, true);
  assert.equal(saved.dwellMs, 0);
  assert.equal(saved.jevUrl, '');
  assert.equal(saved.namerKey, '');
  assert.equal(saved.tone, 'sharp');
});

test('exportJSON omits settings, keys, seenIds, and shortHits', () => {
  const gm = createGM();
  const storage = makeStorage(gm);
  storage.init();
  storage.saveSettings({ apiKey: 'api-secret', jevKey: 'jev-secret', namerKey: 'namer-secret' });

  const profile = storage.get('alice');
  profile.label = {
    text: '空投布道师',
    vibe: 'ember',
    archetype: 'ad',
    confidence: 0.82,
    reason: '引导私信',
    lang: 'zh',
    tone: 'sharp',
    stage: 2,
    updatedAt: T
  };
  profile.assessment = {
    archetype: { bot: 0.1, ad: 0.7, toxic: 0, organic: 0.1, unknown: 0.1 },
    traits: { promotional: 0.9, repetitive: 0.6, hostile: 0, informative: 0, personal: 0, ironic: 0, expert: 0, spammy: 0.4 },
    valence: 0.2,
    energy: 0.8,
    confidence: 0.82,
    evidence: ['external_link'],
    model: 'jev',
    sampleCount: 3,
    ts: T
  };
  profile.dossier = '熟练引导站外';
  profile.history = [{ text: '旧标签', stage: 1, ts: T - 1000 }];
  profile.stage = 2;
  profile.hidden = true;
  profile.seenIds = ['1794390000000'];
  profile.shortHits = { gm: 3 };
  profile.updatedAt = T;
  storage.commit(profile);
  storage.flush();

  const text = storage.exportJSON();
  const doc = JSON.parse(text);
  assert.equal(doc.app, 'x-cyber-profiler');
  assert.equal(doc.v, XCP.EXPORT_VERSION);
  assert.equal(doc.profiles.length, 1);
  const exported = doc.profiles[0];
  assert.equal(exported.label.text, '空投布道师');
  assert.equal(exported.assessment.confidence, 0.82);
  assert.equal(exported.dossier, '熟练引导站外');
  assert.equal(exported.history.length, 1);
  assert.equal(exported.stage, 2);
  assert.equal(exported.hidden, true);
  assert.equal(exported.seenIds, undefined);
  assert.equal(exported.shortHits, undefined);
  assert.doesNotMatch(text, /jevKey|namerKey|apiKey|seenIds|shortHits/);
  assert.equal(text.includes('secret'), false);
});

test('importJSON rejects pollution, skips bad handles, migrates v2, and merges by updatedAt', () => {
  const gm = createGM();
  const storage = makeStorage(gm);
  storage.init();

  const payload = '{"v":2,"exportedAt":1,"profiles":['
    + '{"v":2,"handle":"alice","displayName":"Alice",'
    + '"tags":[{"text":"空投布道师","category":"ad","confidence":0.82}],'
    + '"reason":"引导私信","level":3,"locked":true,"updatedAt":1000,'
    + '"__proto__":{"polluted":true}},'
    + '{"v":2,"handle":"bad handle","updatedAt":1000},'
    + '{"v":2,"handle":"__proto__","updatedAt":1000}]}';

  const result = storage.importJSON(payload);
  assert.equal(result.imported, 1);
  assert.ok(result.skipped >= 2);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(storage.listProfiles(), ['alice']);

  const profile = storage.peek('alice');
  assert.equal(profile.v, 3);
  assert.equal(profile.label.text, '空投布道师');
  assert.equal(profile.label.archetype, 'ad');
  assert.equal(profile.label.vibe, 'ember');
  assert.equal(profile.label.stage, 3);
  assert.equal(profile.stage, 3);
  assert.equal(profile.dossier, '引导私信');
  assert.equal(profile.hidden, false);
  assert.equal(profile.locked, undefined);
  assert.deepEqual(profile.history, []);

  const local = storage.peek('alice');
  local.label.text = '本地标签';
  local.updatedAt = 2000;
  storage.commit(local);
  storage.flush();

  const older = JSON.stringify({
    v: 2,
    profiles: [{
      v: 2,
      handle: 'alice',
      tags: [{ text: '过期标签', category: 'bot', confidence: 0.5 }],
      level: 1,
      updatedAt: 1000
    }]
  });
  const oldResult = storage.importJSON(older);
  assert.equal(oldResult.imported, 0);
  assert.equal(oldResult.skipped, 1);
  assert.equal(storage.peek('alice').label.text, '本地标签');

  const newer = JSON.stringify({
    v: 2,
    profiles: [{
      v: 2,
      handle: 'alice',
      tags: [{ text: '新标签', category: 'organic', confidence: 0.9 }],
      level: 4,
      updatedAt: 3000
    }]
  });
  const newResult = storage.importJSON(newer);
  assert.equal(newResult.imported, 1);
  const replaced = storage.peek('alice');
  assert.equal(replaced.label.text, '新标签');
  assert.equal(replaced.stage, 4);
});

test('clearAll clears profiles and index, bumps epoch, and keeps settings', () => {
  const gm = createGM({ [XCP.KEY_SETTINGS]: { enabled: false } });
  const storage = makeStorage(gm);
  storage.init();

  const alice = storage.get('alice');
  alice.updatedAt = T;
  storage.commit(alice);
  const bob = storage.get('bob');
  bob.updatedAt = T;
  storage.commit(bob);
  storage.flush();
  const before = storage.epoch();

  storage.clearAll();
  const dump = gm._dump();
  assert.equal(storage.epoch(), before + 1);
  assert.equal(dump[XCP.KEY_EPOCH], before + 1);
  assert.equal(dump[XCP.KEY_INDEX], undefined);
  assert.equal(dump[profileKey('alice')], undefined);
  assert.equal(dump[profileKey('bob')], undefined);
  assert.deepEqual(storage.listProfiles(), []);
  assert.equal(storage.peek('alice'), null);
  assert.equal(dump[XCP.KEY_SETTINGS].enabled, false);
});

test('mergeRemote uses max counts, capped unions, and preserves invariants', () => {
  const gm = createGM();
  const storage = makeStorage(gm);
  storage.init();

  const local = storage.get('alice');
  local.displayName = 'Local';
  local.verified = false;
  local.sampleCount = 5;
  local.charCount = 100;
  local.spamCount = 1;
  local.samples = [];
  for (let i = 0; i < 8; i += 1) local.samples.push(keepSample('l' + i, 'x'.repeat(10), i));
  local.samples.push(spamSample('ls', 'gm', 20));
  local.seenIds = [];
  for (let i = 0; i < 80; i += 1) local.seenIds.push('l' + i);
  local.shortHits = {};
  for (let i = 0; i < 15; i += 1) local.shortHits['a' + i] = 1;
  local.shortHits.shared = 2;
  local.history = [];
  for (let i = 0; i < 5; i += 1) local.history.push({ text: '本地' + i, stage: 1, ts: i });
  local.assessment = { archetype: { ad: 1 }, traits: {}, confidence: 0.5, ts: 100 };
  local.label = {
    text: '本地标签',
    vibe: 'ember',
    archetype: 'ad',
    confidence: 0.5,
    reason: '',
    lang: 'zh',
    tone: 'sharp',
    stage: 2,
    updatedAt: 100
  };
  local.stage = 2;
  local.cooldownUntil = 500;
  local.failCount = 2;
  local.hidden = false;
  local.createdAt = 100;
  local.updatedAt = 1000;
  storage.commit(local);
  assert.equal(storage.listProfiles().length, 1);

  const remote = {
    v: 3,
    handle: 'alice',
    displayName: 'Remote',
    verified: true,
    lang: 'en',
    sampleCount: 12,
    charCount: 200,
    spamCount: 3,
    samples: [],
    seenIds: [],
    shortHits: {},
    assessment: { archetype: { organic: 1 }, traits: {}, confidence: 0.9, ts: 200 },
    label: {
      text: '远端标签',
      vibe: 'aurora',
      archetype: 'organic',
      confidence: 0.9,
      reason: '',
      lang: 'en',
      tone: 'sharp',
      stage: 3,
      updatedAt: 200
    },
    dossier: '远端笔记',
    hidden: true,
    history: [],
    stage: 4,
    cooldownUntil: 900,
    stable: true,
    failCount: 1,
    createdAt: 50,
    updatedAt: 2000
  };
  for (let i = 0; i < 8; i += 1) remote.samples.push(keepSample('r' + i, 'y'.repeat(10), i));
  remote.samples.push(spamSample('rs2', 'lol', 21));
  remote.samples.push(spamSample('rs3', 'lol', 22));
  remote.samples.push(spamSample('rs4', 'lol', 23));
  for (let i = 0; i < 80; i += 1) remote.seenIds.push('r' + i);
  for (let i = 0; i < 15; i += 1) remote.shortHits['b' + i] = 1;
  remote.shortHits.shared = 7;
  for (let i = 0; i < 5; i += 1) remote.history.push({ text: '远端' + i, stage: 2, ts: 100 + i });

  const merged = storage.mergeRemote(remote);
  assert.equal(merged.sampleCount, 12);
  assert.equal(merged.charCount, 200);
  assert.equal(merged.spamCount, 4);
  assert.ok(merged.samples.length <= XCP.SAMPLE_CAP);
  assert.ok(merged.samples.filter((s) => s.spamToken).length <= XCP.SPAM_SAMPLE_CAP);
  assert.ok(merged.seenIds.length <= XCP.SEEN_CAP);
  assert.ok(Object.keys(merged.shortHits).length <= XCP.SHORT_KEY_CAP);
  assert.equal(merged.shortHits.shared, 7);
  assert.ok(merged.history.length <= XCP.HISTORY_CAP);
  assert.equal(merged.history[0].ts, 104);
  assert.equal(merged.stage, 4);
  assert.ok(merged.stage >= merged.label.stage);
  assert.equal(merged.label.text, '远端标签');
  assert.equal(merged.assessment.ts, 200);
  assert.equal(merged.hidden, true);
  assert.equal(merged.cooldownUntil, 900);
  assert.equal(merged.failCount, 1);
  assert.equal(merged.createdAt, 50);
  assert.equal(merged.updatedAt, 2000);
  assert.equal(merged.verified, true);
  assert.equal(merged.displayName, 'Remote');
});

test('flush merges a remote profile and index before writing', () => {
  const gm = createGM();
  const storage = makeStorage(gm);
  storage.init();

  const local = storage.get('alice');
  local.samples = [keepSample('1', 'local sample text', 100)];
  local.sampleCount = 1;
  local.charCount = 17;
  local.label = {
    text: '本地标签',
    vibe: 'ember',
    archetype: 'ad',
    confidence: 0.5,
    reason: '',
    lang: 'zh',
    tone: 'sharp',
    stage: 1,
    updatedAt: 100
  };
  local.stage = 1;
  local.updatedAt = 100;
  storage.commit(local);

  gm.set(profileKey('alice'), {
    v: 3,
    handle: 'alice',
    displayName: 'Remote Alice',
    samples: [keepSample('2', 'remote sample text', 200)],
    sampleCount: 2,
    charCount: 18,
    assessment: { archetype: { ad: 1 }, traits: {}, confidence: 0.8, ts: 200 },
    label: {
      text: '远端标签',
      vibe: 'ember',
      archetype: 'ad',
      confidence: 0.8,
      reason: '',
      lang: 'zh',
      tone: 'sharp',
      stage: 2,
      updatedAt: 200
    },
    stage: 2,
    createdAt: 50,
    updatedAt: 200
  });
  gm.set(XCP.KEY_INDEX, ['alice', 'remote_user']);

  assert.equal(storage.flush(), true);
  const stored = gm._dump()[profileKey('alice')];
  assert.equal(stored.samples.length, 2);
  assert.equal(stored.sampleCount, 2);
  assert.equal(stored.displayName, 'Remote Alice');
  assert.equal(stored.label.text, '远端标签');
  assert.equal(stored.assessment.ts, 200);
  assert.deepEqual(gm._dump()[XCP.KEY_INDEX], ['alice', 'remote_user']);
  assert.deepEqual(storage.listProfiles(), ['alice', 'remote_user']);
});

test('quota failure evicts a batch and retries once', () => {
  const gm = createGM();
  const storage = makeStorage(gm);
  storage.init();

  const low = storage.get('low');
  low.updatedAt = 100;
  storage.commit(low);
  storage.flush();
  const high = storage.get('high');
  high.stage = 5;
  high.label = {
    text: '稳定标签',
    vibe: 'aurora',
    archetype: 'organic',
    confidence: 0.95,
    reason: '',
    lang: 'zh',
    tone: 'sharp',
    stage: 5,
    updatedAt: 500
  };
  high.stable = true;
  high.updatedAt = 500;
  storage.commit(high);

  const quota = new Error('QUOTA_BYTES quota exceeded');
  quota.name = 'QuotaExceededError';
  gm._failNextSet(quota);

  assert.equal(storage.flush(), true);
  assert.equal(gm._dump()[profileKey('low')], undefined);
  assert.ok(gm._dump()[profileKey('high')]);
  assert.deepEqual(storage.listProfiles(), ['high']);
});

test('usage resets when the local date changes', () => {
  let current = T;
  const gm = createGM();
  const storage = createStorage(gm, { now: () => current });
  storage.init();

  assert.deepEqual(storage.bumpUsage(), { date: localDate(T), count: 1 });
  assert.equal(storage.getUsage().count, 1);
  current += 86400000;
  assert.deepEqual(storage.getUsage(), { date: localDate(current), count: 0 });
  assert.deepEqual(storage.bumpUsage(), { date: localDate(current), count: 1 });
  storage.flush();
  assert.equal(gm._dump()[XCP.KEY_USAGE].date, localDate(current));
  assert.equal(gm._dump()[XCP.KEY_USAGE].count, 1);
});

test('usage sums across storage instances sharing one GM', () => {
  const gm = createGM();
  const a = makeStorage(gm);
  const b = makeStorage(gm);
  a.init();
  b.init();

  a.bumpUsage(2);
  a.flush();
  b.bumpUsage(3);
  b.flush();
  assert.deepEqual(b.getUsage(), { date: localDate(T), count: 5 });
  assert.deepEqual(gm._dump()[XCP.KEY_USAGE], { date: localDate(T), count: 5 });

  b.flush();
  assert.deepEqual(b.getUsage(), { date: localDate(T), count: 5 });
  assert.deepEqual(gm._dump()[XCP.KEY_USAGE], { date: localDate(T), count: 5 });
});

test('usage adds deltas regardless of instance flush order', () => {
  const gm = createGM({ [XCP.KEY_USAGE]: { date: localDate(T), count: 5 } });
  const a = makeStorage(gm);
  const b = makeStorage(gm);
  a.init();
  b.init();

  b.bumpUsage(1);
  a.bumpUsage(1);
  a.flush();
  b.flush();
  assert.deepEqual(b.getUsage(), { date: localDate(T), count: 7 });
  assert.deepEqual(gm._dump()[XCP.KEY_USAGE], { date: localDate(T), count: 7 });
});

test('usage day rollover keeps only the new day count', () => {
  let current = T;
  const gm = createGM({ [XCP.KEY_USAGE]: { date: localDate(T), count: 4 } });
  const a = createStorage(gm, {
    now: () => current,
    setTimeout() {
      return { unref() {} };
    },
    clearTimeout() {}
  });
  a.init();
  a.bumpUsage(2);
  a.flush();
  assert.equal(gm._dump()[XCP.KEY_USAGE].count, 6);

  current += 86400000;
  const b = createStorage(gm, {
    now: () => current,
    setTimeout() {
      return { unref() {} };
    },
    clearTimeout() {}
  });
  b.init();
  assert.deepEqual(b.getUsage(), { date: localDate(current), count: 0 });
  b.bumpUsage(3);
  b.flush();
  assert.deepEqual(gm._dump()[XCP.KEY_USAGE], { date: localDate(current), count: 3 });
  assert.deepEqual(a.getUsage(), { date: localDate(current), count: 3 });
});

test('flushing without new bumps leaves usage unchanged', () => {
  const gm = createGM();
  const storage = makeStorage(gm);
  storage.init();
  storage.bumpUsage(2);
  storage.flush();
  assert.deepEqual(gm._dump()[XCP.KEY_USAGE], { date: localDate(T), count: 2 });

  storage.flush();
  assert.deepEqual(gm._dump()[XCP.KEY_USAGE], { date: localDate(T), count: 2 });
  storage.getUsage();
  storage.flush();
  assert.deepEqual(gm._dump()[XCP.KEY_USAGE], { date: localDate(T), count: 2 });
});

test('import clamps future timestamps and resets transient state', () => {
  const gm = createGM();
  const storage = makeStorage(gm);
  storage.init();
  const doc = {
    app: 'x-cyber-profiler',
    v: 2,
    profiles: [{
      v: 3,
      handle: 'alice',
      sampleCount: 1,
      charCount: 5,
      samples: [{ id: '1', text: 'hello', links: [], ts: 1e300 }],
      hidden: true,
      cooldownUntil: 1e300,
      stable: true,
      failCount: 9,
      updatedAt: 1e300,
      createdAt: 1e300,
      label: {
        text: '测试标签', vibe: 'frost', archetype: 'unknown', confidence: 0.5,
        reason: 'r', lang: 'zh', tone: 'sharp', stage: 4, updatedAt: 1e300
      },
      assessment: { archetype: { unknown: 1 }, traits: {}, confidence: 0.5, ts: 1e300 },
      history: [{ text: '旧标签', stage: 1, ts: 1e300 }]
    }]
  };
  const result = storage.importJSON(JSON.stringify(doc));
  assert.equal(result.imported, 1);
  const p = storage.peek('alice');
  assert.equal(p.hidden, false);
  assert.equal(p.cooldownUntil, 0);
  assert.equal(p.stable, false);
  assert.equal(p.failCount, 0);
  assert.ok(p.updatedAt <= T + 7 * 864e5);
  assert.ok(p.label.updatedAt <= T + 7 * 864e5);
  assert.ok(p.assessment.ts <= T + 7 * 864e5);
  assert.ok(p.history[0].ts <= T + 7 * 864e5);
});
