import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, h, StubMutationObserver } from './dom-stub.js';
import {
  injectStyles,
  renderBadges,
  renderAllForHandle,
  removeBadges,
  removeAllBadges,
  showCard,
  hideCard,
  setLightMode,
  initInteractions,
  bindRepair
} from '../src/render.js';

function makeArticle(doc, handle = 'crypto_bot_99', opts = {}) {
  const children = [];
  if (opts.userName !== false) {
    const name = opts.name === undefined ? 'Web3 Alpha Hunter' : opts.name;
    const nameLink = h('a', { href: '/' + handle }, [name]);
    const atLink = h('a', { href: '/' + handle }, ['@' + handle]);
    children.push(h('div', { 'data-testid': 'User-Name' }, [nameLink, atLink]));
  }
  children.push(h('div', { 'data-testid': 'tweetText' }, ['hello world']));
  const article = h('article', { 'data-testid': 'tweet' }, children);
  if (opts.connect !== false) doc.body.appendChild(article);
  return article;
}

function makeProfile(handle = 'crypto_bot_99', overrides = {}) {
  const base = {
    v: 3,
    handle,
    displayName: 'Web3 Alpha Hunter',
    verified: true,
    stage: 3,
    updatedAt: 2000,
    assessment: {
      archetype: { bot: 0.08, ad: 0.82, toxic: 0.03, organic: 0.02, unknown: 0.05 },
      traits: {
        promotional: 0.9,
        repetitive: 0.6,
        hostile: 0.05,
        informative: 0.1,
        personal: 0.2,
        ironic: 0.3,
        expert: 0.1,
        spammy: 0.4
      },
      confidence: 0.86
    },
    label: {
      text: '空投布道师',
      vibe: 'ember',
      archetype: 'ad',
      confidence: 0.86,
      reason: '三条推文都在承诺空投收益并引导私信。',
      lang: 'zh',
      tone: 'sharp',
      stage: 3,
      updatedAt: 1900
    },
    dossier: '以 Web3 导师人设活动，话术熟练，频繁引导站外。',
    history: [
      { text: '空投布道师', stage: 3, ts: 3000 },
      { text: '空投猎人', stage: 2, ts: 2000 },
      { text: 'Web3 博主', stage: 1, ts: 1000 },
      { text: '旧标签', stage: 0, ts: 500 }
    ],
    hidden: false
  };
  return Object.assign(base, overrides);
}

test('anchors to the User-Name row and never inside an anchor', () => {
  const doc = createDocument();
  const article = makeArticle(doc);
  const badge = renderBadges(article, makeProfile(), { doc });
  assert.ok(badge);
  const un = article.querySelector('[data-testid="User-Name"]');
  const tags = article.querySelector('.xcp-tags');
  assert.ok(tags);
  assert.equal(tags.parentElement, un);
  assert.equal(un.querySelector('a .xcp-badge'), null);
  assert.equal(un.querySelector('.xcp-badge'), badge);
  assert.equal(tags.getAttribute('data-xcp-handle'), 'crypto_bot_99');
});

test('returns null without a User-Name row', () => {
  const doc = createDocument();
  const article = makeArticle(doc, 'crypto_bot_99', { userName: false });
  assert.equal(renderBadges(article, makeProfile(), { doc }), null);
  assert.equal(article.querySelector('.xcp-tags'), null);
});

test('falls back to User-Name when no matching name link exists', () => {
  const doc = createDocument();
  const article = makeArticle(doc, 'crypto_bot_99', { name: '@someone_else' });
  const badge = renderBadges(article, makeProfile(), { doc });
  const un = article.querySelector('[data-testid="User-Name"]');
  assert.ok(badge);
  assert.equal(article.querySelector('.xcp-tags').parentElement, un);
});

test('hidden profiles render nothing and remove an existing container', () => {
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile();
  assert.ok(renderBadges(article, profile, { doc }));
  assert.ok(article.querySelector('.xcp-tags'));
  assert.equal(renderBadges(article, Object.assign({}, profile, { hidden: true }), { doc }), null);
  assert.equal(article.querySelector('.xcp-tags'), null);
});

