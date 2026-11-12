import { XCP } from './constants.js';

export function createQueue({
  capacity = XCP.MAX_CONCURRENT,
  refillMs = XCP.REFILL_MS,
  cap = XCP.QUEUE_CAP,
  autoMax = XCP.AUTO_QUEUE_MAX,
  now = Date.now
} = {}) {
  const limit = Math.max(1, Math.floor(capacity));
  const interval = Math.max(1, Math.floor(refillMs));
  const maxPending = Math.max(1, Math.floor(cap));
  const maxAuto = Math.max(0, Math.floor(autoMax));

  const waiting = [];
  const active = new Map();
  let tokens = limit;
  let running = 0;
  let lastRefill = now();
  let timer = null;
  let seq = 0;

  function refill() {
    const t = now();
    if (t <= lastRefill) return;
    const count = Math.floor((t - lastRefill) / interval);
    if (count <= 0) return;
    tokens = Math.min(limit, tokens + count);
    lastRefill += count * interval;
  }

  function schedule() {
    if (timer || !waiting.length || tokens > 0) return;
    const wait = Math.max(0, lastRefill + interval - now());
    timer = setTimeout(() => {
      timer = null;
      pump();
    }, wait);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function start(job) {
    tokens -= 1;
    running += 1;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        running -= 1;
        if (active.get(job.key) === job) active.delete(job.key);
        pump();
      });
  }

  function pump() {
    refill();
    if (waiting.length > 1) {
      waiting.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq));
    }
    while (waiting.length && running < limit && tokens > 0) {
      start(waiting.shift());
    }
    schedule();
  }

  function enqueue(key, fn, opts = {}) {
    if (active.has(key)) return active.get(key).promise;

    const count = waiting.length + running;
    if (count >= maxPending) {
      return Promise.resolve({ skipped: 'queue_full' });
    }
    const manual = opts.manual === true;
    if (!manual && count >= maxAuto) {
      return Promise.resolve({ skipped: 'auto_backlog' });
    }

    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const job = {
      key,
      fn,
      priority: Number(opts.priority) || 0,
      seq: seq++,
      promise,
      resolve,
      reject
    };
    active.set(key, job);
    waiting.push(job);
    pump();
    return promise;
  }

  function clear() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const dropped = waiting.splice(0);
    for (const job of dropped) {
      if (active.get(job.key) === job) active.delete(job.key);
      job.resolve({ skipped: 'cleared' });
    }
  }

  function pending() {
    return waiting.length + running;
  }

  function runningCount() {
    return running;
  }

  return { enqueue, pending, running: runningCount, clear };
}
