// Minimal DOM for node:test. Only the selector subset used by src/*.
// No jsdom. Selectors: tag, *, .class, #id, [attr], [attr="v"], [attr*="v"],
// [attr^="v"], [attr$="v"], descendant space, >, comma, :not(...).

const VOID = new Set(['BR', 'IMG', 'HR', 'INPUT', 'META', 'LINK']);

function kebab(s) {
  return s.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

function splitTop(s, sep) {
  const out = [];
  let buf = '';
  let depth = 0;
  let quote = '';
  for (const ch of s) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function tokenizeGroup(group) {
  const tokens = [];
  let buf = '';
  let depth = 0;
  let quote = '';
  let pendingChild = false;
  const push = () => {
    const c = buf.trim();
    if (c) tokens.push({ compound: c, combinator: pendingChild || tokens.length === 0 ? '' : ' ' });
    buf = '';
    pendingChild = false;
  };
  for (const ch of group) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (depth === 0 && (ch === ' ' || ch === '\t' || ch === '\n')) { push(); continue; }
    if (depth === 0 && ch === '>') { push(); pendingChild = true; continue; }
    buf += ch;
  }
  push();
  return tokens;
}

function parseAttrs(compound) {
  const attrs = [];
  const re = /\[([\w-]+)(?:([*^$])?=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  let m;
  while ((m = re.exec(compound))) {
    const hasValue = m[2] != null || m[3] != null || m[4] != null || m[5] != null;
    attrs.push({
      name: m[1],
      op: hasValue ? (m[2] || '=') : '',
      value: m[3] != null ? m[3] : m[4] != null ? m[4] : m[5] != null ? m[5] : ''
    });
  }
  return attrs;
}

function matchCompound(el, compound) {
  if (!el || el.nodeType !== 1) return false;
  let c = compound.trim();
  if (!c) return true;

  const nots = [];
  c = c.replace(/:not\(([^()]*)\)/g, (_, inner) => {
    nots.push(inner.trim());
    return '';
  });
  for (const inner of nots) {
    if (matchSelector(el, inner)) return false;
  }

  const bare = c.replace(/\[[^\]]*\]/g, '');
  const tagMatch = bare.match(/^([a-zA-Z][\w-]*|\*)/);
  if (tagMatch && tagMatch[1] !== '*') {
    if (el.tagName.toLowerCase() !== tagMatch[1].toLowerCase()) return false;
  }
  for (const m of bare.matchAll(/\.([\w-]+)/g)) {
    if (!el.classList.contains(m[1])) return false;
  }
  for (const m of bare.matchAll(/#([\w-]+)/g)) {
    if (el.id !== m[1]) return false;
  }
  for (const a of parseAttrs(c)) {
    const v = el.getAttribute(a.name);
    if (v == null) return false;
    if (!a.op) continue;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '*' && !v.includes(a.value)) return false;
    if (a.op === '^' && !v.startsWith(a.value)) return false;
    if (a.op === '$' && !v.endsWith(a.value)) return false;
  }
  return true;
}

function matchGroup(el, group) {
  const tokens = tokenizeGroup(group);
  if (!tokens.length) return false;
  let i = tokens.length - 1;
  if (!matchCompound(el, tokens[i].compound)) return false;
  let node = el;
  i--;
  while (i >= 0) {
    const wantChild = tokens[i + 1].combinator === '>';
    const token = tokens[i];
    if (wantChild) {
      node = node.parentElement;
      if (!node || !matchCompound(node, token.compound)) return false;
    } else {
      node = node.parentElement;
      while (node && !matchCompound(node, token.compound)) node = node.parentElement;
      if (!node) return false;
    }
    i--;
  }
  return true;
}

export function matchSelector(el, selector) {
  if (!selector || !el || el.nodeType !== 1) return false;
  return splitTop(selector, ',').some(g => matchGroup(el, g));
}

let UID = 0;

class StubText {
  constructor(value) {
    this.nodeType = 3;
    this.nodeValue = String(value);
    this.parentElement = null;
    this.parentNode = null;
    this._connected = false;
  }
  get textContent() { return this.nodeValue; }
  set textContent(v) { this.nodeValue = String(v); }
  get isConnected() { return this._connected; }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
}

class StubElement {
  constructor(tag, attrs = {}) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attributes = Object.create(null);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v != null) this.attributes[k] = String(v);
    }
    this.childNodes = [];
    this.parentElement = null;
    this.parentNode = null;
    this._connected = false;
    this._observers = new Set();
    this._listeners = Object.create(null);
    this._uid = ++UID;
    this.value = attrs.value != null ? String(attrs.value) : '';
    this.checked = !!attrs.checked;
    this.disabled = !!attrs.disabled;
    this.style = {
      setProperty: (k, v) => { const cur = this.getAttribute('style') || ''; this.setAttribute('style', cur + k + ':' + v + ';'); },
      removeProperty: () => {}
    };
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get classList() {
    const self = this;
    if (!this._classList) {
      this._classList = {
        add(...names) {
          const set = new Set(self._classes());
          names.forEach(n => set.add(n));
          self.setAttribute('class', [...set].join(' '));
        },
        remove(...names) {
          const set = new Set(self._classes());
          names.forEach(n => set.delete(n));
          self.setAttribute('class', [...set].join(' '));
        },
        contains(name) { return self._classes().includes(name); },
        toggle(name, force) {
          const has = self._classes().includes(name);
          const on = force === undefined ? !has : !!force;
          if (on) this.add(name); else this.remove(name);
          return on;
        }
      };
    }
    return this._classList;
  }
  _classes() { return (this.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  get dataset() {
    const self = this;
    return new Proxy({}, {
      get(_, k) { return self.getAttribute('data-' + kebab(String(k))); },
      set(_, k, v) { self.setAttribute('data-' + kebab(String(k)), v); return true; },
      has(_, k) { return self.hasAttribute('data-' + kebab(String(k))); }
    });
  }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get textContent() {
    return this.childNodes.map(n => n.textContent).join('');
  }
  set textContent(v) {
    for (const child of this.childNodes) { child.parentElement = null; child.parentNode = null; if (child._setConnected) child._setConnected(false); else child._connected = false; }
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(new StubText(v));
  }
  _setConnected(on) {
    this._connected = on;
    for (const child of this.childNodes) {
      if (child._setConnected) child._setConnected(on);
      else child._connected = on;
    }
  }
  get isConnected() { return this._connected; }
  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(typeof node === 'string' ? new StubText(node) : node);
    }
  }
  prepend(...nodes) {
    for (const node of nodes.slice().reverse()) {
      this.insertBefore(typeof node === 'string' ? new StubText(node) : node, this.firstChild);
    }
  }
  replaceChildren(...nodes) {
    this.textContent = '';
    this.append(...nodes);
  }
  appendChild(node) {
    if (!node) return node;
    if (node.parentElement) node.parentElement.removeChild(node);
    node.parentElement = this;
    node.parentNode = this;
    if (node._setConnected) node._setConnected(this._connected);
    else node._connected = this._connected;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node, ref) {
    if (!ref) return this.appendChild(node);
    const i = this.childNodes.indexOf(ref);
    if (i < 0) return this.appendChild(node);
    if (node.parentElement) node.parentElement.removeChild(node);
    node.parentElement = this;
    node.parentNode = this;
    if (node._setConnected) node._setConnected(this._connected);
    this.childNodes.splice(i, 0, node);
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) {
      this.childNodes.splice(i, 1);
      node.parentElement = null;
      node.parentNode = null;
      if (node._setConnected) node._setConnected(false);
      else node._connected = false;
    }
    return node;
  }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  setAttribute(k, v) { this.attributes[String(k)] = String(v); }
  getAttribute(k) { return this.attributes[String(k)] == null ? null : this.attributes[String(k)]; }
  hasAttribute(k) { return this.attributes[String(k)] != null; }
  removeAttribute(k) { delete this.attributes[String(k)]; }
  getAttributeNames() { return Object.keys(this.attributes); }
  matches(sel) { return matchSelector(this, sel); }
  closest(sel) {
    let n = this;
    while (n && n.nodeType === 1) {
      if (matchSelector(n, sel)) return n;
      n = n.parentElement;
    }
    return null;
  }
  contains(node) {
    let n = node;
    while (n) { if (n === this) return true; n = n.parentElement; }
    return false;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (matchSelector(child, sel)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  addEventListener(type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  }
  removeEventListener(type, fn) {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  dispatchEvent(event) {
    const e = typeof event === 'string' ? { type: event } : event;
    if (!e.target) e.target = this;
    e.preventDefault = e.preventDefault || (() => { e.defaultPrevented = true; });
    e.stopPropagation = e.stopPropagation || (() => { e._stopped = true; });
    for (const fn of (this._listeners[e.type] || []).slice()) fn.call(this, e);
    if (this.parentElement && !e._stopped) this.parentElement.dispatchEvent(e);
    return !e.defaultPrevented;
  }
  focus() { this._focused = true; }
  blur() { this._focused = false; }
  click() { this.dispatchEvent({ type: 'click' }); }
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  getClientRects() { return []; }
  scrollIntoView() {}
}

class StubDocument {
  constructor() {
    this.nodeType = 9;
    this.documentElement = new StubElement('html');
    this.head = new StubElement('head');
    this.body = new StubElement('body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.documentElement._setConnected(true);
    this.visibilityState = 'visible';
    this._listeners = Object.create(null);
  }
  createElement(tag) { return new StubElement(tag); }
  createTextNode(text) { return new StubText(text); }
  getElementById(id) {
    return this.documentElement.querySelector('#' + id);
  }
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); }
  removeEventListener(type, fn) {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  dispatchEvent(event) {
    const e = typeof event === 'string' ? { type: event } : event;
    if (!e.target) e.target = this;
    e.preventDefault = e.preventDefault || (() => {});
    e.stopPropagation = e.stopPropagation || (() => {});
    for (const fn of (this._listeners[e.type] || []).slice()) fn.call(this, e);
    return true;
  }
  getSelection() { return { toString: () => '' }; }
}

export function createDocument() {
  return new StubDocument();
}

export function h(tag, attrs = {}, children = []) {
  const el = new StubElement(tag, attrs);
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null) continue;
    el.appendChild(typeof child === 'string' || typeof child === 'number' ? new StubText(child) : child);
  }
  return el;
}

