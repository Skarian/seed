import {Modal} from './modal.js';
import React, { useEffect, useRef, type ReactNode } from 'react';

export type PreviewMedia = {
  name: string; url: string; kind: 'image' | 'video' | 'audio'; type: string;
  width?: number; height?: number; duration?: number;
};
export function MediaPreview({ media, onClose, onDelete, controls, label='Media preview' }: {
  media: PreviewMedia; onClose: () => void; onDelete?: () => void; controls?: ReactNode; label?:string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  return <Modal ref={dialog} className="media-viewer" aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="viewer-toolbar">
      <button type="button" className="viewer-button" aria-label="Close preview" onClick={onClose}><Glyph name="close" /></button>
      <div className="viewer-actions">
        <details className="viewer-info"><summary aria-label="File information"><Glyph name="info" /></summary><div><strong>{media.name}</strong><span>{media.type || media.kind}</span>{media.width !== undefined && <span>{media.width} × {media.height}</span>}{media.duration !== undefined && <span>{media.duration.toFixed(1)} seconds</span>}</div></details>
        <a className="viewer-button" href={media.url} download={media.name} aria-label="Download file"><Glyph name="download" /></a>
        {onDelete && <button type="button" className="viewer-button" aria-label="Delete file" onClick={onDelete}><Glyph name="delete" /></button>}
      </div>
    </header>
    <div className="viewer-canvas" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      {media.kind === 'image' ? <img src={media.url} alt={media.name} /> : media.kind === 'video' ? <video src={media.url} controls playsInline preload="metadata" /> : <div className="viewer-audio"><span aria-hidden="true">♫</span><audio src={media.url} controls preload="metadata" /></div>}
    </div>
    {controls && <div className="viewer-controls">{controls}</div>}
  </Modal>;
}
export function Glyph({ name }: { name: 'close' | 'info' | 'download' | 'delete' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'close' && <path d="m6 6 12 12M6 18 18 6" />}
    {name === 'info' && <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>}
    {name === 'download' && <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>}
    {name === 'delete' && <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>}
  </svg>;
}
