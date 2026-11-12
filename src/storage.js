import { XCP, DEFAULT_SETTINGS, VIBE_BY_ARCHETYPE, EVIDENCE, profileKey } from './constants.js';

const ST_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const ST_HARD_TARGET_BYTES = 6 * 1024 * 1024;

function stClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (err) {
      // Fall through to JSON clone.
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return value;
  }
}

function stIsRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stSafeKey(key) {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

function stText(value, cap) {
  if (typeof value === 'number' || typeof value === 'boolean') value = String(value);
  if (typeof value !== 'string') return '';
  let text = value.replace(XCP.CONTROL_RE, '').replace(XCP.ZERO_WIDTH_RE, '').trim();
  if (cap > 0) text = Array.from(text).slice(0, cap).join('');
  return text;
}

function stTagText(value, cap) {
  return stText(value, cap).replace(/[<>]/g, '').trim();
}

function stCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function stInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function stClamp01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

const ST_TS_MAX = 4102444800000;

function stTs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), ST_TS_MAX);
}

function stBool(value) {
  return value === true;
}

function stHandle(value) {
  if (typeof value !== 'string') return '';
  const handle = value.trim().toLowerCase();
  if (!stSafeKey(handle)) return '';
  return XCP.HANDLE_RE.test(handle) ? handle : '';
}

function stByteSize(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch (err) {
    return 0;
  }
  if (typeof text !== 'string') return 0;
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(text).length;
  }
  return text.length * 2;
}

function stIsQuotaError(err) {
  if (!err) return false;
  const name = String(err.name || '');
  const message = String(err.message || '');
  return /quota/i.test(name) || /quota|exceeded/i.test(message);
}

function stDateKey(ts) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function stGuessLang(text) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  return 'en';
}

function stLinks(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const link = item.trim();
    if (!/^https?:\/\//i.test(link)) continue;
    if (out.length >= XCP.LINK_CAP) break;
    out.push(link.slice(0, 2048));
  }
  return out;
}

function stSanitizeSample(raw) {
  if (!stIsRecord(raw)) return null;
  let id = '';
  if (typeof raw.id === 'string' || typeof raw.id === 'number') {
    id = String(raw.id).trim().slice(0, 32);
  }
  if (!id) return null;
  const text = stText(raw.text, XCP.TEXT_CAP);
  if (!text) return null;
  const sample = {
    id,
    text,
    links: stLinks(raw.links),
    promoted: stBool(raw.promoted),
    ts: stTs(raw.ts)
  };
  const cardHost = stText(raw.cardHost, XCP.CARD_TEXT_CAP);
  if (cardHost) sample.cardHost = cardHost;
  const spamToken = stText(raw.spamToken, 64);
  if (spamToken) sample.spamToken = spamToken;
  return sample;
}

function stCapSamples(value) {
  if (!Array.isArray(value)) return [];
  const byId = new Map();
  const noId = [];
  for (const item of value) {
    const sample = stSanitizeSample(item);
    if (!sample) continue;
    if (!sample.id) {
      noId.push(sample);
      continue;
    }
    const prev = byId.get(sample.id);
    if (!prev || sample.ts > prev.ts) byId.set(sample.id, sample);
  }
  const all = Array.from(byId.values()).concat(noId).sort((a, b) => b.ts - a.ts);
  const spam = [];
  const keep = [];
  for (const sample of all) {
    if (sample.spamToken) {
      if (spam.length < XCP.SPAM_SAMPLE_CAP) spam.push(sample);
    } else if (keep.length < XCP.SAMPLE_CAP) {
      keep.push(sample);
    }
    if (spam.length + keep.length >= XCP.SAMPLE_CAP) break;
  }
  return spam.concat(keep)
    .sort((a, b) => a.ts - b.ts)
    .slice(-XCP.SAMPLE_CAP);
}

function stSeenIds(value, cap) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const id = String(item).trim().slice(0, 32);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(-cap);
}

function stShortHits(value) {
  if (!stIsRecord(value)) return {};
  const entries = [];
  for (const key of Object.keys(value)) {
    if (!stSafeKey(key)) continue;
    const token = stText(key, 64);
    if (!token) continue;
    const count = stCount(value[key]);
    if (count > 0) entries.push([token, count]);
  }
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out = {};
  for (const entry of entries.slice(0, XCP.SHORT_KEY_CAP)) {
    if (!stSafeKey(entry[0])) continue;
    out[entry[0]] = entry[1];
  }
  return out;
}

function stHistory(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (!stIsRecord(item)) continue;
    const text = stTagText(item.text, XCP.LABEL_MAX_GRAPHEMES);
    if (!text) continue;
    const stage = stInt(item.stage, 0, 99, 0);
    const ts = stTs(item.ts);
    const key = text + '\u0000' + ts;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, stage, ts });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, XCP.HISTORY_CAP);
}

