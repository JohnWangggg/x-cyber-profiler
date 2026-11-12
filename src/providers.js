import { XCP } from './constants.js';
import { LLMError } from './llm.js';

export const PROVIDERS = Object.freeze(['openai', 'gemini', 'anthropic', 'ollama', 'jev']);

const DEFAULTS = Object.freeze({
  openai: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  anthropic: 'https://api.anthropic.com/v1/messages',
  ollama: 'http://localhost:11434/v1/chat/completions',
  jev: XCP.DEFAULT_JEV_URL
});

const ANTHROPIC_VERSION = '2023-06-01';

function fail(code, message) {
  throw new LLMError(code, null, false, message || code);
}

function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function isXHost(host) {
  return host === 'x.com' || host.endsWith('.x.com')
    || host === 'twitter.com' || host.endsWith('.twitter.com');
}

function defaultEndpoint(provider) {
  return DEFAULTS[provider] || DEFAULTS.openai;
}

function isLocalEndpoint(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' && isLocalHost(url.hostname.toLowerCase().replace(/\.$/, ''));
  } catch (e) {
    return false;
  }
}

export function effectiveMode(settings) {
  const s = settings || {};
  let jevReady = false;
  if (s.jevKey || isLocalEndpoint(s.jevUrl)) {
    try {
      normalizeEndpoint('jev', s.jevUrl);
      jevReady = true;
    } catch (e) {
      jevReady = false;
    }
  }
  const hasNamer = s.namerProvider !== 'none' && (!!s.namerKey || isLocalEndpoint(s.namerUrl));
  if (s.evalProvider === 'combined') return hasNamer ? 'combined' : 'none';
  if (jevReady) return hasNamer ? 'jev' : 'jev-only';
  return hasNamer ? 'combined' : 'none';
}

export function normalizeEndpoint(provider, raw) {
  if (!PROVIDERS.includes(provider)) fail('BAD_PROVIDER', 'unknown provider');
  const value = raw == null ? '' : String(raw).trim();
  if (!value) return defaultEndpoint(provider);
  if (value.length > 300) fail('BAD_ENDPOINT', 'endpoint too long');
  if (/\s/.test(value)) fail('BAD_ENDPOINT', 'endpoint contains whitespace');

  let parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    fail('BAD_ENDPOINT', 'endpoint is not a valid URL');
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    fail('BAD_ENDPOINT', 'endpoint protocol not allowed');
  }
  if (parsed.username || parsed.password) fail('BAD_ENDPOINT', 'endpoint credentials not allowed');
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (isXHost(host)) fail('BAD_ENDPOINT', 'x.com endpoints are not allowed');
  if (protocol === 'http:' && !isLocalHost(host)) {
    fail('BAD_ENDPOINT', 'http is only allowed for localhost');
  }
  return value;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (part && typeof part.text === 'string') return part.text;
    return '';
  }).join('');
}

function splitMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const system = [];
  const rest = [];
  for (const msg of list) {
    const role = msg && msg.role;
    const content = textOf(msg && msg.content);
    if (role === 'system') {
      if (content) system.push(content);
      continue;
    }
    rest.push({ role: role === 'assistant' ? 'assistant' : 'user', content });
  }
  return { system: system.join('\n\n'), messages: rest };
}

function geminiContents(messages) {
  const split = splitMessages(messages);
  const contents = split.messages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));
  const body = { contents };
  if (split.system) body.systemInstruction = { parts: [{ text: split.system }] };
  return body;
}

function geminiUrl(raw, model) {
  const token = model ? encodeURIComponent(model) : '';
  let url = String(raw || DEFAULTS.gemini);
  if (url.includes('{model}')) return url.replace(/\{model\}/g, token);

  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  if (hashIndex >= 0) url = url.slice(0, hashIndex);
  const queryIndex = url.indexOf('?');
  const query = queryIndex >= 0 ? url.slice(queryIndex) : '';
  if (queryIndex >= 0) url = url.slice(0, queryIndex);

  if (/:generateContent/.test(url)) return url + query + hash;
  if (!token) return url + query + hash;
  if (/\/models\/?$/.test(url)) {
    return url.replace(/\/$/, '') + '/' + token + ':generateContent' + query + hash;
  }
  if (/\/models\/[^/]+$/.test(url)) return url + ':generateContent' + query + hash;
  return url.replace(/\/$/, '') + '/' + token + ':generateContent' + query + hash;
}

