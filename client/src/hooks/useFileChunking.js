import { useCallback } from 'react';
import { sendFileInChunks } from '../lib/transfer';

// State and cancellation belong to the session; this hook only reads one slice
// at a time and lets the peer apply transport backpressure between slices.
export function useFileChunking() {
  return useCallback((options) => sendFileInChunks(options), []);
}

export default useFileChunking;
