import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createSignalingServer } from '../index.js';

const ORIGIN = 'http://localhost:5173';
const offer = { type: 'offer', sdp: 'v=0\r\ns=QuickDrop test offer\r\n' };
const answer = { type: 'answer', sdp: 'v=0\r\ns=QuickDrop test answer\r\n' };
const candidate = {
  candidate: {
    candidate: 'candidate:1 1 UDP 1 127.0.0.1 5000 typ host',
    sdpMid: '0',
    sdpMLineIndex: 0,
  },
};
const simplePeerCandidate = { type: 'candidate', ...candidate };

async function fixture(t, options = {}) {
  const app = createSignalingServer({ allowedOrigins: [ORIGIN], ...options });
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  return {
    app,
    url: `ws://127.0.0.1:${address.port}`,
    httpUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function connect(url, options = {}) {
  const socket = new WebSocket(url, { origin: ORIGIN, ...options });
  const inbox = [];
  const pending = [];
  socket.on('error', () => {});
  const closed = new Promise((resolve) => socket.once('close', (code) => resolve(code)));
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const index = pending.findIndex((entry) => entry.type === message.type);
    if (index === -1) inbox.push(message);
    else {
      const [entry] = pending.splice(index, 1);
      clearTimeout(entry.timer);
      entry.resolve(message);
    }
  });
  await once(socket, 'open');
  return {
    socket,
    inbox,
    closed,
    send(message) {
      socket.send(JSON.stringify(message));
    },
    next(type) {
      const index = inbox.findIndex((message) => message.type === type);
      if (index !== -1) return Promise.resolve(inbox.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const entry = { type, resolve, timer: null };
        entry.timer = setTimeout(() => {
          pending.splice(pending.indexOf(entry), 1);
          reject(new Error(`Timed out waiting for ${type}. Buffered: ${JSON.stringify(inbox)}`));
        }, 2000);
        pending.push(entry);
      });
    },
  };
}

async function pair(url, sessionId = randomUUID()) {
  const sender = await connect(url);
  sender.send({ type: 'join', sessionId, role: 'sender' });
  const senderJoined = await sender.next('joined');
  const receiver = await connect(url);
  receiver.send({ type: 'join', sessionId, role: 'receiver' });
  const receiverJoined = await receiver.next('joined');
  await Promise.all([sender.next('peer-ready'), receiver.next('peer-ready')]);
  return { sender, receiver, sessionId, senderJoined, receiverJoined };
}

