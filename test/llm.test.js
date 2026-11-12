import test from 'node:test';
import assert from 'node:assert/strict';
import { createLLM, parseModelJson, LLMError } from '../src/llm.js';

const BASE = {
  jevUrl: 'https://api.example.com/v1/evaluate',
  jevKey: 'jek',
  jevModel: 'jev',
  jevSchema: 'xcp.profile.v1',
  namerProvider: 'openai',
  namerUrl: 'https://api.example.com/v1/chat/completions',
  namerKey: 'nk',
  namerModel: 'model',
  temperature: 0.2,
  jsonMode: true
};

function settings(overrides = {}) {
  return Object.assign({}, BASE, overrides);
}

function response(status, payload, headers = '') {
  return {
    status,
    responseText: typeof payload === 'string' ? payload : JSON.stringify(payload),
    headers
  };
}

function chatBody(text, finishReason = 'stop') {
  return {
    choices: [{ message: { content: text }, finish_reason: finishReason }],
    usage: { total_tokens: 3 }
  };
}

function fakeTransport(sequence) {
  const calls = [];
  const transport = (options) => {
    calls.push(options);
    const item = sequence.shift();
    if (!item) return Promise.reject(new Error('unexpected request'));
    return typeof item === 'function' ? item(options) : Promise.resolve(item);
  };
  return { transport, calls };
}

test('chat returns parsed text, json, usage and finish reason', async () => {
  const { transport, calls } = fakeTransport([response(200, chatBody('{"ok":true}'))]);
  const llm = createLLM({ transport, getSettings: () => settings() });

  const result = await llm.chat([{ role: 'user', content: 'hi' }], {
    maxTokens: 100, jsonMode: true
  });

  assert.equal(result.text, '{"ok":true}');
  assert.deepEqual(result.json, { ok: true });
  assert.deepEqual(result.usage, { total_tokens: 3 });
  assert.equal(result.finishReason, 'stop');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, 'Bearer nk');
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.max_tokens, 100);
});

test('chat drops response_format once after a 400', async () => {
  const seen = [];
  const { transport, calls } = fakeTransport([
    (options) => {
      seen.push(JSON.parse(options.body));
      return Promise.resolve(response(400, { error: 'response_format unsupported' }));
    },
    (options) => {
      seen.push(JSON.parse(options.body));
      return Promise.resolve(response(200, chatBody('{"ok":1}')));
    }
  ]);
  const llm = createLLM({ transport, getSettings: () => settings({ jevKey: '' }) });

  const result = await llm.chat([{ role: 'user', content: 'hi' }], { jsonMode: true });

  assert.equal(result.text, '{"ok":1}');
  assert.equal(calls.length, 2);
  assert.deepEqual(seen[0].response_format, { type: 'json_object' });
  assert.equal(seen[1].response_format, undefined);
});

test('retries 429 twice at most and honors a short Retry-After', async () => {
  const { transport, calls } = fakeTransport([
    response(429, { error: 'slow down' }, 'Retry-After: 0'),
    response(200, chatBody('after'))
  ]);
  const llm = createLLM({ transport, getSettings: () => settings({ jevKey: '' }) });

  const result = await llm.chat([{ role: 'user', content: 'hi' }]);
  assert.equal(result.text, 'after');
  assert.equal(calls.length, 2);
});

test('does not retry 401 and exposes the status', async () => {
  const { transport, calls } = fakeTransport([response(401, { error: 'nope' })]);
  const llm = createLLM({ transport, getSettings: () => settings({ jevKey: '' }) });

  await assert.rejects(
    llm.chat([{ role: 'user', content: 'hi' }]),
    (err) => err instanceof LLMError && err.status === 401 && err.retryable === false
  );
  assert.equal(calls.length, 1);
});

test('retries once when a 200 has empty content', async () => {
  const { transport, calls } = fakeTransport([
    response(200, chatBody('')),
    response(200, chatBody('filled'))
  ]);
  const llm = createLLM({ transport, getSettings: () => settings({ jevKey: '' }) });

  const result = await llm.chat([{ role: 'user', content: 'hi' }]);
  assert.equal(result.text, 'filled');
  assert.equal(calls.length, 2);
});

