import {Modal} from './modal.js';
import React, { useEffect, useId, useRef, useState } from 'react';

export function ConfirmDialog({ title, description, action, onConfirm, onClose }: {
  title: string; description: string; action: string;
  onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId(), descriptionId = useId();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  return <Modal ref={dialog} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!pending.current) onClose(); }}>
    <h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p>
    {error && <p role="alert">{error}</p>}
    <div className="confirm-actions">
      <button ref={cancel} disabled={busy} onClick={onClose}>Cancel</button>
      <button className="destructive" disabled={busy} onClick={async () => {
        if (pending.current) return;
        pending.current = true; setBusy(true); setError('');
        try { await onConfirm(); onClose(); }
        catch (failure) { setError((failure as Error).message); }
        finally { pending.current = false; setBusy(false); }
      }}>{busy ? 'Working…' : action}</button>
    </div>
  </Modal>;
}
