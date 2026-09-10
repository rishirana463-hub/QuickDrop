import { useRef, useState } from 'react';
import { ArrowUpRight, FileUp, FolderUp, Plus, X } from 'lucide-react';
import TiltCard from './TiltCard.jsx';
import { formatBytes, MAX_FILE_SIZE } from '../lib/format.js';

export default function FileDropZone({ file, onSelect, onRemove, locked = false }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  function choose(files) {
    setDragging(false);
    if (locked || !files?.length) return;
    if (files.length > 1) return setError('Choose one file at a time for this transfer.');
    if (files[0].size > MAX_FILE_SIZE) return setError('Choose a file up to 100 GB.');
    setError('');
    onSelect(files[0]);
  }
  return (
    <div>
      <input
        ref={input}
        type="file"
        className="sr-only"
        aria-label="Choose a file to send"
        disabled={locked}
        tabIndex={-1}
        onChange={(e) => {
          choose(e.target.files);
          e.target.value = '';
        }}
      />
      <TiltCard
        className={`drop-zone ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          choose(e.dataTransfer.files);
        }}
      >
        {file ? (
          <>
            <div className="file-orbit">
              <FileUp size={36} strokeWidth={1.4} />
            </div>
            <h3 className="file-name" title={file.name}>
              {file.name}
            </h3>
            <p>
              {formatBytes(file.size)} <span className="dot-divider">·</span> {file.type || 'File'}
            </p>
            {!locked && (
              <button className="text-button" onClick={onRemove}>
                <X size={14} /> Remove file
              </button>
            )}
          </>
        ) : (
          <>
            <div className="upload-symbol">
              <FolderUp size={42} strokeWidth={1.3} />
              <span>
                <Plus size={13} />
              </span>
            </div>
            <h3>Drop your file here</h3>
            <p>or choose something to share</p>
            <button className="button primary" onClick={() => input.current?.click()}>
              Browse files <ArrowUpRight size={17} />
            </button>
            <span className="file-limit">
              Any file type <span>·</span> Up to 100 GB*
            </span>
            <span className="file-limit">*Over 512 MB needs direct-to-disk receiving.</span>
          </>
        )}
      </TiltCard>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </div>
  );
}
