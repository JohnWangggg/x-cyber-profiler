import test from 'node:test';
import assert from 'node:assert/strict';
import { h, t, createDocument, installGlobals, StubIntersectionObserver } from './dom-stub.js';

test('selector subset: tag, attr, class, descendant, comma, not', () => {
  const doc = createDocument();
  const article = h('article', { 'data-testid': 'tweet', class: 'card' });
  const row = h('div', { 'data-testid': 'User-Name' });
  const link = h('a', { href: '/alice', class: 'name' }, 'Alice');
  const handle = h('span', { class: 'handle' }, '@alice');
  row.append(link, handle);
  article.append(row);
  doc.body.append(article);

  assert.equal(article.matches('article[data-testid="tweet"]'), true);
  assert.equal(row.matches('[data-testid="User-Name"]'), true);
  assert.equal(link.matches('a.name'), true);
  assert.equal(article.querySelector('div a'), link);
  assert.equal(article.querySelector('article'), null);
  assert.equal(article.querySelectorAll('span, a').length, 2);
  assert.equal(link.matches('a:not(.missing)'), true);
  assert.equal(link.matches('a:not(.name)'), false);
});

test('textContent walks text nodes and setter replaces', () => {
  const el = h('div');
  el.append('a', h('span', {}, 'b'), 'c');
  assert.equal(el.textContent, 'abc');
  el.textContent = 'x';
  assert.equal(el.childNodes.length, 1);
  assert.equal(el.textContent, 'x');
});

test('remove disconnects descendants; closest/contains work', () => {
  const doc = createDocument();
  const outer = h('article', { 'data-testid': 'tweet' });
  const inner = h('span');
  outer.appendChild(inner);
  doc.body.appendChild(outer);
  assert.equal(inner.isConnected, true);
  assert.equal(inner.closest('article').getAttribute('data-testid'), 'tweet');
  assert.equal(outer.contains(inner), true);
  inner.remove();
  assert.equal(inner.isConnected, false);
  assert.equal(outer.contains(inner), false);
});

test('classList and dataset proxy', () => {
  const el = h('div');
  el.classList.add('a', 'b');
  assert.equal(el.classList.contains('a'), true);
  el.classList.remove('a');
  assert.equal(el.classList.contains('a'), false);
  el.dataset.xcpHandle = 'alice';
  assert.equal(el.getAttribute('data-xcp-handle'), 'alice');
  assert.equal(el.dataset.xcpHandle, 'alice');
});

test('installGlobals exposes document/window/observers', () => {
  const doc = createDocument();
  installGlobals(doc);
  assert.equal(globalThis.document, doc);
  assert.equal(globalThis.window.document, doc);
  const el = h('div');
  doc.body.appendChild(el);
  const io = new StubIntersectionObserver(() => {});
  io.observe(el);
  assert.equal(io.targets.has(el), true);
  const entry = StubIntersectionObserver.entry(el, true, 0.8);
  assert.equal(entry.isIntersecting, true);
  assert.ok(entry.intersectionRect.height > 0);
});

test('append/prepend/replaceChildren and input value', () => {
  const el = h('div');
  el.append('a', 'b');
  el.prepend('z');
  assert.equal(el.textContent, 'zab');
  el.replaceChildren('x', h('b', {}, 'y'));
  assert.equal(el.textContent, 'xy');
  const input = h('input', { value: 'k' });
  assert.equal(input.value, 'k');
});
