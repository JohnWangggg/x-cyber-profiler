import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './dom-stub.js';
import { createGM } from './gm-stub.js';
import { createStorage } from '../src/storage.js';
import { registerMenu, openSettings, showToast } from '../src/menu.js';

const COMMAND_TITLES = [
  'XCP 设置',
  'XCP 开关打标',
  'XCP 导出档案',
  'XCP 导入档案',
  'XCP 清空档案',
  'XCP 今日用量'
];

async function setup(t, options = {}) {
  const doc = createDocument();
  const gm = createGM();
  const storage = createStorage(gm);
  await storage.init();
  const commands = [];
  const previous = globalThis.GM_registerMenuCommand;
  globalThis.GM_registerMenuCommand = (name, fn) => {
    commands.push({ name, fn });
    return commands.length;
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.GM_registerMenuCommand;
    else globalThis.GM_registerMenuCommand = previous;
  });
  const calls = { settings: 0, reassess: 0 };
  const win = options.win || { confirm: () => false };
  registerMenu({
    storage,
    onSettingsChanged: () => { calls.settings += 1; },
    onReassess: () => { calls.reassess += 1; },
    doc,
    win,
    transport: options.transport
  });
  return { doc, gm, storage, commands, calls, win };
}

function setControl(doc, key, value) {
  const el = doc.querySelector('[data-xcp-control="' + key + '"]');
  assert.ok(el, 'missing control ' + key);
  if (el.getAttribute('type') === 'checkbox') el.checked = !!value;
  else el.value = String(value);
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

function seedProfile(storage, handle = 'crypto_bot_99') {
  const profile = storage.get(handle);
  profile.displayName = 'Web3 Alpha Hunter';
  profile.sampleCount = 2;
  profile.charCount = 18;
  profile.samples = [
    { id: '1794390000000', text: 'Check my pinned tweet', links: [], promoted: false, ts: 1794390000000 }
  ];
  profile.seenIds = ['1794390000000'];
  profile.label = {
    text: '空投布道师',
    vibe: 'ember',
    archetype: 'ad',
    confidence: 0.86,
    reason: '三条推文都在承诺空投收益。',
    lang: 'zh',
    tone: 'sharp',
    stage: 1,
    updatedAt: 1794390000000
  };
  profile.dossier = '以 Web3 导师人设活动。';
  profile.stage = 1;
  profile.createdAt = 1794300000000;
  profile.updatedAt = 1794390000000;
  storage.commit(profile);
  return profile;
}

test('registers exactly the six menu commands', async (t) => {
  const { commands } = await setup(t);
  assert.deepEqual(commands.map((entry) => entry.name), COMMAND_TITLES);
  assert.equal(typeof commands[0].fn, 'function');
});

test('openSettings reuses the open modal and Escape closes it', async (t) => {
  const { doc, storage } = await setup(t);
  const first = openSettings({ storage, doc });
  const second = openSettings({ storage, doc });
  assert.equal(first, second);
  assert.equal(doc.querySelectorAll('#xcp-backdrop').length, 1);
  assert.ok(doc.getElementById('xcp-usage-line').textContent.length > 0);
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(doc.getElementById('xcp-backdrop'), null);
});

test('save keeps false and 0 instead of defaults', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { doc, storage, calls } = await setup(t);
  const before = storage.loadSettings();
  assert.equal(before.enabled, true);
  assert.equal(before.dailyBudget, 400);

  openSettings({ storage, onSettingsChanged: () => { calls.settings += 1; }, doc });
  setControl(doc, 'dailyBudget', 0);
  setControl(doc, 'temperature', 0);
  setControl(doc, 'dwellMs', 300);
  setControl(doc, 'enabled', false);
  setControl(doc, 'autoLabelAll', false);
  doc.querySelector('[data-xcp-action="save"]').click();

  const saved = storage.loadSettings();
  assert.equal(saved.dailyBudget, 0);
  assert.equal(saved.temperature, 0);
  assert.equal(saved.dwellMs, 300);
  assert.equal(saved.enabled, false);
  assert.equal(saved.autoLabelAll, false);
  assert.equal(saved.jevUrl, before.jevUrl);
  assert.equal(calls.settings, 1);
  assert.equal(doc.getElementById('xcp-backdrop'), null);
  assert.equal(doc.getElementById('xcp-toast').textContent, '设置已保存');
  t.mock.timers.tick(2400);
});