test('renders a ghost while scanning without a label', () => {
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile('crypto_bot_99', { label: undefined });
  const badge = renderBadges(article, profile, { doc, scanning: true });
  assert.ok(badge);
  assert.ok(badge.classList.contains('xcp-ghost'));
  assert.equal(badge.querySelector('.xcp-text').textContent, '正在生成第一印象…');
  assert.equal(badge.querySelector('.xcp-pips'), null);
  assert.equal(article.querySelector('.xcp-tags').getAttribute('data-xcp-scan'), '1');
});

test('keeps the label and adds busy state while scanning', () => {
  const doc = createDocument();
  const article = makeArticle(doc);
  const badge = renderBadges(article, makeProfile(), { doc, scanning: true });
  assert.ok(badge.classList.contains('xcp-busy'));
  assert.equal(badge.querySelector('.xcp-text').textContent, '空投布道师');
});

test('renders label, sigil, pips, vibe and aria metadata', () => {
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile();
  const badge = renderBadges(article, profile, { doc });
  assert.equal(badge.querySelector('.xcp-text').textContent, '空投布道师');
  assert.equal(badge.querySelectorAll('.xcp-sigil').length, 1);
  assert.ok(badge.classList.contains('xcp-vibe-ember'));
  assert.equal(badge.getAttribute('data-stage'), '3');
  assert.equal(badge.getAttribute('tabindex'), '0');
  assert.equal(badge.getAttribute('role'), 'button');
  assert.match(badge.getAttribute('aria-label'), /^标签：空投布道师/);
  assert.match(badge.getAttribute('aria-label'), /第 3 阶段/);
  assert.match(badge.getAttribute('title'), /空投布道师 · ember · 86%/);
  assert.match(badge.getAttribute('title'), /三条推文都在承诺空投收益并引导私信。/);

  const pips = badge.querySelectorAll('.xcp-pips i');
  assert.equal(pips.length, 3);
  assert.equal(badge.querySelectorAll('.xcp-pips i.on').length, Math.min(3, Math.ceil(3 / 3)));
});

test('uses hash-stable sigils per handle', () => {
  const doc = createDocument();
  const one = makeArticle(doc);
  const two = makeArticle(doc);
  const a = renderBadges(one, makeProfile(), { doc });
  const b = renderBadges(two, makeProfile(), { doc });
  assert.equal(a.querySelector('.xcp-sigil').textContent, b.querySelector('.xcp-sigil').textContent);
});

test('reuses the same container and badge across renders', () => {
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile();
  const firstBadge = renderBadges(article, profile, { doc });
  const tags = article.querySelector('.xcp-tags');
  const skipped = renderBadges(article, profile, { doc });
  assert.equal(skipped, firstBadge);
  assert.equal(article.querySelectorAll('.xcp-tags').length, 1);

  const next = makeProfile('crypto_bot_99', {
    updatedAt: 2100,
    label: Object.assign({}, profile.label, { text: '空投教父', updatedAt: 2000 })
  });
  const nextBadge = renderBadges(article, next, { doc });
  assert.equal(article.querySelector('.xcp-tags'), tags);
  assert.equal(article.querySelectorAll('.xcp-tags').length, 1);
  assert.equal(nextBadge.querySelector('.xcp-text').textContent, '空投教父');
});

test('removes containers by handle and all at once', () => {
  const doc = createDocument();
  const a = makeArticle(doc, 'alice');
  const b = makeArticle(doc, 'bob');
  renderBadges(a, makeProfile('alice'), { doc });
  renderBadges(b, makeProfile('bob'), { doc });
  assert.equal(removeBadges('alice', doc), 1);
  assert.equal(a.querySelector('.xcp-tags'), null);
  assert.ok(b.querySelector('.xcp-tags'));
  assert.equal(removeAllBadges(doc), 1);
  assert.equal(doc.querySelectorAll('.xcp-tags').length, 0);
});

test('renders every matching article for a handle', () => {
  const doc = createDocument();
  const a = makeArticle(doc, 'alice');
  const b = makeArticle(doc, 'alice');
  makeArticle(doc, 'bob');
  const count = renderAllForHandle('alice', makeProfile('alice'), { doc, root: doc.body });
  assert.equal(count, 2);
  assert.ok(a.querySelector('.xcp-tags'));
  assert.ok(b.querySelector('.xcp-tags'));
});

