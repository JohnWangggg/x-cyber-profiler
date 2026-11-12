import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJevPayload, normalizeAssessment } from '../src/assess.js';
import { composeLabel, buildNameMessages, normalizeLabel } from '../src/name.js';
import { createLLM, parseModelJson } from '../src/llm.js';
import { effectiveMode } from '../src/providers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env.local');
const env = {};
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}
Object.assign(env, process.env);
const base = (env.JEV_URL || 'https://api.typesafe.ai/v1').replace(/\/$/, '');
const url = /\/systemone$/.test(base) ? base : base + '/systemone';
const key = env.JEV_KEY || env.TYPESAFE_API_KEY || '';
if (!key) { console.error('missing JEV_KEY'); process.exit(2); }

const profile = {
  handle: 'xcp_probe',
  lang: 'en',
  samples: [
    { text: 'GM. Check my pinned tweet for 100x gems and join t.me/example', promoted: false, links: ['https://t.me/example'], spamToken: null },
    { text: 'Great insight! Totally agree with your point.', promoted: false, links: [], spamToken: null }
  ]
};

const payload = buildJevPayload(profile, { jevModel: env.JEV_MODEL || 'jev-latest' });
const settings = {
  jevKey: key,
  jevUrl: base,
  jevModel: env.JEV_MODEL || 'jev-latest',
  namerProvider: env.NAMER_PROVIDER || 'openai',
  namerUrl: env.NAMER_URL || 'https://api.deepseek.com/v1/chat/completions',
  namerKey: env.NAMER_KEY || '',
  namerModel: env.NAMER_MODEL || 'deepseek-chat',
  labelLang: env.LABEL_LANG || 'en',
  tone: env.LABEL_TONE || 'sharp',
  jsonMode: true
};
console.log('[app-probe] questions:', Object.keys(payload.questions).length);
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(30000)
});
const text = await res.text();
console.log('[app-probe] status:', res.status);
if (res.status !== 200) {
  console.log(text.slice(0, 2000));
  process.exit(1);
}
const body = JSON.parse(text);
console.log('[app-probe] model:', body.model);
console.log('[app-probe] answer keys:', Object.keys(body.answers || {}).join(', '));
const assessment = normalizeAssessment(body, { model: body.model, sampleCount: profile.samples.length, ts: Date.now() });
console.log('[app-probe] assessment:', JSON.stringify(assessment, null, 2));
const lang = settings.labelLang;
const tone = settings.tone;
if (effectiveMode(settings) === 'jev-only' || settings.namerProvider === 'none') {
  const fallback = composeLabel(assessment, { lang, tone, salt: 'xcp_probe', stage: 1 });
  console.log('[app-probe] no NAMER_KEY; fallback label:', JSON.stringify(fallback, null, 2));
} else {
  const llm = createLLM({
    transport: (opts) => fetch(opts.url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: AbortSignal.timeout(opts.timeout || 25000)
    }).then(async (r) => ({ status: r.status, responseText: await r.text(), headers: r.headers })),
    getSettings: () => settings
  });
  const named = await llm.chat(buildNameMessages(profile, assessment, { lang, tone }), {
    jsonMode: true, maxTokens: 1500, temperature: 0.7
  });
  const label = normalizeLabel(parseModelJson(named.text), { lang, tone, assessment });
  console.log('[app-probe] namer label:', JSON.stringify(label, null, 2));
}
