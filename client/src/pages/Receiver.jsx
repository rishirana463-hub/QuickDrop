import { Link, useParams } from 'react-router-dom';
import { validate as validateUUID } from 'uuid';
import { ArrowDownToLine, ArrowLeft, FileDown, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { usePeerConnection } from '../hooks/usePeerConnection.js';
import { addHistory, formatBytes } from '../lib/format.js';
import TransferStatus from '../components/TransferStatus.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import DownloadActions from '../components/DownloadActions.jsx';
import { useState } from 'react';

function IncomingTransfer({ sessionId }) {
  const transfer = usePeerConnection({ role: 'receiver', sessionId, onComplete: addHistory });
  const { metadata, status, error } = transfer;
  const [preferDisk, setPreferDisk] = useState(false);
  const useDisk = transfer.requiresDisk || preferDisk;
  const unsupportedLarge = transfer.requiresDisk && !transfer.canStreamToDisk;
  const ended = ['complete', 'declined', 'cancelled', 'error'].includes(status);
  return (
    <motion.section
      className="receiver-card"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="section-label">
        <ArrowDownToLine size={16} /> INCOMING FILE{' '}
        <span className="local-badge">PRIVATE TRANSFER</span>
      </div>
      <TransferStatus status={status} error={error} receiver />
      {metadata && (
        <div className="incoming-file">
          <div className="file-orbit">
            <FileDown size={36} strokeWidth={1.4} />
          </div>
          <h2 title={metadata.name}>{metadata.name}</h2>
          <p>
            {formatBytes(metadata.size)} <span className="dot-divider">·</span>{' '}
            {metadata.type || 'File'}
          </p>
        </div>
      )}
      {status === 'awaiting-accept' && (
        <div className="consent-panel">
          <p>
            Only accept files from someone you know.
            <br />
            {useDisk
              ? 'Choose a save location before any file bytes are sent.'
              : 'Your download starts after you accept.'}
          </p>
          {transfer.canStreamToDisk && !transfer.requiresDisk && (
            <label className="disk-choice">
              <input
                type="checkbox"
                checked={preferDisk}
                disabled={transfer.choosingDestination}
                onChange={(event) => setPreferDisk(event.target.checked)}
              />{' '}
              Save directly to disk
            </label>
          )}
          {transfer.requiresDisk && (
            <p className={unsupportedLarge ? 'inline-error' : 'disk-notice'}>
              {unsupportedLarge
                ? 'This browser cannot receive files over 512 MB. Open this link in a desktop browser with direct-to-disk saving, such as Chrome or Edge.'
                : 'Large file: writes directly to your chosen location. Ensure there is enough free disk space.'}
            </p>
          )}
          {transfer.saveError && (
            <p role="alert" className="inline-error">
              {transfer.saveError}
            </p>
          )}
          <div>
            <button className="button secondary" onClick={transfer.decline}>
              Decline
            </button>
            <button
              className="button primary"
              disabled={unsupportedLarge || transfer.choosingDestination}
              onClick={() => transfer.accept({ toDisk: useDisk })}
            >
              {transfer.choosingDestination
                ? 'Choose a location…'
                : useDisk
                  ? 'Accept & save'
                  : 'Accept file'}{' '}
              <ArrowDownToLine size={17} />
            </button>
          </div>
        </div>
      )}
      {status === 'transferring' && <ProgressBar {...transfer} size={metadata?.size} />}
      {status === 'complete' && transfer.savedToDisk && (
        <div className="download-fallback">
          <p>
            <strong>Saved directly to your chosen location.</strong>
            <br />
            The file is already on your device. No additional download is needed.
          </p>
        </div>
      )}
      {status === 'complete' && !transfer.savedToDisk && (
        <DownloadActions file={transfer.receivedFile} url={transfer.downloadUrl} />
      )}
      {status === 'error' && (
        <div className="invitation-help">
          <h3>Start from the sender’s current QR code</h3>
          <ol>
            <li>
              On the sending device, tap <strong>Create new QR code</strong>, or select your file
              again.
            </li>
            <li>Keep that sender tab open and the device awake.</li>
            <li>
              Scan the new code on the receiving device, then tap <strong>Accept file</strong>.
            </li>
          </ol>
          <p>
            Old, completed, and expired links cannot download a file. The file is only available
            while the sender is connected.
          </p>
        </div>
      )}
      {!ended && status !== 'awaiting-accept' && (
        <div className="transfer-actions">
          <button className="text-button" onClick={transfer.cancel}>
            Cancel transfer
          </button>
        </div>
      )}
      {ended && (
        <Link className="text-button back-link" to="/">
          <ArrowLeft size={15} /> Back to QuickDrop
        </Link>
      )}
      <div className="receiver-note">
        <ShieldCheck size={15} /> Encrypted directly between your devices.
      </div>
    </motion.section>
  );
}

export default function Receiver() {
  const { sessionId } = useParams();
  return (
    <>
      <section className="intro receiver-intro">
        <div className="eyebrow">
          <span /> A DIRECT CONNECTION
        </div>
        <h1>
          Something good
          <br className="mobile-break" /> is <span>on its way.</span>
        </h1>
        <p>One small step. Then it’s on your device.</p>
      </section>
      {validateUUID(sessionId || '') ? (
        <IncomingTransfer key={sessionId} sessionId={sessionId} />
      ) : (
        <section className="receiver-card">
          <TransferStatus
            status="error"
            error="This transfer link isn’t valid. Ask the sender for a new QR code or link."
          />
          <Link className="button secondary" to="/">
            Back to QuickDrop <ArrowLeft size={16} />
          </Link>
        </section>
      )}
    </>
  );
}
