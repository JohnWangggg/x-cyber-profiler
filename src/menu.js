import { XCP, DEFAULT_SETTINGS } from './constants.js';
import { normalizeEndpoint, buildRequest, effectiveMode } from './providers.js';

const MENU_COMMANDS = Object.freeze([
  'XCP 设置',
  'XCP 开关打标',
  'XCP 导出档案',
  'XCP 导入档案',
  'XCP 清空档案',
  'XCP 今日用量'
]);

const NAMER_PROVIDERS = Object.freeze(['openai', 'gemini', 'anthropic', 'ollama', 'none']);
const EXPORT_FILE = 'xcp-profiles.json';
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const TEST_TIMEOUT_MS = 10000;
const TEST_PROMPT = 'Return only {"ok":true} as json.';
const LOCAL_HOSTS = Object.freeze(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

const LANG_LABELS = Object.freeze({
  auto: '自动',
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский'
});

const TONE_LABELS = Object.freeze({
  sharp: '犀利',
  soft: '柔和',
  abstract: '抽象',
  chuuni: '中二',
  academic: '学院'
});

const PROVIDER_LABELS = Object.freeze({
  openai: 'OpenAI 兼容',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  none: '不使用'
});

const MENU_CSS = `
#xcp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, .55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
#xcp-backdrop .xcp-modal {
  width: min(92vw, 460px);
  max-height: 86vh;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 18px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, .12);
  background: linear-gradient(180deg, rgba(24, 24, 30, .98), rgba(12, 12, 16, .98));
  box-shadow: 0 24px 80px rgba(0, 0, 0, .5);
  color: #e5e7eb;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
}
#xcp-backdrop .xcp-modal h2 { margin: 0 0 4px; font-size: 15px; }
#xcp-backdrop .xcp-modal p { margin: 0 0 14px; color: #9ca3af; font-size: 12px; line-height: 1.5; }
#xcp-backdrop .xcp-section { margin: 16px 0 8px; color: #5eead4; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
#xcp-backdrop .xcp-field { display: block; margin-bottom: 12px; }
#xcp-backdrop .xcp-field > span { display: block; margin-bottom: 5px; color: #9ca3af; font-size: 11px; }
#xcp-backdrop .xcp-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, .14);
  background: rgba(255, 255, 255, .06);
  color: #f9fafb;
  font: inherit;
  outline: none;
}
#xcp-backdrop .xcp-input:focus { border-color: rgba(94, 234, 212, .6); }
#xcp-backdrop .xcp-check { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; color: #d1d5db; font-size: 12px; }
#xcp-backdrop .xcp-field-error { display: block; margin-top: 3px; color: #fca5a5; font-size: 11px; }
#xcp-backdrop .xcp-error-line { color: #fca5a5; font-size: 12px; min-height: 0; }
#xcp-backdrop .xcp-usage { color: #9ca3af; font-size: 11px; line-height: 1.5; margin: 12px 0 0; }
#xcp-backdrop .xcp-stat-row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid rgba(255, 255, 255, .07); font-size: 12px; }
#xcp-backdrop .xcp-stat-row span:first-child { color: #9ca3af; }
#xcp-backdrop .xcp-stat-row span:last-child { color: #f9fafb; text-align: right; word-break: break-word; }
#xcp-backdrop .xcp-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
#xcp-backdrop .xcp-btn {
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, .14);
  background: rgba(255, 255, 255, .06);
  color: #e5e7eb;
  font: inherit;
  cursor: pointer;
}
#xcp-backdrop .xcp-btn:hover { background: rgba(255, 255, 255, .12); }
#xcp-backdrop .xcp-btn-primary { border-color: rgba(94, 234, 212, .5); background: rgba(16, 185, 129, .18); color: #5eead4; }
#xcp-toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2147483647;
  max-width: 320px;
  padding: 9px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, .14);
  background: rgba(17, 24, 39, .94);
  color: #e5e7eb;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, .4);
}
`;

const toastTimers = new WeakMap();
const modalCleanups = new WeakMap();

function menuResolveDoc(doc) {
  if (doc) return doc;
  if (typeof document === 'undefined') return null;
  return document;
}

function bodyOf(doc) {
  return doc.body || doc.documentElement || null;
}

function ensureMenuStyles(doc) {
  if (!doc || !doc.head) return null;
  const existing = doc.getElementById('xcp-menu-style');
  if (existing) return existing;
  const style = doc.createElement('style');
  style.id = 'xcp-menu-style';
  style.textContent = MENU_CSS;
  doc.head.appendChild(style);
  return style;
}

function menuReadSettings(storage) {
  try {
    const saved = storage && typeof storage.loadSettings === 'function' ? storage.loadSettings() : null;
    return { ...DEFAULT_SETTINGS, ...(saved || {}) };
  } catch (err) {
    return { ...DEFAULT_SETTINGS };
  }
}

function readUsage(storage) {
  try {
    return (storage && typeof storage.getUsage === 'function' ? storage.getUsage() : null) || {};
  } catch (err) {
    return {};
  }
}

function readStats(storage) {
  try {
    return (storage && typeof storage.getStats === 'function' ? storage.getStats() : null) || {};
  } catch (err) {
    return {};
  }
}

function menuToCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function firstCount(source, keys) {
  if (source == null) return null;
  if (typeof source === 'number') return menuToCount(source);
  if (Array.isArray(source)) return source.length;
  for (const key of keys) {
    const n = menuToCount(source[key]);
    if (n != null) return n;
  }
  return null;
}

function formatError(value) {
  if (value == null) return '';
  let text = '';
  if (typeof value === 'object') {
    if (value.status != null) text = String(value.status);
    else if (value.code != null) text = String(value.code);
    else if (value.message != null) text = String(value.message);
    else text = '';
  } else {
    text = String(value);
  }
  return text.length > 60 ? text.slice(0, 60) + '…' : text;
}

function resolveTransport(transport) {
  if (typeof transport === 'function') return transport;
  const request = typeof globalThis !== 'undefined' && typeof globalThis.GM_xmlhttpRequest === 'function'
    ? globalThis.GM_xmlhttpRequest
    : null;
  if (!request) return null;
  return (options) => new Promise((resolve, reject) => {
    try {
      request({
        method: options.method || 'POST',
        url: options.url,
        headers: options.headers || {},
        data: options.body,
        timeout: options.timeout,
        onload: (response) => resolve({
          status: response && response.status,
          responseText: response && response.responseText
        }),
        onerror: () => reject(new Error('网络错误')),
        ontimeout: () => reject(new Error('请求超时'))
      });
    } catch (err) {
      reject(err);
    }
  });
}

function responseStatus(response) {
  const raw = response && typeof response === 'object' ? response.status : response;
  const status = Number(raw);
  return Number.isFinite(status) ? status : 0;
}

function testStatusToast(status) {
  if (status >= 200 && status < 300) return '连接正常';
  if (status === 401 || status === 403) return 'Key 无效';
  if (status === 451) return '当前网络区域被限制（451）';
  return 'HTTP ' + status;
}

function testFailureMessage(err) {
  const message = err && err.message != null ? String(err.message) : (err == null ? '' : String(err));
  return '连接失败：' + (message || '网络错误');
}

function validateTestRequest(next, kind) {
  const errors = [];
  const push = (key, message) => errors.push({ key, message });
  if (kind === 'jev') {
    let err = endpointError(next.jevUrl, true, true);
    if (err) push('jevUrl', err);
    err = keyError(next.jevKey);
    if (err) push('jevKey', err);
    err = modelError(next.jevModel, true);
    if (err) push('jevModel', err);
    if (next.jevSchema.length > 64) push('jevSchema', 'Schema 不能超过 64 个字符');
    return errors;
  }
  if (!NAMER_PROVIDERS.includes(next.namerProvider) || next.namerProvider === 'none') {
    push('namerProvider', '请选择起名 Provider');
    return errors;
  }
  let err = endpointError(next.namerUrl, true, true);
  if (err) push('namerUrl', err);
  err = keyError(next.namerKey);
  if (err) push('namerKey', err);
  err = modelError(next.namerModel, true);
  if (err) push('namerModel', err);
  return errors;
}

function buildJevTestRequest(next) {
  return buildRequest({
    provider: 'jev',
    url: normalizeEndpoint('jev', next.jevUrl),
    key: next.jevKey,
    payload: {
      model: next.jevModel || XCP.DEFAULT_JEV_MODEL,
      state: { handle: 'xcp-test', lang_hint: 'en', samples: [] },
      questions: {
        ping: { type: 'noul', instructions: 'Is this a valid TypeSafe request?' }
      }
    }
  });
}

function buildNamerTestRequest(next) {
  return buildRequest({
    provider: next.namerProvider,
    url: normalizeEndpoint(next.namerProvider, next.namerUrl),
    key: next.namerKey,
    model: next.namerModel,
    messages: [{ role: 'user', content: TEST_PROMPT }],
    maxTokens: 16,
    jsonMode: true
  });
}

async function runConnectionTest(kind, button, context) {
  const next = readForm(context.fields);
  const errors = validateTestRequest(next, kind);
  if (showFormErrors(context.modal, context.errorLine, errors)) return false;
  const send = context.transport;
  if (typeof send !== 'function') {
    showToast('当前环境不支持测试连接', context.doc);
    return false;
  }
  let request = null;
  try {
    request = kind === 'jev' ? buildJevTestRequest(next) : buildNamerTestRequest(next);
  } catch (err) {
    showToast(testFailureMessage(err), context.doc);
    return false;
  }
  if (context.storage && typeof context.storage.bumpUsage === 'function') {
    try { context.storage.bumpUsage(); } catch (err) {}
  }
  if (button) button.disabled = true;
  try {
    const response = await send({
      url: request.url,
      method: request.init.method,
      headers: request.init.headers,
      body: request.init.body,
      timeout: TEST_TIMEOUT_MS
    });
    showToast(testStatusToast(responseStatus(response)), context.doc);
    return true;
  } catch (err) {
    showToast(testFailureMessage(err), context.doc);
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

function hiddenProfileList(storage) {
  const list = [];
  if (!storage) return list;
  let handles = [];
  try {
    handles = typeof storage.listProfiles === 'function' ? storage.listProfiles() : [];
  } catch (err) {
    return list;
  }
  for (const item of handles) {
    let profile = null;
    try {
      if (item && typeof item === 'object') profile = item;
      else if (typeof storage.peek === 'function') profile = storage.peek(item);
    } catch (err) {
      profile = null;
    }
    if (profile && profile.hidden && profile.handle) list.push(profile);
  }
  return list;
}

function hiddenCountText(storage) {
  return '隐藏账号：' + hiddenProfileList(storage).length;
}

function restoreHidden(storage, doc, onSettingsChanged) {
  const hidden = hiddenProfileList(storage);
  if (!hidden.length) {
    showToast('没有隐藏账号', doc);
    return 0;
  }
  const stamp = Date.now();
  let restored = 0;
  for (const profile of hidden) {
    try {
      profile.hidden = false;
      profile.updatedAt = stamp;
      if (storage.commit(profile)) restored += 1;
    } catch (err) {}
  }
  showToast('已恢复 ' + restored + ' 个隐藏账号', doc);
  if (typeof onSettingsChanged === 'function') {
    try { onSettingsChanged(); } catch (err) {}
  }
  return restored;
}

function showFormErrors(modal, errorLine, errors) {
  clearErrors(modal, errorLine);
  if (!errors.length) return false;
  for (const item of errors) {
    const node = findByAttr(modal, 'data-xcp-error', item.key);
    if (node) node.textContent = item.message;
  }
  errorLine.textContent = errors[0].message;
  const first = findByAttr(modal, 'data-xcp-control', errors[0].key);
  if (first && typeof first.focus === 'function') first.focus();
  return true;
}

function modeLabel(settings) {
  const mode = effectiveMode(settings);
  if (mode === 'jev') return 'Jev+LLM';
  if (mode === 'combined') return 'combined';
  if (mode === 'jev-only') return 'Jev 兜底';
  return '未配置';
}

function usageLine(storage, settings) {
  const usage = readUsage(storage);
  const total = firstCount(usage, ['count', 'total', 'requests']);
  const evals = firstCount(usage, ['eval', 'evaluate', 'assess', 'assessmentCount']);
  const names = firstCount(usage, ['name', 'naming', 'label', 'labelCount']);
  const budget = menuToCount(settings.dailyBudget) || 0;
  const parts = [];
  if (evals != null && names != null) parts.push('今日 评估 ' + evals + ' / 起名 ' + names);
  else parts.push('今日请求 ' + (total == null ? 0 : total));
  parts.push('预算 ' + (budget ? budget : '不限'));
  parts.push('模式：' + modeLabel(settings));
  parts.push('v' + XCP.VERSION);
  const error = formatError(usage.lastError != null ? usage.lastError : usage.error);
  if (error) {
    const paused = !!(usage.authPaused || usage.paused);
    parts.push('最近错误：' + error + (paused ? '（已暂停）' : ''));
  }
  return parts.join(' · ');
}

function formatBytes(value) {
  const n = menuToCount(value);
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function closeModal(doc) {
  const d = menuResolveDoc(doc);
  if (!d) return;
  const cleanup = modalCleanups.get(d);
  if (cleanup) {
    modalCleanups.delete(d);
    try { cleanup(); } catch (err) {}
  }
  const backdrop = d.getElementById('xcp-backdrop');
  if (backdrop) backdrop.remove();
}

function createBackdrop(doc, kind) {
  const backdrop = doc.createElement('div');
  backdrop.id = 'xcp-backdrop';
  backdrop.className = 'xcp-backdrop';
  backdrop.setAttribute('data-xcp-modal', kind);
  const modal = doc.createElement('div');
  modal.className = 'xcp-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  backdrop.appendChild(modal);
  bodyOf(doc).appendChild(backdrop);
  return { backdrop, modal };
}

function bindModalDismiss(doc, backdrop) {
  const onKey = (event) => {
    if (!event || event.key !== 'Escape') return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    closeModal(doc);
  };
  const onClick = (event) => {
    if (event && event.target === backdrop) closeModal(doc);
  };
  doc.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', onClick);
  modalCleanups.set(doc, () => {
    doc.removeEventListener('keydown', onKey);
    backdrop.removeEventListener('click', onClick);
  });
}

function addSection(doc, modal, title) {
  const section = doc.createElement('div');
  section.className = 'xcp-section';
  section.textContent = title;
  modal.appendChild(section);
}

function addField(doc, modal, key, label, control) {
  const row = doc.createElement('label');
  row.className = 'xcp-field';
  row.setAttribute('data-xcp-field', key);
  const caption = doc.createElement('span');
  caption.textContent = label;
  row.appendChild(caption);
  row.appendChild(control);
  const error = doc.createElement('span');
  error.className = 'xcp-field-error';
  error.setAttribute('data-xcp-error', key);
  row.appendChild(error);
  modal.appendChild(row);
  return row;
}

function textControl(doc, key, value, type, placeholder) {
  const input = doc.createElement('input');
  input.className = 'xcp-input';
  input.setAttribute('data-xcp-control', key);
  input.setAttribute('type', type || 'text');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  if (placeholder) input.setAttribute('placeholder', placeholder);
  input.value = value == null ? '' : String(value);
  return input;
}

function selectControl(doc, key, value, options) {
  const select = doc.createElement('select');
  select.className = 'xcp-input';
  select.setAttribute('data-xcp-control', key);
  for (const option of options) {
    const el = doc.createElement('option');
    el.value = option.value;
    el.setAttribute('value', option.value);
    el.textContent = option.label;
    select.appendChild(el);
  }
  select.value = value;
  return select;
}

function addCheck(doc, modal, key, label, checked) {
  const row = doc.createElement('label');
  row.className = 'xcp-check';
  row.setAttribute('data-xcp-field', key);
  const input = doc.createElement('input');
  input.setAttribute('type', 'checkbox');
  input.setAttribute('data-xcp-control', key);
  input.checked = !!checked;
  const caption = doc.createElement('span');
  caption.textContent = label;
  row.appendChild(input);
  row.appendChild(caption);
  modal.appendChild(row);
  return input;
}

function addButton(doc, modal, action, label, primary) {
  const button = doc.createElement('button');
  button.className = primary ? 'xcp-btn xcp-btn-primary' : 'xcp-btn';
  button.setAttribute('type', 'button');
  button.setAttribute('data-xcp-action', action);
  button.textContent = label;
  modal.appendChild(button);
  return button;
}

function addRow(doc, modal, label, value) {
  const row = doc.createElement('div');
  row.className = 'xcp-stat-row';
  const left = doc.createElement('span');
  left.textContent = label;
  const right = doc.createElement('span');
  right.textContent = value;
  row.appendChild(left);
  row.appendChild(right);
  modal.appendChild(row);
  return row;
}

function menuIsXHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com');
}

function menuIsLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return LOCAL_HOSTS.includes(host);
}

function endpointError(raw, required, allowLocal) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return required ? '需要填写接口地址' : '';
  if (value.length > 300) return '地址过长';
  if (/\s/.test(value)) return '地址不能包含空白';
  let parsed = null;
  try {
    parsed = new URL(value);
  } catch (err) {
    return '地址不完整';
  }
  if (parsed.username || parsed.password) return '地址不能包含账号密码';
  if (menuIsXHost(String(parsed.hostname || '').toLowerCase().replace(/\.$/, ''))) return '不能使用 X 的域名';
  if (parsed.protocol === 'https:') return '';
  if (allowLocal && parsed.protocol === 'http:' && menuIsLocalHost(parsed.hostname)) return '';
  return '地址必须是 https（本地可用 http）';
}

function keyError(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return '';
  if (/\s/.test(value)) return 'Key 不能包含空白';
  if (value.length < 10 || value.length > 200) return 'Key 长度需为 10–200';
  return '';
}

function modelError(raw, required) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return required ? '需要填写模型名' : '';
  if (!/^[A-Za-z0-9._:/@-]{1,64}$/.test(value)) return '模型名只允许字母、数字、. _ : / @ -';
  return '';
}

