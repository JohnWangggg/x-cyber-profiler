import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, installGlobals, h, StubIntersectionObserver } from './dom-stub.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('boot: viewport tweet goes through Jev + namer and renders a badge', async () => {
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
  const main = h('main', { role: 'main' }, [article]);
  doc.body.appendChild(main);

  const map = new Map();
  map.set('xcp:settings', {
    enabled: true,
    evalProvider: 'jev',
    jevUrl: 'https://api.typesafe.ai/v1',
    jevKey: 'jev-key',
    jevModel: 'jev-latest',
    jevSchema: 'xcp.profile.v1',
    namerProvider: 'openai',
    namerUrl: 'https://api.deepseek.com/v1/chat/completions',
    namerKey: 'namer-key',
    namerModel: 'deepseek-chat',
    labelLang: 'zh',
    tone: 'sharp',
    temperature: 0.7,
    autoLabelAll: true,
    dailyBudget: 20,
    dwellMs: 300,
    jsonMode: true
  });

  const requests = [];
  globalThis.GM_getValue = (key, fallback) => (map.has(key) ? structuredClone(map.get(key)) : fallback);
  globalThis.GM_setValue = (key, value) => { map.set(key, structuredClone(value)); };
  globalThis.GM_deleteValue = (key) => { map.delete(key); };
  globalThis.GM_addValueChangeListener = () => 1;
  globalThis.GM_removeValueChangeListener = () => {};
  globalThis.GM_registerMenuCommand = () => 'menu';
  globalThis.GM_addStyle = () => null;
  globalThis.GM_xmlhttpRequest = (opts) => {
    requests.push({ url: opts.url, body: opts.data });
    let body;
    if (String(opts.url).includes('typesafe')) {
      body = {
        model: 'jev-latest',
        answers: {
          archetype: {
            type: 'choice', choice: 'ad', confidence: 0.9,
            probabilities: { bot: 0.03, ad: 0.9, toxic: 0.01, organic: 0.03, unknown: 0.03 }
          },
          ev_external_link: { type: 'noul', noul: 0.92 },
          ev_profit_promise: { type: 'noul', noul: 0.88 }
        }
      };
    } else {
      body = {
        choices: [{
          message: {
            content: JSON.stringify({
              label: '空投布道师',
              vibe: 'ember',
              archetype: 'ad',
              confidence: 0.9,
              reason: '多条外链引导私信。',
              dossier: '以空投话术引流，频繁引导站外。',
              lang: 'zh'
            })
          },
          finish_reason: 'stop'
        }]
      };
    }
    setTimeout(() => opts.onload({ status: 200, responseText: JSON.stringify(body), responseHeaders: '' }), 5);
  };

  const mod = await import('../src/boot.js');
  await mod.start();

  const io = StubIntersectionObserver.last();
  assert.ok(io, 'watcher should create an IntersectionObserver');
  assert.ok(io.targets.has(article), 'article should be observed');
  io.trigger([StubIntersectionObserver.entry(article, true, 1)]);

  await delay(800);

  const badge = doc.querySelector('.xcp-badge');
  assert.ok(badge, 'badge should render');
  assert.match(badge.textContent, /空投布道师/);
  assert.equal(requests.length, 2, 'one Jev request + one namer request');
  assert.ok(requests[0].url.includes('typesafe'));
  assert.ok(requests[1].url.includes('deepseek'));

  const profile = JSON.parse(JSON.stringify([...map.entries()].find(([k]) => k === 'xcp:p:alice')[1]));
  assert.equal(profile.label.text, '空投布道师');
  assert.equal(profile.assessment.archetype.ad > 0.8, true);
  assert.equal(profile.stage, 1);
  assert.equal(profile.history.length, 0);

  mod.stop();
});
