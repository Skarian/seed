import React, { useEffect, useRef, useState } from 'react';
import type { AccessSettings } from '../shared/access.js';
import { adminApi as api } from './admin-api.js';

export function AdminAccess() {
  const [settings, setSettings] = useState<AccessSettings>();
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'removing'>('loading');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    setStatus('loading');
    setError('');
    void api<AccessSettings>('/access', 'GET', undefined, controller.signal)
      .then(result => {
        if (active.current !== controller) return;
        setSettings(result);
        setValue(result.publicOrigin ?? '');
      })
      .catch(error => {
        if (active.current === controller && !controller.signal.aborted) setError((error as Error).message);
      })
      .finally(() => {
        if (active.current !== controller) return;
        active.current = null;
        setStatus('idle');
      });
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [attempt]);

  async function save(remove = false) {
    if (active.current || !settings) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus(remove ? 'removing' : 'saving');
    setError('');
    setMessage('');
    try {
      const result = await api<AccessSettings>('/access', 'PATCH', {
        publicOrigin: remove ? null : value.trim(),
      }, controller.signal);
      if (active.current !== controller) return;
      setSettings(result);
      setValue(result.publicOrigin ?? '');
      setMessage(remove ? 'Address removed. Your local address still works.' : 'Address saved. No restart needed.');
    } catch (error) {
      if (active.current === controller && !controller.signal.aborted) setError((error as Error).message);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setStatus('idle');
      }
    }
  }

  const dirty = value.trim() !== (settings?.publicOrigin ?? '');
  const busy = status !== 'idle';
  return (
    <section className="admin-access" aria-label="Access settings">
      <div className="admin-section-heading">
        <h2>Access</h2>
        <p>Open Seed on your network or through your own secure tunnel.</p>
      </div>
      {status === 'loading' ? <p role="status">Loading access settings…</p> : !settings ? (
        <div className="admin-access-load-error">
          <p role="alert">{error}</p>
          <button type="button" onClick={() => setAttempt(old => old + 1)}>Try again</button>
        </div>
      ) : (
        <>
          <div className="admin-local-address">
            <h3>On this network</h3>
            <a href={settings.localUrl} aria-label="Open Seed at its local address">{settings.localUrl}</a>
          </div>
          <form className="admin-access-card" onSubmit={event => { event.preventDefault(); void save(); }}>
            <div className="admin-access-heading">
              <label htmlFor="remote-url">Remote URL</label>
              <span className={'admin-status' + (settings.publicOrigin && !dirty ? ' ready' : '')}>
                {dirty ? 'Unsaved changes' : settings.publicOrigin ? 'Address saved' : 'Not set'}
              </span>
            </div>
            <p className="admin-access-description">The HTTPS address for your tunnel. Your local address keeps working.</p>
            <input
              id="remote-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={2048}
              placeholder="https://seed.example.com"
              value={value}
              disabled={busy}
              aria-describedby="remote-url-help"
              onChange={event => { setValue(event.target.value); setError(''); setMessage(''); }}
            />
            <p id="remote-url-help" className="admin-access-help">
              Configure your tunnel with sign-in protection outside Seed.
              Saving this URL does not create a tunnel or a login.
            </p>
            <div className="admin-access-actions">
              <button type="submit" className="admin-primary" disabled={busy || !dirty || !value.trim()}>
                {status === 'saving' ? 'Saving…' : 'Save address'}
              </button>
              {settings.publicOrigin && <button type="button" disabled={busy} onClick={() => void save(true)}>
                {status === 'removing' ? 'Removing…' : 'Remove address'}
              </button>}
            </div>
            {error && <p role="alert">{error}</p>}
            {message && <p role="status" className="admin-success">{message}</p>}
          </form>
        </>
      )}
    </section>
  );
}