function stLabel(raw, fallbackTs) {
  if (!stIsRecord(raw)) return null;
  const text = stTagText(raw.text, XCP.LABEL_MAX_GRAPHEMES);
  if (!text) return null;
  const archetype = XCP.ARCHETYPES.includes(raw.archetype) ? raw.archetype : 'unknown';
  const vibe = XCP.VIBES.includes(raw.vibe)
    ? raw.vibe
    : (VIBE_BY_ARCHETYPE[archetype] || 'frost');
  const confidence = stClamp01(raw.confidence, 0);
  const reason = stTagText(raw.reason, XCP.REASON_MAX);
  const lang = XCP.LANGS.includes(raw.lang) && raw.lang !== 'auto'
    ? raw.lang
    : stGuessLang(text);
  const tone = XCP.TONES.includes(raw.tone) ? raw.tone : DEFAULT_SETTINGS.tone;
  const stage = stInt(raw.stage, 0, 99, 0);
  return {
    text,
    vibe,
    archetype,
    confidence,
    reason,
    lang,
    tone,
    stage,
    updatedAt: stTs(raw.updatedAt) || fallbackTs
  };
}

function stDistribution(value) {
  if (Array.isArray(value)) {
    const out = {};
    for (const item of value) {
      if (!stIsRecord(item)) continue;
      const key = typeof item.label === 'string' ? item.label : item.name;
      const p = item.p != null ? item.p : item.probability;
      if (typeof key === 'string' && stSafeKey(key) && XCP.ARCHETYPES.includes(key)) {
        out[key] = stClamp01(p, 0);
      }
    }
    return out;
  }
  if (!stIsRecord(value)) return {};
  const out = {};
  for (const key of Object.keys(value)) {
    if (!stSafeKey(key) || !XCP.ARCHETYPES.includes(key)) continue;
    out[key] = stClamp01(value[key], 0);
  }
  return out;
}

function stAssessment(raw) {
  if (!stIsRecord(raw)) return null;
  const source = raw.archetype || raw.classes || raw.probabilities;
  const archetype = stDistribution(source);
  const keys = Object.keys(archetype);
  if (!keys.length) return null;
  let sum = 0;
  for (const key of keys) sum += archetype[key];
  const outArchetype = {};
  for (const key of XCP.ARCHETYPES) {
    if (sum > 0) outArchetype[key] = (archetype[key] || 0) / sum;
    else outArchetype[key] = 1 / XCP.ARCHETYPES.length;
  }
  const traits = {};
  const rawTraits = stIsRecord(raw.traits) ? raw.traits : {};
  for (const key of XCP.TRAITS) {
    traits[key] = stClamp01(rawTraits[key], 0);
  }
  let top = 0;
  for (const key of XCP.ARCHETYPES) {
    if (outArchetype[key] > top) top = outArchetype[key];
  }
  const evidence = [];
  if (Array.isArray(raw.evidence)) {
    for (const item of raw.evidence) {
      if (typeof item === 'string' && EVIDENCE.includes(item) && !evidence.includes(item)) {
        evidence.push(item);
      }
      if (evidence.length >= 8) break;
    }
  }
  return {
    archetype: outArchetype,
    traits,
    valence: stClamp01(raw.valence, 0.5),
    energy: stClamp01(raw.energy, 0.5),
    confidence: stClamp01(raw.confidence, top),
    evidence,
    model: stText(raw.model, 64),
    sampleCount: stCount(raw.sampleCount),
    ts: stTs(raw.ts)
  };
}

function stEmptyProfile(handle, ts) {
  return {
    v: 3,
    handle,
    displayName: '',
    verified: false,
    lang: '',
    sampleCount: 0,
    charCount: 0,
    spamCount: 0,
    samples: [],
    seenIds: [],
    shortHits: {},
    dossier: '',
    hidden: false,
    history: [],
    stage: 0,
    cooldownUntil: 0,
    stable: false,
    failCount: 0,
    createdAt: ts,
    updatedAt: ts
  };
}