test('invalid settings stay in the modal and report the first error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { doc, storage } = await setup(t);
  openSettings({ storage, doc });
  setControl(doc, 'dailyBudget', 99999);
  doc.querySelector('[data-xcp-action="save"]').click();
  assert.ok(doc.getElementById('xcp-backdrop'));
  assert.match(doc.getElementById('xcp-error-line').textContent, /日预算/);
  assert.equal(storage.loadSettings().dailyBudget, 400);
});

test('toggle flips enabled, toasts, and calls the callback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { commands, doc, storage, calls } = await setup(t);
  commands[1].fn();
  assert.equal(storage.loadSettings().enabled, false);
  assert.equal(doc.getElementById('xcp-toast').textContent, '打标已关闭');
  commands[1].fn();
  assert.equal(storage.loadSettings().enabled, true);
  assert.equal(doc.getElementById('xcp-toast').textContent, '打标已开启');
  assert.equal(calls.settings, 2);
  t.mock.timers.tick(2400);
});

test('export downloads a Blob named xcp-profiles.json without keys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { commands, doc, storage } = await setup(t);
  seedProfile(storage);
  storage.saveSettings({ jevKey: 'jev-secret-key-12345', namerKey: 'namer-secret-key-67890' });

  const anchors = [];
  const createElement = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const el = createElement(tag);
    if (String(tag).toLowerCase() === 'a') anchors.push(el);
    return el;
  };
  const originalCreate = URL.createObjectURL;
  let captured = null;
  URL.createObjectURL = (blob) => {
    captured = blob;
    return 'blob:xcp-test';
  };
  t.after(() => { URL.createObjectURL = originalCreate; });

  commands[2].fn();
  assert.ok(captured, 'expected a Blob');
  const text = await captured.text();
  assert.match(text, /crypto_bot_99/);
  assert.doesNotMatch(text, /jev-secret-key-12345/);
  assert.doesNotMatch(text, /namer-secret-key-67890/);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].download, 'xcp-profiles.json');
  assert.match(doc.getElementById('xcp-toast').textContent, /已导出 1 条/);
  t.mock.timers.tick(2400);
});

test('import of a bad JSON file toasts and leaves profiles alone', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { commands, doc, storage } = await setup(t);
  seedProfile(storage);
  const epoch = storage.epoch();

  commands[3].fn();
  const input = doc.getElementById('xcp-import-file');
  assert.ok(input);
  input.files = [{ size: 5, text: async () => '{oops' }];
  input.dispatchEvent({ type: 'change' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(doc.getElementById('xcp-toast').textContent, '文件不是合法 JSON');
  assert.equal(doc.getElementById('xcp-import-file'), null);
  assert.equal(storage.epoch(), epoch);
  assert.ok(storage.peek('crypto_bot_99'));
  t.mock.timers.tick(2400);
});

test('clear asks for confirmation, clears storage, and calls the callback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const confirmed = [];
  const win = {
    confirm(message) {
      confirmed.push(message);
      return true;
    }
  };
  const { commands, doc, storage, calls } = await setup(t, { win });
  seedProfile(storage);
  const epoch = storage.epoch();

  commands[4].fn();
  assert.equal(confirmed.length, 1);
  assert.match(confirmed[0], /清空/);
  assert.equal(storage.peek('crypto_bot_99'), null);
  assert.equal(storage.epoch(), epoch + 1);
  assert.match(doc.getElementById('xcp-toast').textContent, /已清空/);
  assert.equal(calls.settings, 1);
  t.mock.timers.tick(2400);
});

