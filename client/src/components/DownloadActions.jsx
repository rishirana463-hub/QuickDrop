import { useState } from 'react';
import { ArrowDownToLine, Smartphone } from 'lucide-react';

export default function DownloadActions({ file, url }) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const nativePicker = typeof window.showSaveFilePicker === 'function';
  let nativeShare = false;
  try {
    nativeShare = !!file && !!navigator.canShare?.({ files: [file] });
  } catch {
    /* Unsupported file. */
  }
  async function save() {
    if (!file || saving) return;
    setSaving(true);
    setMessage('');
    let writable;
    try {
      if (nativePicker) {
        // Invoke directly from the user's click, before asynchronous work.
        const handle = await window.showSaveFilePicker({ suggestedName: file.name });
        writable = await handle.createWritable();
        await writable.write(file);
        await writable.close();
        writable = null;
        setMessage('File saved to the location you chose.');
      } else {
        await navigator.share({ files: [file] });
        setMessage('Save options closed. Check the destination you selected.');
      }
    } catch (error) {
      if (writable) {
        try {
          await writable.abort();
        } catch {
          /* Already closed. */
        }
      }
      setMessage(
        error.name === 'AbortError'
          ? 'Save cancelled. Your file is still available below.'
          : 'Could not save there. Try Download file, or open this page in your full browser.',
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="download-fallback">
      <p>All file bytes have arrived. Check your Downloads, or choose how to save below.</p>
      <div className="download-buttons">
        <a className="button primary" href={url} download={file?.name}>
          Download file <ArrowDownToLine size={17} />
        </a>
        {(nativePicker || nativeShare) && (
          <button className="button secondary" onClick={save} disabled={saving}>
            <Smartphone size={17} />
            {saving ? 'Saving…' : 'Save to device'}
          </button>
        )}
      </div>
      <p>
        If your phone shows a preview, use its Download or Share → Save to Files option. In a QR
        scanner, choose Open in browser.
      </p>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