function stProfile(raw, handle, keepInternals, nowTs) {
  if (!stIsRecord(raw)) return null;
  const h = stHandle(handle);
  if (!h) return null;
  const rv = stInt(raw.v, 0, 999, 0);
  const legacy = rv === 1 || rv === 2 || (rv === 0 && (Array.isArray(raw.tags) || raw.level != null));
  if (!legacy && rv !== 0 && rv !== 3) return null;

  const samples = stCapSamples(raw.samples);
  const keepLength = samples.reduce((n, s) => (s.spamToken ? n : n + s.text.length), 0);
  const spamSamples = samples.filter((s) => !!s.spamToken).length;
  let sampleCount = Math.max(stCount(raw.sampleCount), samples.length);
  let charCount = Math.max(stCount(raw.charCount), keepLength);
  let spamCount = Math.min(XCP.SPAM_SAMPLE_CAP, Math.max(stCount(raw.spamCount), spamSamples));
  let ts = stTs(raw.updatedAt);
  let createdAt = stCount(raw.createdAt) || ts || nowTs;
  if (!ts) ts = createdAt;
  if (createdAt > ts) createdAt = ts;

  let stage = stInt(raw.stage, 0, 99, 0);
  let label = null;
  let dossier = stTagText(raw.dossier, XCP.DOSSIER_MAX);
  let hidden = stBool(raw.hidden);
  let history = stHistory(raw.history);
  const assessment = stAssessment(raw.assessment);

  if (legacy) {
    const reason = stTagText(raw.reason, XCP.REASON_MAX);
    stage = stInt(raw.level, 0, 99, stage);
    label = stLabel(raw.label, ts);
    if (!label && Array.isArray(raw.tags)) {
      for (const tag of raw.tags) {
        if (!stIsRecord(tag)) continue;
        const text = stTagText(tag.text, XCP.LABEL_MAX_GRAPHEMES);
        if (!text) continue;
        const category = XCP.ARCHETYPES.includes(tag.category) ? tag.category : 'unknown';
        label = {
          text,
          vibe: VIBE_BY_ARCHETYPE[category] || 'frost',
          archetype: category,
          confidence: stClamp01(tag.confidence, 0),
          reason,
          lang: stGuessLang(text),
          tone: DEFAULT_SETTINGS.tone,
          stage,
          updatedAt: ts
        };
        break;
      }
    }
    if (label) stage = Math.max(stage, label.stage);
    if (!label && stage > 0) stage = Math.max(0, stage);
    dossier = reason;
    hidden = false;
    history = [];
  } else {
    label = stLabel(raw.label, ts);
    if (label) stage = Math.max(stage, label.stage);
  }

  const out = {
    v: 3,
    handle: h,
    displayName: stText(raw.displayName, XCP.DISPLAY_NAME_CAP),
    verified: stBool(raw.verified),
    lang: XCP.LANGS.includes(raw.lang) && raw.lang !== 'auto' ? raw.lang : '',
    sampleCount,
    charCount,
    spamCount,
    samples,
    seenIds: keepInternals ? stSeenIds(raw.seenIds, XCP.SEEN_CAP) : [],
    shortHits: keepInternals ? stShortHits(raw.shortHits) : {},
    dossier,
    hidden,
    history,
    stage,
    cooldownUntil: Math.min(stCount(raw.cooldownUntil), nowTs + 7 * 864e5),
    stable: stBool(raw.stable),
    failCount: stInt(raw.failCount, 0, 9, 0),
    createdAt,
    updatedAt: ts
  };
  if (assessment) out.assessment = assessment;
  if (label) out.label = label;
  return out;
}

function stArr(value) {
  return Array.isArray(value) ? value : [];
}

function stUnionSamples(a, b) {
  return stCapSamples(stArr(a).concat(stArr(b)));
}

function stMergeHits(a, b) {
  const left = stShortHits(a);
  const right = stShortHits(b);
  const out = {};
  for (const key of Object.keys(left)) {
    if (stSafeKey(key)) out[key] = left[key];
  }
  for (const key of Object.keys(right)) {
    if (!stSafeKey(key)) continue;
    out[key] = Math.max(stCount(out[key]), right[key]);
  }
  return stShortHits(out);
}

function stPickLabel(a, b) {
  if (!a.label) return { label: b.label || null, fromA: false };
  if (!b.label) return { label: a.label, fromA: true };
  const aStage = stInt(a.label.stage, 0, 99, 0);
  const bStage = stInt(b.label.stage, 0, 99, 0);
  if (aStage !== bStage) return aStage > bStage ? { label: a.label, fromA: true } : { label: b.label, fromA: false };
  const aTs = stTs(a.label.updatedAt);
  const bTs = stTs(b.label.updatedAt);
  if (aTs !== bTs) return aTs > bTs ? { label: a.label, fromA: true } : { label: b.label, fromA: false };
  return (stTs(a.updatedAt) >= stTs(b.updatedAt))
    ? { label: a.label, fromA: true }
    : { label: b.label, fromA: false };
}

function stPickAssessment(a, b) {
  if (!a.assessment) return b.assessment ? stClone(b.assessment) : null;
  if (!b.assessment) return stClone(a.assessment);
  const ats = stTs(a.assessment.ts);
  const bts = stTs(b.assessment.ts);
  if (ats !== bts) return stClone(ats > bts ? a.assessment : b.assessment);
  return stClone(stTs(a.updatedAt) >= stTs(b.updatedAt) ? a.assessment : b.assessment);
}