test('throws EMPTY after one empty retry, and TRUNCATED without retry', async () => {
  const empty = fakeTransport([response(200, chatBody('')), response(200, chatBody(''))]);
  const llmEmpty = createLLM({ transport: empty.transport, getSettings: () => settings({ jevKey: '' }) });
  await assert.rejects(
    llmEmpty.chat([{ role: 'user', content: 'hi' }]),
    (err) => err instanceof LLMError && err.code === 'EMPTY'
  );
  assert.equal(empty.calls.length, 2);

  const truncated = fakeTransport([response(200, chatBody('{"partial":', 'length'))]);
  const llmTruncated = createLLM({
    transport: truncated.transport,
    getSettings: () => settings({ jevKey: '' })
  });
  await assert.rejects(
    llmTruncated.chat([{ role: 'user', content: 'hi' }]),
    (err) => err instanceof LLMError && err.code === 'TRUNCATED'
  );
  assert.equal(truncated.calls.length, 1);
});

test('rejects responses above 50KB before parsing', async () => {
  const { transport, calls } = fakeTransport([response(200, 'x'.repeat(60000))]);
  const llm = createLLM({ transport, getSettings: () => settings({ jevKey: '' }) });

  await assert.rejects(
    llm.chat([{ role: 'user', content: 'hi' }]),
    (err) => err instanceof LLMError && err.code === 'TOO_LARGE'
  );
  assert.equal(calls.length, 1);
});

test('jev posts model, schema and input to the evaluator endpoint', async () => {
  const { transport, calls } = fakeTransport([response(200, { output: { archetype: { ad: 1 } } })]);
  const llm = createLLM({
    transport,
    getSettings: () => settings({ namerKey: '' })
  });

  assert.equal(llm.mode(), 'jev-only');
  const result = await llm.jev({ handle: 'a', samples: [] }, { maxTokens: 80 });

  assert.deepEqual(result.json, { archetype: { ad: 1 } });
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(body, {
    model: 'jev',
    schema: 'xcp.profile.v1',
    input: { handle: 'a', samples: [] }
  });
  assert.equal(calls[0].headers.Authorization, 'Bearer jek');
});

test('jev unwraps a payload that already contains model, schema and input', async () => {
  const { transport, calls } = fakeTransport([response(200, { archetype: { ad: 1 } })]);
  const llm = createLLM({
    transport,
    getSettings: () => settings({ namerKey: '' })
  });

  await llm.jev({
    model: 'jev',
    schema: 'xcp.profile.v1',
    input: { handle: 'a', samples: [] }
  });

  const body = JSON.parse(calls[0].body);
  assert.deepEqual(body, {
    model: 'jev',
    schema: 'xcp.profile.v1',
    input: { handle: 'a', samples: [] }
  });
});

test('mode reports the effective configuration', () => {
  const llm = createLLM({ getSettings: () => settings() });
  assert.equal(llm.mode(), 'jev');
  const combined = createLLM({ getSettings: () => settings({ jevKey: '' }) });
  assert.equal(combined.mode(), 'combined');
  const none = createLLM({ getSettings: () => settings({ jevKey: '', namerKey: '' }) });
  assert.equal(none.mode(), 'none');
});

test('parseModelJson handles plain, fenced, think-wrapped and prose output', () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseModelJson('<think>secret</think>\n{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('Here you go:\n{"a":"} inside","b":2}\nDone.'), {
    a: '} inside',
    b: 2
  });
});

test('parseModelJson rejects non-objects and invalid JSON', () => {
  for (const value of [null, 1, {}, [], true]) {
    assert.throws(() => parseModelJson(value), (err) => err instanceof LLMError && err.code === 'BAD_JSON');
  }
  assert.throws(() => parseModelJson('no braces'), (err) => err.code === 'BAD_JSON');
  assert.throws(() => parseModelJson('{"a":'), (err) => err.code === 'BAD_JSON');
  assert.throws(() => parseModelJson('[1,2]'), (err) => err.code === 'BAD_JSON');
});
