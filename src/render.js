import { XCP, THEME, VIBE_BY_ARCHETYPE } from './constants.js';
import { SEL } from './selectors.js';

const SIGILS = ['✦', '◈', '▲', '●', '◆', '✧'];
const CONTAINER_CLASS = 'xcp-tags';
const BADGE_CLASS = 'xcp-badge';
const GHOST_TEXT = '正在生成第一印象…';
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 8;

const CSS = `
.xcp-tags {
  position: relative;
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  margin-left: 4px;
  max-width: min(100%, 320px);
  line-height: 1;
  white-space: nowrap;
}
.xcp-badge {
  --xcp-a: #a855f7;
  --xcp-b: #f0abfc;
  --xcp-glow: rgba(217, 70, 239, .50);
  --xcp-glow-size: 12px;
  --xcp-bg-a: rgba(168, 85, 247, .22);
  --xcp-bg-b: rgba(236, 72, 153, .16);
  --xcp-base: rgba(9, 13, 22, .74);
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  height: 22px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--xcp-b) 48%, transparent);
  border-radius: 999px;
  font: 600 11px/1 "JetBrains Mono", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", system-ui, sans-serif;
  letter-spacing: .02em;
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
  color: #fff;
  overflow: visible;
  cursor: default;
  background:
    linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.03)) padding-box,
    linear-gradient(100deg, var(--xcp-bg-a), var(--xcp-bg-b)) padding-box,
    linear-gradient(var(--xcp-base), var(--xcp-base)) padding-box;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.18),
    0 0 var(--xcp-glow-size, 12px) -2px var(--xcp-glow);
  transition: transform .2s cubic-bezier(.16, 1, .3, 1), box-shadow .2s ease;
}
.xcp-badge:hover { transform: translateY(-1px); }
.xcp-badge::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(110deg, transparent 20%, rgba(255,255,255,.35) 45%, transparent 62%);
  transform: translateX(-130%);
  clip-path: inset(0 round 999px);
}
.xcp-badge.is-new::after { animation: xcp-sheen .9s cubic-bezier(.16, 1, .3, 1) 1; }
.xcp-badge:focus-visible { outline: 2px solid var(--xcp-b); outline-offset: 2px; }
.xcp-sigil {
  color: var(--xcp-b);
  font-size: 10px;
  text-shadow: 0 0 10px var(--xcp-glow);
}
.xcp-text {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 0 12px var(--xcp-glow);
  unicode-bidi: plaintext;
}
.xcp-pips { display: inline-flex; gap: 2px; margin-left: 1px; }
.xcp-pips i {
  width: 3px;
  height: 9px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--xcp-b) 28%, transparent);
}
.xcp-pips i.on { background: var(--xcp-b); box-shadow: 0 0 8px var(--xcp-b); }

.xcp-vibe-neon { --xcp-a:#a855f7; --xcp-b:#f0abfc; --xcp-glow:rgba(217,70,239,.50); --xcp-bg-a:rgba(168,85,247,.22); --xcp-bg-b:rgba(236,72,153,.16); }
.xcp-vibe-ember { --xcp-a:#f59e0b; --xcp-b:#fb7185; --xcp-glow:rgba(251,113,133,.52); --xcp-bg-a:rgba(245,158,11,.22); --xcp-bg-b:rgba(251,113,133,.16); }
.xcp-vibe-venom { --xcp-a:#ef4444; --xcp-b:#fb7185; --xcp-glow:rgba(248,113,113,.55); --xcp-bg-a:rgba(239,68,68,.24); --xcp-bg-b:rgba(190,24,93,.16); }
.xcp-vibe-aurora { --xcp-a:#10b981; --xcp-b:#22d3ee; --xcp-glow:rgba(34,211,238,.48); --xcp-bg-a:rgba(16,185,129,.20); --xcp-bg-b:rgba(34,211,238,.15); }
.xcp-vibe-frost { --xcp-a:#64748b; --xcp-b:#93c5fd; --xcp-glow:rgba(147,197,253,.38); --xcp-bg-a:rgba(100,116,139,.20); --xcp-bg-b:rgba(147,197,253,.14); }
.xcp-vibe-sakura { --xcp-a:#f472b6; --xcp-b:#fda4af; --xcp-glow:rgba(244,114,182,.45); --xcp-bg-a:rgba(244,114,182,.20); --xcp-bg-b:rgba(253,164,175,.15); }

.xcp-ghost {
  --xcp-a:#475569;
  --xcp-b:#94a3b8;
  --xcp-glow:rgba(148,163,184,.18);
  --xcp-bg-a:rgba(255,255,255,.03);
  --xcp-bg-b:rgba(255,255,255,.03);
  background: rgba(255,255,255,.03);
  border: 1px dashed rgba(255,255,255,.22);
  box-shadow: none;
  color: #9aa3b8;
  animation: none;
}
.xcp-ghost .xcp-sigil { animation: xcp-breathe 2.2s ease-in-out infinite; }
.xcp-ghost .xcp-text { text-shadow: none; font-weight: 500; }

.xcp-badge.xcp-busy .xcp-sigil { animation: xcp-breathe .9s ease-in-out infinite; }
.xcp-badge.xcp-busy .xcp-pips i.on { animation: xcp-pip-busy .8s ease-in-out infinite; }

.xcp-light .xcp-badge,
html[data-xcp-light="1"] .xcp-badge {
  background: rgba(255,255,255,.86) padding-box;
  border-color: color-mix(in srgb, var(--xcp-b) 45%, #cbd5e1);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.9), 0 1px 2px rgba(20,20,40,.12);
  color: #1d2230;
  animation: none;
}
.xcp-light .xcp-badge::after,
html[data-xcp-light="1"] .xcp-badge::after { display: none; }
.xcp-light .xcp-badge .xcp-sigil,
.xcp-light .xcp-badge .xcp-text,
html[data-xcp-light="1"] .xcp-badge .xcp-sigil,
html[data-xcp-light="1"] .xcp-badge .xcp-text { text-shadow: none; }
.xcp-light .xcp-badge .xcp-text,
html[data-xcp-light="1"] .xcp-badge .xcp-text { color: #1d2230; }
.xcp-light .xcp-badge .xcp-sigil,
html[data-xcp-light="1"] .xcp-badge .xcp-sigil { color: color-mix(in srgb, var(--xcp-b) 55%, #334155); }

#xcp-card.xcp-card {
  --xcp-a: #a855f7;
  --xcp-b: #f0abfc;
  --xcp-glow: rgba(217,70,239,.5);
  position: fixed;
  width: ${XCP.CARD_WIDTH}px;
  max-width: calc(100vw - 24px);
  padding: 14px 15px 12px;
  border-radius: 16px;
  z-index: 2147483645;
  display: none;
  box-sizing: border-box;
  background: linear-gradient(180deg, rgba(19,24,38,.94), rgba(8,11,19,.97));
  border: 1px solid rgba(255,255,255,.11);
  box-shadow: 0 28px 70px -24px #000, inset 0 1px 0 rgba(255,255,255,.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: #e9edf8;
  font-family: "JetBrains Mono", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", system-ui, sans-serif;
  text-align: left;
}
#xcp-card.xcp-card.xcp-open { display: block; }
#xcp-card .card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
#xcp-card .card-label {
  font: 700 18px/1.2 system-ui, sans-serif;
  letter-spacing: -.02em;
  color: #fff;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#xcp-card .vibe-chip {
  font: 600 9px/1 "JetBrains Mono", monospace;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--xcp-b);
  opacity: .9;
  white-space: nowrap;
}
#xcp-card .conf {
  height: 3px;
  margin: 11px 0 12px;
  border-radius: 99px;
  background: rgba(255,255,255,.08);
  overflow: hidden;
}
#xcp-card .conf i {
  display: block;
  height: 100%;
  width: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--xcp-a), var(--xcp-b));
  box-shadow: 0 0 12px var(--xcp-glow);
}
#xcp-card .reason {
  margin: 0 0 12px;
  color: #d7deee;
  font-size: 12.5px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
#xcp-card .note {
  padding: 9px 10px;
  border-radius: 10px;
  background: rgba(255,255,255,.035);
  border: 1px solid rgba(255,255,255,.06);
}
#xcp-card .note b,
#xcp-card .hist b {
  display: block;
  font: 600 9px/1 "JetBrains Mono", monospace;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: #7f89a0;
  margin-bottom: 6px;
}
#xcp-card .note p {
  margin: 0;
  color: #aeb8cc;
  font-size: 11.5px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
#xcp-card .bars { margin: 11px 0 0; display: grid; gap: 5px; }
#xcp-card .bar {
  display: grid;
  grid-template-columns: 74px 1fr 30px;
  align-items: center;
  gap: 7px;
  font: 500 9px/1 "JetBrains Mono", monospace;
  color: #8f99ae;
}
#xcp-card .bar span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#xcp-card .bar i {
  height: 3px;
  border-radius: 99px;
  background: rgba(255,255,255,.08);
  overflow: hidden;
}
#xcp-card .bar i::after {
  content: "";
  display: block;
  height: 100%;
  width: var(--w, 0%);
  background: linear-gradient(90deg, var(--xcp-a), var(--xcp-b));
  opacity: .85;
}
#xcp-card .hist { margin-top: 11px; }
#xcp-card .hist-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  color: #9aa4b9;
  font-size: 11px;
}
#xcp-card .hist-row em {
  font-style: normal;
  font: 600 9px/1 "JetBrains Mono", monospace;
  color: var(--xcp-b);
  opacity: .8;
  width: 20px;
}
#xcp-card .hist-row span {
  color: #c8d0e0;
  overflow-wrap: anywhere;
}
#xcp-card .card-foot {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(255,255,255,.07);
  color: #6f798e;
  font: 500 9.5px/1.3 "JetBrains Mono", monospace;
  display: flex;
  align-items: center;
  gap: 8px;
}
#xcp-card .card-foot .card-hint { margin-right: auto; }
#xcp-card .card-foot button {
  padding: 4px 8px;
  border-radius: 7px;
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.06);
  color: #d7deee;
  font: inherit;
  cursor: pointer;
}
#xcp-card .card-foot button:hover { background: rgba(255,255,255,.12); }
#xcp-card .card-foot button[data-xcp-action="hide"] { color: #fda4af; }

@keyframes xcp-sheen { 0% { transform: translateX(-130%); } 100% { transform: translateX(130%); } }
@keyframes xcp-breathe {
  0%, 100% { opacity: .95; transform: scale(1); }
  50% { opacity: .45; transform: scale(.82); }
}
@keyframes xcp-pip-busy {
  0%, 100% { opacity: 1; }
  50% { opacity: .35; }
}

@media (max-width: ${XCP.BADGE_COMPACT_PX}px) {
  .xcp-pips { display: none; }
  .xcp-text { max-width: 150px; }
}
.xcp-compact .xcp-pips { display: none; }

@media (prefers-reduced-motion: reduce) {
  .xcp-badge,
  .xcp-badge::after,
  .xcp-badge:hover,
  .xcp-sigil,
  .xcp-text,
  .xcp-pips i {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }
}
`;

