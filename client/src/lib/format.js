export { MAX_FILE_SIZE, MAX_MEMORY_FILE_SIZE } from './transfer.js';
export function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
export function formatETA(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return 'Calculating…';
  if (seconds < 1) return 'Almost there';
  return seconds < 60
    ? `${Math.ceil(seconds)}s remaining`
    : `${Math.ceil(seconds / 60)}m remaining`;
}
export function receiveUrl(sessionId) {
  const base = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, '');
  return `${base}/receive/${sessionId}`;
}
const HISTORY_KEY = 'quickdrop-history-v1';
export function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(value)
      ? value.filter((x) => x && typeof x.name === 'string' && Number.isFinite(x.size)).slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
export function addHistory(record) {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(
        [{ ...record, completedAt: record.completedAt || Date.now() }, ...readHistory()].slice(
          0,
          20,
        ),
      ),
    );
    window.dispatchEvent(new Event('quickdrop-history'));
  } catch {
    /* Storage may be disabled; transfer still succeeds. */
  }
}
export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* No persisted history. */
  }
  window.dispatchEvent(new Event('quickdrop-history'));
}