function numberValue(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return NaN;
  return Number(text);
}

function readForm(fields) {
  return {
    evalProvider: fields.evalProvider.value,
    jevUrl: String(fields.jevUrl.value || '').trim(),
    jevKey: String(fields.jevKey.value || '').trim(),
    jevModel: String(fields.jevModel.value || '').trim(),
    jevSchema: String(fields.jevSchema.value || '').trim(),
    namerProvider: fields.namerProvider.value,
    namerUrl: String(fields.namerUrl.value || '').trim(),
    namerKey: String(fields.namerKey.value || '').trim(),
    namerModel: String(fields.namerModel.value || '').trim(),
    labelLang: fields.labelLang.value,
    tone: fields.tone.value,
    temperature: numberValue(fields.temperature.value),
    dwellMs: numberValue(fields.dwellMs.value),
    dailyBudget: numberValue(fields.dailyBudget.value),
    autoLabelAll: !!fields.autoLabelAll.checked,
    enabled: !!fields.enabled.checked
  };
}

function validateSettings(next) {
  const errors = [];
  const push = (key, message) => errors.push({ key, message });
  const jevMode = next.evalProvider === 'jev';
  const namerOn = next.namerProvider !== 'none';

  if (!jevMode && next.evalProvider !== 'combined') push('evalProvider', '评估模式无效');

  let err = endpointError(next.jevUrl, jevMode, true);
  if (err) push('jevUrl', err);
  err = keyError(next.jevKey);
  if (err) push('jevKey', err);
  err = modelError(next.jevModel, jevMode);
  if (err) push('jevModel', err);
  if (next.jevSchema.length > 64) push('jevSchema', 'Rubric 标记不能超过 64 个字符');

  if (!NAMER_PROVIDERS.includes(next.namerProvider)) push('namerProvider', 'Provider 无效');
  err = endpointError(next.namerUrl, namerOn, true);
  if (err) push('namerUrl', err);
  err = keyError(next.namerKey);
  if (err) push('namerKey', err);
  err = modelError(next.namerModel, namerOn);
  if (err) push('namerModel', err);

  if (!XCP.LANGS.includes(next.labelLang)) push('labelLang', '标签语言无效');
  if (!XCP.TONES.includes(next.tone)) push('tone', '语气无效');

  if (!Number.isFinite(next.temperature) || next.temperature < 0 || next.temperature > 1.5) {
    push('temperature', '温度需在 0–1.5');
  }
  if (!Number.isInteger(next.dwellMs) || next.dwellMs < XCP.DWELL_MIN || next.dwellMs > XCP.DWELL_MAX) {
    push('dwellMs', '停留需为 ' + XCP.DWELL_MIN + '–' + XCP.DWELL_MAX + ' 的整数');
  }
  if (!Number.isInteger(next.dailyBudget) || next.dailyBudget < 0 || next.dailyBudget > 5000) {
    push('dailyBudget', '日预算需为 0–5000 的整数');
  }

  return errors;
}

