import { XCP } from './constants.js';
import { SEL } from './selectors.js';

const PROFILE_PATH_RE = /^\/([A-Za-z0-9_]{1,15})\/?$/;
const INTERNAL_HOSTS = new Set([
  'x.com', 'www.x.com', 'mobile.x.com',
  'twitter.com', 'www.twitter.com', 'mobile.twitter.com'
]);

function pathnameOf(href) {
  const raw = String(href == null ? '' : href).trim();
  if (!raw) return '';
  try {
    return new URL(raw, 'https://x.com').pathname;
  } catch (err) {
    return '';
  }
}

function urlOf(href) {
  const raw = String(href == null ? '' : href).trim();
  if (!raw) return null;
  try {
    return new URL(raw, 'https://x.com');
  } catch (err) {
    return null;
  }
}

function isInternalHost(host) {
  return INTERNAL_HOSTS.has(String(host || '').toLowerCase());
}

function externalUrl(href) {
  const url = urlOf(href);
  if (!url) return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (isInternalHost(url.hostname)) return null;
  return url;
}

function cleanText(raw) {
  let text = String(raw == null ? '' : raw);
  text = text.replace(/\r\n?/g, '\n');
  text = text.replace(XCP.CONTROL_RE, '');
  text = text.replace(XCP.ZERO_WIDTH_RE, '');
  const lines = text.split('\n').map(line => line.replace(/[^\S\n]+/g, ' ').trim());
  text = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  return text.replace(/^\n+/, '').replace(/\n+$/, '');
}

function ownedBy(node, article) {
  if (!node) return false;
  if (node.closest(SEL.quote)) return false;
  const owner = node.closest('article');
  return !owner || owner === article;
}

function ownedQuery(article, selector) {
  const out = [];
  if (!article || typeof article.querySelectorAll !== 'function') return out;
  for (const node of article.querySelectorAll(selector)) {
    if (ownedBy(node, article)) out.push(node);
  }
  return out;
}

function parseStatus(href) {
  const path = pathnameOf(href);
  if (!path) return null;
  const m = XCP.STATUS_RE.exec(path);
  if (!m) return null;
  const handle = m[1].toLowerCase();
  if (!XCP.HANDLE_RE.test(handle)) return null;
  return { handle, statusId: m[2] };
}

function statusLinks(article) {
  const out = [];
  for (const anchor of ownedQuery(article, SEL.statusLink)) {
    const parsed = parseStatus(anchor.getAttribute('href'));
    if (parsed) out.push(parsed);
  }
  return out;
}

function userNameHandle(article) {
  const userName = findUserName(article);
  if (!userName) return '';
  const anchors = [];
  if (userName.tagName === 'A') anchors.push(userName);
  for (const anchor of userName.querySelectorAll(SEL.anchor)) anchors.push(anchor);
  for (const anchor of anchors) {
    if (!ownedBy(anchor, article)) continue;
    const m = PROFILE_PATH_RE.exec(pathnameOf(anchor.getAttribute('href')));
    if (!m) continue;
    const handle = m[1].toLowerCase();
    if (XCP.HANDLE_RE.test(handle)) return handle;
  }
  return '';
}

function isDm(article) {
  if (!article || typeof article.closest !== 'function') return false;
  return !!(article.closest(SEL.dmDrawer) || article.closest(SEL.dmConversation));
}

export function isOuterTweet(article) {
  if (!article || article.nodeType !== 1) return false;
  if (String(article.tagName || '').toUpperCase() !== 'ARTICLE') return false;
  if (article.getAttribute('data-testid') !== 'tweet') return false;
  let parent = article.parentElement;
  while (parent) {
    if (String(parent.tagName || '').toUpperCase() === 'ARTICLE') return false;
    parent = parent.parentElement;
  }
  return true;
}

