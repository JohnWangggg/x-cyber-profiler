import { XCP } from './constants.js';
import { PROVIDERS, effectiveMode, buildRequest, normalizeEndpoint, parseResponse, isRetryableStatus } from './providers.js';

export const LLMError = class LLMError extends Error {
  constructor(code, status, retryable, message) {
    super(message || (typeof code === 'string' ? code : 'LLM error'));
    this.name = 'LLMError';
    this.code = typeof code === 'string' ? code : (code && code.code) || 'ERROR';
    this.status = status == null ? null : status;
    this.retryable = retryable === true;
  }
};

const MAX_RETRIES = 2;
const JSON_PROVIDERS = Object.freeze(['openai', 'ollama', 'gemini']);

function sleep(ms) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffFor(index) {
  const list = XCP.RETRY_BACKOFF_MS;
  const value = Array.isArray(list) ? list[index] : 0;
  return Number(value) >= 0 ? Number(value) : 0;
}

function byteLength(text) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return text.length * 2;
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    return value == null ? null : String(value);
  }
  if (typeof headers === 'string') {
    const lines = headers.split(/\r?\n/);
    for (const line of lines) {
      const index = line.indexOf(':');
      if (index < 0) continue;
      if (line.slice(0, index).trim().toLowerCase() === name.toLowerCase()) {
        return line.slice(index + 1).trim();
      }
    }
    return null;
  }
  if (typeof headers === 'object') {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === name.toLowerCase()) return String(headers[key]);
    }
  }
  return null;
}

function retryAfterMs(headers) {
  const value = headerValue(headers, 'Retry-After');
  if (!value) return null;
  const seconds = Number(value);
  let ms;
  if (Number.isFinite(seconds)) {
    if (seconds < 0) return null;
    ms = seconds * 1000;
  } else {
    const when = Date.parse(value);
    if (!Number.isFinite(when)) return null;
    ms = Math.max(0, when - Date.now());
  }
  return Math.min(ms, XCP.RETRY_AFTER_MAX_MS);
}

function defaultTransport(options) {
  if (typeof fetch !== 'function') {
    return Promise.reject(new LLMError('NO_TRANSPORT', null, false, 'no transport'));
  }
  return fetch(options.url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    signal: options.signal
  }).then((res) => res.text().then((text) => ({
    status: res.status,
    responseText: text,
    headers: res.headers
  })));
}

function callTransport(transport, built) {
  const timeout = XCP.REQUEST_TIMEOUT_MS;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const options = {
    method: 'POST',
    url: built.url,
    headers: built.init.headers,
    body: built.init.body,
    timeout,
    signal: controller ? controller.signal : undefined
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (controller) {
        try { controller.abort(); } catch (e) { /* ignore */ }
      }
      reject(new LLMError('TIMEOUT', null, true, 'request timeout'));
    }, timeout);
    if (timer && typeof timer.unref === 'function') timer.unref();

    Promise.resolve()
      .then(() => transport(options))
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

function normalizeTransportError(err) {
  if (err instanceof LLMError) return err;
  const status = err && err.status != null ? Number(err.status) : null;
  let code = (err && err.code) || 'NETWORK';
  if (err && (err.name === 'AbortError' || code === 'ABORT_ERR')) code = 'TIMEOUT';
  let retryable = true;
  if (code === 'NO_TRANSPORT' || code === 'BAD_ENDPOINT' || code === 'NO_KEY'
    || code === 'BAD_PROVIDER' || code === 'BAD_JSON' || code === 'TOO_LARGE'
    || code === 'EMPTY' || code === 'TRUNCATED') {
    retryable = false;
  }
  if (Number.isFinite(status)) retryable = isRetryableStatus(status);
  return new LLMError(code, Number.isFinite(status) ? status : null, retryable, 'transport failed');
}

function readSettings(getSettings) {
  if (typeof getSettings !== 'function') return {};
  try {
    return getSettings() || {};
  } catch (e) {
    return {};
  }
}

function supportsJsonField(provider) {
  return JSON_PROVIDERS.includes(provider);
}

function assertProvider(provider) {
  if (!PROVIDERS.includes(provider)) {
    throw new LLMError('BAD_PROVIDER', null, false, 'unknown provider');
  }
}

function configFor(kind, settings) {
  if (kind === 'jev') {
    return {
      provider: 'jev',
      url: settings.jevUrl,
      key: settings.jevKey,
      model: settings.jevModel || 'jev',
      schema: settings.jevSchema || XCP.DEFAULT_JEV_SCHEMA
    };
  }
  const provider = settings.namerProvider || 'openai';
  assertProvider(provider);
  return {
    provider,
    url: settings.namerUrl,
    key: settings.namerKey,
    model: settings.namerModel || XCP.DEFAULT_MODEL
  };
}

