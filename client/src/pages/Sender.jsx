import { useEffect, useState } from 'react';
import { v4 as uuidv4, validate as validateUUID } from 'uuid';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Link2,
  LockKeyhole,
  ScanLine,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import FileDropZone from '../components/FileDropZone.jsx';
import QRDisplay from '../components/QRDisplay.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import TransferStatus from '../components/TransferStatus.jsx';
import { usePeerConnection } from '../hooks/usePeerConnection.js';
import { addHistory } from '../lib/format.js';

function ReceiveEntry() {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  function submit(e) {
    e.preventDefault();
    let id = link.trim();
    try {
      if (id.includes('/')) id = new URL(id).pathname.split('/receive/')[1]?.replace(/\/$/, '');
    } catch {
      /* Validate below. */
    }
    if (!id || !validateUUID(id))
      return setError('Paste a complete QuickDrop transfer link or a valid session ID.');
    navigate(`/receive/${id}`);
  }
  return (
    <div className="receive-entry">
      <div className="file-orbit">
        <ScanLine size={34} strokeWidth={1.4} />
      </div>
      <h2>A file is coming your way.</h2>
      <p>
        Scan the sender’s QR code with your phone’s camera,
        <br className="desktop-break" /> or paste their transfer link below.
      </p>
      <form onSubmit={submit}>
        <label className="sr-only" htmlFor="receive-link">
          Transfer link or session ID
        </label>
        <div className="link-input">
          <Link2 size={18} />
          <input
            id="receive-link"
            type="text"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setError('');
            }}
            placeholder="Paste a transfer link"
            required
            autoComplete="off"
          />
          <button className="button primary" type="submit">
            Connect <ArrowRight size={16} />
          </button>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </form>
      <span className="privacy-mini">
        <ShieldCheck size={14} /> You’ll review the file before accepting.
      </span>
    </div>
  );
}

export default function Sender() {
  const [mode, setMode] = useState('send');
  const [selection, setSelection] = useState(null);
  const transfer = usePeerConnection({
    role: 'sender',
    sessionId: selection?.id,
    file: selection?.file,
    onComplete: addHistory,
  });
  const active = ['connecting', 'waiting', 'awaiting-accept', 'transferring'].includes(
    transfer.status,
  );
  const ended = ['complete', 'error', 'declined', 'cancelled'].includes(transfer.status);
  useEffect(() => {
    if (!active) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
  function select(file) {
    setSelection({ file, id: uuidv4() });
  }
  function reset() {
    transfer.cancel();
    setSelection(null);
  }
  return (
    <>
      <section className="intro">
        <div className="eyebrow">
          <span /> LESS WAITING. MORE SHARING.
        </div>
        <h1>
          Good things are
          <br className="mobile-break" /> meant to be <span>shared.</span>
        </h1>
        <p>From your device to theirs. Just a file, a scan, and a connection.</p>
        <div className="intro-tags">
          <span>
            <LockKeyhole size={13} /> Private by design
          </span>
          <i />
          <span>
            <Zap size={13} /> Straight to your device
          </span>
          <i />
          <span>
            <Check size={13} /> No sign-up
          </span>
        </div>
      </section>
      <motion.section
        className="workspace"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        aria-label="File transfer"
      >
        <div className="workspace-top">
          <div className="mode-switch" role="tablist" aria-label="Transfer direction">
            <button
              role="tab"
              id="send-tab"
              aria-controls="send-panel"
              aria-selected={mode === 'send'}
              className={mode === 'send' ? 'active' : ''}
              onClick={() => setMode('send')}
            >
              <ArrowUpRight size={17} /> Send a file
            </button>
            <button
              role="tab"
              id="receive-tab"
              aria-controls="receive-panel"
              aria-selected={mode === 'receive'}
              disabled={active}
              className={mode === 'receive' ? 'active' : ''}
              onClick={() => setMode('receive')}
            >
              <ArrowDownLeft size={17} /> Receive a file
            </button>
          </div>
          <span className="connection-badge">
            <span /> Peer-to-peer
          </span>
        </div>
        <AnimatePresence mode="wait">
          {mode === 'send' ? (
            <motion.div
              key="send"
              id="send-panel"
              role="tabpanel"
              aria-labelledby="send-tab"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="transfer-grid">
                <div className="send-panel">
                  <div className="section-label">
                    <span className="step-number">01</span> SELECT A FILE{' '}
                    <span className="local-badge">STAYS LOCAL</span>
                  </div>
                  <FileDropZone
                    file={selection?.file}
                    onSelect={select}
                    onRemove={reset}
                    locked={active || transfer.status === 'complete'}
                  />
                  {transfer.status === 'transferring' && (
                    <ProgressBar {...transfer} size={selection?.file?.size} />
                  )}
                  <TransferStatus status={transfer.status} error={transfer.error} />
                  {selection && (
                    <div className="transfer-actions">
                      {active ? (
                        <button className="text-button" onClick={transfer.cancel}>
                          Cancel transfer
                        </button>
                      ) : ended ? (
                        <>
                          <button className="button primary" onClick={() => select(selection.file)}>
                            Create new QR code
                          </button>{' '}
                          <button className="button secondary" onClick={reset}>
                            Send another file <ArrowUpRight size={16} />
                          </button>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
                <QRDisplay
                  sessionId={selection?.id}
                  status={transfer.status}
                  expiresAt={transfer.status === 'waiting' ? transfer.expiresAt : null}
                  enabled={transfer.status === 'waiting'}
                />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="receive"
              role="tabpanel"
              id="receive-panel"
              aria-labelledby="receive-tab"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <ReceiveEntry />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="workspace-bottom">
          <LockKeyhole size={13} />
          <span>Your files never live on a server.</span>
          <span className="encrypted">
            <ShieldCheck size={13} /> Encrypted in transit
          </span>
        </div>
      </motion.section>
      <section className="how-steps" aria-label="How QuickDrop works">
        <div>
          <span className="how-number">01</span>
          <div>
            <h3>Pick something good.</h3>
            <p>A photo, a project, that very important PDF.</p>
          </div>
        </div>
        <span className="step-connector" />
        <div>
          <span className="how-number">02</span>
          <div>
            <h3>Make the connection.</h3>
            <p>Scan the QR code on the other device.</p>
          </div>
        </div>
        <span className="step-connector" />
        <div>
          <span className="how-number">03</span>
          <div>
            <h3>And it’s theirs.</h3>
            <p>Accept the file. We’ll take it from here.</p>
          </div>
        </div>
      </section>
    </>
  );
}
