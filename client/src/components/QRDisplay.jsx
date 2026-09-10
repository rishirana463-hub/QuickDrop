import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, QrCode, ScanLine, Smartphone, CheckCheck } from 'lucide-react';
import TiltCard from './TiltCard.jsx';
import { receiveUrl } from '../lib/format.js';

export default function QRDisplay({ sessionId, expiresAt, status = 'idle', enabled = true }) {
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(t);
    }
  }, [copied]);
  const url = sessionId ? receiveUrl(sessionId) : '';
  const localOnly = url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  const seconds = Math.max(0, Math.ceil(((expiresAt || now) - now) / 1000));
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <div className="qr-panel">
      <div className="section-label">
        <span className="step-number">02</span> CONNECT YOUR DEVICE
      </div>
      <AnimatePresence mode="wait">
        {sessionId && enabled ? (
          <motion.div
            key={sessionId}
            className="qr-active"
            initial={{ opacity: 0, scale: 0.93 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 22 }}
          >
            <TiltCard className="qr-code">
              <QRCodeSVG
                value={url}
                size={166}
                level="M"
                marginSize={2}
                title="Scan to receive your file"
              />
            </TiltCard>
            <h3>{localOnly ? 'Local preview link' : 'One scan away.'}</h3>
            <p>
              {localOnly ? (
                'This address only works on this computer. Open QuickDrop at a public HTTPS address before scanning with your phone.'
              ) : (
                <>
                  Open your phone’s camera
                  <br />
                  and point it at this code.
                </>
              )}
            </p>
            {expiresAt && seconds > 0 && (
              <span className="expiry">
                Link expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
              </span>
            )}
            <p className="sender-reminder">
              Keep this sender tab open. Scan on the other device, then tap Accept file.
            </p>
            <button className="button secondary copy-button" onClick={copy}>
              {copied ? <Check size={15} /> : <Copy size={15} />}{' '}
              {copied ? 'Link copied' : 'Copy transfer link'}
            </button>
            <input
              className={copyError ? 'link-fallback' : 'sr-only'}
              aria-label="Transfer link"
              readOnly
              value={url}
              tabIndex={copyError ? 0 : -1}
              onFocus={(e) => e.target.select()}
            />
            {copyError && <p className="copy-help">Select and copy the link above.</p>}
          </motion.div>
        ) : ['awaiting-accept', 'transferring', 'complete'].includes(status) ? (
          <motion.div
            key="connected"
            className="qr-empty connected-device"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="connected-symbol">
              {status === 'complete' ? (
                <CheckCheck size={46} strokeWidth={1.3} />
              ) : (
                <Smartphone size={46} strokeWidth={1.3} />
              )}
              <span>
                <Check size={13} />
              </span>
            </div>
            <h3>{status === 'complete' ? 'Successfully delivered.' : 'You’re connected.'}</h3>
            <p>
              {status === 'complete'
                ? 'A little less distance between your devices.'
                : status === 'transferring'
                  ? 'Your file is on its way. Keep both tabs open.'
                  : 'Accept the file on your other device to continue.'}
            </p>
            <div className="camera-note">
              <span className="connected-dot" />{' '}
              {status === 'complete' ? 'Every byte, received' : 'Private connection established'}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            className="qr-empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="qr-placeholder">
              <i />
              <i />
              <i />
              <i />
              <QrCode size={64} strokeWidth={1} />
              <span className="scan-line" />
            </div>
            <h3>Your next device is a scan away</h3>
            <p>
              {status === 'connecting'
                ? 'Preparing your connection…'
                : sessionId
                  ? 'Start a new transfer to create a fresh code.'
                  : 'Add a file to create your private QR code.'}
            </p>
            <div className="camera-note">
              <Smartphone size={14} /> No app needed on the other device
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="qr-bottom">
        <ScanLine size={15} />
        <span>Scan. Accept. Enjoy.</span>
      </div>
    </div>
  );
}