function clearErrors(modal, errorLine) {
  errorLine.textContent = '';
  for (const node of modal.querySelectorAll('[data-xcp-error]')) node.textContent = '';
}

function findByAttr(root, attribute, value) {
  for (const node of root.querySelectorAll('[' + attribute + ']')) {
    if (node.getAttribute(attribute) === value) return node;
  }
  return null;
}

function addModelList(doc, modal, id, input, models) {
  const list = doc.createElement('datalist');
  list.id = id;
  for (const model of models) {
    const option = doc.createElement('option');
    option.value = model;
    list.appendChild(option);
  }
  modal.appendChild(list);
  input.setAttribute('list', id);
}

function buildSettingsForm(doc, modal, settings, storage, options) {
  const fields = Object.create(null);

  addSection(doc, modal, '评估');
  fields.evalProvider = selectControl(doc, 'evalProvider', settings.evalProvider, [
    { value: 'jev', label: 'Jev 评估 + 生成起名' },
    { value: 'combined', label: '单一模型（combined）' }
  ]);
  addField(doc, modal, 'evalProvider', '评估模式', fields.evalProvider);
  fields.jevUrl = textControl(doc, 'jevUrl', settings.jevUrl, 'text', XCP.DEFAULT_JEV_URL);
  addField(doc, modal, 'jevUrl', 'Jev URL', fields.jevUrl);
  fields.jevKey = textControl(doc, 'jevKey', settings.jevKey, 'password', 'jev_...');
  addField(doc, modal, 'jevKey', 'Jev Key', fields.jevKey);
  fields.jevModel = textControl(doc, 'jevModel', settings.jevModel, 'text', XCP.DEFAULT_JEV_MODEL);
  addField(doc, modal, 'jevModel', 'Jev 模型', fields.jevModel);
  fields.jevSchema = textControl(doc, 'jevSchema', settings.jevSchema, 'text', XCP.DEFAULT_JEV_SCHEMA);
  addField(doc, modal, 'jevSchema', 'Rubric 版本（本地标记，不发送）', fields.jevSchema);

  addSection(doc, modal, '起名');
  fields.namerProvider = selectControl(doc, 'namerProvider', settings.namerProvider, NAMER_PROVIDERS.map((value) => ({
    value,
    label: PROVIDER_LABELS[value] || value
  })));
  addField(doc, modal, 'namerProvider', '起名 Provider', fields.namerProvider);
  fields.namerUrl = textControl(doc, 'namerUrl', settings.namerUrl, 'text', XCP.DEFAULT_API_URL);
  addField(doc, modal, 'namerUrl', '起名 URL', fields.namerUrl);
  fields.namerKey = textControl(doc, 'namerKey', settings.namerKey, 'password', 'sk-...');
  addField(doc, modal, 'namerKey', '起名 Key', fields.namerKey);
  fields.namerModel = textControl(doc, 'namerModel', settings.namerModel, 'text', XCP.DEFAULT_MODEL);
  addField(doc, modal, 'namerModel', '起名模型', fields.namerModel);
  addModelList(doc, modal, 'xcp-jev-models', fields.jevModel, ['jev-latest', 'jev-preview']);
  addModelList(doc, modal, 'xcp-namer-models', fields.namerModel, [
    'auto/glm-5.3-flash', 'auto/kimi-k3', 'auto/deepseek-v4.1-flash', 'auto/qwen3.8-max',
    'auto/gpt-6-luna', 'auto/gemini-3.8-flash'
  ]);
  const presetActions = doc.createElement('div');
  presetActions.className = 'xcp-actions';
  modal.appendChild(presetActions);
  const applyMagpieEval = () => {
    fields.evalProvider.value = 'jev';
    fields.jevUrl.value = XCP.MAGPIE_BASE_URL;
    fields.jevKey.value = '';
    fields.jevModel.value = XCP.MAGPIE_JEV_MODEL;
  };
  const applyMagpieNamer = () => {
    fields.namerProvider.value = 'openai';
    fields.namerUrl.value = XCP.MAGPIE_URL;
    fields.namerKey.value = '';
    fields.namerModel.value = XCP.MAGPIE_MODEL;
  };
  const magpieEval = addButton(doc, presetActions, 'use-magpie-eval', '使用本地 Magpie 评估', false);
  magpieEval.addEventListener('click', () => {
    applyMagpieEval();
    showToast('已填入本地 Magpie 评估，保存后生效', doc);
  });
  const magpieName = addButton(doc, presetActions, 'use-magpie-name', '使用本地 Magpie 起名', false);
  magpieName.addEventListener('click', () => {
    applyMagpieNamer();
    showToast('已填入本地 Magpie 起名，保存后生效', doc);
  });
  const magpieAll = addButton(doc, presetActions, 'use-magpie', '全部使用本地 Magpie', true);
  magpieAll.addEventListener('click', () => {
    applyMagpieEval();
    applyMagpieNamer();
    showToast('已全部填入本地 Magpie，保存后生效', doc);
  });
  const testActions = doc.createElement('div');
  testActions.className = 'xcp-actions';
  modal.appendChild(testActions);
  const testJev = addButton(doc, testActions, 'test-jev', '测试 Jev', false);
  const testNamer = addButton(doc, testActions, 'test-namer', '测试起名', false);

  addSection(doc, modal, '标签');
  fields.labelLang = selectControl(doc, 'labelLang', settings.labelLang, XCP.LANGS.map((value) => ({
    value,
    label: LANG_LABELS[value] || value
  })));
  addField(doc, modal, 'labelLang', '标签语言', fields.labelLang);
  fields.tone = selectControl(doc, 'tone', settings.tone, XCP.TONES.map((value) => ({
    value,
    label: TONE_LABELS[value] || value
  })));
  addField(doc, modal, 'tone', '语气', fields.tone);

  addSection(doc, modal, '高级');
  fields.temperature = textControl(doc, 'temperature', settings.temperature, 'number');
  fields.temperature.setAttribute('step', '0.1');
  addField(doc, modal, 'temperature', '温度（0–1.5）', fields.temperature);
  fields.dwellMs = textControl(doc, 'dwellMs', settings.dwellMs, 'number');
  fields.dwellMs.setAttribute('step', '100');
  addField(doc, modal, 'dwellMs', '停留阈值（毫秒）', fields.dwellMs);
  fields.dailyBudget = textControl(doc, 'dailyBudget', settings.dailyBudget, 'number');
  fields.dailyBudget.setAttribute('step', '1');
  addField(doc, modal, 'dailyBudget', '日预算（0 不限）', fields.dailyBudget);
  fields.autoLabelAll = addCheck(doc, modal, 'autoLabelAll', '全员自动打标', settings.autoLabelAll);
  fields.enabled = addCheck(doc, modal, 'enabled', '启用打标', settings.enabled);

  addSection(doc, modal, '本地档案');
  const hiddenLine = doc.createElement('p');
  hiddenLine.id = 'xcp-hidden-count';
  hiddenLine.className = 'xcp-usage';
  hiddenLine.textContent = hiddenCountText(storage);
  modal.appendChild(hiddenLine);
  const localActions = doc.createElement('div');
  localActions.className = 'xcp-actions';
  modal.appendChild(localActions);
  const restore = addButton(doc, localActions, 'restore-hidden', '恢复全部隐藏账号', false);
  restore.addEventListener('click', () => {
    restoreHidden(storage, doc, options.onSettingsChanged);
    hiddenLine.textContent = hiddenCountText(storage);
  });

  const usage = doc.createElement('p');
  usage.id = 'xcp-usage-line';
  usage.className = 'xcp-usage';
  usage.textContent = usageLine(storage, settings);
  modal.appendChild(usage);

  const errorLine = doc.createElement('p');
  errorLine.id = 'xcp-error-line';
  errorLine.className = 'xcp-error-line';
  modal.appendChild(errorLine);

  const testContext = {
    fields,
    modal,
    errorLine,
    transport: options.transport,
    storage,
    doc
  };
  testJev.addEventListener('click', () => {
    runConnectionTest('jev', testJev, testContext).catch(() => {});
  });
  testNamer.addEventListener('click', () => {
    runConnectionTest('namer', testNamer, testContext).catch(() => {});
  });

  const actions = doc.createElement('div');
  actions.className = 'xcp-actions';
  modal.appendChild(actions);
  const cancel = addButton(doc, actions, 'cancel', '取消', false);
  const save = addButton(doc, actions, 'save', '保存', true);

  cancel.addEventListener('click', () => closeModal(doc));
  save.addEventListener('click', () => {
    const next = readForm(fields);
    const errors = validateSettings(next);
    if (showFormErrors(modal, errorLine, errors)) return;
    let saved = null;
    try {
      saved = storage.saveSettings(next);
    } catch (err) {
      errorLine.textContent = '保存失败：' + (err && err.message ? err.message : String(err));
      return;
    }
    closeModal(doc);
    showToast('设置已保存', doc);
    if (typeof options.onSettingsChanged === 'function') {
      try { options.onSettingsChanged(saved || next); } catch (err) {}
    }
  });

  return { fields, save, cancel };
}

