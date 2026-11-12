import { XCP } from './constants.js';
import { SEL } from './selectors.js';
import { isOuterTweet, fastIdentity } from './extract.js';

const RETRY_MS = 1000;

function ctorFor(win, name) {
  if (win && typeof win[name] === 'function') return win[name];
  if (typeof globalThis !== 'undefined' && typeof globalThis[name] === 'function') return globalThis[name];
  return null;
}

export function createWatcher({
  getDwell,
  isEnabled,
  onReady,
  onRenderKnown,
  onScan,
  doc = document,
  win = window
} = {}) {
  let root = null;
  let io = null;
  let mo = null;
  let rootTimer = null;
  let scanTimer = null;
  let started = false;
  let destroyed = false;

  let consumed = new WeakSet();
  let observed = new WeakSet();
  let identity = new WeakMap();
  const visible = new Set();
  const timers = new Map();
  const retries = new Map();

  const setT = win && typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
  const clearT = win && typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
  const setI = win && typeof win.setInterval === 'function' ? win.setInterval.bind(win) : setInterval;
  const clearI = win && typeof win.clearInterval === 'function' ? win.clearInterval.bind(win) : clearInterval;

  function enabledNow() {
    if (typeof isEnabled !== 'function') return true;
    try {
      return isEnabled() !== false;
    } catch (err) {
      return false;
    }
  }

  function dwellNow() {
    let value = XCP.DWELL_MS;
    if (typeof getDwell === 'function') {
      try {
        value = Number(getDwell());
      } catch (err) {
        value = XCP.DWELL_MS;
      }
    }
    if (!Number.isFinite(value)) value = XCP.DWELL_MS;
    return Math.min(XCP.DWELL_MAX, Math.max(XCP.DWELL_MIN, value));
  }

  function isDm(article) {
    if (!article || typeof article.closest !== 'function') return false;
    return !!(article.closest(SEL.dmDrawer) || article.closest(SEL.dmConversation));
  }

  function isXcpNode(node) {
    let cur = node;
    while (cur && cur.nodeType === 1) {
      if (cur.classList && cur.classList.contains('xcp-tags')) return true;
      const id = cur.id;
      if (id === 'xcp-backdrop' || id === 'xcp-toast') return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function containsArticle(node) {
    if (!node || node.nodeType !== 1) return false;
    if (typeof node.matches === 'function' && node.matches(SEL.tweet)) return true;
    return typeof node.querySelector === 'function' && !!node.querySelector(SEL.tweet);
  }

  function clearTimer(article) {
    const timer = timers.get(article);
    if (timer !== undefined) {
      clearT(timer);
      timers.delete(article);
    }
  }

  function clearAllTimers() {
    for (const timer of timers.values()) clearT(timer);
    timers.clear();
    retries.clear();
  }

  function forget(article) {
    clearTimer(article);
    visible.delete(article);
    retries.delete(article);
    observed.delete(article);
    if (io) io.unobserve(article);
  }

  function removeContainers(article) {
    if (!article || typeof article.querySelectorAll !== 'function') return;
    for (const node of article.querySelectorAll('.xcp-tags')) node.remove();
  }

  function observe(article) {
    if (!io || observed.has(article)) return;
    observed.add(article);
    io.observe(article);
  }

  function consume(article) {
    consumed.add(article);
    forget(article);
  }

  function guard(article) {
    let next = null;
    try {
      next = fastIdentity(article);
    } catch (err) {
      next = null;
    }
    const prev = identity.get(article);
    if (prev && next && prev !== next.statusId) {
      clearTimer(article);
      retries.delete(article);
      consumed.delete(article);
      visible.delete(article);
      observed.delete(article);
      removeContainers(article);
      if (io) io.unobserve(article);
      observe(article);
    }
    if (next) identity.set(article, next.statusId);
    return next;
  }

  function isEffectivelyVisible(entry) {
    if (!entry || !entry.isIntersecting) return false;
    const rect = entry.boundingClientRect || {};
    const intersection = entry.intersectionRect || {};
    const rectH = Number(rect.height) || 0;
    const visibleH = Number(intersection.height) || 0;
    if (visibleH <= 0 || rectH <= 0) return false;
    const viewport = Number(win && win.innerHeight) || 0;
    const need = Math.min(rectH * XCP.VIS_RATIO, viewport * XCP.VIS_RATIO);
    return visibleH >= need;
  }

  function renderKnown(article) {
    if (!enabledNow()) return;
    if (typeof onRenderKnown !== 'function') return;
    try {
      onRenderKnown(article);
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) console.error('[xcp] onRenderKnown', err);
    }
  }

  function startDwell(article) {
    if (!started || destroyed) return;
    if (consumed.has(article) || timers.has(article)) return;
    const timer = setT(() => {
      timers.delete(article);
      if (!started || destroyed || !article.isConnected) return;
      if (!visible.has(article)) return;
      if (consumed.has(article)) return;
      if (!doc || doc.visibilityState !== 'visible') return;
      if (!enabledNow()) return;

      let ok = false;
      try {
        ok = typeof onReady === 'function' && onReady(article) === true;
      } catch (err) {
        if (typeof console !== 'undefined' && console.error) console.error('[xcp] onReady', err);
      }
      if (ok) consume(article);
      else retry(article, 1);
    }, dwellNow());
    timers.set(article, timer);
  }

  function retry(article, attempt) {
    if (!started || destroyed || attempt > 6) return;
    if (!article.isConnected || !visible.has(article) || consumed.has(article)) return;
    retries.set(article, attempt);
    const timer = setT(() => {
      timers.delete(article);
      if (!started || destroyed || !article.isConnected) return;
      if (!visible.has(article) || consumed.has(article)) return;
      if (!doc || doc.visibilityState !== 'visible') return;
      if (!enabledNow()) return;

      let ok = false;
      try {
        ok = typeof onReady === 'function' && onReady(article) === true;
      } catch (err) {
        if (typeof console !== 'undefined' && console.error) console.error('[xcp] retry', err);
      }
      if (ok) consume(article);
      else retry(article, attempt + 1);
    }, Math.min(4000, RETRY_MS * attempt));
    timers.set(article, timer);
  }

  function onIntersect(entries) {
    if (!started || destroyed) return;
    for (const entry of entries || []) {
      const article = entry && entry.target;
      if (!article) continue;
      if (!article.isConnected) {
        forget(article);
        continue;
      }
      if (!isOuterTweet(article) || isDm(article)) {
        forget(article);
        continue;
      }
      guard(article);
      if (consumed.has(article)) {
        visible.delete(article);
        clearTimer(article);
        continue;
      }
      if (isEffectivelyVisible(entry)) {
        visible.add(article);
        renderKnown(article);
        startDwell(article);
      } else {
        visible.delete(article);
        clearTimer(article);
        retries.delete(article);
      }
    }
  }

  function scan() {
    if (!started || destroyed) return;
    if (!root || !root.isConnected) {
      bindRoot();
      return;
    }
    if (!io) return;
    const articles = root.querySelectorAll(SEL.tweet);
    for (const article of articles) {
      if (!isOuterTweet(article) || isDm(article)) continue;
      guard(article);
      if (consumed.has(article)) continue;
      observe(article);
    }
    if (typeof onScan === 'function') {
      try { onScan(); } catch (err) { if (typeof console !== 'undefined' && console.error) console.error('[xcp] onScan', err); }
    }
  }

  function onMutations(records) {
    if (!started || destroyed) return;
    let relevant = false;
    for (const record of records || []) {
      const added = record && record.addedNodes;
      if (!added) continue;
      for (const node of added) {
        if (!node || node.nodeType !== 1) continue;
        if (isXcpNode(node)) continue;
        if (containsArticle(node)) {
          relevant = true;
          break;
        }
      }
      if (relevant) break;
    }
    if (!relevant) return;
    if (scanTimer !== null) clearT(scanTimer);
    scanTimer = setT(() => {
      scanTimer = null;
      if (!started || destroyed) return;
      if (!root || !root.isConnected) {
        bindRoot();
        return;
      }
      scan();
    }, XCP.SCAN_DEBOUNCE_MS);
  }

  function detachObservers() {
    if (mo) {
      mo.disconnect();
      mo = null;
    }
    if (io) {
      io.disconnect();
      io = null;
    }
    observed = new WeakSet();
    visible.clear();
    clearAllTimers();
  }

  function bindRoot() {
    if (!started || destroyed) return false;
    const next = findRoot();
    if (!next) {
      root = null;
      return false;
    }
    if (next === root && root.isConnected && mo && io) return true;
    detachObservers();
    root = next;

    const IOCtor = ctorFor(win, 'IntersectionObserver');
    const MOCtor = ctorFor(win, 'MutationObserver');
    if (IOCtor) {
      io = new IOCtor(onIntersect, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    }
    if (MOCtor) {
      mo = new MOCtor(onMutations);
      mo.observe(root, { childList: true, subtree: true });
    }
    scan();
    return !!io;
  }

  function findRoot() {
    return doc.querySelector(SEL.primary) || doc.querySelector(SEL.main);
  }

  function checkRoot() {
    if (!started || destroyed) return;
    const next = findRoot();
    if (!next) {
      if (root && !root.isConnected) {
        detachObservers();
        root = null;
      }
      return;
    }
    if (!root || !root.isConnected || next !== root || !io || !mo) {
      detachObservers();
      root = null;
      bindRoot();
    }
  }

  function start() {
    if (destroyed) return;
    if (started) {
      scan();
      return;
    }
    started = true;
    bindRoot();
    if (rootTimer === null) rootTimer = setI(checkRoot, XCP.ROOT_CHECK_MS);
  }

  function stop() {
    started = false;
    if (rootTimer !== null) {
      clearI(rootTimer);
      rootTimer = null;
    }
    if (scanTimer !== null) {
      clearT(scanTimer);
      scanTimer = null;
    }
    detachObservers();
    root = null;
    consumed = new WeakSet();
    identity = new WeakMap();
  }

  function poke() {
    if (!started || destroyed) return;
    for (const article of [...visible]) {
      if (!article.isConnected) {
        forget(article);
        continue;
      }
      guard(article);
      if (consumed.has(article)) continue;
      clearTimer(article);
      startDwell(article);
    }
  }

  function destroy() {
    if (destroyed) return;
    stop();
    destroyed = true;
  }

  return { start, stop, scan, poke, destroy };
}