function stMerge(a, b) {
  if (!a) return b ? stClone(b) : null;
  if (!b) return stClone(a);
  const newer = stTs(a.updatedAt) >= stTs(b.updatedAt) ? a : b;
  const older = newer === a ? b : a;
  const picked = stPickLabel(a, b);
  const samples = stUnionSamples(a.samples, b.samples);
  const keepLength = samples.reduce((n, s) => (s.spamToken ? n : n + s.text.length), 0);
  const spamSamples = samples.filter((s) => !!s.spamToken).length;
  const assessment = stPickAssessment(a, b);
  const label = picked.label;
  const labelDossier = picked.fromA ? a.dossier : b.dossier;
  const otherDossier = picked.fromA ? b.dossier : a.dossier;
  const dossier = stTagText(labelDossier, XCP.DOSSIER_MAX) || stTagText(otherDossier, XCP.DOSSIER_MAX);
  let stage = Math.max(
    stInt(a.stage, 0, 99, 0),
    stInt(b.stage, 0, 99, 0),
    label ? stInt(label.stage, 0, 99, 0) : 0
  );
  stage = Math.min(99, stage);
  const createdAtA = stCount(a.createdAt);
  const createdAtB = stCount(b.createdAt);
  let createdAt;
  if (createdAtA && createdAtB) createdAt = Math.min(createdAtA, createdAtB);
  else createdAt = createdAtA || createdAtB || 0;
  const out = {
    v: 3,
    handle: a.handle || b.handle,
    displayName: stText(newer.displayName, XCP.DISPLAY_NAME_CAP) || stText(older.displayName, XCP.DISPLAY_NAME_CAP),
    verified: stBool(a.verified) || stBool(b.verified),
    lang: (XCP.LANGS.includes(newer.lang) && newer.lang !== 'auto' ? newer.lang : '')
      || (XCP.LANGS.includes(older.lang) && older.lang !== 'auto' ? older.lang : ''),
    sampleCount: Math.max(stCount(a.sampleCount), stCount(b.sampleCount), samples.length),
    charCount: Math.max(stCount(a.charCount), stCount(b.charCount), keepLength),
    spamCount: Math.min(XCP.SPAM_SAMPLE_CAP, Math.max(stCount(a.spamCount), stCount(b.spamCount), spamSamples)),
    samples,
    seenIds: stSeenIds(stArr(a.seenIds).concat(stArr(b.seenIds)), XCP.SEEN_CAP),
    shortHits: stMergeHits(a.shortHits, b.shortHits),
    dossier,
    hidden: stBool(newer.hidden),
    history: stHistory(stArr(a.history).concat(stArr(b.history))),
    stage,
    cooldownUntil: Math.max(stCount(a.cooldownUntil), stCount(b.cooldownUntil)),
    stable: stBool(newer.stable),
    failCount: Math.min(
      stInt(a.failCount, 0, 9, 0),
      stInt(b.failCount, 0, 9, 0)
    ),
    createdAt,
    updatedAt: Math.max(stTs(a.updatedAt), stTs(b.updatedAt))
  };
  if (assessment) out.assessment = assessment;
  if (label) out.label = label;
  return out;
}

function stAssign(target, source) {
  for (const key of Object.keys(target)) {
    if (!stSafeKey(key)) continue;
    delete target[key];
  }
  for (const key of Object.keys(source)) {
    if (!stSafeKey(key)) continue;
    target[key] = stClone(source[key]);
  }
  return target;
}

function stExportProfile(profile, nowTs) {
  const safe = stProfile(profile, profile.handle, false, nowTs);
  if (!safe) return null;
  const out = {
    v: 3,
    handle: safe.handle,
    displayName: safe.displayName,
    verified: safe.verified,
    lang: safe.lang,
    sampleCount: safe.sampleCount,
    charCount: safe.charCount,
    spamCount: safe.spamCount,
    samples: safe.samples,
    dossier: safe.dossier,
    hidden: safe.hidden,
    history: safe.history,
    stage: safe.stage,
    cooldownUntil: safe.cooldownUntil,
    stable: safe.stable,
    failCount: safe.failCount,
    createdAt: safe.createdAt,
    updatedAt: safe.updatedAt
  };
  if (safe.assessment) out.assessment = safe.assessment;
  if (safe.label) out.label = safe.label;
  return out;
}

function stMergeSettings(saved) {
  const merged = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) merged[key] = stClone(DEFAULT_SETTINGS[key]);
  if (stIsRecord(saved)) {
    for (const key of Object.keys(saved)) {
      if (!stSafeKey(key)) continue;
      merged[key] = stClone(saved[key]);
    }
  }
  return merged;
}