export function extractText(root) {
  if (!root) return '';
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      out.push(node.nodeValue == null ? '' : node.nodeValue);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = String(node.tagName || '').toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE') return;
    if (tag === 'BR') {
      out.push('\n');
      return;
    }
    if (tag === 'IMG') {
      const alt = node.getAttribute('alt');
      if (alt) out.push(alt);
      return;
    }
    const block = tag === 'DIV' || tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE';
    if (block) out.push('\n');
    for (const child of node.childNodes) walk(child);
    if (block) out.push('\n');
  };
  walk(root);
  return cleanText(out.join('')).slice(0, XCP.TEXT_HARD_CAP);
}

export function findUserName(article) {
  if (!article || typeof article.querySelectorAll !== 'function') return null;
  for (const node of article.querySelectorAll(SEL.userName)) {
    if (ownedBy(node, article)) return node;
  }
  return null;
}

export function fastIdentity(article) {
  if (!article || typeof article.querySelectorAll !== 'function') return null;
  const list = statusLinks(article);
  return list.length ? list[0] : null;
}

export function extractTweet(article) {
  if (!isOuterTweet(article)) return null;
  if (isDm(article)) return null;

  const candidates = statusLinks(article);
  if (!candidates.length) return null;

  const preferred = userNameHandle(article);
  let status = null;
  if (preferred) {
    for (const candidate of candidates) {
      if (candidate.handle === preferred) {
        status = candidate;
        break;
      }
    }
  }
  if (!status) status = candidates[0];

  const handle = status.handle;
  const statusId = status.statusId;

  let displayName = '';
  const userName = findUserName(article);
  if (userName) {
    const anchors = [];
    if (userName.tagName === 'A') anchors.push(userName);
    for (const anchor of userName.querySelectorAll(SEL.anchor)) anchors.push(anchor);
    for (const anchor of anchors) {
      if (!ownedBy(anchor, article)) continue;
      const m = PROFILE_PATH_RE.exec(pathnameOf(anchor.getAttribute('href')));
      if (!m || m[1].toLowerCase() !== handle) continue;
      const name = cleanText(anchor.textContent);
      if (!name || name.charAt(0) === '@') continue;
      displayName = name.slice(0, XCP.DISPLAY_NAME_CAP);
      break;
    }
  }

  const verified = ownedQuery(article, SEL.verified).length > 0;

  let text = '';
  const texts = ownedQuery(article, SEL.tweetText);
  if (texts.length) text = extractText(texts[0]);

  const links = [];
  const seen = new Set();
  for (const anchor of ownedQuery(article, SEL.anchor)) {
    const url = externalUrl(anchor.getAttribute('href'));
    if (!url) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    links.push(url.href);
    if (links.length >= XCP.LINK_CAP) break;
  }

  const promoted = !!(article.closest && article.closest(SEL.placement));

  let cardTitle = '';
  let cardHost = '';
  const cards = ownedQuery(article, SEL.card);
  if (cards.length) {
    const card = cards[0];
    cardTitle = extractText(card).slice(0, XCP.CARD_TEXT_CAP);
    const cardAnchors = [];
    if (card.tagName === 'A') cardAnchors.push(card);
    for (const anchor of card.querySelectorAll(SEL.anchor)) cardAnchors.push(anchor);
    for (const anchor of cardAnchors) {
      const url = externalUrl(anchor.getAttribute('href'));
      if (!url) continue;
      cardHost = url.hostname;
      break;
    }
  }

  return {
    handle,
    statusId,
    displayName,
    verified,
    text,
    links,
    promoted,
    cardTitle,
    cardHost
  };
}

export function ownHandle(doc) {
  const d = doc || (typeof document === 'undefined' ? null : document);
  if (!d) return '';
  const nodes = [d.querySelector(SEL.accountSwitcher), d.querySelector(SEL.profileLink)];
  for (const node of nodes) {
    if (!node) continue;
    const anchors = [];
    if (node.tagName === 'A' || node.getAttribute('href')) anchors.push(node);
    for (const anchor of node.querySelectorAll(SEL.anchor)) anchors.push(anchor);
    for (const anchor of anchors) {
      const m = PROFILE_PATH_RE.exec(pathnameOf(anchor.getAttribute('href')));
      if (!m) continue;
      const handle = m[1].toLowerCase();
      if (XCP.HANDLE_RE.test(handle)) return handle;
    }
  }
  return '';
}