function renderResolveDoc(doc) {
  if (doc) return doc;
  return typeof document === 'undefined' ? null : document;
}

function handleOf(profile) {
  return String((profile && profile.handle) || '').toLowerCase();
}

function isHandle(handle) {
  if (!handle) return false;
  XCP.HANDLE_RE.lastIndex = 0;
  return XCP.HANDLE_RE.test(handle);
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function later(fn, ms) {
  const timer = setTimeout(fn, ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

function frame(fn) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
  return later(fn, 0);
}

function sigilFor(handle) {
  let hash = 0;
  for (let i = 0; i < handle.length; i += 1) {
    hash = (hash * 31 + handle.charCodeAt(i)) >>> 0;
  }
  return SIGILS[hash % SIGILS.length];
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function renderPathnameOf(href) {
  const raw = String(href || '');
  if (!raw) return '';
  try {
    return new URL(raw, 'https://x.com/').pathname;
  } catch (err) {
    const cut = Math.min(
      raw.indexOf('?') >= 0 ? raw.indexOf('?') : raw.length,
      raw.indexOf('#') >= 0 ? raw.indexOf('#') : raw.length
    );
    return raw.slice(0, cut);
  }
}

function matchesHandle(href, handle) {
  return renderPathnameOf(href).toLowerCase() === '/' + handle;
}

function hasTestId(node, value) {
  return !!(node && node.getAttribute && node.getAttribute('data-testid') === value);
}

function inQuote(node) {
  let current = node;
  while (current && current.nodeType === 1) {
    if (hasTestId(current, 'quoteTweet')) return true;
    current = current.parentElement;
  }
  return false;
}

function renderFindUserName(article) {
  const nodes = article.querySelectorAll(SEL.userName);
  for (const node of nodes) {
    if (inQuote(node)) continue;
    if (hasTestId(node, 'User-Name')) return node;
  }
  return null;
}

function findNameLink(un, handle) {
  const links = un.querySelectorAll('a[href]');
  for (const link of links) {
    if (inQuote(link)) continue;
    if (!matchesHandle(link.getAttribute('href'), handle)) continue;
    const text = String(link.textContent || '').trim();
    if (!text || text.charAt(0) === '@') continue;
    return link;
  }
  return null;
}

function resolveRow(un, handle) {
  const link = findNameLink(un, handle);
  let row = link && link.parentElement ? link.parentElement : un;
  if (row !== un && !un.contains(row)) row = un;
  while (row && row.tagName === 'A') row = row.parentElement;
  if (!row) return null;
  const anchor = row.closest ? row.closest('a') : null;
  if (anchor) row = anchor.parentElement;
  return row || null;
}

function findContainer(row) {
  for (const child of row.children) {
    if (child.classList && child.classList.contains(CONTAINER_CLASS)) return child;
  }
  return null;
}

function ensureContainer(doc, row) {
  const existing = findContainer(row);
  if (existing) return existing;
  const container = el(doc, 'span', CONTAINER_CLASS);
  row.appendChild(container);
  return container;
}

function topOf(map) {
  if (!map || typeof map !== 'object') return null;
  let bestKey = '';
  let bestValue = -Infinity;
  for (const key of Object.keys(map)) {
    const value = Number(map[key]);
    if (!Number.isFinite(value)) continue;
    if (value > bestValue) {
      bestValue = value;
      bestKey = key;
    }
  }
  return bestKey ? { key: bestKey, value: bestValue } : null;
}

function vibeOf(profile, label) {
  const raw = label && typeof label.vibe === 'string' ? label.vibe : '';
  if (XCP.VIBES.indexOf(raw) >= 0) return raw;
  const archetype = (label && label.archetype)
    || (profile && profile.assessment ? (topOf(profile.assessment.archetype) || {}).key : '');
  return VIBE_BY_ARCHETYPE[archetype] || 'frost';
}

function stageOf(profile, label) {
  const stage = Number(profile && profile.stage);
  if (Number.isFinite(stage) && stage > 0) return Math.floor(stage);
  const labelStage = Number(label && label.stage);
  if (Number.isFinite(labelStage) && labelStage > 0) return Math.floor(labelStage);
  return 1;
}

function confidenceOf(profile, label) {
  const labelConfidence = Number(label && label.confidence);
  if (Number.isFinite(labelConfidence)) return clamp01(labelConfidence);
  const assessmentConfidence = Number(profile && profile.assessment && profile.assessment.confidence);
  if (Number.isFinite(assessmentConfidence)) return clamp01(assessmentConfidence);
  return 0.5;
}

function stageLabel(stage) {
  return stage >= XCP.MAX_STAGE_DISPLAY ? '9+' : String(stage);
}

function updatedStamp(profile, label, stage, scanning) {
  const updated = Number(profile && profile.updatedAt) || 0;
  const labelUpdated = Number(label && label.updatedAt) || 0;
  return [
    updated,
    labelUpdated,
    label && label.text ? label.text : '',
    label && label.vibe ? label.vibe : '',
    stage,
    scanning ? '1' : '0'
  ].join(':');
}

function buildPips(doc, stage) {
  const pips = el(doc, 'span', 'xcp-pips');
  const on = Math.min(3, Math.ceil(stage / 3));
  for (let i = 0; i < 3; i += 1) {
    const pip = doc.createElement('i');
    if (i < on) pip.className = 'on';
    pips.appendChild(pip);
  }
  return pips;
}

function buildBadge(doc, profile, label, vibe, stage) {
  const badge = el(doc, 'span', BADGE_CLASS + ' ' + (THEME[vibe] || THEME.frost));
  const confidence = confidenceOf(profile, label);
  const sigil = el(doc, 'span', 'xcp-sigil', sigilFor(handleOf(profile)));
  const text = el(doc, 'span', 'xcp-text', label.text);
  const title = [
    label.text + ' · ' + vibe + ' · ' + Math.round(confidence * 100) + '%',
    label.reason || '',
    '第 ' + stageLabel(stage) + ' 阶段 · 双击或 Enter 重评'
  ].filter(Boolean).join('\n');
  const aria = '标签：' + label.text
    + '；理由：' + (label.reason || '无')
    + '；第 ' + stageLabel(stage) + ' 阶段；按 Enter 重评';

  badge.setAttribute('data-stage', String(stage));
  badge.setAttribute('tabindex', '0');
  badge.setAttribute('role', 'button');
  badge.setAttribute('dir', 'auto');
  badge.setAttribute('aria-label', aria);
  badge.setAttribute('title', title);
  badge.style.setProperty('--xcp-glow-size', glowSize(confidence) + 'px');

  badge.appendChild(sigil);
  badge.appendChild(text);
  badge.appendChild(buildPips(doc, stage));
  return badge;
}

function buildGhost(doc, profile) {
  const badge = el(doc, 'span', BADGE_CLASS + ' xcp-ghost');
  const sigil = el(doc, 'span', 'xcp-sigil', sigilFor(handleOf(profile)));
  const text = el(doc, 'span', 'xcp-text', GHOST_TEXT);
  badge.setAttribute('dir', 'auto');
  badge.setAttribute('title', GHOST_TEXT);
  badge.appendChild(sigil);
  badge.appendChild(text);
  return badge;
}

function glowSize(confidence) {
  return Math.round(6 + clamp01((confidence - 0.5) / 0.5) * 12);
}

export function injectStyles(doc) {
  const d = renderResolveDoc(doc);
  if (!d) return null;
  const existing = d.getElementById('xcp-style');
  if (existing) return existing;
  const style = d.createElement('style');
  style.setAttribute('id', 'xcp-style');
  style.textContent = CSS;
  const host = d.head || d.documentElement;
  if (!host) return null;
  host.appendChild(style);
  return style;
}

export function renderBadges(article, profile, opts = {}) {
  if (!article || !profile) return null;
  const doc = renderResolveDoc(opts.doc);
  if (!doc) return null;
  const handle = handleOf(profile);
  if (!isHandle(handle)) return null;

  const un = renderFindUserName(article);
  if (!un) return null;

  const row = resolveRow(un, handle);
  if (!row) return null;

  const existing = findContainer(row);
  if (profile.hidden) {
    if (existing) existing.remove();
    return null;
  }

  const label = profile.label && typeof profile.label.text === 'string' && profile.label.text.trim()
    ? profile.label
    : null;
  const scanning = opts.scanning === true;
  const stage = stageOf(profile, label);
  const stamp = updatedStamp(profile, label, stage, scanning);

  const hasAssessment = !!(profile.assessment && typeof profile.assessment === 'object');
  if (!label && !scanning && !hasAssessment) {
    if (existing) existing.remove();
    return null;
  }

  if (existing && existing.isConnected
    && existing.getAttribute('data-xcp-handle') === handle
    && existing.getAttribute('data-xcp-updated') === stamp) {
    return existing.querySelector('.' + BADGE_CLASS);
  }

  const container = existing || ensureContainer(doc, row);
  container.textContent = '';
  container.setAttribute('data-xcp-handle', handle);
  container.setAttribute('data-xcp-updated', stamp);
  container.setAttribute('data-xcp-scan', scanning ? '1' : '0');
  container.setAttribute('dir', 'auto');

  if (!label) {
    container.appendChild(buildGhost(doc, profile));
    return container.querySelector('.' + BADGE_CLASS);
  }

  const vibe = vibeOf(profile, label);
  const badge = buildBadge(doc, profile, label, vibe, stage);
  if (scanning) badge.classList.add('xcp-busy');
  if (opts.isNew === true) {
    badge.classList.add('is-new');
    later(() => badge.classList.remove('is-new'), 2000);
  }
  container.appendChild(badge);
  return badge;
}

function articleHandle(article) {
  const un = renderFindUserName(article);
  if (!un) return '';
  const links = un.querySelectorAll('a[href]');
  for (const link of links) {
    if (inQuote(link)) continue;
    const path = renderPathnameOf(link.getAttribute('href')).toLowerCase();
    if (/^\/[a-z0-9_]{1,15}$/.test(path)) return path.slice(1);
  }
  return '';
}

function findTweets(root) {
  const out = [];
  const all = root.querySelectorAll(SEL.tweet);
  for (const node of all) {
    if (node.tagName === 'ARTICLE' && hasTestId(node, 'tweet')) out.push(node);
  }
  return out;
}

function findRoot(doc) {
  const primaries = doc.querySelectorAll(SEL.primary);
  for (const node of primaries) {
    if (hasTestId(node, 'primaryColumn')) return node;
  }
  const mains = doc.querySelectorAll(SEL.main);
  for (const node of mains) {
    if (node.getAttribute && node.getAttribute('role') === 'main') return node;
  }
  return doc.body;
}

export function renderAllForHandle(handle, profile, opts = {}) {
  const doc = renderResolveDoc(opts.doc);
  if (!doc || !handle) return 0;
  const wanted = String(handle).toLowerCase();
  if (!isHandle(wanted)) return 0;
  const root = opts.root || findRoot(doc);
  if (!root) return 0;

  const articles = [];
  const all = findTweets(root);
  for (const article of all) {
    if (articleHandle(article) === wanted) articles.push(article);
  }
  if (!articles.length) return 0;

  const renderOne = (article) => {
    renderBadges(article, profile, opts);
  };

  if (articles.length <= 20) {
    for (const article of articles) renderOne(article);
    return articles.length;
  }

  const raf = typeof opts.raf === 'function' ? opts.raf : frame;
  let index = 0;
  const step = () => {
    const end = Math.min(index + 20, articles.length);
    for (; index < end; index += 1) renderOne(articles[index]);
    if (index < articles.length) raf(step);
  };
  raf(step);
  return articles.length;
}

export function removeBadges(handle, doc) {
  let target = handle;
  let d = doc;
  if (target && target.nodeType === 9 && !d) {
    d = target;
    target = undefined;
  }
  const resolved = renderResolveDoc(d);
  if (!resolved) return 0;
  const wanted = target ? String(target).toLowerCase() : '';
  const list = resolved.querySelectorAll('.' + CONTAINER_CLASS);
  let removed = 0;
  for (const node of list) {
    if (wanted && node.getAttribute('data-xcp-handle') !== wanted) continue;
    node.remove();
    removed += 1;
  }
  return removed;
}

export function removeAllBadges(doc) {
  const resolved = renderResolveDoc(doc);
  const removed = removeBadges(undefined, resolved);
  hideCard(resolved);
  return removed;
}

export function bindRepair(article, renderFn, opts = {}) {
  if (!article || typeof renderFn !== 'function') return () => {};
  const Observer = opts.MutationObserver
    || (typeof MutationObserver === 'function' ? MutationObserver : null);
  if (!Observer) return () => {};
  const raf = typeof opts.raf === 'function' ? opts.raf : frame;
  let scheduled = false;
  let locked = false;

  const observer = new Observer(() => {
    if (locked || scheduled) return;
    scheduled = true;
    raf(() => {
      scheduled = false;
      if (!article.isConnected) {
        observer.disconnect();
        return;
      }
      if (article.querySelector('.' + CONTAINER_CLASS)) return;
      locked = true;
      try {
        renderFn();
      } finally {
        locked = false;
      }
    });
  });
  observer.observe(article, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function hasSelection(doc) {
  if (!doc || typeof doc.getSelection !== 'function') return false;
  const selection = doc.getSelection();
  return !!(selection && typeof selection.toString === 'function' && selection.toString().length);
}

function cardOf(doc) {
  return doc ? doc.getElementById('xcp-card') : null;
}

function actionFrom(target) {
  return target && target.closest ? target.closest('[data-xcp-action]') : null;
}

function badgeFrom(target) {
  return target && target.closest ? target.closest('.' + BADGE_CLASS) : null;
}

function containerFromBadge(badge) {
  return badge && badge.closest ? badge.closest('.' + CONTAINER_CLASS) : null;
}

function isTouchPointer(event, win) {
  if (!event) return false;
  const kind = event.pointerType;
  if (typeof kind === 'string' && kind) return kind === 'touch';
  const caps = event.sourceCapabilities;
  if (caps && caps.firesTouchEvents) return true;
  if (!win) return false;
  if (Number(win.navigator && win.navigator.maxTouchPoints) > 0) return true;
  if ('ontouchstart' in win) return true;
  try {
    return typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
  } catch (err) {
    return false;
  }
}

export function initInteractions(opts = {}) {
  const doc = renderResolveDoc(opts.doc);
  if (!doc) return () => {};
  const root = opts.root || doc.body || doc.documentElement;
  if (!root) return () => {};
  const getProfile = typeof opts.getProfile === 'function' ? opts.getProfile : null;
  const onReassess = typeof opts.onReassess === 'function' ? opts.onReassess : null;
  const onHide = typeof opts.onHide === 'function' ? opts.onHide : null;

  const lastForce = new Map();
  let openTimer = 0;
  let closeTimer = 0;
  let pressTimer = 0;
  let press = null;
  let firedPress = null;
  let expandedBadge = null;
  let suppressBadge = null;
  let suppressUntil = 0;
  const bound = [];

  const clearOpen = () => {
    clearTimeout(openTimer);
    openTimer = 0;
  };
  const clearClose = () => {
    clearTimeout(closeTimer);
    closeTimer = 0;
  };

  const profileFor = (handle) => {
    if (!handle || !getProfile) return null;
    try {
      return getProfile(handle);
    } catch (err) {
      return null;
    }
  };

  const force = (handle) => {
    if (!handle || !onReassess) return;
    const now = Date.now();
    const last = lastForce.get(handle) || 0;
    if (now - last < XCP.DOUBLE_CLICK_GUARD_MS) return;
    lastForce.set(handle, now);
    onReassess(handle, { force: true });
  };

  const openFor = (badge) => {
    if (!badge || !badge.isConnected) return;
    const container = containerFromBadge(badge);
    const handle = container ? container.getAttribute('data-xcp-handle') : '';
    const profile = profileFor(handle);
    if (!profile || profile.hidden) return;
    showCard(badge, profile, { doc });
  };

  const scheduleOpen = (badge) => {
    clearClose();
    clearOpen();
    openTimer = later(() => {
      openTimer = 0;
      openFor(badge);
    }, 250);
  };

  const cancelPress = () => {
    clearTimeout(pressTimer);
    pressTimer = 0;
    press = null;
  };

  const closeCard = () => {
    if (expandedBadge) {
      if (expandedBadge.isConnected && expandedBadge.setAttribute) {
        expandedBadge.setAttribute('aria-expanded', 'false');
      }
      expandedBadge = null;
    }
    hideCard(doc);
  };

  const scheduleClose = () => {
    clearOpen();
    clearClose();
    closeTimer = later(() => {
      closeTimer = 0;
      closeCard();
    }, 120);
  };

  const isSuppressed = (target) => {
    if (!suppressBadge) return false;
    if (Date.now() >= suppressUntil) {
      suppressBadge = null;
      return false;
    }
    return badgeFrom(target) === suppressBadge;
  };

  const markExpanded = (badge) => {
    if (expandedBadge && expandedBadge !== badge && expandedBadge.isConnected
      && expandedBadge.setAttribute) {
      expandedBadge.setAttribute('aria-expanded', 'false');
    }
    expandedBadge = badge;
    if (badge.setAttribute) badge.setAttribute('aria-expanded', 'true');
  };

  const firePress = () => {
    pressTimer = 0;
    const current = press;
    press = null;
    if (!current) return;
    const badge = current.badge;
    if (!badge || !badge.isConnected) return;
    const container = containerFromBadge(badge);
    const handle = container ? container.getAttribute('data-xcp-handle') : '';
    const profile = profileFor(handle);
    if (!profile || profile.hidden) return;
    const card = showCard(badge, profile, { doc });
    if (!card) return;
    clearOpen();
    clearClose();
    firedPress = { badge, pointerId: current.pointerId };
    suppressBadge = badge;
    suppressUntil = Date.now() + XCP.DOUBLE_CLICK_GUARD_MS;
    markExpanded(badge);
  };

  const onPointerDown = (event) => {
    if (!isTouchPointer(event, win)) return;
    if (event.isPrimary === false) return;
    if (Number(event.button) > 0) return;
    const badge = badgeFrom(event.target);
    if (!badge) return;
    cancelPress();
    press = {
      badge,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    pressTimer = later(firePress, LONG_PRESS_MS);
  };

  const samePointer = (event) => {
    if (!press) return false;
    if (press.pointerId == null || event.pointerId == null) return true;
    return press.pointerId === event.pointerId;
  };

  const onPointerMove = (event) => {
    if (!samePointer(event)) return;
    const x = event.clientX;
    const y = event.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!Number.isFinite(press.x) || !Number.isFinite(press.y)) return;
    const dx = x - press.x;
    const dy = y - press.y;
    if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_SLOP_PX) cancelPress();
  };

  const matchesFired = (event) => {
    if (!firedPress) return false;
    if (firedPress.pointerId == null || event.pointerId == null) return true;
    return firedPress.pointerId === event.pointerId;
  };

  const onPointerUp = (event) => {
    if (matchesFired(event)) {
      suppressBadge = firedPress.badge;
      suppressUntil = Date.now() + XCP.DOUBLE_CLICK_GUARD_MS;
      firedPress = null;
    }
    if (!samePointer(event)) return;
    cancelPress();
  };

  const onPointerCancel = (event) => {
    if (matchesFired(event)) firedPress = null;
    if (!samePointer(event)) return;
    cancelPress();
  };

  const guard = (event, key) => {
    if (!event) return false;
    if (event[key]) return false;
    try {
      event[key] = true;
    } catch (err) {
      return true;
    }
    return true;
  };

  const onDoubleClick = (event) => {
    if (!guard(event, '__xcpDbl')) return;
    if (isSuppressed(event.target)) {
      if (event.preventDefault) event.preventDefault();
      return;
    }
    const badge = badgeFrom(event.target);
    if (!badge) return;
    if (event.preventDefault) event.preventDefault();
    if (hasSelection(doc)) return;
    const container = containerFromBadge(badge);
    const handle = container ? container.getAttribute('data-xcp-handle') : '';
    if (!handle) return;
    force(handle);
  };

  const onKeyDown = (event) => {
    if (!guard(event, '__xcpKey')) return;
    const key = event.key;
    if (key === 'Escape' || key === 'Esc') {
      clearOpen();
      clearClose();
      cancelPress();
      closeCard();
      return;
    }
    if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar' && key !== 'Space') return;
    const badge = badgeFrom(event.target);
    if (!badge) return;
    if (event.preventDefault) event.preventDefault();
    if (hasSelection(doc)) return;
    const container = containerFromBadge(badge);
    const handle = container ? container.getAttribute('data-xcp-handle') : '';
    if (!handle) return;
    force(handle);
  };

  const onMouseOver = (event) => {
    if (!guard(event, '__xcpOver')) return;
    const card = cardOf(doc);
    if (card && event.target === card) {
      clearClose();
      return;
    }
    const badge = badgeFrom(event.target);
    if (badge) {
      if (event.relatedTarget && badge.contains(event.relatedTarget)) return;
      scheduleOpen(badge);
      return;
    }
    if (card && card.contains(event.target)) clearClose();
  };

  const onMouseOut = (event) => {
    if (!guard(event, '__xcpOut')) return;
    const card = cardOf(doc);
    if (card && card.contains(event.target)
      && !(event.relatedTarget && card.contains(event.relatedTarget))) {
      scheduleClose();
      return;
    }
    const badge = badgeFrom(event.target);
    if (!badge) return;
    if (event.relatedTarget && badge.contains(event.relatedTarget)) return;
    if (event.relatedTarget && card && card.contains(event.relatedTarget)) return;
    scheduleClose();
  };

  const onFocusIn = (event) => {
    if (!guard(event, '__xcpFocusIn')) return;
    const badge = badgeFrom(event.target);
    if (badge) scheduleOpen(badge);
  };

  const onFocusOut = (event) => {
    if (!guard(event, '__xcpFocusOut')) return;
    const badge = badgeFrom(event.target);
    if (!badge) return;
    const card = cardOf(doc);
    if (event.relatedTarget && card && card.contains(event.relatedTarget)) return;
    scheduleClose();
  };

  const onClick = (event) => {
    if (!guard(event, '__xcpClick')) return;
    if (isSuppressed(event.target)) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      return;
    }
    const action = actionFrom(event.target);
    if (!action) return;
    const card = cardOf(doc);
    if (!card || !card.contains(action)) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    const handle = card.getAttribute('data-xcp-handle') || '';
    const kind = action.getAttribute('data-xcp-action');
    if (kind === 'reassess') {
      force(handle);
      closeCard();
      return;
    }
    if (kind === 'hide') {
      const profile = profileFor(handle);
      if (profile) profile.hidden = true;
      if (onHide) onHide(handle, profile || null);
      removeBadges(handle, doc);
      closeCard();
    }
  };

  const onScroll = () => {
    cancelPress();
    closeCard();
  };
  const nodes = [root, doc.body, doc].filter(Boolean);
  const seen = new Set();
  for (const node of nodes) {
    if (seen.has(node)) continue;
    seen.add(node);
    const pairs = [
      ['dblclick', onDoubleClick],
      ['keydown', onKeyDown],
      ['mouseover', onMouseOver],
      ['mouseout', onMouseOut],
      ['focusin', onFocusIn],
      ['focusout', onFocusOut],
      ['click', onClick],
      ['pointerdown', onPointerDown],
      ['pointermove', onPointerMove],
      ['pointerup', onPointerUp],
      ['pointercancel', onPointerCancel]
    ];
    for (const [type, fn] of pairs) {
      const capture = type === 'dblclick' || type === 'keydown' || type === 'click'
        || type === 'pointerdown' || type === 'pointermove'
        || type === 'pointerup' || type === 'pointercancel';
      node.addEventListener(type, fn, capture);
      bound.push([node, type, fn, capture]);
    }
  }
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('scroll', onScroll, true);
    bound.push([win, 'scroll', onScroll, true]);
  }

  return () => {
    clearOpen();
    clearClose();
    cancelPress();
    for (const [node, type, fn, capture] of bound) node.removeEventListener(type, fn, capture);
    bound.length = 0;
    closeCard();
  };
}

function formatScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return clamp01(number).toFixed(2);
}

function appendAssessment(doc, card, profile) {
  const assessment = profile && profile.assessment;
  if (!assessment || typeof assessment !== 'object') return;
  const rows = [];
  const topArchetype = topOf(assessment.archetype);
  if (topArchetype) rows.push([topArchetype.key, topArchetype.value]);
  const traits = assessment.traits || {};
  const traitKeys = Object.keys(traits)
    .filter((key) => Number.isFinite(Number(traits[key])))
    .sort((a, b) => Number(traits[b]) - Number(traits[a]))
    .slice(0, 3);
  for (const key of traitKeys) rows.push([key, Number(traits[key])]);
  if (!rows.length) return;

  const bars = el(doc, 'div', 'bars');
  for (const [name, value] of rows) {
    const bar = el(doc, 'div', 'bar');
    bar.appendChild(el(doc, 'span', '', name));
    const track = el(doc, 'i');
    track.style.setProperty('--w', Math.round(clamp01(value) * 100) + '%');
    bar.appendChild(track);
    bar.appendChild(el(doc, 'span', '', formatScore(value)));
    bars.appendChild(bar);
  }
  card.appendChild(bars);
}

function appendHistory(doc, card, profile) {
  const history = Array.isArray(profile && profile.history) ? profile.history : [];
  if (!history.length) return;
  const box = el(doc, 'div', 'hist');
  box.appendChild(el(doc, 'b', '', '进化轨迹'));
  const rows = history.slice(0, 3).reverse();
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = el(doc, 'div', 'hist-row');
    const stage = Number(item.stage);
    row.appendChild(el(doc, 'em', '', Number.isFinite(stage) ? 'S' + Math.floor(stage) : 'S?'));
    row.appendChild(el(doc, 'span', '', item.text == null ? '' : item.text));
    box.appendChild(row);
  }
  if (box.children.length > 1) card.appendChild(box);
}

