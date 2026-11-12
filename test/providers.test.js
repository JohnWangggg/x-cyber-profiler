import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS, effectiveMode, normalizeEndpoint, buildRequest, parseResponse,
  isRetryableStatus
} from '../src/providers.js';
import { LLMError } from '../src/llm.js';

function bodyOf(req) {
  return JSON.parse(req.init.body);
}

function isCode(code) {
  return (err) => err instanceof LLMError && err.code === code;
}

test('PROVIDERS lists the five adapters', () => {
  assert.deepEqual(PROVIDERS, ['openai', 'gemini', 'anthropic', 'ollama', 'jev']);
});

test('effectiveMode follows key and endpoint availability', () => {
  const jevUrl = 'https://api.example.com/v1/evaluate';
  assert.equal(effectiveMode({ jevKey: 'j', jevUrl, namerKey: 'n' }), 'jev');
  assert.equal(effectiveMode({ jevKey: 'j', jevUrl, namerKey: '' }), 'jev-only');
  assert.equal(effectiveMode({ jevKey: '', namerKey: 'n' }), 'combined');
  assert.equal(effectiveMode({}), 'none');
  assert.equal(effectiveMode({ jevKey: 'j', jevUrl: 'file:///etc/passwd', namerKey: 'n' }), 'combined');
  assert.equal(effectiveMode({ jevKey: 'j', jevUrl: 'file:///etc/passwd', namerKey: '' }), 'none');
});

test('normalizeEndpoint accepts https and localhost http', () => {
  assert.equal(
    normalizeEndpoint('openai', 'https://api.example.com/v1/chat/completions'),
    'https://api.example.com/v1/chat/completions'
  );
  assert.equal(
    normalizeEndpoint('ollama', 'http://localhost:11434/v1/chat/completions'),
    'http://localhost:11434/v1/chat/completions'
  );
  assert.equal(
    normalizeEndpoint('ollama', 'http://127.0.0.1:11434/v1/chat/completions'),
    'http://127.0.0.1:11434/v1/chat/completions'
  );
  assert.equal(
    normalizeEndpoint('ollama', 'http://[::1]:11434/v1/chat/completions'),
    'http://[::1]:11434/v1/chat/completions'
  );
});

test('normalizeEndpoint rejects external http, X domains and unsafe schemes', () => {
  assert.throws(() => normalizeEndpoint('openai', 'http://api.example.com/v1'), isCode('BAD_ENDPOINT'));
  assert.throws(() => normalizeEndpoint('openai', 'https://x.com/v1'), isCode('BAD_ENDPOINT'));
  assert.throws(() => normalizeEndpoint('openai', 'https://api.x.com/v1'), isCode('BAD_ENDPOINT'));
  assert.throws(() => normalizeEndpoint('openai', 'https://twitter.com/v1'), isCode('BAD_ENDPOINT'));
  assert.throws(() => normalizeEndpoint('openai', 'https://mobile.twitter.com/v1'), isCode('BAD_ENDPOINT'));
  assert.throws(() => normalizeEndpoint('openai', 'file:///etc/passwd'), isCode('BAD_ENDPOINT'));
  assert.throws(() => normalizeEndpoint('openai', 'data:text/plain,x'), isCode('BAD_ENDPOINT'));
  assert.throws(() => normalizeEndpoint('openai', 'javascript:alert(1)'), isCode('BAD_ENDPOINT'));
});

test('normalizeEndpoint defaults empty values and rejects bad spacing or length', () => {
  assert.match(normalizeEndpoint('openai', ''), /^https:\/\//);
  assert.match(normalizeEndpoint('ollama', ''), /^http:\/\/localhost/);
  assert.match(normalizeEndpoint('jev', ''), /^https:\/\//);
  assert.throws(() => normalizeEndpoint('openai', 'https://api.example.com/a b'), isCode('BAD_ENDPOINT'));
  assert.throws(() => normalizeEndpoint('openai', 'https://' + 'a'.repeat(300) + '.com'), isCode('BAD_ENDPOINT'));
  assert.throws(() => normalizeEndpoint('openai', 'ftp://api.example.com/v1'), isCode('BAD_ENDPOINT'));
});

test('buildRequest shapes OpenAI and Ollama chat bodies', () => {
  const messages = [{ role: 'user', content: 'hello' }];
  const openai = buildRequest({
    provider: 'openai', url: 'https://api.example.com/v1/chat/completions', key: 'k',
    model: 'm', messages, jsonMode: true, temperature: 0.2, maxTokens: 100
  });
  const openaiBody = bodyOf(openai);
  assert.equal(openai.init.method, 'POST');
  assert.equal(openai.init.headers.Authorization, 'Bearer k');
  assert.equal(openaiBody.model, 'm');
  assert.deepEqual(openaiBody.messages, messages);
  assert.equal(openaiBody.temperature, 0.2);
  assert.equal(openaiBody.max_tokens, 100);
  assert.deepEqual(openaiBody.response_format, { type: 'json_object' });

  const ollama = buildRequest({
    provider: 'ollama', url: 'http://localhost:11434/v1/chat/completions',
    model: 'llama3', messages, jsonMode: false, temperature: 0, maxTokens: 50
  });
  const ollamaBody = bodyOf(ollama);
  assert.equal(ollama.init.headers.Authorization, undefined);
  assert.equal(ollamaBody.model, 'llama3');
  assert.equal(ollamaBody.response_format, undefined);
  assert.equal(ollamaBody.max_tokens, 50);
});

test('buildRequest shapes Gemini contents, system instruction and URL', () => {
  const req = buildRequest({
    provider: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/models',
    key: 'gk', model: 'gemini-2.0-flash', jsonMode: true, temperature: 0.3, maxTokens: 120,
    messages: [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ]
  });
  const body = bodyOf(req);
  assert.match(req.url, /\/models\/gemini-2\.0-flash:generateContent$/);
  assert.equal(req.init.headers['x-goog-api-key'], 'gk');
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'rules' }] });
  assert.deepEqual(body.contents, [
    { role: 'user', parts: [{ text: 'hi' }] },
    { role: 'model', parts: [{ text: 'hello' }] }
  ]);
  assert.deepEqual(body.generationConfig, {
    temperature: 0.3,
    maxOutputTokens: 120,
    responseMimeType: 'application/json'
  });
});