export function openSettings(options = {}) {
  const { storage, onSettingsChanged, doc } = options;
  const d = menuResolveDoc(doc);
  if (!d || !storage) return null;
  const existing = d.getElementById('xcp-backdrop');
  if (existing) {
    if (existing.getAttribute('data-xcp-modal') === 'settings') {
      const first = existing.querySelector('[data-xcp-control]');
      if (first && typeof first.focus === 'function') first.focus();
      return existing;
    }
    closeModal(d);
  }
  ensureMenuStyles(d);
  const settings = menuReadSettings(storage);
  const { backdrop, modal } = createBackdrop(d, 'settings');
  bindModalDismiss(d, backdrop);

  const title = d.createElement('h2');
  title.id = 'xcp-settings-title';
  title.textContent = 'XCP 设置';
  modal.setAttribute('aria-labelledby', 'xcp-settings-title');
  modal.appendChild(title);

  const privacy = d.createElement('p');
  privacy.textContent = '样本（推文正文）会发往你配置的评估与起名接口；Key 只保存在本地，不会写入导出文件。';
  modal.appendChild(privacy);

  buildSettingsForm(d, modal, settings, storage, {
    onSettingsChanged,
    transport: resolveTransport(options.transport)
  });
  return backdrop;
}

function statCount(stats) {
  return firstCount(stats, ['profiles', 'count', 'total', 'handles']);
}