export function buildRequest(opts = {}) {
  const {
    provider,
    url,
    key,
    model,
    schema,
    messages,
    payload,
    jsonMode,
    temperature,
    maxTokens
  } = opts;

  if (!PROVIDERS.includes(provider)) fail('BAD_PROVIDER', 'unknown provider');
  const headers = { 'Content-Type': 'application/json' };
  let body;
  let finalUrl = url || defaultEndpoint(provider);

  if (provider === 'jev') {
    if (key) headers.Authorization = 'Bearer ' + key;
    finalUrl = /\/systemone$/.test(finalUrl) ? finalUrl : finalUrl.replace(/\/$/, '') + '/systemone';
    const wrapped = payload && typeof payload === 'object' && payload.input !== undefined
      ? payload
      : null;
    if (payload && typeof payload === 'object' && payload.state !== undefined && payload.questions) {
      body = { ...payload, model: payload.model || model || XCP.DEFAULT_JEV_MODEL };
    } else {
      body = {
        model: model || (wrapped && wrapped.model) || XCP.DEFAULT_JEV_MODEL,
        schema: schema || (wrapped && wrapped.schema) || XCP.DEFAULT_JEV_SCHEMA,
        input: wrapped ? wrapped.input : payload
      };
    }
  } else if (provider === 'gemini') {
    if (key) headers['x-goog-api-key'] = key;
    body = geminiContents(messages);
    const generationConfig = {};
    if (typeof temperature === 'number') generationConfig.temperature = temperature;
    if (typeof maxTokens === 'number') generationConfig.maxOutputTokens = maxTokens;
    if (jsonMode) generationConfig.responseMimeType = 'application/json';
    body.generationConfig = generationConfig;
    finalUrl = geminiUrl(finalUrl, model);
  } else if (provider === 'anthropic') {
    if (key) headers['x-api-key'] = key;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
    const split = splitMessages(messages);
    body = { model, messages: split.messages, max_tokens: maxTokens };
    if (split.system) body.system = split.system;
    if (typeof temperature === 'number') body.temperature = temperature;
  } else {
    if (key) headers.Authorization = 'Bearer ' + key;
    body = {
      model,
      messages: Array.isArray(messages) ? messages : [],
      temperature,
      max_tokens: maxTokens
    };
    if (jsonMode) body.response_format = { type: 'json_object' };
  }

  return {
    url: finalUrl,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }
  };
}

function tryJson(text) {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch (e) {
    return undefined;
  }
}

function contentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      return '';
    }).join('');
  }
  if (value && typeof value.text === 'string') return value.text;
  return '';
}

export function parseResponse(provider, bodyText) {
  if (!PROVIDERS.includes(provider)) fail('BAD_PROVIDER', 'unknown provider');
  if (typeof bodyText !== 'string' || !bodyText.trim()) fail('EMPTY', 'empty response');

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (e) {
    fail('BAD_JSON', 'response is not valid JSON');
  }

  if (provider === 'openai' || provider === 'ollama') {
    const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
    const text = contentText(choice && choice.message && choice.message.content);
    if (!text || !text.trim()) fail('EMPTY', 'empty response content');
    return {
      text,
      json: tryJson(text),
      usage: body.usage,
      finishReason: choice && choice.finish_reason
    };
  }

  if (provider === 'gemini') {
    const candidate = body && Array.isArray(body.candidates) ? body.candidates[0] : null;
    const parts = candidate && candidate.content && Array.isArray(candidate.content.parts)
      ? candidate.content.parts
      : [];
    const text = parts.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('');
    if (!text || !text.trim()) fail('EMPTY', 'empty response content');
    return {
      text,
      json: tryJson(text),
      usage: body.usageMetadata,
      finishReason: candidate && candidate.finishReason
    };
  }

  if (provider === 'anthropic') {
    const parts = body && Array.isArray(body.content) ? body.content : [];
    const text = parts.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('');
    if (!text || !text.trim()) fail('EMPTY', 'empty response content');
    return {
      text,
      json: tryJson(text),
      usage: body.usage,
      finishReason: body.stop_reason
    };
  }

  const value = body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'output')
    ? body.output
    : body;
  if (value == null || value === '' || (typeof value === 'string' && !value.trim())) {
    fail('EMPTY', 'empty response content');
  }
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
    fail('EMPTY', 'empty response content');
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return {
    text,
    json: typeof value === 'string' ? tryJson(value) : value,
    usage: body && body.usage,
    finishReason: (body && (body.finish_reason || body.stop_reason)) || undefined
  };
}

export function isRetryableStatus(status) {
  const code = Number(status);
  return code === 0 || code === 429 || (code >= 500 && code <= 599);
}
