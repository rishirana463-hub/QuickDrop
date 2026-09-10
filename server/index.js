import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const MAX_MESSAGE_BYTES = 128 * 1024;

function positiveInteger(value, fallback, name) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, required, optional = []) {
  return (
    object(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}

// Explicitly limit this service to WebRTC descriptions and ICE candidates.
// Metadata, file chunks, consent, and progress belong on the data channel.
export function isValidSignal(data) {
  if (exactKeys(data, ['type', 'sdp'])) {
    return (
      ['offer', 'answer'].includes(data.type) &&
      typeof data.sdp === 'string' &&
      data.sdp.startsWith('v=0') &&
      data.sdp.length <= 96 * 1024
    );
  }
  if (
    !exactKeys(data, ['candidate'], ['type']) ||
    (Object.hasOwn(data, 'type') && data.type !== 'candidate')
  )
    return false;
  const candidate = data.candidate;
  return (
    exactKeys(candidate, ['candidate', 'sdpMLineIndex', 'sdpMid'], ['usernameFragment']) &&
    typeof candidate.candidate === 'string' &&
    candidate.candidate.length <= 8192 &&
    (candidate.sdpMid === null ||
      (typeof candidate.sdpMid === 'string' && candidate.sdpMid.length <= 256)) &&
    (candidate.sdpMLineIndex === null ||
      (Number.isInteger(candidate.sdpMLineIndex) &&
        candidate.sdpMLineIndex >= 0 &&
        candidate.sdpMLineIndex <= 65535)) &&
    (candidate.usernameFragment === undefined ||
      candidate.usernameFragment === null ||
      (typeof candidate.usernameFragment === 'string' && candidate.usernameFragment.length <= 256))
  );
}

/** Create a server without listening, so imports and tests have no side effects. */
export function createSignalingServer(options = {}) {
  const sessionTtlMs = positiveInteger(
    options.sessionTtlMs ?? process.env.SESSION_TTL_MS,
    300_000,
    'SESSION_TTL_MS',
  );
  const activeSessionTtlMs = positiveInteger(
    options.activeSessionTtlMs ?? process.env.ACTIVE_SESSION_TTL_MS,
    7_200_000,
    'ACTIVE_SESSION_TTL_MS',
  );
  const maxSessions = positiveInteger(
    options.maxSessions ?? process.env.MAX_SESSIONS,
    200,
    'MAX_SESSIONS',
  );
  const maxConnections = positiveInteger(
    options.maxConnections ?? process.env.MAX_CONNECTIONS,
    500,
    'MAX_CONNECTIONS',
  );
  const heartbeatMs = positiveInteger(options.heartbeatMs, 30_000, 'heartbeatMs');
  const joinTimeoutMs = positiveInteger(options.joinTimeoutMs, 15_000, 'joinTimeoutMs');
  const rateWindowMs = positiveInteger(options.rateWindowMs, 10_000, 'rateWindowMs');
  const maxMessagesPerWindow = positiveInteger(
    options.maxMessagesPerWindow,
    150,
    'maxMessagesPerWindow',
  );
  const sweepIntervalMs = positiveInteger(
    options.sweepIntervalMs,
    Math.min(1000, sessionTtlMs, activeSessionTtlMs),
    'sweepIntervalMs',
  );
  const configuredOrigins =
    options.allowedOrigins ?? process.env.ALLOWED_ORIGINS?.split(',') ?? DEFAULT_ORIGINS;
  const allowedOrigins = new Set(configuredOrigins.map((origin) => origin.trim()).filter(Boolean));
  if (allowedOrigins.size === 0 || allowedOrigins.has('*')) {
    throw new Error('ALLOWED_ORIGINS must contain exact frontend origins, not a wildcard.');
  }

  const rooms = new Map();
  let closing = false;
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if ((request.method === 'GET' || request.method === 'HEAD') && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        request.method === 'HEAD'
          ? undefined
          : JSON.stringify({ status: 'ok', service: 'quickdrop-signaling' }),
      );
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });

  function send(socket, message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > MAX_MESSAGE_BYTES * 2) {
      socket.terminate();
      return false;
    }
    socket.send(JSON.stringify(message), (error) => {
      if (error) socket.terminate();
    });
    return true;
  }

  function reject(socket, code, message, closeCode = 1008) {
    send(socket, { type: 'error', code, message });
    socket.close(closeCode, code);
  }

  function release(socket) {
    clearTimeout(socket.joinTimer);
    const room = rooms.get(socket.sessionId);
    if (!room || room[socket.role] !== socket) return;
    rooms.delete(socket.sessionId);
    const peer = socket.role === 'sender' ? room.receiver : room.sender;
    socket.sessionId = null;
    socket.role = null;
    if (peer) {
      peer.sessionId = null;
      peer.role = null;
      send(peer, { type: 'peer-left' });
      peer.close(1000, 'PEER_LEFT');
    }
  }

  function expire(room) {
    rooms.delete(room.sessionId);
    for (const socket of [room.sender, room.receiver].filter(Boolean)) {
      socket.sessionId = null;
      socket.role = null;
      reject(
        socket,
        'SESSION_EXPIRED',
        'This transfer session has expired. Create a new invitation.',
      );
    }
  }

  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url?.split('?')[0];
    if (closing || wss.clients.size >= maxConnections) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    if (!allowedOrigins.has(request.headers.origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    if (pathname !== '/' && pathname !== '/ws' && pathname !== '/signal') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (websocket) => {
      wss.emit('connection', websocket, request);
    });
  });

  wss.on('connection', (socket) => {
    socket.alive = true;
    socket.sessionId = null;
    socket.role = null;
    socket.rateWindowStarted = Date.now();
    socket.messageCount = 0;
    socket.joinTimer = setTimeout(() => {
      reject(socket, 'JOIN_TIMEOUT', 'Join a transfer session shortly after connecting.');
    }, joinTimeoutMs);
    socket.joinTimer.unref();
    socket.on('pong', () => {
      socket.alive = true;
    });
    socket.on('error', () => release(socket));
    socket.on('close', () => release(socket));

    socket.on('message', (raw, isBinary) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now - socket.rateWindowStarted >= rateWindowMs) {
        socket.rateWindowStarted = now;
        socket.messageCount = 0;
      }
      if (++socket.messageCount > maxMessagesPerWindow) {
        reject(socket, 'RATE_LIMITED', 'Too many signaling messages. Please try again.');
        return;
      }
      let message;
      try {
        if (isBinary) throw new Error('Binary messages are not signaling.');
        message = JSON.parse(raw.toString('utf8'));
      } catch {
        reject(socket, 'INVALID_MESSAGE', 'Send a valid JSON signaling message.');
        return;
      }
      if (!object(message) || typeof message.type !== 'string') {
        reject(socket, 'INVALID_MESSAGE', 'A signaling message must be a JSON object with a type.');
        return;
      }

      if (message.type === 'join') {
        if (
          !exactKeys(message, ['type', 'sessionId', 'role']) ||
          typeof message.sessionId !== 'string' ||
          !UUID.test(message.sessionId) ||
          !['sender', 'receiver'].includes(message.role)
        ) {
          reject(
            socket,
            'INVALID_MESSAGE',
            'Join requires a valid UUID sessionId and a sender or receiver role.',
          );
          return;
        }
        if (socket.sessionId) {
          reject(socket, 'ALREADY_JOINED', 'This connection has already joined a session.');
          return;
        }
        const sessionId = message.sessionId.toLowerCase();
        let room = rooms.get(sessionId);
        if (room && room.expiresAt <= now) {
          expire(room);
          room = undefined;
        }
        if (message.role === 'receiver' && !room) {
          reject(
            socket,
            'SESSION_NOT_FOUND',
            'This invitation is missing or expired. Ask the sender for a new link.',
          );
          return;
        }
        if (room?.[message.role]) {
          reject(socket, 'SESSION_FULL', 'This session already has a peer in that role.');
          return;
        }
        if (!room) {
          if (rooms.size >= maxSessions) {
            reject(
              socket,
              'SERVER_BUSY',
              'The signaling service is busy. Please try again shortly.',
            );
            return;
          }
          room = {
            sessionId,
            sender: null,
            receiver: null,
            expiresAt: now + sessionTtlMs,
            paired: false,
          };
          rooms.set(sessionId, room);
        }
        room[message.role] = socket;
        socket.sessionId = sessionId;
        socket.role = message.role;
        clearTimeout(socket.joinTimer);
        if (room.sender && room.receiver) {
          room.paired = true;
          room.expiresAt = now + activeSessionTtlMs;
        }
        send(socket, { type: 'joined', sessionId, role: message.role, expiresAt: room.expiresAt });
        if (room.paired) {
          for (const peer of [room.sender, room.receiver]) {
            send(peer, { type: 'peer-ready', expiresAt: room.expiresAt });
          }
        }
        return;
      }

      if (message.type === 'leave' && exactKeys(message, ['type'])) {
        release(socket);
        socket.close(1000, 'LEFT_SESSION');
        return;
      }

      if (
        message.type === 'signal' &&
        exactKeys(message, ['type', 'data']) &&
        isValidSignal(message.data)
      ) {
        const room = rooms.get(socket.sessionId);
        if (!room) {
          reject(socket, 'NO_SESSION', 'Join a session before sending WebRTC signaling.');
          return;
        }
        if (room.expiresAt <= now) {
          expire(room);
          return;
        }
        const peer = socket.role === 'sender' ? room.receiver : room.sender;
        if (!peer) {
          send(socket, {
            type: 'error',
            code: 'PEER_NOT_READY',
            message: 'Wait for the receiver to join.',
          });
          return;
        }
        send(peer, { type: 'signal', data: message.data });
        return;
      }

      reject(
        socket,
        'INVALID_MESSAGE',
        'Only join, leave, and valid SDP or ICE signal messages are accepted.',
      );
    });
  });

  const expiryTimer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.expiresAt <= now) expire(room);
    }
  }, sweepIntervalMs);
  expiryTimer.unref();
  const heartbeatTimer = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState !== WebSocket.OPEN || !socket.alive) {
        release(socket);
        socket.terminate();
        continue;
      }
      socket.alive = false;
      socket.ping();
    }
  }, heartbeatMs);
  heartbeatTimer.unref();

  return {
    server,
    wss,
    stats() {
      return {
        sessions: rooms.size,
        connections: wss.clients.size,
        paired: [...rooms.values()].filter((room) => room.paired).length,
      };
    },
    listen(port = Number(process.env.PORT ?? 3001), host = '0.0.0.0') {
      return new Promise((resolve, rejectPromise) => {
        server.once('error', rejectPromise);
        server.listen(port, host, () => {
          server.off('error', rejectPromise);
          resolve(server.address());
        });
      });
    },
    async close() {
      closing = true;
      clearInterval(expiryTimer);
      clearInterval(heartbeatTimer);
      rooms.clear();
      for (const socket of wss.clients) {
        clearTimeout(socket.joinTimer);
        socket.terminate();
      }
      await new Promise((resolve) => wss.close(resolve));
      if (server.listening) {
        server.closeIdleConnections();
        await new Promise((resolve, rejectPromise) =>
          server.close((error) => (error ? rejectPromise(error) : resolve())),
        );
      }
    },
  };
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const app = createSignalingServer();
  app
    .listen()
    .then((address) => {
      console.log(`QuickDrop signaling listening on port ${address.port}`);
    })
    .catch((error) => {
      console.error('Unable to start signaling server:', error.message);
      process.exitCode = 1;
    });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      app
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }
}