test('clear does nothing when confirmation is declined', async (t) => {
  const { commands, storage } = await setup(t, { win: { confirm: () => false } });
  seedProfile(storage);
  const epoch = storage.epoch();
  commands[4].fn();
  assert.ok(storage.peek('crypto_bot_99'));
  assert.equal(storage.epoch(), epoch);
});

test('usage command shows today count and budget', async (t) => {
  const { commands, doc, storage } = await setup(t);
  storage.bumpUsage();
  storage.bumpUsage();
  commands[5].fn();
  assert.ok(doc.getElementById('xcp-backdrop'));
  assert.equal(doc.getElementById('xcp-usage-title').textContent, 'XCP 今日用量');
  const rows = [...doc.querySelectorAll('.xcp-stat-row')].map((row) => row.textContent);
  assert.ok(rows.some((row) => row.startsWith('今日请求') && row.endsWith('2')), rows.join(' | '));
});

test('showToast writes textContent and removes itself after 2400ms', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const doc = createDocument();
  const toast = showToast('hello', doc);
  assert.equal(toast.id, 'xcp-toast');
  assert.equal(toast.className, 'xcp-toast');
  assert.equal(toast.textContent, 'hello');
  assert.ok(doc.getElementById('xcp-toast'));
  t.mock.timers.tick(2400);
  assert.equal(doc.getElementById('xcp-toast'), null);
});

test('Jev connection test posts a minimal request and reports success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [];
  const transport = (request) => {
    requests.push(request);
    return Promise.resolve({ status: 200 });
  };
  const { commands, doc, storage } = await setup(t, { transport });
  storage.saveSettings({ jevKey: 'jev-secret-key-12345' });
  commands[0].fn();
  const before = storage.loadSettings();
  const button = doc.querySelector('[data-xcp-action="test-jev"]');
  button.click();
  await flush();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:3425/v1/systemone');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].timeout, 10000);
  assert.equal(requests[0].headers.Authorization, 'Bearer jev-secret-key-12345');
  const body = JSON.parse(requests[0].body);
  assert.equal(body.model, 'jev-latest');
  assert.equal(body.schema, undefined);
  assert.equal(body.state.handle, 'xcp-test');
  assert.equal(body.questions.ping.type, 'noul');
  assert.equal(doc.getElementById('xcp-toast').textContent, '连接正常');
  assert.doesNotMatch(doc.getElementById('xcp-toast').textContent, /jev-secret-key-12345/);
  assert.deepEqual(storage.loadSettings(), before);
  assert.equal(storage.getUsage().count, 1);
  assert.ok(doc.getElementById('xcp-backdrop'));
  assert.equal(button.disabled, false);
  t.mock.timers.tick(2400);
});

test('namer connection test uses the selected provider endpoint and prompt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = [];
  const transport = (request) => {
    requests.push(request);
    return Promise.resolve({ status: 200 });
  };
  const { commands, doc, storage } = await setup(t, { transport });
  storage.saveSettings({ namerKey: 'namer-secret-key-67890' });
  commands[0].fn();
  doc.querySelector('[data-xcp-action="test-namer"]').click();
  await flush();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:3425/v1/chat/completions');
  assert.equal(requests[0].headers.Authorization, 'Bearer namer-secret-key-67890');
  const body = JSON.parse(requests[0].body);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Return only {"ok":true} as json.' }]);
  assert.equal(body.max_tokens, 16);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(doc.getElementById('xcp-toast').textContent, '连接正常');
  assert.doesNotMatch(doc.getElementById('xcp-toast').textContent, /namer-secret-key-67890/);
  assert.ok(doc.getElementById('xcp-backdrop'));
  t.mock.timers.tick(2400);
});

test('connection test reports an invalid key for 401 without closing the modal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = () => Promise.resolve({ status: 401 });
  const { commands, doc, storage } = await setup(t, { transport });
  storage.saveSettings({ jevKey: 'jev-secret-key-12345' });
  commands[0].fn();
  const button = doc.querySelector('[data-xcp-action="test-jev"]');
  button.click();
  await flush();

  assert.equal(doc.getElementById('xcp-toast').textContent, 'Key 无效');
  assert.doesNotMatch(doc.getElementById('xcp-toast').textContent, /jev-secret-key-12345/);
  assert.ok(doc.getElementById('xcp-backdrop'));
  assert.equal(button.disabled, false);
  t.mock.timers.tick(2400);
});