test('injects a single style element', () => {
  const doc = createDocument();
  const first = injectStyles(doc);
  const second = injectStyles(doc);
  assert.ok(first);
  assert.equal(first, second);
  assert.equal(doc.querySelectorAll('#xcp-style').length, 1);
  assert.match(first.textContent, /\.xcp-badge/);
  assert.match(first.textContent, /\.xcp-vibe-ember/);
  assert.match(first.textContent, /#xcp-card/);
  assert.match(first.textContent, /prefers-reduced-motion/);
});

test('toggles light mode on the document root', () => {
  const doc = createDocument();
  assert.equal(setLightMode(true, doc), true);
  assert.ok(doc.documentElement.classList.contains('xcp-light'));
  assert.equal(doc.documentElement.getAttribute('data-xcp-light'), '1');
  assert.equal(setLightMode(false, doc), false);
  assert.ok(!doc.documentElement.classList.contains('xcp-light'));
  assert.equal(doc.documentElement.getAttribute('data-xcp-light'), null);
});

test('shows a singleton card with text-only content and actions', () => {
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile();
  const badge = renderBadges(article, profile, { doc });

  const card = showCard(badge, profile, { doc });
  assert.ok(card);
  assert.equal(card.id, 'xcp-card');
  assert.equal(card.parentElement, doc.body);
  assert.ok(card.classList.contains('xcp-open'));
  assert.equal(doc.querySelectorAll('#xcp-card').length, 1);

  assert.equal(card.querySelector('.card-label').textContent, '空投布道师');
  assert.match(card.querySelector('.vibe-chip').textContent, /ember/);
  assert.equal(card.querySelector('.reason').textContent, profile.label.reason);
  assert.equal(card.querySelector('.note p').textContent, profile.dossier);
  assert.equal(card.querySelectorAll('.hist-row').length, 3);
  assert.equal(card.querySelectorAll('.bar').length, 4);
  assert.equal(card.querySelector('.bar span').textContent, 'ad');
  assert.ok(card.querySelector('[data-xcp-action="reassess"]'));
  assert.ok(card.querySelector('[data-xcp-action="hide"]'));

  const same = showCard(badge, profile, { doc });
  assert.equal(same, card);
  assert.equal(doc.querySelectorAll('#xcp-card').length, 1);

  hideCard(doc);
  assert.ok(!card.classList.contains('xcp-open'));
  assert.equal(card.getAttribute('aria-hidden'), 'true');
});

test('card content does not parse HTML from model or user text', () => {
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile();
  profile.label.text = '<img src=x onerror=alert(1)>';
  profile.label.reason = '<b>reason</b>';
  profile.dossier = '<script>bad()</script>';
  const badge = renderBadges(article, profile, { doc });
  const card = showCard(badge, profile, { doc });
  assert.equal(card.querySelector('.card-label').textContent, profile.label.text);
  assert.equal(card.querySelector('.reason').textContent, profile.label.reason);
  assert.equal(card.querySelector('.note p').textContent, profile.dossier);
  assert.equal(card.querySelector('img'), null);
  assert.equal(card.querySelector('script'), null);
  assert.ok(card.textContent.includes('<b>reason</b>'));
});

test('double-click reassesses once per 800ms guard window', () => {
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile();
  const badge = renderBadges(article, profile, { doc });
  const calls = [];
  const disconnect = initInteractions({
    root: doc.body,
    doc,
    getProfile: () => profile,
    onReassess: (handle, options) => calls.push([handle, options])
  });

  badge.dispatchEvent({ type: 'dblclick' });
  badge.dispatchEvent({ type: 'dblclick' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['crypto_bot_99', { force: true }]);
  disconnect();
  badge.dispatchEvent({ type: 'dblclick' });
  assert.equal(calls.length, 1);
});

test('card actions hide the profile and remove its badges', () => {
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile();
  const badge = renderBadges(article, profile, { doc });
  const hidden = [];
  const disconnect = initInteractions({
    root: doc.body,
    doc,
    getProfile: () => profile,
    onReassess: () => {},
    onHide: (handle, value) => hidden.push([handle, value])
  });

  const card = showCard(badge, profile, { doc });
  const hideButton = card.querySelector('[data-xcp-action="hide"]');
  hideButton.dispatchEvent({ type: 'click' });
  assert.equal(profile.hidden, true);
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0][0], 'crypto_bot_99');
  assert.equal(article.querySelector('.xcp-tags'), null);
  assert.ok(!card.classList.contains('xcp-open'));
  disconnect();
});

