import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDocument, installGlobals, h, StubIntersectionObserver } from '../test/dom-stub.js';

const doc = createDocument();
installGlobals(doc);

const article = h('article', { 'data-testid': 'tweet' }, [
  h('div', { 'data-testid': 'User-Name' }, [
    h('a', { href: '/alice' }, 'Alice'),
    h('a', { href: '/alice' }, '@alice')
  ]),
  h('div', { 'data-testid': 'tweetText' }, 'Check my pinned tweet and join t.me/xxx'),
  h('a', { href: 'https://t.me/xxx' }, 't.me/xxx'),
  h('a', { href: '/alice/status/123' }, '2h')
]);
doc.body.appendChild(h('main', { role: 'main' }, [article]));

const map = new Map();
map.set('xcp:settings', {
  enabled: true, evalProvider: 'jev',
  jevUrl: 'https://api.typesafe.ai/v1', jevKey: 'k', jevModel: 'jev-latest',
  namerProvider: 'openai', namerUrl: 'https://api.deepseek.com/v1/chat/completions', namerKey: 'n', namerModel: 'm',
  labelLang: 'zh', tone: 'sharp', autoLabelAll: true, dailyBudget: 20, dwellMs: 300, jsonMode: true
});
globalThis.GM_getValue = (k, d) => map.has(k) ? structuredClone(map.get(k)) : d;
globalThis.GM_setValue = (k, v) => map.set(k, structuredClone(v));
globalThis.GM_deleteValue = (k) => map.delete(k);
globalThis.GM_addValueChangeListener = () => 1;
globalThis.GM_removeValueChangeListener = () => {};
globalThis.GM_registerMenuCommand = () => 'menu';
globalThis.GM_addStyle = () => null;

let requests = 0;
globalThis.GM_xmlhttpRequest = (opts) => {
  requests += 1;
  let body;
  if (String(opts.url).includes('typesafe')) {
    body = {
      model: 'jev-latest',
      answers: {
        archetype: {
          type: 'choice', choice: 'ad', confidence: 0.9,
          probabilities: { bot: 0.03, ad: 0.9, toxic: 0.01, organic: 0.03, unknown: 0.03 }
        },
        ev_external_link: { type: 'noul', noul: 0.92 }
      }
    };
  } else {
    body = {
      choices: [{
        message: {
          content: JSON.stringify({
            label: '空投布道师', vibe: 'ember', archetype: 'ad', confidence: 0.9,
            reason: '外链引导', dossier: '空投话术', lang: 'zh'
          })
        },
        finish_reason: 'stop'
      }]
    };
  }
  setTimeout(() => opts.onload({ status: 200, responseText: JSON.stringify(body), responseHeaders: '' }), 5);
};

const dist = fileURLToPath(new URL('../dist/x-cyber-profiler.user.js', import.meta.url));
new Function(fs.readFileSync(dist, 'utf8'))();
await new Promise((resolve) => setTimeout(resolve, 50));
const io = StubIntersectionObserver.last();
if (!io) throw new Error('no IntersectionObserver');
io.trigger([StubIntersectionObserver.entry(article, true, 1)]);
await new Promise((resolve) => setTimeout(resolve, 900));

const badge = doc.querySelector('.xcp-badge');
if (!badge || !badge.textContent.includes('空投布道师')) {
  console.error('[smoke] badge missing:', badge && badge.textContent);
  process.exit(1);
}
if (requests !== 2) {
  console.error('[smoke] expected 2 requests, got', requests);
  process.exit(1);
}
console.log('[smoke] assembled userscript ok: badge =', badge.textContent.trim(), 'requests =', requests);
process.exit(0);
