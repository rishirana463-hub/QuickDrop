import { motion } from 'framer-motion';
import { CircleAlert, LoaderCircle, Radio, ShieldCheck, X } from 'lucide-react';
const messages = {
  idle: ['Ready when you are', 'Your file stays on your device until it’s accepted.'],
  connecting: ['Making a connection', 'Setting up a private path between your devices.'],
  waiting: ['Waiting for receiver…', 'Scan the code or share the link to connect.'],
  'awaiting-accept': [
    'Connected · waiting for acceptance',
    'The other device needs to accept your file.',
  ],
  transferring: ['Transfer in progress', 'Your file is moving directly between devices.'],
  complete: ['Transfer complete', 'All bytes received. You’re good to go.'],
  declined: ['Transfer declined', 'The receiver chose not to accept this file.'],
  cancelled: ['Transfer cancelled', 'Start again whenever you’re ready.'],
  error: ['Couldn’t complete the transfer', 'Try a fresh link and keep both devices online.'],
};
export function SuccessCheck() {
  return (
    <motion.svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="success-check">
      <motion.path
        d="m5 12 4 4L19 6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45 }}
      />
    </motion.svg>
  );
}
export default function TransferStatus({ status = 'idle', error, receiver = false }) {
  let [title, description] = messages[status] || messages.idle;
  if (receiver && status === 'awaiting-accept')
    [title, description] = ['Your file is ready', 'Accept the file below to start receiving.'];
  if (receiver && status === 'waiting')
    [title, description] = [
      'Waiting for the sender',
      'Keep this tab open while the devices connect.',
    ];
  return (
    <div className={`status-wrap status-${status}`} role="status" aria-live="polite">
      <motion.div
        className="status-inner"
        key={status}
        initial={{ opacity: 1, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        <span className="status-icon">
          {status === 'complete' ? (
            <SuccessCheck />
          ) : status === 'error' ? (
            <CircleAlert size={19} />
          ) : ['cancelled', 'declined'].includes(status) ? (
            <X size={19} />
          ) : ['connecting', 'transferring'].includes(status) ? (
            <LoaderCircle className="spin" size={19} />
          ) : status === 'idle' ? (
            <ShieldCheck size={20} />
          ) : (
            <Radio size={19} />
          )}
        </span>
        <div>
          <strong>{title}</strong>
          <p>{error || description}</p>
        </div>
        {status === 'waiting' && (
          <span className="waiting-dots">
            <i />
            <i />
            <i />
          </span>
        )}
      </motion.div>
    </div>
  );
}
