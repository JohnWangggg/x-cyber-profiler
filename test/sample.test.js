import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyText,
  ingestSample,
  effectiveChars,
  targetStage,
  cooldownFor,
  shouldAssess,
  trimShortHits
} from '../src/sample.js';
import { XCP } from '../src/constants.js';

function base(over = {}) {
  return {
    seenIds: [],
    samples: [],
    shortHits: {},
    sampleCount: 0,
    charCount: 0,
    spamCount: 0,
    failCount: 0,
    stage: 0,
    ...over
  };
}

test('classifyText: empty and blank input', () => {
  assert.deepEqual(classifyText(''), { kind: 'empty' });
  assert.deepEqual(classifyText('   \n\t  '), { kind: 'empty' });
  assert.deepEqual(classifyText(null), { kind: 'empty' });
});

test('classifyText: shorter than 5 kept characters is a short token', () => {
  assert.deepEqual(classifyText('gm'), { kind: 'short', token: 'gm' });
  assert.deepEqual(classifyText('OK!'), { kind: 'short', token: 'ok!' });
  assert.deepEqual(classifyText('哈哈哈'), { kind: 'short', token: '哈哈哈' });
});

test('classifyText: 5 or more cleaned characters is keep', () => {
  assert.deepEqual(classifyText('hello'), { kind: 'keep' });
  assert.deepEqual(classifyText('@alice 😀 hello world'), { kind: 'keep' });
});

test('classifyText: pure noise uses mention/emoji/link tokens', () => {
  assert.deepEqual(classifyText('@alice @bob'), { kind: 'short', token: 'mention' });
  assert.deepEqual(classifyText('😀😀'), { kind: 'short', token: 'emoji' });
  assert.deepEqual(classifyText('https://t.co/abc'), { kind: 'short', token: 'link' });
  assert.deepEqual(classifyText('t.co/abc'), { kind: 'short', token: 'link' });
  assert.deepEqual(classifyText('https://example.com/path'), { kind: 'short', token: 'link' });
});

test('classifyText: repeated calls do not drift shared regex state', () => {
  assert.deepEqual(classifyText('😀'), { kind: 'short', token: 'emoji' });
  assert.deepEqual(classifyText('😀'), { kind: 'short', token: 'emoji' });
  assert.deepEqual(classifyText('@a'), { kind: 'short', token: 'mention' });
  assert.deepEqual(classifyText('@a'), { kind: 'short', token: 'mention' });
});

test('ingestSample: keep sample, duplicate statusId, and identity rules', () => {
  const p = base();
  const r = ingestSample(p, {
    statusId: '1',
    text: 'hello world!!!',
    displayName: 'Alice',
    verified: false,
    links: ['a', 'b', 'c', 'd'],
    promoted: true,
    ts: 111
  });

  assert.deepEqual(r, { added: true, kind: 'keep' });
  assert.equal(p.sampleCount, 1);
  assert.equal(p.samples.length, 1);
  assert.equal(p.samples[0].text, 'hello world!!!');
  assert.equal(p.charCount, 'hello world!!!'.length);
  assert.deepEqual(p.samples[0].links, ['a', 'b', 'c']);
  assert.equal(p.samples[0].promoted, true);
  assert.equal(p.samples[0].ts, 111);
  assert.equal(p.displayName, 'Alice');
  assert.equal(p.verified, false);
  assert.ok(p.updatedAt > 0);

  p.updatedAt = 1000;
  const dup = ingestSample(p, {
    statusId: '1',
    text: 'hello world!!!',
    displayName: 'Alice 2',
    verified: true
  });
  assert.deepEqual(dup, { added: false, kind: 'dup' });
  assert.equal(p.sampleCount, 1);
  assert.equal(p.charCount, 'hello world!!!'.length);
  assert.equal(p.displayName, 'Alice 2');
  assert.equal(p.verified, true);
  assert.ok(p.updatedAt > 1000);

  p.updatedAt = 2000;
  const stable = ingestSample(p, {
    statusId: '1',
    text: 'hello world!!!',
    displayName: 'Alice 2',
    verified: false
  });
  assert.deepEqual(stable, { added: false, kind: 'dup' });
  assert.equal(p.updatedAt, 2000);
  assert.equal(p.verified, true);
});

test('ingestSample: empty displayName never overwrites; long name is capped', () => {
  const p = base();
  ingestSample(p, { statusId: '1', text: 'gm', displayName: 'Keep' });
  assert.equal(p.displayName, 'Keep');

  ingestSample(p, { statusId: '2', text: 'ok', displayName: '   ' });
  assert.equal(p.displayName, 'Keep');

  const long = 'x'.repeat(120);
  ingestSample(p, { statusId: '3', text: 'ok', displayName: long });
  assert.equal(p.displayName, 'x'.repeat(XCP.DISPLAY_NAME_CAP));
});

