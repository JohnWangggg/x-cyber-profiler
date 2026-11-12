import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env.local');

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let value = t.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...readEnvFile(ENV_FILE), ...process.env };
const base = (env.JEV_URL || 'https://api.typesafe.ai/v1').replace(/\/$/, '');
const url = /\/systemone$/.test(base) ? base : base + '/systemone';
const model = env.JEV_MODEL || 'jev-latest';
const key = env.JEV_KEY || env.TYPESAFE_API_KEY || '';
const auth = (env.JEV_AUTH || 'bearer').toLowerCase();

const payload = {
  model,
  state: {
    handle: 'xcp_probe',
    samples: [
      { text: 'GM. Check my pinned tweet for 100x gems and join t.me/example', promoted: false, links: ['https://t.me/example'], spamToken: null },
      { text: 'Great insight! Totally agree with your point.', promoted: false, links: [], spamToken: null }
    ]
  },
  questions: {
    archetype: {
      type: 'choice',
      instructions: 'Which best describes this account?',
      criteria: {
        bot: 'Template replies, AI tone, repetitive praise, engagement farming',
        ad: 'Promotional links, referral, airdrop, sales, scam',
        toxic: 'Insults, hostility, rage bait',
        organic: 'Concrete experience, original analysis, real technical sharing',
        unknown: 'Not enough signal'
      }
    },
    promotional: { type: 'score', instructions: 'How promotional is the account?', criteria: ['Not promotional', 'Some promotion', 'Clearly promotional'] },
    repetitive: { type: 'score', instructions: 'How repetitive are the samples?', criteria: ['Varied', 'Some repetition', 'Highly repetitive'] },
    hostile: { type: 'score', instructions: 'How hostile is the account?', criteria: ['Friendly or neutral', 'Slightly hostile', 'Clearly hostile'] },
    informative: { type: 'score', instructions: 'How informative is the account?', criteria: ['No information', 'Some information', 'Highly informative'] },
    valence: { type: 'score', instructions: 'Overall sentiment', criteria: ['Negative', 'Neutral', 'Positive'] },
    energy: { type: 'score', instructions: 'Overall energy', criteria: ['Low', 'Medium', 'High'] },
    external_link: { type: 'noul', instructions: 'Do the samples contain an external link?' },
    profit_promise: { type: 'noul', instructions: 'Do the samples promise profit or returns?' },
    template_phrase: { type: 'noul', instructions: 'Do the samples reuse template-like phrases?' }
  }
};

if (process.argv.includes('--dry')) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}
if (!key) {
  console.error('Missing JEV_KEY. Copy .env.local.example to .env.local and fill JEV_KEY, or export JEV_KEY.');
  process.exit(2);
}

const headers = { 'Content-Type': 'application/json' };
if (auth === 'x-api-key') headers['x-api-key'] = key;
else if (auth === 'header') headers.Authorization = key;
else headers.Authorization = 'Bearer ' + key;

let res;
try {
  res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000)
  });
} catch (err) {
  console.error('[probe] network error:', err && err.message ? err.message : err);
  process.exit(1);
}

const text = await res.text();
console.log('[probe] url:', url);
console.log('[probe] status:', res.status);
console.log('[probe] content-type:', res.headers.get('content-type') || '(none)');
if (res.status === 401 || res.status === 403) {
  console.log('[probe] auth failed. Check JEV_KEY and JEV_AUTH (bearer | x-api-key | header).');
}
if (res.status === 451) {
  console.log('[probe] region blocked by TypeSafe. Use a network/proxy in a supported region, or point JEV_URL at your own relay.');
}
const clipped = text.length > 12000 ? text.slice(0, 12000) + '\n…[truncated]' : text;
let parsed = null;
try { parsed = JSON.parse(clipped); } catch (e) { /* text */ }
if (parsed) {
  console.log('[probe] response json:');
  console.log(JSON.stringify(parsed, null, 2));
  console.log('[probe] top-level keys:', Object.keys(parsed).join(', ') || '(none)');
  if (parsed.answers) console.log('[probe] answer keys:', Object.keys(parsed.answers).join(', '));
} else {
  console.log('[probe] response text:');
  console.log(clipped);
}
