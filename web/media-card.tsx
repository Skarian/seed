import React, { useState } from 'react';

export function LoadingIndicator({ label }: { label: string }) {
  return <span className="media-loading" role="status"><span className="media-spinner" aria-hidden="true" /><span>{label}</span></span>;
}

export function MediaCard({ src, name, onOpen, onDelete, deleting }: {
  src: string; name: string; onOpen: () => void; onDelete: () => void; deleting: boolean;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  return <div className="library-item">
    <button className={`library-preview media-preview media-${state}`} onClick={() => {
      if (state === 'error') { setState('loading'); setAttempt(value => value + 1); }
      else if (state === 'ready') onOpen();
    }} aria-label={state === 'error' ? `Retry loading ${name}` : name}>
      <img key={attempt} src={src} alt={name} loading="lazy" decoding="async" onLoad={() => setState('ready')} onError={() => setState('error')} />
      {state === 'loading' && <LoadingIndicator label="Loading image…" />}
      {state === 'error' && <span className="media-error">Image unavailable. Click to retry.</span>}
    </button>
    <button className="library-delete" aria-label={`Delete ${name}`} title="Delete" disabled={deleting} onClick={onDelete}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
    </button>
  </div>;
}