test('ingestSample: no statusId is dup and records nothing', () => {
  const p = base();
  const r = ingestSample(p, { text: 'hello world', displayName: 'NoId' });
  assert.deepEqual(r, { added: false, kind: 'dup' });
  assert.deepEqual(p.seenIds, []);
  assert.equal(p.samples.length, 0);
  assert.equal(p.sampleCount, 0);
  assert.equal(p.displayName, 'NoId');
});

test('ingestSample: duplicate sample id is detected even after seenIds eviction', () => {
  const p = base({
    seenIds: [],
    samples: [{ id: 'x', text: 'hello world', links: [], promoted: false, cardHost: '', ts: 1 }],
    sampleCount: 1,
    charCount: 'hello world'.length
  });
  const r = ingestSample(p, { statusId: 'x', text: 'hello world' });
  assert.deepEqual(r, { added: false, kind: 'dup' });
  assert.equal(p.sampleCount, 1);
  assert.equal(p.charCount, 'hello world'.length);
});

test('ingestSample: ring caps at 10 while sampleCount keeps growing', () => {
  const p = base();
  for (let i = 0; i < 12; i++) {
    const r = ingestSample(p, { statusId: String(i), text: 'hello ' + i });
    assert.equal(r.kind, 'keep');
  }
  assert.equal(p.samples.length, XCP.SAMPLE_CAP);
  assert.equal(p.samples[0].id, '2');
  assert.equal(p.samples[p.samples.length - 1].id, '11');
  assert.equal(p.sampleCount, 12);
  assert.equal(p.charCount, 10 * 'hello 0'.length + 2 * 'hello 10'.length);
  assert.equal(p.seenIds.length, 12);
});

test('ingestSample: keep text is capped at 240 and charCount uses capped length', () => {
  const p = base();
  const r = ingestSample(p, { statusId: 'long', text: 'a'.repeat(300) });
  assert.equal(r.kind, 'keep');
  assert.equal(p.samples[0].text.length, XCP.TEXT_CAP);
  assert.equal(p.charCount, XCP.TEXT_CAP);
});

test('ingestSample: empty is seen only and does not touch updatedAt', () => {
  const p = base({ updatedAt: 500 });
  const r = ingestSample(p, { statusId: 'e', text: '   \n ' });
  assert.deepEqual(r, { added: false, kind: 'empty' });
  assert.deepEqual(p.seenIds, ['e']);
  assert.equal(p.sampleCount, 0);
  assert.equal(p.samples.length, 0);
  assert.equal(p.updatedAt, 500);
});

test('ingestSample: seenIds caps at 80 dropping the oldest', () => {
  const p = base();
  for (let i = 0; i < 85; i++) {
    ingestSample(p, { statusId: 's' + i, text: 'gm' });
  }
  assert.equal(p.seenIds.length, XCP.SEEN_CAP);
  assert.equal(p.seenIds[0], 's5');
  assert.equal(p.seenIds[p.seenIds.length - 1], 's84');
});

test('ingestSample: gm spam samples at hits 3/6/9/12, then none', () => {
  const p = base();
  const kinds = [];
  for (let i = 1; i <= 15; i++) {
    const r = ingestSample(p, { statusId: 'g' + i, text: 'gm', ts: i });
    kinds.push(r.kind);
  }

  assert.deepEqual(kinds, [
    'short', 'short', 'spam',
    'short', 'short', 'spam',
    'short', 'short', 'spam',
    'short', 'short', 'spam',
    'short', 'short', 'short'
  ]);
  assert.equal(p.shortHits.gm, 15);
  assert.equal(p.spamCount, XCP.SPAM_SAMPLE_CAP);
  assert.equal(p.sampleCount, XCP.SPAM_SAMPLE_CAP);
  assert.equal(p.samples.length, XCP.SPAM_SAMPLE_CAP);
  assert.equal(p.charCount, 0);
  for (const s of p.samples) {
    assert.equal(s.text, 'gm');
    assert.equal(s.spamToken, 'gm');
  }
  assert.equal(targetStage(p), 2);
  assert.equal(effectiveChars(p), XCP.SPAM_SAMPLE_CAP * XCP.SPAM_CHAR_WEIGHT);
});

test('ingestSample: short hits below the repeat threshold create no samples', () => {
  const p = base();
  const first = ingestSample(p, { statusId: 't1', text: 'gn' });
  const second = ingestSample(p, { statusId: 't2', text: 'gn' });
  assert.deepEqual(first, { added: false, kind: 'short' });
  assert.deepEqual(second, { added: false, kind: 'short' });
  assert.equal(p.sampleCount, 0);
  assert.equal(p.samples.length, 0);
  assert.equal(p.shortHits.gn, 2);

  const third = ingestSample(p, { statusId: 't3', text: 'gn' });
  assert.deepEqual(third, { added: true, kind: 'spam' });
  assert.equal(p.sampleCount, 1);
  assert.equal(p.spamCount, 1);
  assert.equal(targetStage(p), 1);
});