export function createStorage(gm, opts) {
  const options = stIsRecord(opts) ? opts : {};
  const clock = typeof options.now === 'function'
    ? options.now
    : (typeof options.now === 'number' ? () => options.now : () => Date.now());
  const setTimer = typeof options.setTimeout === 'function'
    ? options.setTimeout
    : (fn, ms) => setTimeout(fn, ms);
  const clearTimer = typeof options.clearTimeout === 'function'
    ? options.clearTimeout
    : (id) => clearTimeout(id);
  const memCap = Number.isFinite(options.memCap) && options.memCap > 0
    ? Math.floor(options.memCap)
    : XCP.MEM_PROFILE_CAP;

  let index = [];
  let epochNum = 0;
  let settings = stMergeSettings(null);
  let stats = { bytes: 0, count: 0 };
  let profileBytes = 0;
  let usage = null;
  let indexDirty = false;
  let statsDirty = false;
  let usageDirty = false;
  let quotaFailed = false;
  let timer = null;

  const profiles = new Map();
  const dirty = new Set();
  const sizes = new Map();
  const tombstones = new Set();

  function now() {
    const value = Number(clock());
    return Number.isFinite(value) ? Math.floor(value) : Date.now();
  }

  function cancelTimer() {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function schedule() {
    if (timer != null) return;
    timer = setTimer(() => {
      timer = null;
      try {
        flush();
      } catch (err) {
        console.error('[xcp]', err && err.name ? err.name : err);
      }
    }, XCP.PERSIST_DEBOUNCE_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function estimateBytes() {
    return Math.max(0, profileBytes + (index.length ? stByteSize(index) : 0));
  }

  function touch(handle) {
    const profile = profiles.get(handle);
    if (!profile) return;
    profiles.delete(handle);
    profiles.set(handle, profile);
  }

  function rememberSize(handle, profile) {
    const size = stByteSize(profile);
    const old = sizes.get(handle);
    sizes.set(handle, size);
    if (old == null) profileBytes += size;
    else profileBytes = Math.max(0, profileBytes + size - old);
    return size;
  }

  function cacheLoaded(handle, profile) {
    profiles.set(handle, profile);
    if (!sizes.has(handle)) sizes.set(handle, stByteSize(profile));
    touch(handle);
    enforceMem();
  }

  function writeProfile(handle, profile) {
    const raw = gm.get(profileKey(handle), null);
    if (stIsRecord(raw)) {
      const stored = stProfile(raw, handle, true, now());
      if (stored) {
        const merged = stMerge(profile, stored);
        if (merged) stAssign(profile, merged);
      }
    }
    const size = stByteSize(profile);
    const old = sizes.get(handle);
    sizes.set(handle, size);
    if (old == null) profileBytes += size;
    else profileBytes = Math.max(0, profileBytes + size - old);
    statsDirty = true;
    gm.set(profileKey(handle), stClone(profile));
    dirty.delete(handle);
  }

  function enforceMem() {
    while (profiles.size > memCap) {
      const handles = Array.from(profiles.keys());
      let removed = false;
      for (const handle of handles) {
        if (profiles.size <= memCap) break;
        if (dirty.has(handle)) {
          try {
            writeProfile(handle, profiles.get(handle));
          } catch (err) {
            if (stIsQuotaError(err)) continue;
            throw err;
          }
          if (dirty.has(handle)) continue;
        }
        profiles.delete(handle);
        removed = true;
      }
      if (!removed) break;
    }
  }

  function loadIndex(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    const seen = new Set();
    for (const item of value) {
      const handle = stHandle(typeof item === 'string' ? item : '');
      if (!handle || seen.has(handle)) continue;
      seen.add(handle);
      out.push(handle);
    }
    return out;
  }

  function writeIndex() {
    const remote = gm.get(XCP.KEY_INDEX, null);
    const next = index.slice();
    const seen = new Set(next);
    if (Array.isArray(remote)) {
      for (const item of remote) {
        const handle = stHandle(typeof item === 'string' ? item : '');
        if (!handle || seen.has(handle) || tombstones.has(handle)) continue;
        if (next.length >= XCP.PROFILE_HARD_LIMIT) break;
        seen.add(handle);
        next.push(handle);
      }
    }
    gm.set(XCP.KEY_INDEX, stClone(next));
    index = next;
    indexDirty = false;
  }

  function readProfile(handle) {
    if (profiles.has(handle)) return profiles.get(handle);
    const raw = gm.get(profileKey(handle), null);
    if (!stIsRecord(raw)) return null;
    const profile = stProfile(raw, handle, true, now());
    if (!profile) return null;
    return profile;
  }

  function evictBatch() {
    if (!index.length) return 0;
    const candidates = [];
    for (const handle of index) {
      if (dirty.has(handle)) continue;
      const profile = profiles.get(handle) || readProfile(handle);
      if (!profile) {
        candidates.push({ handle, priority: 0, stage: 0, stable: false, updatedAt: 0, size: 0 });
        continue;
      }
      const stage = stInt(profile.stage, 0, 99, 0);
      const hasLabel = !!(profile.label && profile.label.text);
      let priority;
      if (profile.stable || stage >= 4) priority = 2;
      else if (!hasLabel && stage < 2) priority = 0;
      else priority = 1;
      candidates.push({
        handle,
        priority,
        stage,
        stable: stBool(profile.stable),
        updatedAt: stTs(profile.updatedAt),
        size: sizes.has(handle) ? sizes.get(handle) : stByteSize(profile)
      });
    }
    candidates.sort((a, b) => (
      a.priority - b.priority
      || (a.stable ? 1 : 0) - (b.stable ? 1 : 0)
      || a.stage - b.stage
      || a.updatedAt - b.updatedAt
      || a.handle.localeCompare(b.handle)
    ));
    const batch = Math.max(1, Math.ceil(index.length * 0.1));
    const chosen = new Set(candidates.slice(0, batch).map((item) => item.handle));
    for (const item of candidates.slice(0, batch)) {
      try {
        gm.del(profileKey(item.handle));
      } catch (err) {
        if (!stIsQuotaError(err)) throw err;
      }
      profiles.delete(item.handle);
      dirty.delete(item.handle);
      sizes.delete(item.handle);
      tombstones.add(item.handle);
      profileBytes = Math.max(0, profileBytes - item.size);
    }
    index = index.filter((handle) => !chosen.has(handle));
    indexDirty = true;
    statsDirty = true;
    quotaFailed = false;
    return chosen.size;
  }

  function preflightBytes() {
    let bytes = estimateBytes();
    if (bytes > XCP.BYTES_HARD_LIMIT) {
      console.warn('[xcp] storage hard limit');
      let guard = 0;
      while (bytes > ST_HARD_TARGET_BYTES && guard < 100) {
        if (!evictBatch()) break;
        bytes = estimateBytes();
        guard += 1;
      }
    } else if (bytes > XCP.BYTES_SOFT_LIMIT) {
      console.warn('[xcp] storage soft limit');
      evictBatch();
    }
  }

  function flushPass() {
    for (const handle of Array.from(dirty)) {
      const profile = profiles.get(handle);
      if (!profile) {
        dirty.delete(handle);
        continue;
      }
      writeProfile(handle, profile);
    }
    if (indexDirty) writeIndex();
    if (statsDirty) {
      stats = { bytes: estimateBytes(), count: index.length };
      gm.set(XCP.KEY_STATS, { bytes: stats.bytes, count: stats.count });
      statsDirty = false;
    }
    if (usageDirty && usage) {
      const today = stDateKey(now());
      if (usage.date !== today) usage = { date: today, count: 0, base: 0, delta: 0 };
      const remote = gm.get(XCP.KEY_USAGE, null);
      if (stIsRecord(remote) && remote.date === usage.date) {
        usage.base = Math.max(usage.base, stCount(remote.count));
      }
      usage.count = usage.base + usage.delta;
      gm.set(XCP.KEY_USAGE, { date: usage.date, count: usage.count });
      usage.base = usage.count;
      usage.delta = 0;
      usageDirty = false;
    }
  }

  function flush() {
    cancelTimer();
    if (!dirty.size && !indexDirty && !statsDirty && !usageDirty) return true;
    preflightBytes();
    let retried = false;
    for (;;) {
      try {
        flushPass();
        quotaFailed = false;
        return true;
      } catch (err) {
        if (!stIsQuotaError(err)) throw err;
        quotaFailed = true;
        if (retried) return false;
        retried = true;
        if (!evictBatch()) return false;
      }
    }
  }

  function init() {
    cancelTimer();
    profiles.clear();
    dirty.clear();
    sizes.clear();
    tombstones.clear();
    index = loadIndex(gm.get(XCP.KEY_INDEX, []));
    epochNum = stCount(gm.get(XCP.KEY_EPOCH, 0));
    const storedStats = gm.get(XCP.KEY_STATS, null);
    if (stIsRecord(storedStats)) {
      stats = {
        bytes: stCount(storedStats.bytes),
        count: stCount(storedStats.count)
      };
      profileBytes = Math.max(0, stats.bytes - stByteSize(index));
    } else {
      stats = { bytes: 0, count: index.length };
      profileBytes = 0;
    }
    settings = stMergeSettings(gm.get(XCP.KEY_SETTINGS, {}));
    indexDirty = false;
    statsDirty = false;
    usageDirty = false;
    quotaFailed = false;
    usage = null;
    return true;
  }

  function peek(rawHandle) {
    const handle = stHandle(rawHandle);
    if (!handle) return null;
    if (profiles.has(handle)) {
      touch(handle);
      return profiles.get(handle);
    }
    const raw = gm.get(profileKey(handle), null);
    if (!stIsRecord(raw)) return null;
    const profile = stProfile(raw, handle, true, now());
    if (!profile) {
      try {
        gm.set(XCP.KEY_LEGACY, { handle, raw: stClone(raw), ts: now() });
      } catch (err) {
        if (!stIsQuotaError(err)) throw err;
      }
      return null;
    }
    cacheLoaded(handle, profile);
    const rv = stInt(raw.v, 0, 999, 0);
    if (rv !== 3) {
      dirty.add(handle);
      statsDirty = true;
      schedule();
    }
    return profile;
  }

  function get(rawHandle) {
    const handle = stHandle(rawHandle);
    if (!handle) return null;
    if (profiles.has(handle)) {
      touch(handle);
      return profiles.get(handle);
    }
    const existing = peek(handle);
    if (existing) return existing;
    const profile = stEmptyProfile(handle, now());
    profiles.set(handle, profile);
    touch(handle);
    enforceMem();
    return profiles.get(handle) || profile;
  }

  function commit(profile) {
    if (!stIsRecord(profile)) return false;
    const handle = stHandle(profile.handle);
    if (!handle) return false;
    if (profile.handle !== handle) profile.handle = handle;
    if (profile.v !== 3) profile.v = 3;
    tombstones.delete(handle);
    const inIndex = index.includes(handle);
    if (!inIndex && index.length >= XCP.PROFILE_HARD_LIMIT) return false;
    let oldSize = sizes.has(handle) ? sizes.get(handle) : null;
    if (oldSize == null && inIndex && !profiles.has(handle)) {
      const raw = gm.get(profileKey(handle), null);
      if (stIsRecord(raw)) oldSize = stByteSize(raw);
    }
    profiles.delete(handle);
    profiles.set(handle, profile);
    const size = stByteSize(profile);
    sizes.set(handle, size);
    if (oldSize == null) profileBytes += size;
    else profileBytes = Math.max(0, profileBytes + size - oldSize);
    if (!inIndex) {
      index.push(handle);
      indexDirty = true;
    }
    dirty.add(handle);
    statsDirty = true;
    schedule();
    enforceMem();
    return true;
  }

  function remove(rawHandle) {
    const handle = stHandle(rawHandle);
    if (!handle) return false;
    const at = index.indexOf(handle);
    let existed = at >= 0 || profiles.has(handle);
    profiles.delete(handle);
    dirty.delete(handle);
    let size = sizes.has(handle) ? sizes.get(handle) : null;
    if (size == null) {
      const raw = gm.get(profileKey(handle), null);
      if (stIsRecord(raw)) {
        size = stByteSize(raw);
        existed = true;
      }
    }
    if (size != null) profileBytes = Math.max(0, profileBytes - size);
    sizes.delete(handle);
    try {
      gm.del(profileKey(handle));
    } catch (err) {
      if (!stIsQuotaError(err)) throw err;
    }
    if (at >= 0) index.splice(at, 1);
    if (at >= 0 || existed) {
      tombstones.add(handle);
      indexDirty = true;
      try {
        writeIndex();
      } catch (err) {
        if (!stIsQuotaError(err)) throw err;
        indexDirty = true;
        schedule();
      }
    }
    statsDirty = true;
    schedule();
    return existed;
  }

  function clearAll() {
    cancelTimer();
    const handles = new Set(index.concat(Array.from(profiles.keys())));
    for (const handle of handles) {
      try {
        gm.del(profileKey(handle));
      } catch (err) {
        if (!stIsQuotaError(err)) throw err;
      }
    }
    if (usageDirty && usage) {
      try {
        gm.set(XCP.KEY_USAGE, { date: usage.date, count: usage.count });
        usage.base = usage.count;
        usage.delta = 0;
        usageDirty = false;
      } catch (err) {
        if (!stIsQuotaError(err)) throw err;
      }
    }
    index = [];
    profiles.clear();
    dirty.clear();
    sizes.clear();
    tombstones.clear();
    profileBytes = 0;
    stats = { bytes: 0, count: 0 };
    indexDirty = false;
    statsDirty = false;
    quotaFailed = false;
    try {
      gm.del(XCP.KEY_INDEX);
      gm.del(XCP.KEY_STATS);
    } catch (err) {
      if (!stIsQuotaError(err)) throw err;
    }
    epochNum = stCount(epochNum) + 1;
    gm.set(XCP.KEY_EPOCH, epochNum);
    return handles.size;
  }

  function loadSettings() {
    settings = stMergeSettings(gm.get(XCP.KEY_SETTINGS, {}));
    return stClone(settings);
  }

  function saveSettings(partial) {
    const next = loadSettings();
    if (stIsRecord(partial)) {
      for (const key of Object.keys(partial)) {
        if (!stSafeKey(key)) continue;
        next[key] = stClone(partial[key]);
      }
    }
    gm.set(XCP.KEY_SETTINGS, stClone(next));
    settings = stClone(next);
    return stClone(settings);
  }

  function exportJSON() {
    const exportedAt = now();
    const list = [];
    for (const handle of index) {
      const profile = peek(handle);
      if (!profile) continue;
      const safe = stExportProfile(profile, exportedAt);
      if (safe) list.push(safe);
    }
    return JSON.stringify({
      app: 'x-cyber-profiler',
      v: XCP.EXPORT_VERSION,
      exportedAt,
      profiles: list
    });
  }

  function importJSON(text) {
    if (typeof text !== 'string') {
      const err = new Error('import: text required');
      err.code = 'ERR_IMPORT_TEXT';
      throw err;
    }
    if (stByteSize(text) > ST_IMPORT_MAX_BYTES) {
      const err = new Error('import: file too large');
      err.code = 'ERR_IMPORT_SIZE';
      throw err;
    }
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (err) {
      const next = new Error('import: invalid json');
      next.code = 'ERR_IMPORT_JSON';
      throw next;
    }
    if (!stIsRecord(doc)) {
      const err = new Error('import: invalid document');
      err.code = 'ERR_IMPORT_DOC';
      throw err;
    }
    const version = doc.v == null ? 2 : stInt(doc.v, 0, 999, 0);
    if (version !== 1 && version !== 2) {
      const err = new Error('import: unsupported version');
      err.code = 'ERR_IMPORT_VERSION';
      throw err;
    }
    if (!Array.isArray(doc.profiles)) {
      const err = new Error('import: profiles required');
      err.code = 'ERR_IMPORT_PROFILES';
      throw err;
    }
    if (doc.profiles.length > XCP.PROFILE_HARD_LIMIT) {
      const err = new Error('import: too many profiles');
      err.code = 'ERR_IMPORT_COUNT';
      throw err;
    }
    const ts = now();
    const staged = new Map();
    let skipped = 0;
    for (const raw of doc.profiles) {
      if (!stIsRecord(raw)) {
        skipped += 1;
        continue;
      }
      const handle = stHandle(raw.handle);
      if (!handle) {
        skipped += 1;
        continue;
      }
      const profile = stProfile(raw, handle, false, ts);
      if (!profile) {
        skipped += 1;
        continue;
      }
      profile.hidden = false;
      profile.cooldownUntil = 0;
      profile.stable = false;
      profile.failCount = 0;
      const cap = ts + 7 * 864e5;
      profile.updatedAt = Math.min(profile.updatedAt, cap);
      profile.createdAt = Math.min(profile.createdAt, profile.updatedAt);
      if (profile.label) profile.label.updatedAt = Math.min(profile.label.updatedAt, cap);
      if (profile.assessment) profile.assessment.ts = Math.min(profile.assessment.ts, cap);
      profile.history = (profile.history || []).map((item) => ({
        ...item,
        ts: Math.min(item.ts, cap)
      }));
      staged.set(handle, profile);
    }
    let imported = 0;
    for (const entry of staged) {
      const handle = entry[0];
      const incoming = entry[1];
      const at = index.indexOf(handle);
      if (at < 0 && index.length >= XCP.PROFILE_HARD_LIMIT) {
        skipped += 1;
        continue;
      }
      const local = profiles.has(handle) ? profiles.get(handle) : peek(handle);
      let live;
      if (local) {
        if (stTs(local.updatedAt) > stTs(incoming.updatedAt)) {
          skipped += 1;
          continue;
        }
        const merged = stMerge(local, incoming);
        stAssign(local, merged);
        live = local;
      } else {
        live = stClone(incoming);
      }
      if (at < 0) {
        index.push(handle);
        indexDirty = true;
      }
      tombstones.delete(handle);
      profiles.delete(handle);
      profiles.set(handle, live);
      dirty.add(handle);
      rememberSize(handle, live);
      imported += 1;
      statsDirty = true;
    }
    if (imported > 0) {
      enforceMem();
      schedule();
    }
    return { imported, skipped };
  }

  function getUsage() {
    const today = stDateKey(now());
    if (!usage) {
      const raw = gm.get(XCP.KEY_USAGE, null);
      const base = stIsRecord(raw) && raw.date === today ? stCount(raw.count) : 0;
      usage = { date: today, count: base, base, delta: 0 };
      if (stIsRecord(raw) && raw.date !== today) usageDirty = true;
    } else if (usage.date !== today) {
      const raw = gm.get(XCP.KEY_USAGE, null);
      const base = stIsRecord(raw) && raw.date === today ? stCount(raw.count) : 0;
      usage = { date: today, count: base, base, delta: 0 };
      usageDirty = true;
    }
    return { date: usage.date, count: usage.count };
  }

  function bumpUsage(amount) {
    getUsage();
    const n = Number(amount);
    const delta = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
    usage.count += delta;
    usage.delta += delta;
    usageDirty = true;
    schedule();
    return { date: usage.date, count: usage.count };
  }

  function getStats() {
    const out = { bytes: estimateBytes(), count: index.length };
    if (quotaFailed) out.quota = true;
    return out;
  }

  function mergeRemote(remote) {
    if (!stIsRecord(remote)) return null;
    const handle = stHandle(remote.handle);
    if (!handle) return null;
    const incoming = stProfile(remote, handle, true, now());
    if (!incoming) return null;
    const at = index.indexOf(handle);
    if (!profiles.has(handle) && at < 0) return null;
    const local = profiles.has(handle) ? profiles.get(handle) : peek(handle);
    if (!local) {
      if (at < 0) return null;
      cacheLoaded(handle, incoming);
      return incoming;
    }
    const merged = dirty.has(handle) ? stMerge(local, incoming) : stClone(incoming);
    if (merged) stAssign(local, merged);
    touch(handle);
    sizes.set(handle, stByteSize(local));
    return local;
  }

  function listProfiles() {
    return index.slice();
  }

  function epoch() {
    return epochNum;
  }

  return {
    init,
    peek,
    get,
    commit,
    flush,
    remove,
    clearAll,
    loadSettings,
    saveSettings,
    exportJSON,
    importJSON,
    bumpUsage,
    getUsage,
    getStats,
    mergeRemote,
    listProfiles,
    epoch
  };
}
