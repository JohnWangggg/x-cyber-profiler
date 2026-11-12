import { performance } from 'node:perf_hooks';
import { createStorage } from '../src/storage.js';
import { createGM } from '../test/gm-stub.js';
import { XCP, profileKey } from '../src/constants.js';

const N = Number(process.argv[2] || 300);
const sampleText = '这是一条用于基准测试的推文样本，包含一些具体信息、链接和足够长度，用来模拟真实时间线中的中文文本。'.repeat(3).slice(0, 240);
const now = Date.now();

function makeProfile(i) {
  const samples = Array.from({ length: 10 }, (_, j) => ({
    id: String(1000000000000000000n + BigInt(i * 100 + j)),
    text: sampleText,
    links: j % 2 ? ['https://t.me/example'] : [],
    promoted: j === 3,
    cardHost: j === 3 ? 't.me' : '',
    ...(j === 4 ? { spamToken: 'gm' } : {}),
    ts: now - j * 1000
  }));
  return {
    v: 3,
    handle: 'bench_' + i,
    displayName: 'Bench User ' + i,
    verified: i % 3 === 0,
    lang: 'zh',
    sampleCount: 10,
    charCount: 10 * 240,
    spamCount: 1,
    samples,
    seenIds: samples.map((s) => s.id),
    shortHits: { gm: 3, hh: 2 },
    assessment: {
      archetype: { bot: 0.1, ad: 0.6, toxic: 0.05, organic: 0.2, unknown: 0.05 },
      traits: { promotional: 0.7, repetitive: 0.4, hostile: 0.1, informative: 0.3, personal: 0.2, ironic: 0.1, expert: 0.2, spammy: 0.5 },
      valence: 0.4, energy: 0.6, confidence: 0.8,
      evidence: ['external_link', 'template_phrase'],
      model: 'jev-1.14.0', sampleCount: 10, ts: now
    },
    label: { text: '测试标签', vibe: 'ember', archetype: 'ad', confidence: 0.8, reason: '外链与重复话术', lang: 'zh', tone: 'sharp', stage: 6, updatedAt: now },
    dossier: '以推广话术活动，频繁引导站外链接。',
    history: Array.from({ length: 5 }, (_, j) => ({ text: '旧标签' + j, stage: 5 - j, ts: now - j * 86400000 })),
    stage: 6,
    cooldownUntil: now + 3600000,
    stable: false,
    failCount: 0,
    createdAt: now - 86400000,
    updatedAt: now
  };
}

const gm = createGM();
const storage = createStorage(gm, { now: () => now, setTimeout: () => ({ unref() {} }), clearTimeout() {} });
storage.init();
const t0 = performance.now();
for (let i = 0; i < N; i++) storage.commit(makeProfile(i));
const tCommit = performance.now() - t0;
const t1 = performance.now();
storage.flush();
const tFlush = performance.now() - t1;
const dump = gm._dump();
let bytes = 0;
for (const [k, v] of Object.entries(dump)) bytes += Buffer.byteLength(JSON.stringify(v));
const per = bytes / N;
const p0 = performance.now();
for (let i = 0; i < N; i++) storage.peek('bench_' + i);
const tPeek = performance.now() - p0;
const t2 = performance.now();
const p = storage.peek('bench_0') || storage.peek('bench_' + (N - 1));
if (p) p.updatedAt = now + 1;
if (p) { storage.commit(p); storage.flush(); }
const tOneFlush = performance.now() - t2;
console.log(JSON.stringify({
  profiles: N,
  commitMs: Math.round(tCommit),
  flushAllMs: Math.round(tFlush),
  peekAllMs: Math.round(tPeek),
  oneFlushMs: Math.round(tOneFlush),
  totalKB: Math.round(bytes / 1024),
  perProfileKB: +(per / 1024).toFixed(2),
  perProfileBytes: Math.round(per),
  indexBytes: Buffer.byteLength(JSON.stringify(dump[XCP.KEY_INDEX])),
  kept: storage.listProfiles().length,
  stats: storage.getStats()
}, null, 2));