test('connection test surfaces HTTP status and network failures', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let response = Promise.resolve({ status: 500 });
  const transport = () => response;
  const { commands, doc, storage } = await setup(t, { transport });
  storage.saveSettings({ jevKey: 'jev-secret-key-12345' });
  commands[0].fn();
  const button = doc.querySelector('[data-xcp-action="test-jev"]');
  button.click();
  await flush();
  assert.equal(doc.getElementById('xcp-toast').textContent, 'HTTP 500');

  response = Promise.reject(new Error('network down'));
  button.click();
  await flush();
  assert.match(doc.getElementById('xcp-toast').textContent, /连接失败/);
  assert.match(doc.getElementById('xcp-toast').textContent, /network down/);
  assert.ok(doc.getElementById('xcp-backdrop'));
  t.mock.timers.tick(2400);
});

test('connection test explains when no transport is available', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = globalThis.GM_xmlhttpRequest;
  delete globalThis.GM_xmlhttpRequest;
  t.after(() => {
    if (previous !== undefined) globalThis.GM_xmlhttpRequest = previous;
  });
  const { commands, doc, storage } = await setup(t);
  storage.saveSettings({ jevKey: 'jev-secret-key-12345' });
  commands[0].fn();
  doc.querySelector('[data-xcp-action="test-jev"]').click();
  await flush();
  assert.equal(doc.getElementById('xcp-toast').textContent, '当前环境不支持测试连接');
  t.mock.timers.tick(2400);
});

test('restore hidden profiles unhides every hidden profile and refreshes the count', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { commands, doc, storage, calls } = await setup(t);
  for (const handle of ['crypto_bot_99', 'airdrop_king']) {
    seedProfile(storage, handle);
    const profile = storage.peek(handle);
    profile.hidden = true;
    storage.commit(profile);
  }
  seedProfile(storage, 'normal_user');

  commands[0].fn();
  assert.equal(doc.getElementById('xcp-hidden-count').textContent, '隐藏账号：2');
  doc.querySelector('[data-xcp-action="restore-hidden"]').click();

  assert.equal(storage.peek('crypto_bot_99').hidden, false);
  assert.equal(storage.peek('airdrop_king').hidden, false);
  assert.equal(storage.peek('normal_user').hidden, false);
  assert.equal(calls.settings, 1);
  assert.equal(doc.getElementById('xcp-hidden-count').textContent, '隐藏账号：0');
  assert.match(doc.getElementById('xcp-toast').textContent, /2/);
  assert.ok(doc.getElementById('xcp-backdrop'));
  t.mock.timers.tick(2400);
});

test('local Magpie preset fills the namer fields without a key', async (t) => {
  const { doc, storage } = await setup(t);
  openSettings({ storage, doc });
  doc.querySelector('[data-xcp-action="use-magpie"]').click();
  assert.equal(doc.querySelector('[data-xcp-control="evalProvider"]').value, 'jev');
  assert.equal(doc.querySelector('[data-xcp-control="jevUrl"]').value, 'http://127.0.0.1:3425/v1');
  assert.equal(doc.querySelector('[data-xcp-control="jevModel"]').value, 'jev-latest');
  assert.equal(doc.querySelector('[data-xcp-control="jevKey"]').value, '');
  assert.equal(doc.querySelector('[data-xcp-control="namerProvider"]').value, 'openai');
  assert.equal(doc.querySelector('[data-xcp-control="namerUrl"]').value, 'http://127.0.0.1:3425/v1/chat/completions');
  assert.equal(doc.querySelector('[data-xcp-control="namerModel"]').value, 'auto/glm-5.3-flash');
  assert.equal(doc.querySelector('[data-xcp-control="namerKey"]').value, '');
});
