import { performance } from 'node:perf_hooks';
import { buildJevPayload, normalizeAssessment } from '../src/assess.js';
import { buildNameMessages, normalizeLabel } from '../src/name.js';
import { parseModelJson } from '../src/llm.js';

const BASE = process.env.MAGPIE_BASE || 'http://127.0.0.1:3425';
const JEV = BASE + '/v1/systemone';
const CHAT = BASE + '/v1/chat/completions';

const profile = {
  handle: 'xcp_bench',
  lang: 'en',
  samples: [
    { text: 'GM. Check my pinned tweet for 100x gems and join t.me/example', promoted: false, links: ['https://t.me/example'], spamToken: null },
    { text: 'Great insight! Totally agree with your point.', promoted: false, links: [], spamToken: null }
  ]
};

async function post(url, body) {
  const t0 = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  if (!res.ok) throw new Error(url + ' HTTP ' + res.status + ': ' + text.slice(0, 300));
  return { body: JSON.parse(text), ms, bytes: text.length };
}

const jevPayload = buildJevPayload(profile, { jevModel: 'jev-latest' });
const jev = await post(JEV, jevPayload);
const assessment = normalizeAssessment(jev.body, { model: jev.body.model, sampleCount: 2, ts: Date.now() });
console.log(`jev ${jev.ms.toFixed(0)}ms input=${jev.body.usage?.input_tokens || '?'} output=${jev.body.usage?.output_tokens || '?'} model=${jev.body.model}`);

const models = [
  'auto/deepseek-v4.1-flash',
  'auto/glm-5.3-flash',
  'auto/qwen3.8-max',
  'auto/kimi-k3',
  'auto/gpt-6-luna'
];
for (const model of models) {
  const messages = buildNameMessages(profile, assessment, { lang: 'en', tone: 'sharp' });
  const body = { model, messages, temperature: 0.7, max_tokens: 1500, response_format: { type: 'json_object' } };
  try {
    const r = await post(CHAT, body);
    const text = r.body.choices?.[0]?.message?.content || '';
    let label = null;
    try { label = normalizeLabel(parseModelJson(text), { lang: 'en', tone: 'sharp', assessment }); } catch (e) { label = { error: e.code || e.message }; }
    console.log(`${model.padEnd(30)} ${r.ms.toFixed(0)}ms out=${r.body.usage?.completion_tokens ?? '?'} label=${label.text || label.error}`);
  } catch (e) {
    console.log(`${model.padEnd(30)} ERROR ${e.message}`);
  }
}