test('trimShortHits: caps at 20 and drops lowest value, ties by insertion order', () => {
  const hits = {};
  for (let i = 0; i < 20; i++) hits['k' + i] = 5;
  hits.extra = 1;
  const p = base({ shortHits: hits });
  trimShortHits(p);
  assert.equal(Object.keys(p.shortHits).length, 20);
  assert.equal('extra' in p.shortHits, false);
  assert.equal('k0' in p.shortHits, true);

  const tied = {};
  for (let i = 0; i < 21; i++) tied['v' + i] = 2;
  trimShortHits(base({ shortHits: tied }));
  assert.equal(Object.keys(tied).length, 20);
  assert.equal('v0' in tied, false);
  assert.equal('v20' in tied, true);
});

test('targetStage: stage boundaries', () => {
  const cases = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 2],
    [5, 2],
    [6, 3],
    [10, 4],
    [16, 5],
    [24, 6],
    [36, 7],
    [49, 7],
    [50, 8],
    [69, 8],
    [70, 9]
  ];
  for (const [n, stage] of cases) {
    assert.equal(targetStage(base({ sampleCount: n })), stage, 'n=' + n);
  }
});

test('cooldownFor: stage table and S9+ daily cap', () => {
  assert.equal(cooldownFor(0), 86400000);
  assert.equal(cooldownFor(2), 600000);
  assert.equal(cooldownFor(4), 3600000);
  assert.equal(cooldownFor(8), 86400000);
  assert.equal(cooldownFor(9), 86400000);
  assert.equal(cooldownFor(20), 86400000);
});

test('shouldAssess: force, gates, target, stable refresh', () => {
  const now = 1000000000000;

  assert.equal(shouldAssess(base(), false, now), false);
  assert.equal(shouldAssess(base(), true, now), false);
  assert.equal(shouldAssess(base({ samples: [{ id: '1' }], cooldownUntil: now + 1 }), true, now), true);

  const failing = base({
    samples: [{ id: '1' }, { id: '2' }, { id: '3' }],
    sampleCount: 3,
    failCount: 2
  });
  assert.equal(shouldAssess(failing, false, now), false);

  const cooling = base({
    samples: [{ id: '1' }, { id: '2' }, { id: '3' }],
    sampleCount: 3,
    cooldownUntil: now + 1
  });
  assert.equal(shouldAssess(cooling, false, now), false);

  const targetAhead = base({
    samples: [{ id: '1' }, { id: '2' }, { id: '3' }],
    sampleCount: 3,
    stage: 1
  });
  assert.equal(shouldAssess(targetAhead, false, now), true);

  const caughtUp = base({
    samples: [{ id: '1' }],
    sampleCount: 6,
    stage: 3
  });
  assert.equal(shouldAssess(caughtUp, false, now), false);

  const stableEnough = base({
    samples: [{ id: '1' }],
    sampleCount: 20,
    stage: 6,
    stable: true,
    assessment: { sampleCount: 10, ts: now }
  });
  assert.equal(shouldAssess(stableEnough, false, now), true);

  const stableNotEnough = base({
    samples: [{ id: '1' }],
    sampleCount: 19,
    stage: 6,
    stable: true,
    assessment: { sampleCount: 10, ts: now - 86400000 }
  });
  assert.equal(shouldAssess(stableNotEnough, false, now), false);

  const stableElapsed = base({
    samples: [{ id: '1' }],
    sampleCount: 19,
    stage: 6,
    stable: true,
    assessment: { sampleCount: 10, ts: now - 7 * 86400000 }
  });
  assert.equal(shouldAssess(stableElapsed, false, now), true);
});

test('ingestSample: cardTitle is the sample when text is empty or short', () => {
  const emptyText = base();
  const r1 = ingestSample(emptyText, {
    statusId: '1', text: '', cardTitle: 'Big News', links: [], promoted: false
  });
  assert.equal(r1.added, true);
  assert.equal(r1.kind, 'keep');
  assert.equal(emptyText.samples[0].text, 'Big News');
  assert.equal(emptyText.charCount, 'Big News'.length);

  const shortText = base();
  const r2 = ingestSample(shortText, {
    statusId: '2', text: 'gm', cardTitle: 'Long enough card title', links: [], promoted: false
  });
  assert.equal(r2.kind, 'keep');
  assert.equal(shortText.samples[0].text, 'Long enough card title');
});