export function showCard(anchor, profile, opts = {}) {
  const doc = renderResolveDoc(opts.doc);
  if (!doc || !anchor || !profile) return null;
  const label = profile.label && typeof profile.label.text === 'string' && profile.label.text.trim()
    ? profile.label
    : null;
  const vibe = vibeOf(profile, label);
  const confidence = confidenceOf(profile, label);
  const stage = stageOf(profile, label);
  const handle = handleOf(profile);

  let card = cardOf(doc);
  if (!card) {
    card = el(doc, 'div', 'xcp-card');
    card.setAttribute('id', 'xcp-card');
    (doc.body || doc.documentElement).appendChild(card);
  }
  card.textContent = '';
  card.className = 'xcp-card ' + (THEME[vibe] || THEME.frost);
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-hidden', 'false');
  card.setAttribute('aria-label', '标签详情：' + (label ? label.text : '正在生成'));
  card.setAttribute('data-xcp-handle', handle);

  const top = el(doc, 'div', 'card-top');
  top.appendChild(el(doc, 'span', 'card-label', label ? label.text : (profile.displayName || '@' + handle)));
  top.appendChild(el(doc, 'span', 'vibe-chip', vibe + ' · S' + stageLabel(stage)));
  card.appendChild(top);

  const conf = el(doc, 'div', 'conf');
  const fill = el(doc, 'i');
  fill.style.setProperty('width', Math.round(confidence * 100) + '%');
  conf.appendChild(fill);
  card.appendChild(conf);

  const reason = label && label.reason ? label.reason : '正在收集证据…';
  card.appendChild(el(doc, 'p', 'reason', reason));

  const dossier = profile.dossier ? String(profile.dossier) : '';
  if (dossier) {
    const note = el(doc, 'div', 'note');
    note.appendChild(el(doc, 'b', '', '印象笔记'));
    note.appendChild(el(doc, 'p', '', dossier));
    card.appendChild(note);
  }

  appendAssessment(doc, card, profile);
  appendHistory(doc, card, profile);

  const foot = el(doc, 'div', 'card-foot');
  foot.appendChild(el(doc, 'span', 'card-hint', '双击 / Enter 重评'));
  const reassess = el(doc, 'button', '', '重评');
  reassess.setAttribute('type', 'button');
  reassess.setAttribute('data-xcp-action', 'reassess');
  foot.appendChild(reassess);
  const hide = el(doc, 'button', '', '隐藏');
  hide.setAttribute('type', 'button');
  hide.setAttribute('data-xcp-action', 'hide');
  foot.appendChild(hide);
  card.appendChild(foot);

  card.classList.add('xcp-open');

  const rect = typeof anchor.getBoundingClientRect === 'function'
    ? anchor.getBoundingClientRect()
    : { left: 0, right: 0, top: 0, bottom: 0 };
  const win = opts.win || doc.defaultView || (typeof window === 'undefined' ? null : window);
  const vw = (win && win.innerWidth) || (doc.documentElement && doc.documentElement.clientWidth) || 0;
  const vh = (win && win.innerHeight) || (doc.documentElement && doc.documentElement.clientHeight) || 0;
  const width = XCP.CARD_WIDTH;
  const estimated = 260;
  let left = rect.left || 0;
  if (vw && left + width + 8 > vw) left = (rect.right || 0) - width;
  if (vw) left = Math.max(8, Math.min(left, Math.max(8, vw - width - 8)));
  let topPos = (rect.bottom || 0) + 8;
  if (vh && topPos + estimated > vh && (rect.top || 0) - estimated - 8 > 8) {
    topPos = rect.top - estimated - 8;
  }
  if (vh) topPos = Math.max(8, Math.min(topPos, Math.max(8, vh - 48)));
  card.style.setProperty('left', Math.round(left) + 'px');
  card.style.setProperty('top', Math.round(topPos) + 'px');

  return card;
}

export function hideCard(doc) {
  const d = renderResolveDoc(doc);
  if (!d) return null;
  const card = cardOf(d);
  if (!card) return null;
  card.classList.remove('xcp-open');
  card.setAttribute('aria-hidden', 'true');
  return card;
}

export function setLightMode(isLight, doc) {
  const d = renderResolveDoc(doc);
  if (!d) return false;
  const on = !!isLight;
  const root = d.documentElement;
  if (!root) return false;
  if (on) {
    root.classList.add('xcp-light');
    root.setAttribute('data-xcp-light', '1');
  } else {
    root.classList.remove('xcp-light');
    root.removeAttribute('data-xcp-light');
  }
  return on;
}