function showUsage(storage, doc) {
  const d = menuResolveDoc(doc);
  if (!d || !storage) return null;
  const existing = d.getElementById('xcp-backdrop');
  if (existing) {
    if (existing.getAttribute('data-xcp-modal') === 'usage') {
      const close = existing.querySelector('[data-xcp-action="close"]');
      if (close && typeof close.focus === 'function') close.focus();
      return existing;
    }
    closeModal(d);
  }
  ensureMenuStyles(d);
  const settings = menuReadSettings(storage);
  const usage = readUsage(storage);
  const stats = readStats(storage);
  const { backdrop, modal } = createBackdrop(d, 'usage');
  bindModalDismiss(d, backdrop);

  const title = d.createElement('h2');
  title.id = 'xcp-usage-title';
  title.textContent = 'XCP 今日用量';
  modal.setAttribute('aria-labelledby', 'xcp-usage-title');
  modal.appendChild(title);

  const total = firstCount(usage, ['count', 'total', 'requests']);
  const evals = firstCount(usage, ['eval', 'evaluate', 'assess', 'assessmentCount']);
  const names = firstCount(usage, ['name', 'naming', 'label', 'labelCount']);
  const budget = menuToCount(settings.dailyBudget) || 0;
  const profiles = statCount(stats);
  addRow(d, modal, '模式', modeLabel(settings));
  addRow(d, modal, '今日请求', total == null ? '0' : String(total));
  if (evals != null || names != null) {
    addRow(d, modal, '今日评估', evals == null ? '—' : String(evals));
    addRow(d, modal, '今日起名', names == null ? '—' : String(names));
  }
  addRow(d, modal, '日预算', budget ? String(budget) : '不限');
  addRow(d, modal, '档案数', profiles == null ? '—' : String(profiles));
  addRow(d, modal, '近似占用', formatBytes(stats.bytes != null ? stats.bytes : stats.size));
  const error = formatError(usage.lastError != null ? usage.lastError : usage.error);
  if (error) {
    const paused = !!(usage.authPaused || usage.paused);
    addRow(d, modal, '最近错误', error + (paused ? '（已暂停）' : ''));
  }

  const tip = d.createElement('p');
  tip.className = 'xcp-usage';
  tip.textContent = '预算 0 表示不限。修改预算或其他选项请打开“XCP 设置”。';
  modal.appendChild(tip);

  const actions = d.createElement('div');
  actions.className = 'xcp-actions';
  modal.appendChild(actions);
  const close = addButton(d, actions, 'close', '关闭', true);
  close.addEventListener('click', () => closeModal(d));
  if (typeof close.focus === 'function') close.focus();
  return backdrop;
}

