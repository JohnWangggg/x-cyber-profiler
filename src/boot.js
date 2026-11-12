import { XCP, profileKey } from './constants.js';
import { SEL } from './selectors.js';
import { createStorage } from './storage.js';
import { ingestSample, shouldAssess, targetStage, cooldownFor } from './sample.js';
import { buildJevPayload, normalizeAssessment, sameArchetype, sameTopTrait } from './assess.js';
import { resolveLang, resolveTone, buildNameMessages, buildCombinedMessages, normalizeLabel, normalizeCombined, shouldRename, composeLabel } from './name.js';
import { createQueue } from './queue.js';
import { effectiveMode } from './providers.js';
import { createLLM, parseModelJson } from './llm.js';
import { extractTweet, fastIdentity, ownHandle } from './extract.js';
import { createWatcher } from './observe.js';
import { injectStyles, renderBadges, renderAllForHandle, removeAllBadges, removeBadges, bindRepair, initInteractions, setLightMode, hideCard } from './render.js';
import { registerMenu, showToast, openSettings } from './menu.js';

let storage = null;
let settings = null;
let queue = null;
let llm = null;
let watcher = null;
let interactions = null;
let started = false;

const inFlight = new Map();
const repairs = new WeakMap();
const storageOffs = [];
const profileSubs = new Map();
let limitToastShown = false;
let regionToastShown = false;
let ownHandleCache = { value: '', at: 0 };
let authPaused = false;
let authToastShown = false;
let autoPausedUntil = 0;
let globalPauseToastShown = false;
let consecutiveFailures = 0;

function gmAdapter() {
  return {
    get(key, fallback) { return GM_getValue(key, fallback); },
    set(key, value) { GM_setValue(key, value); },
    del(key) { GM_deleteValue(key); },
    onChange(key, cb) {
      if (typeof GM_addValueChangeListener !== 'function') return () => {};
      const id = GM_addValueChangeListener(key, (name, oldValue, newValue, remote) => {
        cb(name, oldValue, newValue, remote);
      });
      return () => {
        if (typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(id);
      };
    }
  };
}

function gmTransport(options) {
  return new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest !== 'function') {
      reject(Object.assign(new Error('GM_xmlhttpRequest unavailable'), { code: 'NO_TRANSPORT' }));
      return;
    }
    GM_xmlhttpRequest({
      method: options.method || 'POST',
      url: options.url,
      headers: options.headers || {},
      data: options.body,
      timeout: options.timeout || XCP.REQUEST_TIMEOUT_MS,
      onload(res) {
        const text = res.responseText || '';
        const headers = res.responseHeaders || '';
        const lengthMatch = String(headers).match(/(?:^|\n)content-length:\s*(\d+)/i);
        if (lengthMatch && Number(lengthMatch[1]) > XCP.RESPONSE_MAX_BYTES) {
          reject(Object.assign(new Error('response too large'), { code: 'TOO_LARGE' }));
          return;
        }
        let bytes = text.length;
        try { bytes = new TextEncoder().encode(text).length; } catch (e) { /* ignore */ }
        if (bytes > XCP.RESPONSE_MAX_BYTES) {
          reject(Object.assign(new Error('response too large'), { code: 'TOO_LARGE' }));
          return;
        }
        if (res.finalUrl) {
          try {
            const host = new URL(res.finalUrl).hostname.toLowerCase().replace(/\.$/, '');
            if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) {
              reject(Object.assign(new Error('redirected to X'), { code: 'BAD_REDIRECT' }));
              return;
            }
          } catch (e) { /* ignore */ }
        }
        resolve({ status: res.status, responseText: text, headers });
      },
      onerror() {
        reject(Object.assign(new Error('network error'), { code: 'NETWORK' }));
      },
      ontimeout() {
        reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }));
      }
    });
  });
}

function hasAnyKey(s) {
  return effectiveMode(s) !== 'none';
}

