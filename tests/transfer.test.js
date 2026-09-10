import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  CHUNK_SIZE,
  MAX_FILE_SIZE,
  validateMetadata,
  parseControl,
  sendFileInChunks,
  writeToPeer,
} from '../client/src/lib/transfer.js';

class TestPeer extends EventEmitter {
  connected = true;
  writes = [];
  inFlight = 0;
  maximumInFlight = 0;
  write(data, done) {
    this.inFlight++;
    this.maximumInFlight = Math.max(this.maximumInFlight, this.inFlight);
    setImmediate(() => {
      this.writes.push(Buffer.from(data));
      this.inFlight--;
      done();
    });
  }
}

test('file bytes are preserved across bounded slices and backpressure', async () => {
  const input = Buffer.from(Array.from({ length: CHUNK_SIZE * 3 + 17 }, (_, i) => i % 251));
  const file = new File([input], 'test.bin', { type: 'application/octet-stream' });
  const peer = new TestPeer();
  const progress = [];
  const count = await sendFileInChunks({ file, peer, onProgress: (bytes) => progress.push(bytes) });
  assert.equal(count, input.length);
  assert.deepEqual(Buffer.concat(peer.writes), input);
  assert.deepEqual(
    peer.writes.map((chunk) => chunk.length),
    [CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, 17],
  );
  assert.deepEqual(progress, [CHUNK_SIZE, CHUNK_SIZE * 2, CHUNK_SIZE * 3, input.length]);
  assert.equal(peer.maximumInFlight, 1);
  assert.equal(peer.listenerCount('close'), 0);
  assert.equal(peer.listenerCount('error'), 0);
});

test('zero-byte files require no binary write', async () => {
  const peer = new TestPeer();
  assert.equal(await sendFileInChunks({ file: new File([], 'empty.txt'), peer }), 0);
  assert.deepEqual(peer.writes, []);
});

test('untrusted metadata is bounded and download paths are sanitized', () => {
  assert.deepEqual(validateMetadata({ name: '../photo.png', size: 5, type: '' }), {
    name: '.._photo.png',
    size: 5,
    type: 'application/octet-stream',
  });
  for (const value of [
    null,
    [],
    {},
    { name: 'x', size: -1, type: '' },
    { name: 'x', size: 1.1, type: '' },
    { name: 'x', size: MAX_FILE_SIZE + 1, type: '' },
    { name: '\0hidden', size: 1, type: '' },
    { name: 'x', size: 1, type: 'image/png\ntext/html' },
  ]) {
    assert.throws(() => validateMetadata(value));
  }
});

test('control messages reject arrays, malformed JSON and excessive length', () => {
  assert.deepEqual(parseControl('{"type":"accept"}'), { type: 'accept' });
  for (const value of ['null', '[]', '{}', 'false', '{', 'x'.repeat(4097), new Uint8Array(1)])
    assert.throws(() => parseControl(value));
});

test('cancellation between slices stops all further reads and writes', async () => {
  const peer = new TestPeer();
  const controller = new AbortController();
  const file = new File([new Uint8Array(CHUNK_SIZE * 5)], 'cancel.bin');
  await assert.rejects(
    sendFileInChunks({
      file,
      peer,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
    { name: 'AbortError' },
  );
  assert.equal(peer.writes.length, 1);
});

test('disconnect during a pending write rejects and releases listeners', async () => {
  const peer = new TestPeer();
  peer.write = () => {};
  const promise = writeToPeer(peer, new Uint8Array(32));
  peer.emit('close');
  await assert.rejects(promise, /connection.*lost/i);
  assert.equal(peer.listenerCount('close'), 0);
  assert.equal(peer.listenerCount('error'), 0);
});

test('a short file read fails before emitting a corrupted chunk', async () => {
  const peer = new TestPeer();
  const file = { name: 'changed.bin', size: 8, type: '', slice: () => new Blob(['abc']) };
  await assert.rejects(sendFileInChunks({ file, peer }), /could not be read completely/i);
  assert.equal(peer.writes.length, 0);
});