function toggleEnabled(storage, doc, onSettingsChanged) {
  const d = menuResolveDoc(doc);
  if (!d || !storage) return;
  const settings = menuReadSettings(storage);
  const enabled = !settings.enabled;
  try {
    storage.saveSettings({ enabled });
  } catch (err) {
    showToast('保存失败：' + (err && err.message ? err.message : String(err)), d);
    return;
  }
  showToast(enabled ? '打标已开启' : '打标已关闭', d);
  if (typeof onSettingsChanged === 'function') {
    try { onSettingsChanged({ enabled }); } catch (err) {}
  }
}

function exportToText(storage) {
  const payload = storage.exportJSON();
  if (typeof payload === 'string') return { text: payload, count: countProfiles(payload) };
  const text = JSON.stringify(payload);
  let count = null;
  if (payload && Array.isArray(payload.profiles)) count = payload.profiles.length;
  return { text, count };
}

function countProfiles(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.profiles)) return parsed.profiles.length;
    if (Array.isArray(parsed)) return parsed.length;
  } catch (err) {}
  return null;
}

function downloadText(doc, text, filename) {
  let href = '';
  let objectUrl = '';
  if (typeof Blob === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    objectUrl = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    href = objectUrl;
  } else {
    href = 'data:application/json;charset=utf-8,' + encodeURIComponent(text);
  }
  const anchor = doc.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.setAttribute('download', filename);
  anchor.style.display = 'none';
  bodyOf(doc).appendChild(anchor);
  if (typeof anchor.click === 'function') anchor.click();
  anchor.remove();
  if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    setTimeout(() => {
      try { URL.revokeObjectURL(objectUrl); } catch (err) {}
    }, 0);
  }
}