function isLightMode() {
  try {
    const bg = getComputedStyle(document.body).backgroundColor || '';
    const m = bg.match(/rgba?\((\d+)\D+(\d+)\D+(\d+)/);
    if (!m) return false;
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return (r * 299 + g * 587 + b * 114) / 1000 > 160;
  } catch (e) {
    return false;
  }
}

function currentOwnHandle() {
  const now = Date.now();
  if (now - ownHandleCache.at < 30000) return ownHandleCache.value;
  ownHandleCache = { value: ownHandle(document), at: now };
  return ownHandleCache.value;
}

function usageLeft(manual) {
  const budget = Number(settings.dailyBudget) || 0;
  if (!budget) return true;
  const usage = storage.getUsage();
  const extra = manual ? XCP.MANUAL_BUDGET_EXTRA : 0;
  return (usage.count || 0) < budget + extra;
}

function canSpend(manual) {
  if (!settings || !settings.enabled) return false;
  if (!hasAnyKey(settings)) return false;
  if (!manual && authPaused) return false;
  if (!manual && Date.now() < autoPausedUntil) return false;
  return usageLeft(manual);
}

async function request(fn, manual) {
  if (!canSpend(manual)) {
    throw Object.assign(new Error('budget or paused'), { code: 'BUDGET' });
  }
  storage.bumpUsage();
  return fn();
}

function noteAuthPause() {
  authPaused = true;
  if (!authToastShown) {
    authToastShown = true;
    showToast('评估/起名接口鉴权失败，自动打标已暂停；修改设置后恢复', document);
  }
}

function noteFailure(profile, err) {
  if (err && err.status === 451) {
    autoPausedUntil = Date.now() + XCP.GLOBAL_PAUSE_MS;
    if (!regionToastShown) {
      regionToastShown = true;
      showToast('Jev 在当前网络区域不可用，请换网络/代理或自建转发', document);
    }
    return;
  }
  if (err && (err.status === 401 || err.status === 403 || err.status === 404)) {
    noteAuthPause();
    return;
  }
  if (err && err.code === 'BUDGET') return;

  profile.failCount = Math.min(9, (profile.failCount || 0) + 1);
  profile.cooldownUntil = Date.now() + 600000;
  profile.updatedAt = Date.now();
  commitProfile(profile);

  consecutiveFailures += 1;
  if (consecutiveFailures >= XCP.GLOBAL_FAIL_MAX && Date.now() >= autoPausedUntil) {
    autoPausedUntil = Date.now() + XCP.GLOBAL_PAUSE_MS;
    if (!globalPauseToastShown) {
      globalPauseToastShown = true;
      showToast('连续失败，自动打标暂停 10 分钟', document);
    }
  }
  console.error('[xcp]', err && (err.status || err.code || err.message));
}

function noteSuccess() {
  consecutiveFailures = 0;
  globalPauseToastShown = false;
}


function commitProfile(profile, epoch) {
  if (epoch != null && storage.epoch() !== epoch) return false;
  const ok = storage.commit(profile);
  if (!ok && !limitToastShown) {
    limitToastShown = true;
    showToast('档案已达上限，请导出后清理', document);
  }
  return ok;
}

function watchProfile(handle) {
  if (profileSubs.has(handle) || typeof GM_addValueChangeListener !== 'function') return;
  const id = GM_addValueChangeListener(profileKey(handle), (name, oldValue, newValue, remote) => {
    if (!remote || !newValue) return;
    storage.mergeRemote(newValue);
    renderHandle(handle, false);
  });
  profileSubs.set(handle, id);
}

function renderHandle(handle, scanning, root) {
  if (!settings || !settings.enabled) return;
  watchProfile(handle);
  const profile = storage.peek(handle);
  const scope = root || document;
  for (const article of scope.querySelectorAll(SEL.tweet)) {
    const id = fastIdentity(article);
    if (!id || id.handle !== handle) continue;
    renderBadges(article, profile, { scanning: !!scanning });
    if (profile && !repairs.has(article)) {
      repairs.set(article, bindRepair(article, () => {
        renderBadges(article, storage.peek(handle), { scanning: inFlight.has(handle) });
      }));
    }
  }
}

function applyAssessment(profile, next, previous, epoch) {
  profile.assessment = next;
  profile.stage = Math.max(profile.stage || 0, targetStage(profile), 1);
  profile.failCount = 0;
  profile.stable = !!(
    next.confidence >= XCP.STABLE_CONFIDENCE &&
    profile.stage >= XCP.STABLE_MIN_STAGE &&
    previous && sameArchetype(previous, next) && sameTopTrait(previous, next)
  );
  profile.cooldownUntil = Date.now() + cooldownFor(profile.stage);
  profile.updatedAt = Date.now();
  commitProfile(profile, epoch);
}

function applyLabel(profile, label, epoch, provisional) {
  const old = profile.label;
  if (old && old.text && old.text !== label.text && !old.provisional) {
    profile.history = profile.history || [];
    profile.history.unshift({
      text: old.text,
      stage: old.stage || profile.stage,
      ts: old.updatedAt || Date.now()
    });
    profile.history = profile.history.slice(0, XCP.HISTORY_CAP);
  }
  profile.label = {
    ...(provisional ? { provisional: true } : {}),
    text: label.text,
    vibe: label.vibe,
    archetype: label.archetype,
    confidence: label.confidence,
    reason: label.reason,
    lang: label.lang,
    tone: label.tone,
    stage: profile.stage,
    updatedAt: Date.now()
  };
  if (label.dossier) profile.dossier = label.dossier;
  profile.updatedAt = Date.now();
  commitProfile(profile, epoch);
}

async function runEvolution(handle, options = {}) {
  const force = options.force === true;
  if (!settings || !settings.enabled) return null;
  if (inFlight.has(handle)) return inFlight.get(handle);
  if (!hasAnyKey(settings)) {
    if (force) {
      showToast('先配置评估/起名模型', document);
      openSettings({ storage, onSettingsChanged, doc: document, transport: gmTransport });
    }
    return null;
  }

  const initial = storage.get(handle);
  if (!initial.samples.length && !force) return null;
  if (force) {
    initial.cooldownUntil = 0;
    if (!initial.samples.length) {
      showToast('样本不足，先滚动浏览该账号', document);
      return null;
    }
  }
  if (!force && !shouldAssess(initial, false, Date.now())) return null;
  if (!force && !canSpend(false)) return null;

  const mode = effectiveMode(settings);
  const lang = resolveLang(settings.labelLang);
  const tone = resolveTone(settings.tone);
  const epoch = storage.epoch();

  const job = queue.enqueue('evo:' + handle, async () => {
    if (!settings.enabled) return { skipped: 'disabled' };
    const profile = storage.get(handle);
    if (!profile.samples.length) return { skipped: 'no_samples' };
    if (storage.epoch() !== epoch) return { skipped: 'epoch' };
    if (!force && !shouldAssess(profile, false, Date.now())) return { skipped: 'not_due' };

    if (mode === 'combined') {
      const raw = await request(
        () => llm.chat(buildCombinedMessages(profile, { lang, tone }), {
          maxTokens: 1500,
          temperature: settings.temperature,
          jsonMode: true
        }),
        force
      );
      const value = parseModelJson(typeof raw === 'string' ? raw : raw.text);
      const combined = normalizeCombined(value, { lang, tone, meta: { model: 'combined', sampleCount: profile.sampleCount, ts: Date.now() } });
      if (!settings.enabled || storage.epoch() !== epoch) return { skipped: 'disabled_or_epoch' };
      const previous = profile.assessment;
      applyAssessment(profile, combined.assessment, previous, epoch);
      applyLabel(profile, combined.label, epoch);
      noteSuccess();
      renderHandle(handle, false);
      return { ok: true, mode };
    }

    const payload = buildJevPayload(profile, settings);
    const rawAssessment = await request(
      () => llm.jev(payload, { maxTokens: XCP.ASSESS_MAX_TOKENS }),
      force
    );
    const value = rawAssessment && rawAssessment.json !== undefined ? rawAssessment.json : rawAssessment;
    const previous = profile.assessment;
    const next = normalizeAssessment(value, {
      model: settings.jevModel || 'jev',
      sampleCount: profile.sampleCount,
      ts: Date.now()
    });
    const rename = force || shouldRename(profile, next, force, { lang, tone });

    if (!settings.enabled || storage.epoch() !== epoch) return { skipped: 'disabled_or_epoch' };
    applyAssessment(profile, next, previous, epoch);
    renderHandle(handle, true);

    if (mode === 'jev-only') {
      applyLabel(profile, composeLabel(next, { lang, tone, salt: handle, handle, stage: profile.stage }), epoch);
      noteSuccess();
      renderHandle(handle, false);
      return { ok: true, mode: 'jev-only' };
    }

    if (!rename) {
      noteSuccess();
      return { ok: true, renamed: false };
    }

    if (!profile.label) {
      const provisional = composeLabel(next, { lang, tone, salt: handle, handle, stage: profile.stage });
      applyLabel(profile, provisional, epoch, true);
      renderHandle(handle, true);
    }

    const rawName = await request(
      () => llm.chat(buildNameMessages(profile, next, { lang, tone }), {
        maxTokens: 1500,
        temperature: settings.temperature,
        jsonMode: true
      }),
      force
    );
    const nameValue = parseModelJson(typeof rawName === 'string' ? rawName : rawName.text);
    if (!settings.enabled || storage.epoch() !== epoch) return { skipped: 'disabled_or_epoch' };
    const label = normalizeLabel(nameValue, { lang, tone, assessment: next });
    applyLabel(profile, label, epoch);
    noteSuccess();
    renderHandle(handle, false);
    return { ok: true, renamed: true };
  }, { priority: force ? 3 : 1, manual: force });

  const tracked = Promise.resolve(job)
    .then((result) => result)
    .catch((err) => {
      if (!settings.enabled || storage.epoch() !== epoch) return { ok: false, skipped: 'stale' };
      const profile = storage.get(handle);
      noteFailure(profile, err);
      renderHandle(handle, false);
      return { ok: false, error: err && (err.code || err.status || err.message) };
    })
    .finally(() => {
      inFlight.delete(handle);
      renderHandle(handle, false);
    });

  inFlight.set(handle, tracked);
  renderHandle(handle, true);
  return tracked;
}

function preRenderCached() {
  if (!settings || !settings.enabled) return;
  const root = document;
  const vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 800;
  for (const article of root.querySelectorAll(SEL.tweet)) {
    const rect = typeof article.getBoundingClientRect === 'function'
      ? article.getBoundingClientRect()
      : { top: 0, bottom: 0 };
    if (rect.bottom < -vh || rect.top > vh * 2) continue;
    const id = fastIdentity(article);
    if (!id) continue;
    const profile = storage.peek(id.handle);
    if (!profile || (!profile.label && !profile.assessment)) continue;
    watchProfile(id.handle);
    renderBadges(article, profile, { scanning: inFlight.has(id.handle) });
  }
}

function onTweet(article) {
  if (!settings.enabled) return true;
  const tweet = extractTweet(article);
  if (!tweet) return false;

  const handle = tweet.handle;
  if (handle === currentOwnHandle()) {
    const own = storage.peek(handle);
    if (own && own.label) renderBadges(article, own, { scanning: false });
    return true;
  }
  if (!tweet.text && !tweet.cardTitle) {
    const existing = storage.peek(handle);
    if (existing && (existing.label || existing.assessment)) {
      renderBadges(article, existing, { scanning: inFlight.has(handle) });
      return true;
    }
    return false;
  }

  watchProfile(handle);
  const profile = storage.get(handle);
  const before = profile.updatedAt;
  const result = ingestSample(profile, tweet);
  if (result.added || result.kind === 'short' || profile.updatedAt !== before) {
    commitProfile(profile);
  }

  const scanning = inFlight.has(handle);
  renderBadges(article, profile, { scanning });
  if (profile && !repairs.has(article)) {
    repairs.set(article, bindRepair(article, () => {
      renderBadges(article, storage.peek(handle), { scanning: inFlight.has(handle) });
    }));
  }

  const autoAllowed = settings.autoLabelAll !== false || profile.label || profile.assessment;
  if (autoAllowed && shouldAssess(profile, false, Date.now())) {
    runEvolution(handle, { force: false });
  }
  return true;
}

function rerenderVisible() {
  if (!settings || !settings.enabled) return;
  const root = document;
  for (const article of root.querySelectorAll(SEL.tweet)) {
    const id = fastIdentity(article);
    if (!id) continue;
    watchProfile(id.handle);
    const profile = storage.peek(id.handle);
    renderBadges(article, profile, { scanning: inFlight.has(id.handle) });
    if (profile && !repairs.has(article)) {
      repairs.set(article, bindRepair(article, () => {
        renderBadges(article, storage.peek(id.handle), { scanning: inFlight.has(id.handle) });
      }));
    }
  }
}

function onSettingsChanged() {
  settings = storage.loadSettings();
  authPaused = false;
  authToastShown = false;
  autoPausedUntil = 0;
  consecutiveFailures = 0;
  globalPauseToastShown = false;
  if (!settings.enabled) {
    if (queue) queue.clear();
    removeAllBadges(document);
    hideCard(document);
  } else {
    rerenderVisible();
  }
  if (watcher) {
    watcher.poke();
    watcher.scan();
  }
  setLightMode(isLightMode(), document);
}

function wireStorageChanges() {
  const listen = (key, fn) => {
    if (typeof GM_addValueChangeListener !== 'function') return;
    const id = GM_addValueChangeListener(key, (name, oldValue, newValue, remote) => {
      if (!remote) return;
      fn(newValue);
    });
    storageOffs.push(() => {
      if (typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(id);
    });
  };
  listen(XCP.KEY_EPOCH, () => {
    storage.init();
    settings = storage.loadSettings();
    rerenderVisible();
  });
  listen(XCP.KEY_SETTINGS, () => {
    onSettingsChanged();
  });
}

export async function start() {
  if (started || globalThis.__xcpStarted) return;
  if (typeof GM_getValue !== 'function' || typeof document === 'undefined') return;
  started = true;
  globalThis.__xcpStarted = true;
  authPaused = false;
  authToastShown = false;
  autoPausedUntil = 0;
  consecutiveFailures = 0;
  globalPauseToastShown = false;
  limitToastShown = false;
  regionToastShown = false;
  inFlight.clear();

  storage = createStorage(gmAdapter());
  await storage.init();
  settings = storage.loadSettings();
  wireStorageChanges();
  queue = createQueue();
  llm = createLLM({ transport: gmTransport, getSettings: () => settings });

  injectStyles(document);
  setLightMode(isLightMode(), document);

  interactions = initInteractions({
    root: document,
    getProfile: (handle) => storage.peek(handle),
    onReassess: (handle) => runEvolution(handle, { force: true }),
    onHide: (handle) => {
      const profile = storage.get(handle);
      profile.hidden = true;
      profile.updatedAt = Date.now();
      commitProfile(profile);
      removeBadges(handle, document);
    },
    doc: document
  });

  watcher = createWatcher({
    getDwell: () => Number(settings.dwellMs) || XCP.DWELL_MS,
    isEnabled: () => !!(settings && settings.enabled),
    onReady: (article) => onTweet(article),
    onScan: preRenderCached,
    onRenderKnown: (article) => {
      const id = fastIdentity(article);
      if (!id) return;
      const profile = storage.peek(id.handle);
      renderBadges(article, profile, { scanning: inFlight.has(id.handle) });
    },
    doc: document,
    win: window
  });

  registerMenu({
    storage,
    onSettingsChanged,
    transport: gmTransport,
    onReassess: (handle) => runEvolution(handle, { force: true }),
    doc: document,
    win: window
  });

  watcher.start();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      storage.flush();
    } else {
      setLightMode(isLightMode(), document);
      if (watcher) {
        watcher.scan();
        watcher.poke();
      }
    }
  });
  window.addEventListener('pagehide', () => storage.flush());

  if (!hasAnyKey(settings) && !GM_getValue(XCP.KEY_INSTALLED, false)) {
    GM_setValue(XCP.KEY_INSTALLED, true);
    showToast('在菜单里配置评估/起名模型后开始打标', document);
  }
}

export function stop() {
  if (!started) return;
  started = false;
  globalThis.__xcpStarted = false;
  while (storageOffs.length) {
    const off = storageOffs.pop();
    try { off(); } catch (e) { /* ignore */ }
  }
  if (typeof GM_removeValueChangeListener === 'function') {
    for (const id of profileSubs.values()) {
      try { GM_removeValueChangeListener(id); } catch (e) { /* ignore */ }
    }
  }
  profileSubs.clear();
  if (watcher) watcher.destroy();
  if (typeof interactions === 'function') interactions();
  else if (interactions && typeof interactions.disconnect === 'function') interactions.disconnect();
  if (queue) queue.clear();
  removeAllBadges(document);
  if (storage) storage.flush();
}

if (typeof GM_getValue === 'function' && typeof document !== 'undefined') {
  start().catch((err) => console.error('[xcp] start', err));
}