test('health endpoint works and unknown routes return 404', async (t) => {
  const { httpUrl } = await fixture(t);
  const response = await fetch(`${httpUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'quickdrop-signaling' });
  assert.equal((await fetch(`${httpUrl}/missing`)).status, 404);
});

test('sender and receiver pair and relay only SDP/ICE to their peer', async (t) => {
  const { url, app } = await fixture(t);
  const { sender, receiver, sessionId, senderJoined, receiverJoined } = await pair(url);
  assert.deepEqual(senderJoined, {
    type: 'joined',
    sessionId,
    role: 'sender',
    expiresAt: senderJoined.expiresAt,
  });
  assert.ok(receiverJoined.expiresAt > senderJoined.expiresAt);
  assert.deepEqual(app.stats(), { sessions: 1, connections: 2, paired: 1 });
  sender.send({ type: 'signal', data: offer });
  assert.deepEqual(await receiver.next('signal'), { type: 'signal', data: offer });
  receiver.send({ type: 'signal', data: answer });
  assert.deepEqual(await sender.next('signal'), { type: 'signal', data: answer });
  sender.send({ type: 'signal', data: candidate });
  assert.deepEqual(await receiver.next('signal'), { type: 'signal', data: candidate });
  assert.equal(sender.inbox.length, 0);
  assert.equal(receiver.inbox.length, 0);
});

test('receiver cannot create a session', async (t) => {
  const { url, app } = await fixture(t);
  const receiver = await connect(url);
  receiver.send({ type: 'join', sessionId: randomUUID(), role: 'receiver' });
  assert.equal((await receiver.next('error')).code, 'SESSION_NOT_FOUND');
  assert.equal(await receiver.closed, 1008);
  assert.equal(app.stats().sessions, 0);
});

test('real simple-peer typed ICE candidate envelopes relay in both directions', async (t) => {
  const { url } = await fixture(t);
  const { sender, receiver } = await pair(url);
  sender.send({ type: 'signal', data: simplePeerCandidate });
  assert.deepEqual(await receiver.next('signal'), { type: 'signal', data: simplePeerCandidate });
  receiver.send({ type: 'signal', data: simplePeerCandidate });
  assert.deepEqual(await sender.next('signal'), { type: 'signal', data: simplePeerCandidate });
});

test('candidate envelopes reject invalid type values without relaying data', async (t) => {
  const { url } = await fixture(t);
  for (const type of ['offer', 'file-offer', null, 42]) {
    await t.test(`type ${JSON.stringify(type)}`, async () => {
      const { sender, receiver } = await pair(url);
      sender.send({ type: 'signal', data: { ...candidate, type } });
      assert.equal((await sender.next('error')).code, 'INVALID_MESSAGE');
      assert.deepEqual(await receiver.next('peer-left'), { type: 'peer-left' });
      assert.equal(
        receiver.inbox.some((message) => message.type === 'signal'),
        false,
      );
    });
  }
});

test('duplicate roles cannot evict either legitimate peer', async (t) => {
  const { url, app } = await fixture(t);
  const { sender, receiver, sessionId } = await pair(url);
  for (const role of ['sender', 'receiver']) {
    const intruder = await connect(url);
    intruder.send({ type: 'join', sessionId, role });
    assert.equal((await intruder.next('error')).code, 'SESSION_FULL');
    assert.equal(await intruder.closed, 1008);
    assert.equal(app.stats().sessions, 1);
  }
  sender.send({ type: 'signal', data: offer });
  assert.deepEqual((await receiver.next('signal')).data, offer);
});

test('malformed JSON, binary, invalid UUID, extra fields, and file metadata are rejected', async (t) => {
  const { url, app } = await fixture(t);
  const invalid = [
    ['malformed JSON', '{oops', false],
    ['binary data', Buffer.from([1, 2, 3]), true],
    ['array', '[]', false],
    [
      'invalid UUID',
      JSON.stringify({ type: 'join', sessionId: 'not-a-uuid', role: 'sender' }),
      false,
    ],
    [
      'extra fields',
      JSON.stringify({
        type: 'join',
        sessionId: randomUUID(),
        role: 'sender',
        filename: 'private.txt',
      }),
      false,
    ],
    ['unknown type', JSON.stringify({ type: 'file', bytes: 'nope' }), false],
    [
      'metadata signal',
      JSON.stringify({ type: 'signal', data: { name: 'private.txt', size: 10 } }),
      false,
    ],
    [
      'invalid SDP',
      JSON.stringify({ type: 'signal', data: { type: 'offer', sdp: 'not-sdp' } }),
      false,
    ],
  ];
  for (const [name, data, binary] of invalid) {
    await t.test(name, async () => {
      const client = await connect(url);
      client.socket.send(data, { binary });
      assert.equal((await client.next('error')).code, 'INVALID_MESSAGE');
      assert.equal(await client.closed, 1008);
    });
  }
  assert.equal(app.stats().sessions, 0);
});

test('files cannot be relayed through a paired signaling channel', async (t) => {
  const { url } = await fixture(t);
  const { sender, receiver } = await pair(url);
  sender.send({ type: 'signal', data: { type: 'file-offer', name: 'private.txt', size: 10 } });
  assert.equal((await sender.next('error')).code, 'INVALID_MESSAGE');
  assert.equal((await receiver.next('peer-left')).type, 'peer-left');
  assert.equal(
    receiver.inbox.some((message) => message.type === 'signal'),
    false,
  );
});

test('unpaired invitations expire and cannot be joined', async (t) => {
  const { url, app } = await fixture(t, { sessionTtlMs: 80, sweepIntervalMs: 10 });
  const sender = await connect(url);
  const sessionId = randomUUID();
  sender.send({ type: 'join', sessionId, role: 'sender' });
  await sender.next('joined');
  assert.equal((await sender.next('error')).code, 'SESSION_EXPIRED');
  await sender.closed;
  assert.equal(app.stats().sessions, 0);
  const receiver = await connect(url);
  receiver.send({ type: 'join', sessionId, role: 'receiver' });
  assert.equal((await receiver.next('error')).code, 'SESSION_NOT_FOUND');
});

test('pairing replaces waiting TTL with a separately bounded active TTL', async (t) => {
  const { url, app } = await fixture(t, {
    sessionTtlMs: 100,
    activeSessionTtlMs: 400,
    sweepIntervalMs: 10,
  });
  const { sender, receiver } = await pair(url);
  await delay(140);
  assert.equal(app.stats().paired, 1);
  sender.send({ type: 'signal', data: candidate });
  assert.deepEqual((await receiver.next('signal')).data, candidate);
  const errors = await Promise.all([sender.next('error'), receiver.next('error')]);
  assert.ok(errors.every((error) => error.code === 'SESSION_EXPIRED'));
  assert.equal(app.stats().sessions, 0);
});

test('leave removes room and notifies the remaining peer', async (t) => {
  const { url, app } = await fixture(t);
  const { sender, receiver } = await pair(url);
  receiver.send({ type: 'leave' });
  assert.deepEqual(await sender.next('peer-left'), { type: 'peer-left' });
  await Promise.all([sender.closed, receiver.closed]);
  assert.equal(app.stats().sessions, 0);
});

test('abrupt disconnect removes room and notifies the remaining peer', async (t) => {
  const { url, app } = await fixture(t);
  const { sender, receiver } = await pair(url);
  sender.socket.terminate();
  assert.deepEqual(await receiver.next('peer-left'), { type: 'peer-left' });
  await receiver.closed;
  assert.equal(app.stats().sessions, 0);
});

test('join timeout cleans up clients that never join', async (t) => {
  const { url, app } = await fixture(t, { joinTimeoutMs: 50 });
  const client = await connect(url);
  assert.equal((await client.next('error')).code, 'JOIN_TIMEOUT');
  assert.equal(await client.closed, 1008);
  assert.equal(app.stats().sessions, 0);
});

test('heartbeat terminates unresponsive clients and clears their session', async (t) => {
  const { url, app } = await fixture(t, { heartbeatMs: 40 });
  const client = await connect(url, { autoPong: false });
  client.send({ type: 'join', sessionId: randomUUID(), role: 'sender' });
  await client.next('joined');
  assert.equal(await client.closed, 1006);
  assert.equal(app.stats().sessions, 0);
});

test('rate limit bounds signaling floods', async (t) => {
  const { url } = await fixture(t, { maxMessagesPerWindow: 3 });
  const client = await connect(url);
  client.send({ type: 'join', sessionId: randomUUID(), role: 'sender' });
  await client.next('joined');
  for (let index = 0; index < 3; index++) client.send({ type: 'signal', data: candidate });
  assert.equal((await client.next('error')).code, 'PEER_NOT_READY');
  assert.equal((await client.next('error')).code, 'PEER_NOT_READY');
  assert.equal((await client.next('error')).code, 'RATE_LIMITED');
  assert.equal(await client.closed, 1008);
});

test('maximum sessions rejects excess senders without affecting existing sessions', async (t) => {
  const { url, app } = await fixture(t, { maxSessions: 1 });
  const sender = await connect(url);
  sender.send({ type: 'join', sessionId: randomUUID(), role: 'sender' });
  await sender.next('joined');
  const extra = await connect(url);
  extra.send({ type: 'join', sessionId: randomUUID(), role: 'sender' });
  assert.equal((await extra.next('error')).code, 'SERVER_BUSY');
  assert.equal(app.stats().sessions, 1);
  assert.equal(sender.socket.readyState, WebSocket.OPEN);
});

test('origin allowlist and connection cap are enforced during upgrade', async (t) => {
  const { url } = await fixture(t, { maxConnections: 1 });
  await assert.rejects(connect(url, { origin: 'https://unexpected.example' }), /403/);
  const legitimate = await connect(url);
  await assert.rejects(connect(url), /503/);
  assert.equal(legitimate.socket.readyState, WebSocket.OPEN);
});

test('oversized messages are closed with code 1009', async (t) => {
  const { url, app } = await fixture(t);
  const client = await connect(url);
  client.socket.send('x'.repeat(129 * 1024));
  assert.equal(await client.closed, 1009);
  assert.equal(app.stats().sessions, 0);
});