function exportProfiles(storage, doc) {
  const d = menuResolveDoc(doc);
  if (!d || !storage || typeof storage.exportJSON !== 'function') return null;
  let result = null;
  try {
    result = exportToText(storage);
  } catch (err) {
    showToast('导出失败：' + (err && err.message ? err.message : String(err)), d);
    return null;
  }
  downloadText(d, result.text, EXPORT_FILE);
  showToast(result.count == null ? '已导出档案' : '已导出 ' + result.count + ' 条档案', d);
  return result.text;
}

function importMessage(err) {
  const message = err && err.message ? String(err.message) : String(err);
  if (/json/i.test(message)) return '文件不是合法 JSON';
  if (/version|不支持|unsupported/i.test(message)) return '版本不支持';
  return '导入失败：' + message;
}

async function runImport(input, storage, doc, onSettingsChanged) {
  const files = input && input.files;
  const file = files && files[0] ? files[0] : null;
  input.remove();
  if (!file) return;
  if (typeof file.size === 'number' && file.size > MAX_IMPORT_BYTES) {
    showToast('文件超过 10MB，已取消导入', doc);
    return;
  }
  let text = '';
  try {
    if (typeof file.text !== 'function') throw new Error('无法读取文件');
    text = await file.text();
  } catch (err) {
    showToast('读取文件失败', doc);
    return;
  }
  try {
    JSON.parse(text);
  } catch (err) {
    showToast('文件不是合法 JSON', doc);
    return;
  }
  let result = null;
  try {
    result = await storage.importJSON(text);
  } catch (err) {
    showToast(importMessage(err), doc);
    return;
  }
  const imported = firstCount(result, ['imported', 'added', 'count', 'profiles']);
  const skipped = firstCount(result, ['skipped', 'invalid', 'rejected']);
  showToast(
    '导入 ' + (imported == null ? 0 : imported) + ' 条，跳过 ' + (skipped == null ? 0 : skipped) + ' 条',
    doc
  );
  if (typeof onSettingsChanged === 'function') {
    try { onSettingsChanged(); } catch (err) {}
  }
}

