import { useEffect, useRef, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock3,
  History,
  Moon,
  Pause,
  Play,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import Sender from './pages/Sender.jsx';
import Receiver from './pages/Receiver.jsx';
import { clearHistory, formatBytes, readHistory } from './lib/format.js';

function AppDialog({ open, onClose, title, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="app-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function App() {
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const motionEnabled = !paused && !reducedMotion;
  const [dialog, setDialog] = useState(null);
  const [history, setHistory] = useState(readHistory);
  const [light, setLight] = useState(() => {
    try {
      return localStorage.getItem('quickdrop-theme') === 'light';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    try {
      localStorage.setItem('quickdrop-theme', light ? 'light' : 'dark');
    } catch {
      /* Optional preference. */
    }
  }, [light]);
  useEffect(() => {
    const sync = () => setHistory(readHistory());
    window.addEventListener('quickdrop-history', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('quickdrop-history', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return (
    <div className="app-shell" data-motion={motionEnabled ? 'on' : 'off'}>
      <header className="site-header">
        <Link className="brand" to="/" aria-label="QuickDrop home">
          <span className="brand-mark">
            <ArrowUpRight size={29} strokeWidth={3} />
          </span>
          QuickDrop<span className="brand-period">.</span>
        </Link>
        <nav aria-label="Main navigation">
          <button className="nav-help" onClick={() => setDialog('help')}>
            How it works <ArrowUpRight size={14} />
          </button>
          <span className="nav-divider" />
          <button
            className="icon-button motion-toggle"
            aria-label={paused ? 'Play animations' : 'Pause animations'}
            title={paused ? 'Play animations' : 'Pause animations'}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            className="icon-button"
            aria-label="Transfer history"
            title="Transfer history"
            onClick={() => setDialog('history')}
          >
            <History size={19} />
          </button>
          <button
            className="icon-button"
            aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}
            onClick={() => setLight(!light)}
          >
            {light ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Sender motionEnabled={motionEnabled} />} />
          <Route path="/receive/:sessionId" element={<Receiver />} />
          <Route path="/receive" element={<Receiver />} />
          <Route
            path="*"
            element={
              <section className="receiver-card not-found">
                <h1>Nothing landed here.</h1>
                <p>Check your transfer link or start a new transfer.</p>
                <Link className="button primary" to="/">
                  Back to QuickDrop
                </Link>
              </section>
            }
          />
        </Routes>
      </main>
      <footer className="site-footer">
        <span>
          <span className="footer-dot" /> QuickDrop. A little closer.
        </span>
        <span>
          Thoughtfully simple. © 2026 <ArrowUpRight size={16} />
        </span>
      </footer>
      <AppDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'history' ? 'Recent transfers' : 'A file. A scan. Done.'}
      >
        {dialog === 'history' ? (
          <>
            <p className="dialog-description">
              Completed transfers on this browser. File contents are never saved here.
            </p>
            {history.length ? (
              <>
                <ul className="history-list">
                  {history.map((item, i) => (
                    <li key={`${item.completedAt}-${i}`}>
                      <span className="history-icon">
                        {item.role === 'sender' ? (
                          <ArrowUpRight size={18} />
                        ) : (
                          <ArrowDownLeft size={18} />
                        )}
                      </span>
                      <div>
                        <strong title={item.name}>{item.name}</strong>
                        <span>
                          {formatBytes(item.size)} · {item.role === 'sender' ? 'Sent' : 'Received'}{' '}
                          · {new Date(item.completedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <Check size={16} className="history-check" />
                    </li>
                  ))}
                </ul>
                <button className="text-button clear-history" onClick={clearHistory}>
                  Clear history
                </button>
              </>
            ) : (
              <div className="history-empty">
                <Clock3 size={30} strokeWidth={1.3} />
                <h3>A fresh start.</h3>
                <p>Your completed transfers will appear here.</p>
              </div>
            )}
          </>
        ) : (
          <div className="help-content">
            <ol>
              <li>
                <strong>Choose a file.</strong>
                <p>
                  Choose a file up to 100 GB. Files over 512 MB require a receiving browser with
                  direct-to-disk saving, such as desktop Chrome or Edge. Other browsers keep the 512
                  MB limit.
                </p>
              </li>
              <li>
                <strong>Connect another device.</strong>
                <p>
                  Scan the QR code with your phone’s camera, or open the transfer link on the other
                  device. Unused links expire after five minutes.
                </p>
              </li>
              <li>
                <strong>Accept and receive.</strong>
                <p>
                  Check the filename, accept the file, and keep both tabs open until the transfer
                  finishes. The download starts automatically.
                </p>
              </li>
            </ol>
            <div className="help-privacy">
              <ShieldCheck size={20} />
              <p>
                File contents move over an encrypted WebRTC connection. The signaling service only
                helps your devices find each other.
              </p>
            </div>
            <p className="help-note">
              Works best on the same Wi-Fi. Some networks need a TURN relay to connect. Transfers
              interrupted by a closed tab or lost connection must be started again.
            </p>
          </div>
        )}
      </AppDialog>
    </div>
  );
}
