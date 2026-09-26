import React, { useState } from 'react';

export function LoadingIndicator({ label }: { label: string }) {
  return <span className="media-loading" role="status"><span className="media-spinner" aria-hidden="true" /><span>{label}</span></span>;
}

export function MediaCard({ src, name, kind = 'image', onOpen, onDelete, deleting, frameCount,actions }: {
  kind?: 'image'|'video'|'audio'|'sequence'; frameCount?:number; src: string; name: string; onOpen: () => void; onDelete: () => void; deleting: boolean;
  actions?:React.ReactNode;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  return <div className="library-item">
    <button className={`library-preview media-preview media-${state}`} onClick={() => {
      if(kind==='sequence'){onOpen();return;}
      if (state === 'error') { setState('loading'); setAttempt(value => value + 1); }
      else if (state === 'ready') onOpen();
    }} aria-label={state === 'error' ? `Retry loading ${name}` : name}>
      {(kind === 'image'||kind==='sequence') ? <img key={attempt} src={src} alt={name} loading="lazy" decoding="async" onLoad={() => setState('ready')} onError={() => setState('error')} /> : kind === 'video' ? <video key={attempt} src={src} muted playsInline preload="metadata" onLoadedData={() => setState('ready')} onError={() => setState('error')} /> : <><audio key={attempt} src={src} preload="metadata" onLoadedMetadata={() => setState('ready')} onError={() => setState('error')} /><span className="audio-symbol">♫</span></>}
      {kind==='sequence' && <span className="frame-count">{frameCount} frames</span>}
      {state === 'ready' && kind === 'video' && <span className="media-play" aria-hidden="true">▶</span>}
      {state === 'loading' && <LoadingIndicator label={`Loading ${kind}…`} />}
      {state === 'error' && <span className="media-error">Media unavailable. Click to retry.</span>}
    </button>
    {actions&&<div className="library-item-actions">{actions}</div>}
    <button className="library-delete" aria-label={`Delete ${name}`} title="Delete" disabled={deleting} onClick={onDelete}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
    </button>
  </div>;
}