export function createLLM({ transport, getSettings } = {}) {
  const send = typeof transport === 'function' ? transport : defaultTransport;

  async function run(kind, messages, payload, opts = {}) {
    const settings = readSettings(getSettings);
    const mode = effectiveMode(settings);
    if (kind === 'jev') {
      if (mode !== 'jev' && mode !== 'jev-only') {
        throw new LLMError('NO_KEY', null, false, 'evaluator key missing');
      }
    } else if (mode === 'none' || mode === 'jev-only') {
      throw new LLMError('NO_KEY', null, false, 'namer key missing');
    }

    const config = configFor(kind, settings);
    const url = normalizeEndpoint(config.provider, config.url);
    const jsonModeDefault = settings.jsonMode !== false;
    let jsonMode = opts.jsonMode === undefined ? jsonModeDefault : opts.jsonMode === true;
    const maxTokens = opts.maxTokens == null
      ? (kind === 'jev' ? XCP.ASSESS_MAX_TOKENS : XCP.NAME_MAX_TOKENS)
      : opts.maxTokens;
    const temperature = opts.temperature == null ? settings.temperature : opts.temperature;

    let retries = 0;
    let emptyRetries = 0;
    let jsonFallback = false;

    for (;;) {
      const built = buildRequest({
        provider: config.provider,
        url,
        key: config.key,
        model: config.model,
        schema: config.schema,
        messages,
        payload,
        jsonMode,
        temperature,
        maxTokens
      });

      let res;
      try {
        res = await callTransport(send, built);
      } catch (err) {
        const failure = normalizeTransportError(err);
        if (failure.retryable && retries < MAX_RETRIES) {
          const delay = backoffFor(retries);
          retries += 1;
          await sleep(delay);
          continue;
        }
        throw failure;
      }

      const status = Number(res && res.status);
      if (!Number.isFinite(status)) {
        const failure = new LLMError('NETWORK', null, true, 'transport returned no status');
        if (retries < MAX_RETRIES) {
          const delay = backoffFor(retries);
          retries += 1;
          await sleep(delay);
          continue;
        }
        throw failure;
      }

      if (status === 400 && jsonMode && supportsJsonField(config.provider) && !jsonFallback) {
        jsonFallback = true;
        jsonMode = false;
        continue;
      }

      if (isRetryableStatus(status) && retries < MAX_RETRIES) {
        let delay = backoffFor(retries);
        if (status === 429) {
          const after = retryAfterMs(res.headers);
          delay = after != null ? after : (retries === 0 ? 10000 : 30000);
        }
        retries += 1;
        await sleep(delay);
        continue;
      }

      if (status < 200 || status >= 300) {
        throw new LLMError('HTTP', status, isRetryableStatus(status), 'HTTP ' + status);
      }

      const text = typeof res.responseText === 'string' ? res.responseText : '';
      if (byteLength(text) > XCP.RESPONSE_MAX_BYTES) {
        throw new LLMError('TOO_LARGE', status, false, 'response too large');
      }

      let parsed;
      try {
        parsed = parseResponse(config.provider, text);
      } catch (err) {
        if (err instanceof LLMError && err.code === 'EMPTY' && emptyRetries < 1) {
          emptyRetries += 1;
          await sleep(0);
          continue;
        }
        throw err instanceof LLMError
          ? err
          : new LLMError('BAD_JSON', status, false, 'invalid response');
      }

      const finish = parsed.finishReason == null ? '' : String(parsed.finishReason);
      if (/^(length|max_tokens)$/i.test(finish)) {
        throw new LLMError('TRUNCATED', status, false, 'response truncated');
      }
      return parsed;
    }
  }

  return {
    chat(messages, opts = {}) {
      return run('chat', messages, undefined, opts);
    },
    jev(payload, opts = {}) {
      return run('jev', undefined, payload, opts);
    },
    mode() {
      return effectiveMode(readSettings(getSettings));
    }
  };
}

export function parseModelJson(text) {
  if (typeof text !== 'string') {
    throw new LLMError('BAD_JSON', null, false, 'model output is not a string');
  }
  let value = text.replace(/^\uFEFF/, '').trim();
  value = value.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, '').trim();
  value = value.replace(/```[A-Za-z0-9_-]*\s*/g, '').replace(/```/g, '').trim();

  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new LLMError('BAD_JSON', null, false, 'no JSON object found');
  }

  let parsed;
  try {
    parsed = JSON.parse(value.slice(start, end + 1));
  } catch (e) {
    throw new LLMError('BAD_JSON', null, false, 'invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LLMError('BAD_JSON', null, false, 'JSON is not an object');
  }
  return parsed;
}
