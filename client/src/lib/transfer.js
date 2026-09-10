export const CHUNK_SIZE = 32 * 1024;
export const MAX_MEMORY_FILE_SIZE = 512 * 1024 * 1024;
export const MAX_FILE_SIZE = 100 * 1024 * 1024 * 1024;
export const RECEIVE_WINDOW = 1024 * 1024;
export const MAX_CONTROL_SIZE = 4096;

export function formatBytes(bytes, decimals = 1) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${Number((bytes / 1024 ** index).toFixed(index ? decimals : 0))} ${units[index]}`;
}

export function formatSpeed(bytesPerSecond) {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Calculating…';
  if (seconds < 1) return 'Almost done';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s`;
}

// Metadata is untrusted even though it arrives on an encrypted data channel.
export function validateMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The sender provided invalid file information.');
  }
  if (
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(value.name)
  ) {
    throw new Error('The file name is invalid or too long.');
  }
  if (!Number.isSafeInteger(value.size) || value.size < 0) {
    throw new Error('The file size is invalid.');
  }
  if (value.size > MAX_FILE_SIZE) {
    throw new Error('QuickDrop supports files up to 100 GB.');
  }
  if (
    typeof value.type !== 'string' ||
    value.type.length > 255 ||
    /[^\x20-\x7e]/.test(value.type)
  ) {
    throw new Error('The file type is invalid.');
  }
  // Browsers also sanitize the download name, but never retain path separators.
  const name = value.name.replace(/[\\/]/g, '_');
  return { name, size: value.size, type: value.type || 'application/octet-stream' };
}

export function fileMetadata(file) {
  return validateMetadata({
    name: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
  });
}

export function parseControl(data) {
  if (typeof data !== 'string' || data.length > MAX_CONTROL_SIZE) {
    throw new Error('The other device sent an invalid control message.');
  }
  let value;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error('The other device sent an unreadable control message.');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.type !== 'string'
  ) {
    throw new Error('The other device sent an invalid control message.');
  }
  return value;
}

export function abortError() {
  return new DOMException('Transfer cancelled.', 'AbortError');
}

// Awaiting every callback bounds the stream and data-channel queues. simple-peer
// delays this callback while RTCDataChannel.bufferedAmount exceeds 64 KiB.
export function writeToPeer(peer, data, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    if (!peer || peer.destroyed || peer.destroying || !peer.connected) {
      return reject(new Error('The connection to the other device was lost.'));
    }
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      peer.removeListener('error', onError);
      peer.removeListener('close', onClose);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(abortError());
    const onError = (error) => finish(error);
    const onClose = () => finish(new Error('The connection to the other device was lost.'));
    signal?.addEventListener('abort', onAbort, { once: true });
    peer.once('error', onError);
    peer.once('close', onClose);
    try {
      peer.write(data, finish);
    } catch (error) {
      finish(error);
    }
  });
}

export async function sendFileInChunks({
  file,
  peer,
  signal,
  onProgress,
  onQueued,
  waitForReceipt,
}) {
  fileMetadata(file);
  let offset = 0;
  while (offset < file.size) {
    if (signal?.aborted) throw abortError();
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const chunk = await file.slice(offset, end).arrayBuffer();
    if (signal?.aborted) throw abortError();
    if (chunk.byteLength !== end - offset)
      throw new Error('This file could not be read completely. Please select it again.');
    onQueued?.(end);
    await writeToPeer(peer, new Uint8Array(chunk), signal);
    offset = end;
    onProgress?.(offset);
    if (waitForReceipt && (offset % RECEIVE_WINDOW === 0 || offset === file.size)) {
      await waitForReceipt(offset);
    }
  }
  return offset;
}