test('Escape closes the open card', () => {
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile();
  const badge = renderBadges(article, profile, { doc });
  const disconnect = initInteractions({
    root: doc.body,
    doc,
    getProfile: () => profile,
    onReassess: () => {}
  });
  const card = showCard(badge, profile, { doc });
  assert.ok(card.classList.contains('xcp-open'));
  doc.body.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.ok(!card.classList.contains('xcp-open'));
  disconnect();
});

test('repair observer rerenders only when the container is missing', () => {
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile();
  renderBadges(article, profile, { doc });
  let calls = 0;
  const disconnect = bindRepair(
    article,
    () => {
      calls += 1;
      renderBadges(article, profile, { doc });
    },
    { MutationObserver: StubMutationObserver, raf: (fn) => fn() }
  );
  const observer = [...article._observers][0];
  assert.ok(observer);

  observer.trigger([]);
  assert.equal(calls, 0);

  article.querySelector('.xcp-tags').remove();
  observer.trigger([]);
  assert.equal(calls, 1);
  assert.ok(article.querySelector('.xcp-tags'));

  disconnect();
  article.remove();
  observer.trigger([]);
  assert.equal(calls, 1);
});

test('quote-first DOM anchors the badge to the outer author', () => {
  const doc = createDocument();
  const quoteName = h('div', { 'data-testid': 'User-Name' }, [
    h('a', { href: '/bob' }, ['Bob']),
    h('a', { href: '/bob' }, ['@bob'])
  ]);
  const quote = h('div', { 'data-testid': 'quoteTweet' }, [quoteName]);
  const outerName = h('div', { 'data-testid': 'User-Name' }, [
    h('a', { href: '/alice' }, ['Alice']),
    h('a', { href: '/alice' }, ['@alice'])
  ]);
  const article = h('article', { 'data-testid': 'tweet' }, [
    quote,
    outerName,
    h('div', { 'data-testid': 'tweetText' }, ['outer text'])
  ]);
  doc.body.appendChild(article);

  const badge = renderBadges(article, makeProfile('alice'), { doc });
  assert.ok(badge);
  const tags = article.querySelector('.xcp-tags');
  assert.ok(tags);
  assert.equal(quote.contains(tags), false);
  assert.match(tags.parentElement.textContent, /Alice/);
});

test('touch long-press opens the card after 500ms without reassessing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile();
  const badge = renderBadges(article, profile, { doc });
  const calls = [];
  const disconnect = initInteractions({
    root: doc.body,
    doc,
    getProfile: () => profile,
    onReassess: (handle, options) => calls.push([handle, options])
  });

  badge.dispatchEvent({
    type: 'pointerdown',
    pointerType: 'touch',
    pointerId: 5,
    clientX: 40,
    clientY: 30
  });
  t.mock.timers.tick(499);
  assert.equal(doc.querySelector('#xcp-card'), null);

  t.mock.timers.tick(1);
  const card = doc.querySelector('#xcp-card');
  assert.ok(card);
  assert.ok(card.classList.contains('xcp-open'));
  assert.equal(badge.getAttribute('aria-expanded'), 'true');
  assert.equal(calls.length, 0);

  badge.dispatchEvent({
    type: 'pointerup',
    pointerType: 'touch',
    pointerId: 5,
    clientX: 40,
    clientY: 30
  });
  badge.dispatchEvent({ type: 'click', pointerType: 'touch' });
  badge.dispatchEvent({ type: 'dblclick' });
  assert.equal(calls.length, 0);
  assert.ok(card.classList.contains('xcp-open'));

  doc.body.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(badge.getAttribute('aria-expanded'), 'false');
  disconnect();
});

