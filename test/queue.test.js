import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../src/queue.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function tick(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('starts up to capacity synchronously and queues the rest', async () => {
  let clock = 0;
  const queue = createQueue({ capacity: 2, refillMs: 1000, now: () => clock });
  const a = deferred();
  const b = deferred();
  const c = deferred();
  const started = [];

  queue.enqueue('a', () => { started.push('a'); return a.promise; });
  queue.enqueue('b', () => { started.push('b'); return b.promise; });
  queue.enqueue('c', () => { started.push('c'); return c.promise; });

  assert.equal(queue.running(), 2);
  assert.equal(queue.pending(), 3);
  await tick();
  assert.deepEqual(started, ['a', 'b']);

  clock = 1000;
  a.resolve('A');
  await tick();
  assert.deepEqual(started, ['a', 'b', 'c']);
  assert.equal(queue.running(), 2);

  b.resolve('B');
  c.resolve('C');
  assert.equal(await Promise.all([a.promise, b.promise, c.promise]).then((x) => x[0]), 'A');
  await tick();
  assert.equal(queue.running(), 0);
  assert.equal(queue.pending(), 0);
});

test('refills one token per refillMs before starting the next job', async () => {
  let clock = 0;
  const queue = createQueue({ capacity: 2, refillMs: 20, now: () => clock });
  const a = deferred();
  const b = deferred();
  const c = deferred();
  const started = [];

  queue.enqueue('a', () => { started.push('a'); return a.promise; });
  queue.enqueue('b', () => { started.push('b'); return b.promise; });
  queue.enqueue('c', () => { started.push('c'); return c.promise; });
  await tick();
  assert.deepEqual(started, ['a', 'b']);

  a.resolve('A');
  await tick();
  assert.deepEqual(started, ['a', 'b']);

  clock = 20;
  await tick(45);
  assert.deepEqual(started, ['a', 'b', 'c']);

  b.resolve('B');
  c.resolve('C');
  await Promise.all([a.promise, b.promise, c.promise]);
});

test('dedupes the same key while queued or running', async () => {
  const queue = createQueue({ capacity: 2, refillMs: 1000, now: () => 0 });
  const gate = deferred();
  let calls = 0;

  const first = queue.enqueue('same', () => {
    calls += 1;
    return gate.promise;
  });
  const second = queue.enqueue('same', () => {
    calls += 1;
    return 'ignored';
  });

  assert.equal(first, second);
  await tick();
  assert.equal(calls, 1);

  gate.resolve('value');
  assert.equal(await first, 'value');
  assert.equal(await second, 'value');
});

test('runs higher priority first and keeps FIFO within a priority', async () => {
  let clock = 0;
  const queue = createQueue({ capacity: 1, refillMs: 10, now: () => clock });
  const gate = deferred();
  const started = [];

  queue.enqueue('gate', () => { started.push('gate'); return gate.promise; });
  queue.enqueue('low-first', () => { started.push('low-first'); return '1'; }, { priority: 1 });
  queue.enqueue('low-second', () => { started.push('low-second'); return '2'; }, { priority: 1 });
  queue.enqueue('high', () => { started.push('high'); return '3'; }, { priority: 3 });
  await tick();
  assert.deepEqual(started, ['gate']);

  clock = 10;
  gate.resolve();
  await tick(20);
  assert.deepEqual(started, ['gate', 'high']);

  clock = 20;
  await tick(20);
  assert.deepEqual(started, ['gate', 'high', 'low-first']);

  clock = 30;
  await tick(20);
  assert.deepEqual(started, ['gate', 'high', 'low-first', 'low-second']);
});

test('rejects manual work at the hard cap and auto work at autoMax', async () => {
  const queue = createQueue({
    capacity: 4,
    refillMs: 1000,
    cap: 2,
    autoMax: 1,
    now: () => 0
  });
  const gate = deferred();

  queue.enqueue('auto-running', () => gate.promise);
  const backlog = await queue.enqueue('auto-waiting', () => 'x');
  assert.deepEqual(backlog, { skipped: 'auto_backlog' });

  const manual = queue.enqueue('manual-one', () => 'manual', { manual: true, priority: 3 });
  assert.equal(queue.pending(), 2);
  const full = await queue.enqueue('manual-two', () => 'nope', { manual: true, priority: 3 });
  assert.deepEqual(full, { skipped: 'queue_full' });

  gate.resolve('done');
  assert.equal(await manual, 'manual');
});

test('a failed job rejects, frees the slot and does not refund the token', async () => {
  let clock = 0;
  const queue = createQueue({ capacity: 1, refillMs: 10, now: () => clock });
  let calls = 0;

  const failed = queue.enqueue('bad', async () => {
    calls += 1;
    throw new Error('boom');
  });
  await assert.rejects(failed, /boom/);
  await tick();
  assert.equal(queue.running(), 0);
  assert.equal(queue.pending(), 0);

  clock = 10;
  const after = await queue.enqueue('after-refill', () => 'ok');
  assert.equal(after, 'ok');
  assert.equal(calls, 1);
});

test('clear resolves queued work and leaves running work alone', async () => {
  const queue = createQueue({ capacity: 1, refillMs: 1000, now: () => 0 });
  const gate = deferred();
  const running = queue.enqueue('running', () => gate.promise);
  const waiting = queue.enqueue('waiting', () => 'later');
  await tick();

  queue.clear();
  assert.deepEqual(await waiting, { skipped: 'cleared' });
  assert.equal(queue.pending(), 1);
  gate.resolve('done');
  assert.equal(await running, 'done');
});
