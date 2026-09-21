import React, { useEffect, useState } from 'react';
import { useSpicy } from './spicy-mode.js';
import './admin.css';
import { AdminLoras } from './admin-loras.js';
import { adminApi as api } from './admin-api.js';
export function Admin() {
  const { spicy } = useSpicy(),
    mode = spicy ? 'nsfw' : 'sfw';
  const [section, setSection] = useState(
    new URLSearchParams(location.search).get('section') === 'loras' ? 'loras' : 'credentials',
  );
  const [settings, setSettings] = useState<any>(),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void api('')
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
        {['credentials', 'loras'].map((tab) => (
          <button
            key={tab}
            type="button"
            aria-current={section === tab ? 'page' : undefined}
            onClick={() => {
              setSection(tab);
              history.replaceState(null, '', '/admin?section=' + tab);
            }}
          >
            {tab === 'credentials' ? 'Credentials' : 'LoRAs'}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {section === 'credentials' ? (
        <>
          <div className="admin-section-heading">
            <h2>Credentials</h2>
            <p>Connect the services Seed uses. Saved keys stay on this PC.</p>
          </div>
          {settings ? (
            <div className="credential-list">
              {[
                {
                  id: 'falKey',
                  name: 'fal',
                  description: 'Image and video generation, LoRA uploads, and cost previews.',
                  url: 'https://fal.ai/dashboard/keys',
                },
                {
                  id: 'openrouterApiKey',
                  name: 'OpenRouter',
                  description: 'The assistant in Chat.',
                  url: 'https://openrouter.ai/settings/keys',
                },
                {
                  id: 'civitaiKey',
                  name: 'Civitai',
                  description: 'Download adapters from your Civitai account.',
                  url: 'https://civitai.com/user/account',
                },
              ].map((provider) => (
                <Credential
                  key={provider.id}
                  {...provider}
                  configured={settings.credentials[provider.id]?.configured}
                  onChange={(credentials) => setSettings((old: any) => ({ ...old, credentials }))}
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
      ) : (
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
  id: string;
  name: string;
  description: string;
  url: string;
  configured: boolean;
  onChange: (v: any) => void;
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
        const result = await api('/credentials/' + id, 'PATCH', {
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
