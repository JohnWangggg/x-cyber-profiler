import { XCP } from './constants.js';

const TCO_RE = /(?:https?:\/\/)?t\.co\/\S+/gi;
const HAS_LINK_RE = /https?:\/\/|(?:^|\s)t\.co\//i;
const HAS_MENTION_RE = /@[A-Za-z0-9_]{1,15}/;
const HAS_EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/u;

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function ensureProfile(p) {
  if (!Array.isArray(p.seenIds)) p.seenIds = [];
  if (!Array.isArray(p.samples)) p.samples = [];
  if (!p.shortHits || typeof p.shortHits !== 'object') p.shortHits = {};
  p.sampleCount = toCount(p.sampleCount);
  p.charCount = toCount(p.charCount);
  p.spamCount = toCount(p.spamCount);
  p.failCount = toCount(p.failCount);
  if (typeof p.verified !== 'boolean') p.verified = false;
}

export function classifyText(raw) {
  const original = String(raw == null ? '' : raw);
  if (!original.trim()) return { kind: 'empty' };

  const cleaned = original
    .replace(XCP.URL_RE, ' ')
    .replace(TCO_RE, ' ')
    .replace(XCP.MENTION_RE, ' ')
    .replace(XCP.EMOJI_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length >= XCP.SHORT_MIN) return { kind: 'keep' };

  let token;
  if (!cleaned) {
    if (HAS_MENTION_RE.test(original)) token = 'mention';
    else if (HAS_EMOJI_RE.test(original)) token = 'emoji';
    else if (HAS_LINK_RE.test(original)) token = 'link';
    else token = 'blank';
  } else {
    token = cleaned.slice(0, XCP.SHORT_KEY_CAP).toLowerCase();
  }
  return { kind: 'short', token };
}

export function trimShortHits(p) {
  if (!p || !p.shortHits) return p;
  const hits = p.shortHits;
  const keys = Object.keys(hits);
  if (keys.length <= XCP.SHORT_KEY_CAP) return p;

  const ranked = keys.slice().sort((a, b) => {
    const av = Number(hits[a]) || 0;
    const bv = Number(hits[b]) || 0;
    return av - bv;
  });
  const drop = keys.length - XCP.SHORT_KEY_CAP;
  for (let i = 0; i < drop; i++) delete hits[ranked[i]];
  return p;
}

function updateIdentity(p, t) {
  let changed = false;

  if (t.displayName) {
    const name = String(t.displayName).trim().slice(0, XCP.DISPLAY_NAME_CAP);
    if (name && p.displayName !== name) {
      p.displayName = name;
      changed = true;
    }
  }
  if (t.verified === true && p.verified !== true) {
    p.verified = true;
    changed = true;
  }
  return changed;
}

function sampleLinks(t) {
  return Array.isArray(t.links) ? t.links.slice(0, XCP.LINK_CAP) : [];
}

function pushSample(p, sample, countsAsChar) {
  p.samples.push(sample);
  p.sampleCount += 1;
  if (countsAsChar) p.charCount += sample.text.length;
  while (p.samples.length > XCP.SAMPLE_CAP) p.samples.shift();
  p.updatedAt = Date.now();
}

export function ingestSample(profile, tweet) {
  const p = profile;
  const t = tweet || {};
  ensureProfile(p);

  const identityChanged = updateIdentity(p, t);
  const statusId = t.statusId;

  if (!statusId) {
    if (identityChanged) p.updatedAt = Date.now();
    return { added: false, kind: 'dup' };
  }

  const duplicate = p.seenIds.includes(statusId) ||
    p.samples.some(s => s.id === statusId);
  if (duplicate) {
    if (identityChanged) p.updatedAt = Date.now();
    return { added: false, kind: 'dup' };
  }

  p.seenIds.push(statusId);
  if (p.seenIds.length > XCP.SEEN_CAP) {
    p.seenIds.splice(0, p.seenIds.length - XCP.SEEN_CAP);
  }

  let sourceText = String(t.text == null ? '' : t.text);
  let c = classifyText(sourceText);
  if (c.kind !== 'keep' && t.cardTitle) {
    const cardClass = classifyText(t.cardTitle);
    if (cardClass.kind === 'keep') {
      sourceText = String(t.cardTitle);
      c = cardClass;
    }
  }
  if (c.kind === 'empty') return { added: false, kind: 'empty' };

  if (identityChanged) p.updatedAt = Date.now();

  if (c.kind === 'short') {
    const token = c.token;
    const hits = (toCount(p.shortHits[token]) || 0) + 1;
    p.shortHits[token] = hits;
    if (Object.keys(p.shortHits).length > XCP.SHORT_KEY_CAP) trimShortHits(p);

    if (hits % XCP.SPAM_REPEAT === 0 && p.spamCount < XCP.SPAM_SAMPLE_CAP) {
      pushSample(p, {
        id: statusId,
        text: token,
        links: sampleLinks(t),
        promoted: t.promoted === true,
        cardHost: t.cardHost || '',
        spamToken: token,
        ts: t.ts || Date.now()
      }, false);
      p.spamCount += 1;
      p.failCount = 0;
      return { added: true, kind: 'spam' };
    }
    return { added: false, kind: 'short' };
  }

  const text = sourceText.slice(0, XCP.TEXT_CAP);
  pushSample(p, {
    id: statusId,
    text,
    links: sampleLinks(t),
    promoted: t.promoted === true,
    cardHost: t.cardHost || '',
    ts: t.ts || Date.now()
  }, true);
  p.failCount = 0;
  return { added: true, kind: 'keep' };
}

export function effectiveChars(profile) {
  const p = profile || {};
  return toCount(p.charCount) + toCount(p.spamCount) * XCP.SPAM_CHAR_WEIGHT;
}

export function targetStage(profile) {
  const n = toCount(profile && profile.sampleCount);
  if (n >= 50) return Math.min(99, 8 + Math.floor((n - 50) / 20));
  for (let i = XCP.STAGES.length - 1; i >= 0; i--) {
    if (n >= XCP.STAGES[i]) return i + 1;
  }
  return 0;
}

export function cooldownFor(stage) {
  const n = toCount(stage);
  if (n >= 9) return 86400000;
  const value = XCP.STAGE_COOLDOWN_MS[n - 1];
  return value == null ? 86400000 : value;
}

export function shouldAssess(profile, force, now) {
  const p = profile || {};
  const at = typeof now === 'number' ? now : Date.now();
  const samples = Array.isArray(p.samples) ? p.samples : [];

  if (force) return samples.length > 0;
  if (!samples.length || toCount(p.failCount) >= 2) return false;
  if (at < toCount(p.cooldownUntil)) return false;

  const target = targetStage(p);
  const stage = toCount(p.stage);
  const assessment = p.assessment;
  const assessedAt = assessment ? toCount(assessment.sampleCount) : 0;

  if (target > stage) return true;

  if (p.stable) {
    const newSamples = toCount(p.sampleCount) - assessedAt;
    const elapsed = at - (assessment ? toCount(assessment.ts) : 0);
    if (newSamples >= XCP.STABLE_NEW_SAMPLES || elapsed >= XCP.STABLE_COOLDOWN_MS) return true;
  }

  return false;
}