test('buildRequest shapes Anthropic system, messages and headers', () => {
  const req = buildRequest({
    provider: 'anthropic', url: 'https://api.anthropic.com/v1/messages', key: 'ak',
    model: 'claude', jsonMode: true, temperature: 0.4, maxTokens: 90,
    messages: [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ]
  });
  const body = bodyOf(req);
  assert.equal(req.init.headers['x-api-key'], 'ak');
  assert.equal(req.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(body.system, 'rules');
  assert.deepEqual(body.messages, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' }
  ]);
  assert.equal(body.max_tokens, 90);
  assert.equal(body.temperature, 0.4);
  assert.equal(body.response_format, undefined);
});

test('buildRequest shapes TypeSafe System One payloads', () => {
  const payload = {
    model: 'jev-latest',
    state: { handle: 'a', samples: [] },
    questions: { ping: { type: 'noul', instructions: 'Is this true?' } }
  };
  const req = buildRequest({
    provider: 'jev', url: 'https://api.example.com/v1', key: 'jk',
    payload, jsonMode: true
  });
  const body = bodyOf(req);
  assert.equal(req.url, 'https://api.example.com/v1/systemone');
  assert.equal(req.init.headers.Authorization, 'Bearer jk');
  assert.deepEqual(body, payload);
  assert.equal(body.input, undefined);
  assert.equal(body.schema, undefined);

  const already = buildRequest({
    provider: 'jev', url: 'https://api.example.com/v1/systemone', payload
  });
  assert.equal(already.url, 'https://api.example.com/v1/systemone');
});

test('parseResponse extracts each provider content and errors', () => {
  const openai = parseResponse('openai', JSON.stringify({
    choices: [{
      message: { content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }] },
      finish_reason: 'stop'
    }],
    usage: { total_tokens: 4 }
  }));
  assert.equal(openai.text, '{"a":1}');
  assert.deepEqual(openai.json, { a: 1 });
  assert.deepEqual(openai.usage, { total_tokens: 4 });
  assert.equal(openai.finishReason, 'stop');

  const gemini = parseResponse('gemini', JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'hel' }, { text: 'lo' }] }, finishReason: 'STOP' }],
    usageMetadata: { totalTokenCount: 2 }
  }));
  assert.equal(gemini.text, 'hello');
  assert.equal(gemini.finishReason, 'STOP');

  const anthropic = parseResponse('anthropic', JSON.stringify({
    content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1 }
  }));
  assert.equal(anthropic.text, 'onetwo');
  assert.equal(anthropic.finishReason, 'end_turn');

  const jev = parseResponse('jev', JSON.stringify({
    output: { archetype: { ad: 1 } },
    usage: { tokens: 9 }
  }));
  assert.deepEqual(jev.json, { archetype: { ad: 1 } });
  assert.equal(jev.text, JSON.stringify({ archetype: { ad: 1 } }));

  assert.throws(
    () => parseResponse('openai', JSON.stringify({ choices: [{ message: { content: '' } }] })),
    isCode('EMPTY')
  );
  assert.throws(() => parseResponse('openai', 'not json'), isCode('BAD_JSON'));
  assert.throws(() => parseResponse('jev', '{}'), isCode('EMPTY'));
});

test('isRetryableStatus treats 0, 429 and 5xx as retryable', () => {
  assert.equal(isRetryableStatus(0), true);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isRetryableStatus(200), false);
});

test('effectiveMode treats namerProvider=none as no namer', () => {
  const base = { jevKey: 'k', jevUrl: 'https://api.typesafe.ai/v1', namerKey: 'n' };
  assert.equal(effectiveMode({ ...base, namerProvider: 'none' }), 'jev-only');
  assert.equal(effectiveMode({ ...base, namerProvider: 'openai' }), 'jev');
});

test('effectiveMode honors evalProvider=combined even with a Jev key', () => {
  assert.equal(effectiveMode({
    evalProvider: 'combined',
    jevKey: 'k',
    jevUrl: 'https://api.typesafe.ai/v1',
    namerKey: 'n',
    namerProvider: 'openai'
  }), 'combined');
});

test('effectiveMode accepts a keyless local namer endpoint', () => {
  assert.equal(effectiveMode({
    jevKey: 'k',
    jevUrl: 'https://api.typesafe.ai/v1',
    namerProvider: 'openai',
    namerUrl: 'http://127.0.0.1:3425/v1/chat/completions',
    namerKey: ''
  }), 'jev');
  assert.equal(effectiveMode({
    namerProvider: 'openai',
    namerUrl: 'https://api.deepseek.com/v1/chat/completions',
    namerKey: ''
  }), 'none');
});
