import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, h, t, installGlobals, StubIntersectionObserver } from './dom-stub.js';
import { extractTweet, extractText, isOuterTweet, findUserName, ownHandle, fastIdentity } from '../src/extract.js';
import { createWatcher } from '../src/observe.js';

function userName(handle, name, atFirst = false) {
  const nameLink = h('a', { href: '/' + handle }, [t(name)]);
  const atLink = h('a', { href: '/' + handle }, [t('@' + handle)]);
  return h('div', { 'data-testid': 'User-Name' }, atFirst ? [atLink, nameLink] : [nameLink, atLink]);
}

function makeTweet(opts = {}) {
  const handle = opts.handle || 'alice';
  const id = opts.id || '123';
  const children = [opts.userName || userName(handle, opts.name || 'Alice', opts.atFirst)];
  if (opts.verified) children.push(h('div', { 'data-testid': 'icon-verified' }, []));
  if (opts.text !== undefined && opts.text !== null) {
    children.push(h('div', { 'data-testid': 'tweetText' }, [t(opts.text)]));
  }
  for (const href of opts.linkHrefs || []) children.push(h('a', { href }, [t('link')]));
  for (const node of opts.extra || []) children.push(node);
  if (opts.statusHref !== null) {
    children.push(h('a', { href: opts.statusHref || '/' + handle + '/status/' + id }, [t('time')]));
  }
  for (const node of opts.after || []) children.push(node);
  return h('article', { 'data-testid': 'tweet' }, children);
}

function makeQuote(opts = {}) {
  return h('div', { 'data-testid': 'quoteTweet' }, [makeTweet(opts)]);
}

test('isOuterTweet rejects nested articles', () => {
  const quote = makeQuote({ handle: 'bob', id: '999', name: 'Bob', text: 'quoted' });
  const outer = makeTweet({ text: 'outer', after: [quote] });
  const nested = quote.querySelector('article');
  assert.equal(isOuterTweet(outer), true);
  assert.equal(isOuterTweet(nested), false);
  assert.equal(isOuterTweet(null), false);
  assert.equal(extractTweet(nested), null);
});

test('extractTweet reads the outer tweet fields', () => {
  const article = makeTweet({
    handle: 'alice',
    id: '123',
    name: 'Alice',
    verified: true,
    text: 'hello world',
    linkHrefs: ['https://t.me/alpha']
  });
  assert.deepEqual(extractTweet(article), {
    handle: 'alice',
    statusId: '123',
    displayName: 'Alice',
    verified: true,
    text: 'hello world',
    links: ['https://t.me/alpha'],
    promoted: false,
    cardTitle: '',
    cardHost: ''
  });
});

test('quote author, badge, text, and links stay out of the outer tweet', () => {
  const quote = makeQuote({
    handle: 'bob',
    id: '999',
    name: 'Bob',
    verified: true,
    text: 'quoted text',
    linkHrefs: ['https://example.com/quoted']
  });
  const article = makeTweet({
    handle: 'alice',
    id: '123',
    name: 'Alice',
    text: 'outer text',
    linkHrefs: ['https://example.com/outer'],
    after: [quote]
  });
  const result = extractTweet(article);
  assert.equal(result.handle, 'alice');
  assert.equal(result.statusId, '123');
  assert.equal(result.displayName, 'Alice');
  assert.equal(result.verified, false);
  assert.equal(result.text, 'outer text');
  assert.deepEqual(result.links, ['https://example.com/outer']);
});

test('status link prefers the one matching the user name link', () => {
  const article = makeTweet({
    handle: 'alice',
    id: '123',
    text: 'hi',
    extra: [h('a', { href: '/bob/status/999' }, [t('other')])]
  });
  const result = extractTweet(article);
  assert.equal(result.handle, 'alice');
  assert.equal(result.statusId, '123');
});

test('status links support /photo and absolute URLs', () => {
  const photo = makeTweet({ handle: 'alice', id: '456', statusHref: '/alice/status/456/photo/1' });
  assert.equal(extractTweet(photo).statusId, '456');
  const absolute = makeTweet({ handle: 'alice', id: '457', statusHref: 'https://x.com/alice/status/457' });
  assert.equal(extractTweet(absolute).statusId, '457');
});

test('extractTweet returns null without a status link or for DM containers', () => {
  const noStatus = makeTweet({ handle: 'alice', text: 'hi', statusHref: null });
  assert.equal(extractTweet(noStatus), null);

  const dm = h('div', { 'data-testid': 'DMDrawer' }, [makeTweet({ handle: 'alice', id: '123' })]);
  assert.equal(extractTweet(dm.querySelector('article')), null);

  const conversation = h('div', { 'data-testid': 'DMConversation' }, [
    makeTweet({ handle: 'alice', id: '124' })
  ]);
  assert.equal(extractTweet(conversation.querySelector('article')), null);
});

test('extractTweet returns null for an invalid handle', () => {
  const article = makeTweet({ handle: 'alice', id: '123', statusHref: '/bad-handle/status/123' });
  assert.equal(extractTweet(article), null);
});

test('promoted is set from a placementTracking ancestor', () => {
  const article = makeTweet({ handle: 'alice', id: '123', text: 'ad' });
  const wrapper = h('div', { 'data-testid': 'placementTracking' }, [article]);
  assert.equal(extractTweet(article).promoted, true);
  assert.equal(extractTweet(makeTweet({ handle: 'alice', id: '124' })).promoted, false);
  assert.ok(wrapper.contains(article));
});

test('card title and host come from the outer card', () => {
  const card = h('div', { 'data-testid': 'card.wrapper' }, [
    h('div', {}, [t('Big News')]),
    h('a', { href: 'https://t.me/chan' }, [])
  ]);
  const article = makeTweet({ handle: 'alice', id: '123', text: 'card tweet', after: [card] });
  const result = extractTweet(article);
  assert.equal(result.cardTitle, 'Big News');
  assert.equal(result.cardHost, 't.me');
});

