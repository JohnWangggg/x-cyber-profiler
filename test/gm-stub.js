function clone(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function createGM(initial = {}, opts = {}) {
  const map = new Map();
  for (const [k, v] of Object.entries(initial)) map.set(k, clone(v));
  const listeners = new Map();
  let failNextSet = null;

  function notify(key, oldValue, newValue) {
    for (const cb of (listeners.get(key) || []).slice()) {
      cb(key, oldValue, newValue, true);
    }
  }

  return {
    get(key, fallback) {
      if (!map.has(key)) return fallback;
      return clone(map.get(key));
    },
    set(key, value) {
      if (failNextSet) {
        const err = failNextSet;
        failNextSet = null;
        throw err;
      }
      if (opts.maxBytes != null) {
        const bytes = Buffer.byteLength(JSON.stringify(value));
        if (bytes > opts.maxBytes) {
          const err = new Error('QUOTA_BYTES quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
      }
      const old = map.has(key) ? clone(map.get(key)) : undefined;
      map.set(key, clone(value));
      notify(key, old, clone(value));
    },
    del(key) {
      const old = map.has(key) ? clone(map.get(key)) : undefined;
      map.delete(key);
      notify(key, old, undefined);
    },
    onChange(key, cb) {
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(cb);
      return () => {
        const arr = listeners.get(key) || [];
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      };
    },
    _dump() { return Object.fromEntries([...map.entries()].map(([k, v]) => [k, clone(v)])); },
    _failNextSet(err) { failNextSet = err; },
    _emit(key, value) { notify(key, undefined, value); }
  };
}
