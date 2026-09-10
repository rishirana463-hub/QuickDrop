import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiskReceiver, createReceiptWindow } from '../client/src/lib/diskTransfer.js';
import { CHUNK_SIZE, RECEIVE_WINDOW, validateMetadata } from '../client/src/lib/transfer.js';

test('multi-GB metadata is accepted without allocating file contents', () => {
  assert.equal(
    validateMetadata({ name: 'large.bin', size: 5 * 1024 ** 3, type: '' }).size,
    5 * 1024 ** 3,
  );
});

test('disk queue is bounded even when writes are stalled', async () => {
  let release;
  const stalled = new Promise((resolve) => {
    release = resolve;
  });
  let writes = 0;
  let closed = false;
  const checkpoints = [];
  const sink = createDiskReceiver({
    size: RECEIVE_WINDOW,
    writable: {
      write: async () => {
        writes++;
        await stalled;
      },
      close: async () => {
        closed = true;
      },
      abort: async () => {},
    },
    onCheckpoint: (n) => checkpoints.push(n),
  });
  for (let i = 0; i < RECEIVE_WINDOW / CHUNK_SIZE; i++) sink.enqueue(new Uint8Array(CHUNK_SIZE));
  assert.equal(sink.pendingBytes, RECEIVE_WINDOW);
  assert.throws(() => sink.enqueue(new Uint8Array(1)), /bounded/);
  const completion = sink.finish();
  assert.equal(closed, false);
  release();
  await completion;
  assert.equal(writes, RECEIVE_WINDOW / CHUNK_SIZE);
  assert.equal(sink.pendingBytes, 0);
  assert.deepEqual(checkpoints, [RECEIVE_WINDOW]);
  assert.equal(closed, true);
});

test('cancellation aborts queued writes and never closes a partial file', async () => {
  let release;
  let aborted = false;
  let closed = false;
  let writes = 0;
  const stalled = new Promise((resolve) => {
    release = resolve;
  });
  const sink = createDiskReceiver({
    size: CHUNK_SIZE * 2,
    writable: {
      write: async () => {
        writes++;
        await stalled;
      },
      close: async () => {
        closed = true;
      },
      abort: async () => {
        aborted = true;
      },
    },
  });
  sink.enqueue(new Uint8Array(CHUNK_SIZE));
  sink.enqueue(new Uint8Array(CHUNK_SIZE));
  await Promise.resolve();
  const stopping = sink.abort();
  release();
  await stopping;
  assert.equal(writes, 1);
  assert.equal(aborted, true);
  assert.equal(closed, false);
});

test('disk errors are surfaced and a failed commit is not success', async () => {
  const errors = [];
  const sink = createDiskReceiver({
    size: 1,
    writable: {
      write: async () => {
        throw new Error('disk full');
      },
      abort: async () => {},
      close: async () => {},
    },
    onError: (e) => errors.push(e.message),
  });
  sink.enqueue(new Uint8Array(1));
  await assert.rejects(sink.finish(), /disk full/);
  assert.deepEqual(errors, ['disk full']);
  await sink.abort();
  const commitFail = createDiskReceiver({
    size: 0,
    writable: {
      write: async () => {},
      close: async () => {
        throw new Error('commit failed');
      },
      abort: async () => {},
    },
  });
  await assert.rejects(commitFail.finish(), /commit failed/);
});

test('sender waits for actual disk acknowledgement, including acknowledgement before wait', async () => {
  const controller = new AbortController();
  const reports = [];
  const flow = createReceiptWindow({
    size: RECEIVE_WINDOW + 7,
    signal: controller.signal,
    onProgress: (n) => reports.push(n),
  });
  flow.sentThrough(RECEIVE_WINDOW);
  let advanced = false;
  const waiting = flow.waitFor(RECEIVE_WINDOW).then(() => {
    advanced = true;
  });
  await Promise.resolve();
  assert.equal(advanced, false);
  assert.throws(() => flow.acknowledge(RECEIVE_WINDOW + 7), /invalid/);
  flow.acknowledge(RECEIVE_WINDOW);
  await waiting;
  assert.equal(advanced, true);
  flow.sentThrough(RECEIVE_WINDOW + 7);
  flow.acknowledge(RECEIVE_WINDOW + 7);
  await flow.waitFor(RECEIVE_WINDOW + 7);
  assert.deepEqual(reports, [RECEIVE_WINDOW, RECEIVE_WINDOW + 7]);
  assert.throws(() => flow.acknowledge(RECEIVE_WINDOW + 7), /invalid/);
});

test('cancelling releases a sender waiting for disk acknowledgement', async () => {
  const controller = new AbortController();
  const flow = createReceiptWindow({ size: RECEIVE_WINDOW, signal: controller.signal });
  flow.sentThrough(RECEIVE_WINDOW);
  const waiting = flow.waitFor(RECEIVE_WINDOW);
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
});