test('links filter site navigation, dedupe, and cap at three', () => {
  const article = makeTweet({
    handle: 'alice',
    id: '123',
    linkHrefs: [
      'https://t.me/alpha',
      'https://example.com/a',
      'https://x.com/hashtag/foo',
      '/hashtag/foo',
      'https://t.me/alpha',
      'https://example.org/b',
      'https://example.net/c'
    ]
  });
  assert.deepEqual(extractTweet(article).links, [
    'https://t.me/alpha',
    'https://example.com/a',
    'https://example.org/b'
  ]);
});

test('displayName ignores the @handle link and caps at 80 characters', () => {
  const article = makeTweet({
    handle: 'alice',
    id: '123',
    text: 'hi',
    atFirst: true,
    name: 'Alice'
  });
  assert.equal(extractTweet(article).displayName, 'Alice');

  const long = makeTweet({
    handle: 'alice',
    id: '124',
    text: 'hi',
    name: 'A'.repeat(100)
  });
  assert.equal(extractTweet(long).displayName.length, 80);
});

test('extractText keeps BR newlines and img alt emoji', () => {
  const root = h('div', {}, [
    t('hello'),
    h('br'),
    t('world'),
    h('img', { alt: '😂' }),
    h('div', {}, [t('next')]),
    h('script', {}, [t('bad')]),
    h('style', {}, [t('bad')]),
    t('\u200B')
  ]);
  assert.equal(extractText(root), 'hello\nworld😂\nnext');
});

test('extractText collapses whitespace and blank lines', () => {
  const root = h('div', {}, [t('  hello   world  '), h('br'), t(' second\u200B line ')]);
  assert.equal(extractText(root), 'hello world\nsecond line');

  const blank = h('div', {}, [t('a'), h('br'), h('br'), h('br'), t(' b ')]);
  assert.equal(extractText(blank), 'a\n\nb');
});

test('extractText caps at 2000 characters', () => {
  const root = h('div', {}, [t('a'.repeat(2100))]);
  assert.equal(extractText(root).length, 2000);
});

test('findUserName returns the outer User-Name node', () => {
  const outerName = userName('alice', 'Alice');
  const quote = makeQuote({ handle: 'bob', id: '999', name: 'Bob', text: 'quoted' });
  const article = h('article', { 'data-testid': 'tweet' }, [
    outerName,
    h('div', { 'data-testid': 'tweetText' }, [t('text')]),
    h('a', { href: '/alice/status/123' }, [t('time')]),
    quote
  ]);
  assert.equal(findUserName(article), outerName);
  assert.equal(findUserName(h('article', { 'data-testid': 'tweet' }, [])), null);
});

test('fastIdentity returns the outer status and skips quote links', () => {
  const quoted = makeTweet({ handle: 'bob', id: '999', text: 'quoted' });
  const article = h('article', { 'data-testid': 'tweet' }, [
    h('div', { 'data-testid': 'quoteTweet' }, [quoted]),
    userName('alice', 'Alice'),
    h('a', { href: '/alice/status/123' }, [t('time')])
  ]);
  assert.deepEqual(fastIdentity(article), { handle: 'alice', statusId: '123' });
  assert.deepEqual(fastIdentity(quoted), null);
  assert.equal(fastIdentity(null), null);
});

test('ownHandle prefers the account switcher, then the profile link', () => {
  const doc = createDocument();
  doc.body.appendChild(h('a', { 'data-testid': 'AppTabBar_Profile_Link', href: '/fallback' }, [t('Me')]));
  doc.body.appendChild(h('div', { 'data-testid': 'SideNav_AccountSwitcher_Button' }, [
    h('a', { href: 'https://x.com/me_user' }, [t('Me')])
  ]));
  assert.equal(ownHandle(doc), 'me_user');

  const profileOnly = createDocument();
  profileOnly.body.appendChild(
    h('a', { 'data-testid': 'AppTabBar_Profile_Link', href: '/other_1' }, [t('Other')])
  );
  assert.equal(ownHandle(profileOnly), 'other_1');

  assert.equal(ownHandle(createDocument()), '');
});

test('watcher observes only outer tweets and renders known badges on visibility', () => {
  const doc = installGlobals();
  let io = null;
  const PreviousIO = globalThis.IntersectionObserver;
  class CaptureIO extends StubIntersectionObserver {
    constructor(cb, opts) {
      super(cb, opts);
      io = this;
    }
  }
  globalThis.IntersectionObserver = CaptureIO;

  const root = h('div', { 'data-testid': 'primaryColumn' }, []);
  doc.body.appendChild(root);
  const outer = makeTweet({ handle: 'alice', id: '123', text: 'outer' });
  outer.appendChild(makeQuote({ handle: 'bob', id: '999', text: 'quoted' }));
  root.appendChild(outer);
  root.appendChild(
    h('div', { 'data-testid': 'DMDrawer' }, [makeTweet({ handle: 'carol', id: '777' })])
  );

  let renders = 0;
  let readies = 0;
  const watcher = createWatcher({
    getDwell: () => 300,
    isEnabled: () => true,
    onReady: () => {
      readies++;
      return true;
    },
    onRenderKnown: () => {
      renders++;
    },
    doc,
    win: globalThis.window
  });

  watcher.start();
  assert.equal(io.targets.size, 1);
  io.trigger([StubIntersectionObserver.entry(outer, true, 1)]);
  assert.equal(renders, 1);
  assert.equal(readies, 0);

  watcher.destroy();
  globalThis.IntersectionObserver = PreviousIO;
});
