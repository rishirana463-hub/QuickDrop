import { abortError, CHUNK_SIZE, RECEIVE_WINDOW } from './transfer.js';

// Application-level flow control is necessary: RTC backpressure alone does not
// bound the receiver's disk write queue when its disk is slower than the network.
export function createReceiptWindow({ size, signal, onProgress }) {
  let queued = 0;
  let acknowledged = 0;
  let waiter = null;
  return {
    sentThrough(end) {
      queued = end;
    },
    acknowledge(end) {
      if (
        !Number.isSafeInteger(end) ||
        end <= acknowledged ||
        end > queued ||
        end > size ||
        (end % RECEIVE_WINDOW !== 0 && end !== size)
      ) {
        throw new Error('The receiver sent an invalid disk-write acknowledgement.');
      }
      acknowledged = end;
      onProgress?.(end);
      if (waiter && end >= waiter.end) waiter.resolve();
    },
    waitFor(end) {
      if (signal.aborted) return Promise.reject(abortError());
      if (acknowledged >= end) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          signal.removeEventListener('abort', cancel);
          waiter = null;
        };
        const cancel = () => {
          cleanup();
          reject(abortError());
        };
        waiter = {
          end,
          resolve: () => {
            cleanup();
            resolve();
          },
        };
        signal.addEventListener('abort', cancel, { once: true });
      });
    },
  };
}

export function createDiskReceiver({ writable, size, onProgress, onCheckpoint, onError }) {
  let accepted = 0;
  let written = 0;
  let pending = 0;
  let chain = Promise.resolve();
  let aborted = false;
  let finishing = false;
  let committed = false;
  let failed = false;
  let abortPromise;
  return {
    get pendingBytes() {
      return pending;
    },
    get writtenBytes() {
      return written;
    },
    enqueue(view) {
      if (aborted || finishing || failed) throw new Error('This file is no longer accepting data.');
      if (
        !view.byteLength ||
        view.byteLength > CHUNK_SIZE ||
        accepted + view.byteLength > size ||
        pending + view.byteLength > RECEIVE_WINDOW
      ) {
        throw new Error('The sender exceeded the bounded disk-write window.');
      }
      const chunk = view.slice();
      accepted += chunk.byteLength;
      pending += chunk.byteLength;
      chain = chain.then(async () => {
        if (aborted) throw abortError();
        await writable.write(chunk);
        if (aborted) throw abortError();
        written += chunk.byteLength;
        pending -= chunk.byteLength;
        onProgress?.(written);
        if (written % RECEIVE_WINDOW === 0 || written === size) await onCheckpoint?.(written);
      });
      // Observe rejections immediately, even if eof/finish has not arrived yet.
      chain.catch((error) => {
        if (!failed && !aborted) {
          failed = true;
          onError?.(error);
        }
      });
    },
    async finish() {
      if (aborted) throw abortError();
      if (finishing || accepted !== size) throw new Error('The incoming file was incomplete.');
      finishing = true;
      await chain;
      if (aborted || written !== size)
        throw new Error('The incoming file could not be fully written.');
      // Only a successfully closed stream commits the file to its chosen path.
      await writable.close();
      committed = true;
    },
    abort() {
      if (committed) return Promise.resolve();
      aborted = true;
      // Wait for an in-flight write to release the stream before aborting it.
      abortPromise ??= chain
        .catch(() => {})
        .then(() => writable.abort())
        .catch(() => {});
      return abortPromise;
    },
  };
}