export function t(text) {
  return new StubText(text);
}

export class StubMutationObserver {
  constructor(cb) { this.cb = cb; this.targets = new Set(); }
  observe(target) { this.targets.add(target); target._observers.add(this); }
  disconnect() {
    for (const t of this.targets) t._observers.delete(this);
    this.targets.clear();
  }
  takeRecords() { return []; }
  trigger(records = []) { this.cb(records, this); }
}

export class StubIntersectionObserver {
  static instances = [];
  constructor(cb, options = {}) {
    this.cb = cb;
    this.options = options;
    this.targets = new Set();
    StubIntersectionObserver.instances.push(this);
  }
  static last() { return StubIntersectionObserver.instances[StubIntersectionObserver.instances.length - 1] || null; }
  observe(el) { this.targets.add(el); }
  unobserve(el) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); }
  trigger(entries) { this.cb(entries, this); }
  static entry(target, visible = true, ratio = 0.8) {
    const height = 120;
    const h = visible ? Math.round(height * ratio) : 0;
    return {
      target,
      isIntersecting: visible,
      intersectionRatio: visible ? ratio : 0,
      boundingClientRect: { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: height, width: 400, height },
      intersectionRect: { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: h, width: 400, height: h }
    };
  }
}

export function installGlobals(doc = createDocument()) {
  StubIntersectionObserver.instances.length = 0;
  globalThis.document = doc;
  globalThis.window = {
    document: doc,
    innerHeight: 800,
    innerWidth: 1200,
    getSelection: () => doc.getSelection(),
    addEventListener: (t, f) => doc.addEventListener(t, f),
    removeEventListener: (t, f) => doc.removeEventListener(t, f)
  };
  globalThis.MutationObserver = StubMutationObserver;
  globalThis.IntersectionObserver = StubIntersectionObserver;
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.getComputedStyle = () => ({ backgroundColor: 'rgb(0, 0, 0)' });
  return doc;
}
