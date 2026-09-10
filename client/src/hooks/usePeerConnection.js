import { useCallback, useEffect, useRef, useState } from 'react';
import Peer from 'simple-peer';
import { validate as isUuid } from 'uuid';
import useFileChunking from './useFileChunking';
import {
  CHUNK_SIZE,
  MAX_MEMORY_FILE_SIZE,
  RECEIVE_WINDOW,
  fileMetadata,
  parseControl,
  validateMetadata,
  writeToPeer,
} from '../lib/transfer';
import { createDiskReceiver, createReceiptWindow } from '../lib/diskTransfer.js';

const CONNECTION_TIMEOUT = 40_000;
const INACTIVITY_TIMEOUT = 45_000;
const TERMINAL = new Set(['complete', 'declined', 'cancelled', 'error']);
const INITIAL_STATE = {
  status: 'idle',
  error: null,
  metadata: null,
  progress: 0,
  speed: 0,
  eta: null,
  bytesTransferred: 0,
  expiresAt: null,
  downloadUrl: null,
  receivedFile: null,
  savedToDisk: false,
  choosingDestination: false,
  saveError: null,
};

function signalingUrl() {
  const configured = import.meta.env.VITE_SIGNALING_URL;
  if (configured) {
    const url = new URL(configured, window.location.href);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (!['ws:', 'wss:'].includes(url.protocol))
      throw new Error('The signaling server URL must use WebSocket transport.');
    return url.href;
  }
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/signal`;
}

function iceServers() {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (import.meta.env.VITE_TURN_URL) {
    servers.push({
      urls: import.meta.env.VITE_TURN_URL.split(',')
        .map((url) => url.trim())
        .filter(Boolean),
      username: import.meta.env.VITE_TURN_USERNAME || '',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
    });
  }
  return servers;
}

/** Progress is 0–100, speed is bytes/second, and eta is seconds or null. */
export function usePeerConnection({ role, sessionId, file, onComplete }) {
  const [state, setState] = useState(INITIAL_STATE);
  const actions = useRef({});
  const completion = useRef(onComplete);
  const sendChunks = useFileChunking();

  useEffect(() => {
    completion.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let active = true;
    let peer = null;
    let socket = null;
    let connected = false;
    let status = 'idle';
    let metadata = null;
    let chunks = [];
    let bytes = 0;
    let startedAt = 0;
    let lastReportAt = 0;
    let lastActivityAt = 0;
    let expiryTimer;
    let connectionTimer;
    let disconnectTimer;
    let inactivityTimer;
    let closeTimer;
    let startupTimer;
    let downloadUrl = null;
    let receivedFile = null;
    let diskReceiver = null;
    let diskFlow = null;
    let choosingDestination = false;
    let eofSent = false;
    let notified = false;
    const controller = new AbortController();

    const patch = (values) => {
      if (active) setState((previous) => ({ ...previous, ...values }));
    };
    const changeStatus = (next, values = {}) => {
      status = next;
      patch({ status: next, ...values });
    };
    const clearTimers = () => {
      clearTimeout(startupTimer);
      clearTimeout(expiryTimer);
      clearTimeout(connectionTimer);
      clearTimeout(disconnectTimer);
      clearInterval(inactivityTimer);
    };
    const closeNetwork = () => {
      clearTimeout(closeTimer);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
          socket.close();
      }
      if (peer && !peer.destroyed && !peer.destroying) peer.destroy();
      connected = false;
    };
    const stop = (next, error = null, grace = 0) => {
      if (!active || TERMINAL.has(status)) return;
      changeStatus(next, { error, eta: null, speed: 0, choosingDestination: false });
      controller.abort();
      void diskReceiver?.abort();
      chunks = [];
      receivedFile = null;
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
        downloadUrl = null;
      }
      clearTimers();
      if (grace) closeTimer = setTimeout(closeNetwork, grace);
      else closeNetwork();
    };
    const fail = (error) => {
      stop('error', error instanceof Error ? error.message : String(error));
    };
    const sendControl = (value) => writeToPeer(peer, JSON.stringify(value), controller.signal);
    const notifyRemote = (type) => {
      // A control frame is small; send it immediately so aborting the file loop
      // cannot discard it from the stream queue. Give the channel time to flush.
      if (peer?.connected && !peer.destroyed && !peer.destroying) {
        try {
          peer.send(JSON.stringify({ type }));
        } catch {
          /* Already disconnected. */
        }
      }
    };
    const protocolFailure = (error) => {
      if (!active || TERMINAL.has(status)) return;
      notifyRemote('cancel');
      stop('error', error.message, 250);
    };
    const report = (count, force = false) => {
      bytes = count;
      const now = performance.now();
      lastActivityAt = now;
      if (!force && now - lastReportAt < 120 && count !== metadata?.size) return;
      lastReportAt = now;
      const duration = Math.max((now - startedAt) / 1000, 0.001);
      const speed = count / duration;
      patch({
        bytesTransferred: count,
        progress: metadata?.size ? Math.min(100, (count / metadata.size) * 100) : 0,
        speed,
        eta: speed > 0 ? Math.max(0, (metadata.size - count) / speed) : null,
      });
    };
    const beginTransfer = () => {
      startedAt = performance.now();
      lastActivityAt = startedAt;
      clearTimeout(expiryTimer);
      clearTimeout(connectionTimer);
      changeStatus('transferring', { expiresAt: null });
      inactivityTimer = setInterval(() => {
        if (performance.now() - lastActivityAt > INACTIVITY_TIMEOUT) {
          protocolFailure(
            new Error(
              'The transfer stopped responding. Keep both devices awake and start a new transfer.',
            ),
          );
        }
      }, 1000);
    };
    const complete = () => {
      if (!active || TERMINAL.has(status)) return;
      report(metadata.size, true);
      changeStatus('complete', {
        progress: 100,
        eta: 0,
        downloadUrl,
        receivedFile,
        savedToDisk: !!diskReceiver,
      });
      clearTimers();
      chunks = [];
      if (!notified) {
        notified = true;
        // A UI history callback must never turn a successful transfer into an error.
        try {
          completion.current?.({ ...metadata, role, completedAt: Date.now() });
        } catch {
          /* Transfer is already complete. */
        }
      }
    };
    const sendFile = async () => {
      beginTransfer();
      try {
        await sendChunks({
          file,
          peer,
          signal: controller.signal,
          onProgress: diskFlow ? undefined : (count) => report(count),
          onQueued: diskFlow?.sentThrough,
          waitForReceipt: diskFlow?.waitFor,
        });
        if (!active || controller.signal.aborted) return;
        // Mark before sending: an acknowledgement can arrive before the write callback.
        eofSent = true;
        await sendControl({ type: 'eof', size: metadata.size });
        lastActivityAt = performance.now();
        // Only the receiver's `received` message can complete the sender.
      } catch (error) {
        if (error.name !== 'AbortError') fail(error);
      }
    };
    const receiveComplete = async (message) => {
      if (
        role !== 'receiver' ||
        status !== 'transferring' ||
        message.size !== metadata.size ||
        bytes !== metadata.size
      ) {
        throw new Error('The received file was incomplete. Please ask the sender to try again.');
      }
      // Prevent another eof/chunk while the acknowledgement is in flight.
      if (diskReceiver) {
        await diskReceiver.finish();
        if (!active || controller.signal.aborted) return;
        await sendControl({ type: 'received', size: bytes });
        if (!active || controller.signal.aborted) return;
        complete();
        closeTimer = setTimeout(closeNetwork, 2000);
        return;
      }
      receivedFile = new File(chunks, metadata.name, { type: metadata.type });
      // Preserve the original MIME for sharing; offer downloads as binary.
      const blob = receivedFile.slice(0, receivedFile.size, 'application/octet-stream');
      if (blob.size !== metadata.size) throw new Error('The received file size does not match.');
      downloadUrl = URL.createObjectURL(blob);
      await sendControl({ type: 'received', size: bytes });
      if (!active || controller.signal.aborted) return;
      complete();
      try {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = metadata.name;
        link.style.display = 'none';
        document.body.appendChild(link);
        try {
          link.click();
        } finally {
          link.remove();
        }
      } catch {
        /* A manual download link remains available if the browser blocks this. */
      }
      // Keep the channel alive until the sender has consumed its acknowledgement.
      closeTimer = setTimeout(closeNetwork, 2000);
    };
    let finishing = false;
    const handleData = (data) => {
      if (!active || TERMINAL.has(status)) return;
      try {
        if (typeof data !== 'string') {
          if (role !== 'receiver' || status !== 'transferring' || finishing) {
            throw new Error('The other device sent file data before it was accepted.');
          }
          const view =
            data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : null;
          if (
            !view ||
            !view.byteLength ||
            view.byteLength > CHUNK_SIZE ||
            bytes + view.byteLength > metadata.size
          ) {
            throw new Error('The other device sent an invalid file chunk.');
          }
          // Copy only the view's bytes so pooled Buffer backing memory is not retained.
          if (diskReceiver) diskReceiver.enqueue(view);
          else {
            chunks.push(view.slice());
            report(bytes + view.byteLength);
          }
          return;
        }
        const message = parseControl(data);
        switch (message.type) {
          case 'metadata':
            if (role !== 'receiver' || metadata || status !== 'connecting')
              throw new Error('Unexpected file information from the other device.');
            if (message.version !== 2)
              throw new Error(
                'These devices are using different QuickDrop versions. Refresh both pages.',
              );
            metadata = validateMetadata(message.file);
            clearTimeout(connectionTimer);
            changeStatus('awaiting-accept', { metadata });
            break;
          case 'accept':
            if (role !== 'sender' || status !== 'awaiting-accept' || !connected)
              throw new Error('Unexpected transfer acceptance.');
            if (!['disk', 'memory'].includes(message.mode))
              throw new Error('The receiver requested an unsupported save method.');
            if (message.mode === 'disk') {
              if (message.windowSize !== RECEIVE_WINDOW)
                throw new Error('The receiver requested an unsupported transfer window.');
              diskFlow = createReceiptWindow({
                size: metadata.size,
                signal: controller.signal,
                onProgress: (count) => report(count),
              });
            } else if (metadata.size > MAX_MEMORY_FILE_SIZE) {
              throw new Error('The receiving browser must save this large file directly to disk.');
            }
            void sendFile();
            break;
          case 'written':
            if (role !== 'sender' || status !== 'transferring' || !diskFlow)
              throw new Error('Unexpected disk-write acknowledgement.');
            diskFlow.acknowledge(message.bytes);
            break;
          case 'decline':
            if (role !== 'sender' || status !== 'awaiting-accept')
              throw new Error('Unexpected transfer response.');
            stop('declined', null, 100);
            break;
          case 'cancel':
            stop('cancelled', null, 100);
            break;
          case 'eof':
            if (finishing) throw new Error('The sender sent a duplicate end-of-file message.');
            finishing = true;
            void receiveComplete(message).catch(protocolFailure);
            break;
          case 'received':
            if (
              role !== 'sender' ||
              status !== 'transferring' ||
              !eofSent ||
              message.size !== metadata.size ||
              bytes !== metadata.size
            ) {
              throw new Error('The other device sent an invalid receipt.');
            }
            complete();
            closeTimer = setTimeout(closeNetwork, 500);
            break;
          default:
            throw new Error('The other device sent an unsupported transfer message.');
        }
      } catch (error) {
        protocolFailure(error);
      }
    };
    const createPeer = () => {
      if (peer || !active || TERMINAL.has(status)) return;
      changeStatus('connecting');
      clearTimeout(connectionTimer);
      connectionTimer = setTimeout(
        () =>
          fail(
            new Error(
              'The devices could not connect. Try the same Wi-Fi network, or configure a TURN relay for restrictive networks.',
            ),
          ),
        CONNECTION_TIMEOUT,
      );
      try {
        peer = new Peer({
          initiator: role === 'sender',
          trickle: true,
          objectMode: true,
          config: { iceServers: iceServers() },
          channelConfig: { ordered: true },
        });
        peer.on('signal', (data) => {
          if (!active || TERMINAL.has(status)) return;
          if (socket?.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: 'signal', data }));
          else if (!connected)
            fail(new Error('The signaling connection was lost. Please start a new transfer.'));
        });
        peer.on('connect', () => {
          if (!active || TERMINAL.has(status)) return;
          connected = true;
          clearTimeout(connectionTimer);
          if (role === 'sender') {
            changeStatus('awaiting-accept');
            void sendControl({ type: 'metadata', version: 2, file: metadata }).catch(fail);
          } else {
            connectionTimer = setTimeout(
              () =>
                fail(
                  new Error(
                    'The sender did not provide file information. Please start a new transfer.',
                  ),
                ),
              15_000,
            );
          }
        });
        peer.on('data', handleData);
        peer.on('iceStateChange', (connectionState) => {
          if (!active || TERMINAL.has(status)) return;
          clearTimeout(disconnectTimer);
          if (connectionState === 'disconnected') {
            disconnectTimer = setTimeout(
              () =>
                fail(
                  new Error(
                    'The other device went offline. Keep both devices awake and start a new transfer.',
                  ),
                ),
              15_000,
            );
          }
        });
        peer.on('error', (error) => {
          if (
            error.code === 'ERR_ICE_CONNECTION_FAILURE' ||
            error.code === 'ERR_CONNECTION_FAILURE'
          ) {
            fail(
              new Error('The devices lost their connection. Try again on the same Wi-Fi network.'),
            );
          } else
            fail(
              new Error('The connection to the other device failed. Please start a new transfer.'),
            );
        });
        peer.on('close', () => {
          connected = false;
          if (!TERMINAL.has(status))
            fail(new Error('The other device disconnected. Keep both pages open and try again.'));
        });
      } catch (error) {
        fail(error);
      }
    };
    const connect = () => {
      if (!active) return;
      if (!sessionId) return;
      try {
        if (!['sender', 'receiver'].includes(role) || !isUuid(sessionId))
          throw new Error('This transfer link is invalid. Ask the sender for a new link.');
        if (role === 'sender') {
          if (!file || typeof file.slice !== 'function')
            throw new Error('Choose a file to start a transfer.');
          metadata = fileMetadata(file);
          patch({ metadata });
        }
        if (!Peer.WEBRTC_SUPPORT)
          throw new Error(
            'This browser does not support WebRTC. Open the link in a recent browser.',
          );
        changeStatus('connecting');
        socket = new WebSocket(signalingUrl());
        connectionTimer = setTimeout(
          () => fail(new Error('The signaling server did not respond. Please try again.')),
          CONNECTION_TIMEOUT,
        );
        socket.onopen = () => {
          if (active) socket.send(JSON.stringify({ type: 'join', sessionId, role }));
        };
        socket.onmessage = (event) => {
          if (!active || TERMINAL.has(status)) return;
          try {
            if (typeof event.data !== 'string' || event.data.length > 128 * 1024)
              throw new Error('Invalid response from the signaling server.');
            const message = JSON.parse(event.data);
            switch (message.type) {
              case 'joined': {
                clearTimeout(connectionTimer);
                const expiration =
                  typeof message.expiresAt === 'number'
                    ? message.expiresAt
                    : Date.parse(message.expiresAt);
                if (!Number.isFinite(expiration))
                  throw new Error('The signaling server returned an invalid session expiry.');
                patch({ expiresAt: expiration });
                clearTimeout(expiryTimer);
                expiryTimer = setTimeout(
                  () =>
                    fail(
                      new Error(
                        'This transfer link has expired. Ask the sender to create a new one.',
                      ),
                    ),
                  Math.max(0, expiration - Date.now()),
                );
                if (!peer) changeStatus(role === 'sender' ? 'waiting' : 'connecting');
                break;
              }
              case 'peer-ready': {
                // Pairing extends the server's room lifetime. The invitation
                // countdown is finished; still bound how long consent can wait.
                const expiration =
                  typeof message.expiresAt === 'number'
                    ? message.expiresAt
                    : Date.parse(message.expiresAt);
                if (Number.isFinite(expiration)) {
                  clearTimeout(expiryTimer);
                  expiryTimer = setTimeout(
                    () =>
                      fail(
                        new Error(
                          'The receiver did not accept in time. Please create a new transfer.',
                        ),
                      ),
                    Math.max(0, Math.min(expiration - Date.now(), 300_000)),
                  );
                }
                patch({ expiresAt: null });
                createPeer();
                break;
              }
              case 'signal':
                createPeer();
                if (peer && !peer.destroyed && !peer.destroying) peer.signal(message.data);
                break;
              case 'peer-left':
                // Before consent, invalidate the invitation immediately instead
                // of leaving an Accept button for a sender that has left.
                // An in-progress transfer can survive a signaling-only outage.
                if (!connected || status !== 'transferring')
                  fail(
                    new Error('The other device left this session. Ask the sender for a new link.'),
                  );
                break;
              case 'error':
                if (!connected)
                  fail(
                    new Error(
                      typeof message.message === 'string'
                        ? message.message.slice(0, 300)
                        : 'This transfer session is unavailable.',
                    ),
                  );
                break;
              default:
                break;
            }
          } catch (error) {
            fail(error);
          }
        };
        socket.onerror = () => {
          if (!connected)
            fail(
              new Error(
                'Could not reach the signaling server. Check your connection and try again.',
              ),
            );
        };
        socket.onclose = () => {
          if (!connected && !TERMINAL.has(status))
            fail(new Error('The signaling connection closed. Please start a new transfer.'));
        };
      } catch (error) {
        fail(error);
      }
    };

    actions.current = {
      accept: async ({ toDisk = false } = {}) => {
        if (!active || role !== 'receiver' || status !== 'awaiting-accept' || choosingDestination)
          return;
        const useDisk = toDisk || metadata.size > MAX_MEMORY_FILE_SIZE;
        if (useDisk && typeof window.showSaveFilePicker !== 'function') {
          patch({
            saveError:
              'This browser cannot save large files directly to disk. Receive this file in a supported desktop browser.',
          });
          return;
        }
        patch({ saveError: null });
        if (useDisk) {
          choosingDestination = true;
          patch({ choosingDestination: true });
          let writable;
          try {
            const handle = await window.showSaveFilePicker({ suggestedName: metadata.name });
            if (!active || controller.signal.aborted) return;
            writable = await handle.createWritable();
            if (!active || controller.signal.aborted) {
              await writable.abort();
              return;
            }
            diskReceiver = createDiskReceiver({
              writable,
              size: metadata.size,
              onProgress: (count) => report(count),
              onCheckpoint: (count) => sendControl({ type: 'written', bytes: count }),
              onError: (error) =>
                protocolFailure(
                  new Error(
                    `Could not write the file to disk: ${error.message}. Check available space and start again.`,
                  ),
                ),
            });
          } catch (error) {
            if (writable) {
              try {
                await writable.abort();
              } catch {
                /* Closed stream. */
              }
            }
            if (active && !controller.signal.aborted)
              patch({
                saveError:
                  error.name === 'AbortError'
                    ? 'No location selected. Choose one when you’re ready; no file bytes have been sent.'
                    : 'Could not open that save location. Open this page in your full browser and try another location.',
              });
            return;
          } finally {
            choosingDestination = false;
            if (active) patch({ choosingDestination: false });
          }
        }
        if (!active || controller.signal.aborted) return;
        beginTransfer();
        void sendControl({
          type: 'accept',
          mode: useDisk ? 'disk' : 'memory',
          ...(useDisk ? { windowSize: RECEIVE_WINDOW } : {}),
        }).catch(fail);
      },
      decline: () => {
        if (!active || role !== 'receiver' || status !== 'awaiting-accept') return;
        notifyRemote('decline');
        stop('declined', null, 500);
      },
      cancel: () => {
        if (!active || TERMINAL.has(status) || status === 'idle') return;
        notifyRemote('cancel');
        stop('cancelled', null, 500);
      },
    };
    setState({ ...INITIAL_STATE });
    // Deferring socket creation makes React StrictMode's setup/cleanup probe inert.
    startupTimer = setTimeout(connect, 0);
    return () => {
      active = false;
      controller.abort();
      void diskReceiver?.abort();
      clearTimers();
      closeNetwork();
      chunks = [];
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      actions.current = {};
    };
  }, [role, sessionId, file, sendChunks]);

  const accept = useCallback((options) => actions.current.accept?.(options), []);
  const decline = useCallback(() => actions.current.decline?.(), []);
  const cancel = useCallback(() => actions.current.cancel?.(), []);
  return {
    ...state,
    accept,
    decline,
    cancel,
    canStreamToDisk: typeof window.showSaveFilePicker === 'function',
    requiresDisk: (state.metadata?.size || 0) > MAX_MEMORY_FILE_SIZE,
  };
}

export default usePeerConnection;
