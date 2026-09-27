import React, { useEffect, useState } from 'react';
import { useSpicy } from './spicy-mode.js';
import './admin.css';
import { AdminLoras } from './admin-loras.js';
import { AdminAccess } from './admin-access.js';
import { adminApi as api } from './admin-api.js';
import { credentialDefinitions, type AdminSettings, type CredentialField, type CredentialStatuses } from '../shared/credentials.js';
export function Admin() {
  const { spicy } = useSpicy(),
    mode = spicy ? 'nsfw' : 'sfw';
  const [section, setSection] = useState(() => {
    const selected = new URLSearchParams(location.search).get('section');
    return selected === 'loras' || selected === 'access' ? selected : 'credentials';
  });
  const [settings, setSettings] = useState<AdminSettings>(),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void api<AdminSettings>('')
      .then((v) => {
        if (live) setSettings(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="admin-page" aria-label="Admin">
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">SETTINGS</p>
          <h1>Admin</h1>
          <p>Your connections and creative tools.</p>
        </div>
      </header>
      <nav className="admin-tabs" aria-label="Admin pages">
        {['credentials', 'loras', 'access'].map((tab) => (
          <button
            key={tab}
            type="button"
            aria-current={section === tab ? 'page' : undefined}
            onClick={() => {
              setSection(tab);
              history.replaceState(null, '', '/admin?section=' + tab);
            }}
          >
            {tab === 'credentials' ? 'Credentials' : tab === 'loras' ? 'LoRAs' : 'Access'}
          </button>
        ))}
      </nav>
      {error && section === 'credentials' && <p role="alert">{error}</p>}
      {section === 'credentials' ? (
        <>
          <div className="admin-section-heading">
            <h2>Credentials</h2>
            <p>Connect the services Seed uses. Keys are stored locally on this PC.</p>
          </div>
          {settings ? (
            <div className="credential-list">
              {credentialDefinitions.map((provider) => (
                <Credential
                  key={provider.id}
                  {...provider}
                  url={provider.keyUrl}
                  configured={settings.credentials[provider.id]?.configured}
                  onChange={(credentials) => setSettings((old) => old ? ({ ...old, credentials }) : old)}
                />
              ))}
            </div>
          ) : (
            <p role="status">Loading credentials…</p>
          )}
          <details className="admin-storage">
            <summary>Application storage</summary>
            <p>Configuration, keys, and LoRA metadata</p>
            <code>{settings?.storage.config}</code>
            <p>Media and local LoRA files</p>
            <code>{settings?.storage.data}</code>
          </details>
        </>
      ) : section === 'access' ? <AdminAccess /> : (
        <AdminLoras key={mode} mode={mode} />
      )}
    </section>
  );
}
function Credential({
  id,
  name,
  description,
  url,
  configured,
  onChange,
}: {
  id: CredentialField;
  name: string;
  description: string;
  url: string;
  configured: boolean;
  onChange: (v: CredentialStatuses) => void;
}) {
  const [value, setValue] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  async function run(action: 'save' | 'remove' | 'check') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (action === 'check') {
        await api('/credentials/' + id + '/check', 'POST', {});
        setMessage('Connection verified.');
      } else {
        const result = await api<{ credentials: CredentialStatuses }>('/credentials/' + id, 'PATCH', {
          value: action === 'remove' ? null : value,
        });
        onChange(result.credentials);
        setValue('');
        setMessage(action === 'remove' ? 'Key removed.' : 'Key saved.');
        window.dispatchEvent(new Event('seed:credentials-changed'));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="credential-card"
      onSubmit={(e) => {
        e.preventDefault();
        void run('save');
      }}
    >
      <div className="credential-heading">
        <h3>{name}</h3>
        <span className={'admin-status ' + (configured ? 'ready' : '')}>
          {configured ? 'Configured' : 'Not configured'}
        </span>
      </div>
      <p>{description}</p>
      <label className="sr-only" htmlFor={'key-' + id}>
        {name} API key
      </label>
      <div className="credential-input">
        <input
          id={'key-' + id}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          placeholder={configured ? 'Paste a replacement key' : 'Paste API key'}
        />
        <button type="submit" className="admin-primary" disabled={busy || !value.trim()}>
          {busy ? 'Working…' : 'Save key'}
        </button>
      </div>
      <div className="credential-actions">
        <a href={url} target="_blank" rel="noopener noreferrer">
          Get API key ↗
        </a>
        {configured && (
          <>
            <button type="button" disabled={busy} onClick={() => void run('check')}>
              Test connection
            </button>
            <button type="button" disabled={busy} onClick={() => void run('remove')}>
              Remove key
            </button>
          </>
        )}
      </div>
      {message && (
        <p role="status" className="admin-success">
          {message}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
