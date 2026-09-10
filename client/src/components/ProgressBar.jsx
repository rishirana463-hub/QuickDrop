import { motion } from 'framer-motion';
import { formatBytes, formatETA } from '../lib/format.js';

export default function ProgressBar({
  progress = 0,
  speed = 0,
  eta,
  bytesTransferred = 0,
  size = 0,
}) {
  const percent = Math.min(100, Math.max(0, progress));
  return (
    <div className="transfer-progress">
      <div className="progress-heading">
        <span>Keep both tabs open</span>
        <strong>
          {percent.toFixed(0)}
          <small>%</small>
        </strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="File transfer"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div animate={{ width: `${percent}%` }} transition={{ duration: 0.25 }} />
      </div>
      <div className="progress-detail">
        <span>
          {formatBytes(bytesTransferred)} / {formatBytes(size)}
        </span>
        <span>
          {formatBytes(speed)}/s <span className="dot-divider">·</span> {formatETA(eta)}
        </span>
      </div>
    </div>
  );
}