function importProfiles(storage, doc, onSettingsChanged) {
  const d = menuResolveDoc(doc);
  if (!d || !storage) return null;
  const stale = d.getElementById('xcp-import-file');
  if (stale) stale.remove();
  const input = d.createElement('input');
  input.id = 'xcp-import-file';
  input.setAttribute('type', 'file');
  input.setAttribute('accept', '.json,application/json');
  input.style.display = 'none';
  input.addEventListener('change', () => {
    runImport(input, storage, d, onSettingsChanged).catch((err) => {
      showToast('导入失败', d);
    });
  });
  bodyOf(d).appendChild(input);
  if (typeof input.click === 'function') input.click();
  return input;
}

function clearProfiles(storage, doc, win, onSettingsChanged) {
  const d = menuResolveDoc(doc);
  if (!d || !storage) return false;
  const view = win || d.defaultView || (typeof window === 'undefined' ? null : window);
  const confirmFn = view && typeof view.confirm === 'function' ? view.confirm : null;
  if (!confirmFn) {
    showToast('当前环境无法确认，已取消清空', d);
    return false;
  }
  const message = '清空所有本地画像？此操作不可撤销，API 设置会保留。';
  if (!confirmFn.call(view, message)) return false;
  const stats = readStats(storage);
  const count = statCount(stats);
  try {
    storage.clearAll();
  } catch (err) {
    showToast('清空失败：' + (err && err.message ? err.message : String(err)), d);
    return false;
  }
  showToast(count == null ? '已清空本地画像' : '已清空 ' + count + ' 条画像', d);
  if (typeof onSettingsChanged === 'function') {
    try { onSettingsChanged(); } catch (err) {}
  }
  return true;
}

export function registerMenu(options = {}) {
  const { storage, onSettingsChanged, doc, win, transport } = options;
  const d = menuResolveDoc(doc);
  if (!d || !storage) return false;
  const register = typeof globalThis !== 'undefined' && typeof globalThis.GM_registerMenuCommand === 'function'
    ? globalThis.GM_registerMenuCommand
    : null;
  if (!register) return false;
  const entries = [
    [MENU_COMMANDS[0], () => openSettings({ storage, onSettingsChanged, doc: d, transport })],
    [MENU_COMMANDS[1], () => toggleEnabled(storage, d, onSettingsChanged)],
    [MENU_COMMANDS[2], () => exportProfiles(storage, d)],
    [MENU_COMMANDS[3], () => importProfiles(storage, d, onSettingsChanged)],
    [MENU_COMMANDS[4], () => clearProfiles(storage, d, win, onSettingsChanged)],
    [MENU_COMMANDS[5], () => showUsage(storage, d)]
  ];
  for (const entry of entries) {
    try {
      register(entry[0], entry[1]);
    } catch (err) {}
  }
  return true;
}

export function showToast(text, doc) {
  const d = menuResolveDoc(doc);
  if (!d) return null;
  ensureMenuStyles(d);
  let toast = d.getElementById('xcp-toast');
  if (!toast) {
    toast = d.createElement('div');
    toast.id = 'xcp-toast';
    toast.className = 'xcp-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    bodyOf(d).appendChild(toast);
  }
  toast.textContent = String(text == null ? '' : text);
  clearTimeout(toastTimers.get(d));
  const timer = setTimeout(() => {
    toastTimers.delete(d);
    const node = d.getElementById('xcp-toast');
    if (node) node.remove();
  }, XCP.TOAST_MS);
  toastTimers.set(d, timer);
  return toast;
}