test('touch long-press is cancelled by pointerup or pointercancel', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile();
  const badge = renderBadges(article, profile, { doc });
  const disconnect = initInteractions({
    root: doc.body,
    doc,
    getProfile: () => profile,
    onReassess: () => {}
  });

  badge.dispatchEvent({
    type: 'pointerdown',
    pointerType: 'touch',
    pointerId: 1,
    clientX: 20,
    clientY: 20
  });
  t.mock.timers.tick(300);
  badge.dispatchEvent({ type: 'pointerup', pointerType: 'touch', pointerId: 1 });
  t.mock.timers.tick(400);
  assert.equal(doc.querySelector('#xcp-card'), null);
  assert.equal(badge.getAttribute('aria-expanded'), null);

  badge.dispatchEvent({
    type: 'pointerdown',
    pointerType: 'touch',
    pointerId: 2,
    clientX: 20,
    clientY: 20
  });
  t.mock.timers.tick(300);
  badge.dispatchEvent({ type: 'pointercancel', pointerType: 'touch', pointerId: 2 });
  t.mock.timers.tick(400);
  assert.equal(doc.querySelector('#xcp-card'), null);
  assert.equal(badge.getAttribute('aria-expanded'), null);
  disconnect();
});

test('touch long-press is cancelled by pointermove beyond 8px', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDocument();
  const article = makeArticle(doc);
  const profile = makeProfile();
  const badge = renderBadges(article, profile, { doc });
  const disconnect = initInteractions({
    root: doc.body,
    doc,
    getProfile: () => profile,
    onReassess: () => {}
  });

  badge.dispatchEvent({
    type: 'pointerdown',
    pointerType: 'touch',
    pointerId: 3,
    clientX: 100,
    clientY: 100
  });
  t.mock.timers.tick(200);
  badge.parentElement.dispatchEvent({
    type: 'pointermove',
    pointerType: 'touch',
    pointerId: 3,
    clientX: 108,
    clientY: 106
  });
  t.mock.timers.tick(400);
  assert.equal(doc.querySelector('#xcp-card'), null);

  badge.dispatchEvent({
    type: 'pointerdown',
    pointerType: 'touch',
    pointerId: 4,
    clientX: 100,
    clientY: 100
  });
  t.mock.timers.tick(200);
  badge.parentElement.dispatchEvent({
    type: 'pointermove',
    pointerType: 'touch',
    pointerId: 4,
    clientX: 104,
    clientY: 103
  });
  t.mock.timers.tick(300);
  assert.ok(doc.querySelector('#xcp-card'));
  disconnect();
});

test('scroll cancels a pending touch long-press', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDocument();
  const scrolls = [];
  doc.defaultView = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener(type, fn) {
      if (type === 'scroll') scrolls.push(fn);
    },
    removeEventListener(type, fn) {
      const index = scrolls.indexOf(fn);
      if (index >= 0) scrolls.splice(index, 1);
    }
  };
  const article = makeArticle(doc);
  const profile = makeProfile();
  const badge = renderBadges(article, profile, { doc });
  const disconnect = initInteractions({
    root: doc.body,
    doc,
    getProfile: () => profile,
    onReassess: () => {}
  });
  assert.equal(scrolls.length, 1);

  badge.dispatchEvent({
    type: 'pointerdown',
    pointerType: 'touch',
    pointerId: 6,
    clientX: 10,
    clientY: 10
  });
  t.mock.timers.tick(200);
  scrolls.slice().forEach((fn) => fn({ type: 'scroll' }));
  t.mock.timers.tick(400);
  assert.equal(doc.querySelector('#xcp-card'), null);
  assert.equal(badge.getAttribute('aria-expanded'), null);
  disconnect();
  assert.equal(scrolls.length, 0);
});

test('long-press falls back to touch capability when pointerType is absent', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDocument();
  doc.defaultView = {
    innerWidth: 1200,
    innerHeight: 800,
    ontouchstart: null,
    addEventListener() {},
    removeEventListener() {}
  };
  const article = makeArticle(doc);
  const profile = makeProfile();
  const badge = renderBadges(article, profile, { doc });
  const disconnect = initInteractions({
    root: doc.body,
    doc,
    getProfile: () => profile,
    onReassess: () => {}
  });

  badge.dispatchEvent({
    type: 'pointerdown',
    pointerId: 7,
    clientX: 30,
    clientY: 30
  });
  t.mock.timers.tick(500);
  const card = doc.querySelector('#xcp-card');
  assert.ok(card);
  assert.equal(badge.getAttribute('aria-expanded'), 'true');
  disconnect();
});
