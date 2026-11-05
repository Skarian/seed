import React, { useEffect, useState } from 'react';
import { useToaster, resolveValue } from 'react-hot-toast/headless';
import { useApp } from '../data.js';
import { api } from '../api.js';
import { StatusControl } from '../App.js';
import { onTabKeys, tabStop, Confirm } from '../ui.js';
import {
  credentialDefinitions,
  type AdminSettings,
  type CredentialField,
  type CredentialStatuses,
} from '../../../shared/credentials.js';
import { AdminLoras } from '../../admin-loras.js';
import { AdminAccess } from '../../admin-access.js';
import '../../admin.css';

const sections = [
  ['keys', 'API keys'],
  ['styles', 'Styles'],
  ['access', 'Other devices'],
  ['content', 'Content'],
] as const;
type Section = (typeof sections)[number][0];

export function SettingsPage({ section: initial }: { section?: string }) {
  const app = useApp();
  const [section, setSection] = useState<Section>(
    () => (sections.some(([k]) => k === initial) ? initial : initial === 'loras' ? 'styles' : 'keys') as Section,
  );
  useEffect(() => {
    if (initial && sections.some(([k]) => k === initial)) setSection(initial as Section);
  }, [initial]);
  return (
    <>
      <header className="head">
        <h1 className="serif">Settings</h1>
        <span className="spacer" />
        <StatusControl />
      </header>
      <div
        className="tabs"
        role="tablist"
        aria-label="Settings sections"
        onKeyDown={onTabKeys}
        style={{ overflowX: 'auto' }}
      >
        {sections.map(([k, l]) => (
          <button
            key={k}
            role="tab"
            {...tabStop(section === k)}
            onClick={() => {
              setSection(k);
              app.go({ name: 'settings', section: k }, true);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="scroll">
        <div className="col">
          <div className="page">
            {section === 'keys' && <Keys />}
            {section === 'styles' && (
              <>
                <p className="muted" style={{ margin: 0 }}>
                  Save a reusable look or character. Seed can suggest it in drafts, or you can choose it in Make
                  settings. Styles are LoRAs imported from Civitai.
                </p>
                <div className="legacy-admin">
                  <AdminLoras key={app.mode} mode={app.mode} />
                </div>
              </>
            )}
            {section === 'access' && (
              <div className="legacy-admin">
                <AdminAccess />
              </div>
            )}
            {section === 'content' && <Content />}
          </div>
        </div>
      </div>
      <HeadlessToasts />
    </>
  );
}

function Keys() {
  const [settings, setSettings] = useState<AdminSettings>(),
    [error, setError] = useState('');
  useEffect(() => {
    void api<AdminSettings>('admin')
      .then(setSettings)
      .catch(e => setError(e.message));
  }, []);
  if (error) return <div className="notice error">{error}</div>;
  if (!settings) return <p className="muted">Loading…</p>;
  return (
    <>
      <p className="muted" style={{ margin: 0 }}>
        Keys are stored only on the Seed PC. OpenRouter powers Seed's replies; Vast or RunPod rent cloud GPUs.
      </p>
      {credentialDefinitions.map(d => (
        <Key
          key={d.id}
          id={d.id}
          name={d.name}
          description={d.description}
          url={d.keyUrl}
          configured={settings.credentials[d.id]?.configured}
          validation={settings.credentials[d.id]?.validation}
          onChange={c => setSettings(s => s && { ...s, credentials: c })}
        />
      ))}
      <details className="box">
        <summary>Where Seed keeps its files</summary>
        <p className="muted" style={{ margin: 0 }}>
          Settings and keys: <code>{settings.storage.config}</code>
          <br />
          Media and styles: <code>{settings.storage.data}</code>
        </p>
      </details>
    </>
  );
}
function Key({
  id,
  name,
  description,
  url,
  configured,
  validation,
  onChange,
}: {
  id: CredentialField;
  name: string;
  description: string;
  url: string;
  configured: boolean;
  validation?: 'unchecked' | 'valid' | 'invalid';
  onChange: (c: CredentialStatuses) => void;
}) {
  const [value, setValue] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [replacing, setReplacing] = useState(false),
    [removing, setRemoving] = useState(false);
  async function run(action: 'save' | 'remove' | 'check') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (action === 'check') {
        await api('admin/credentials/' + id + '/check', { body: {} });
        setMessage('Connection works.');
      } else {
        const r = await api<{ credentials: CredentialStatuses }>('admin/credentials/' + id, {
          method: 'PATCH',
          body: { value: action === 'remove' ? null : value },
        });
        onChange(r.credentials);
        setValue('');
        setReplacing(false);
        setMessage(action === 'remove' ? 'Key removed.' : 'Key saved.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="box"
      onSubmit={e => {
        e.preventDefault();
        void run('save');
      }}
    >
      <div className="row">
        <span className="grow">
          <b>{name}</b>
          <br />
          <span className="muted" style={{ fontSize: 13.5 }}>
            {description}
          </span>
        </span>
        {/* Saved is not the same as working: the badge says what is known. */}
        <span className={'chip ' + (configured && !error && validation !== 'invalid' ? 'on' : '')}>
          {!configured
            ? 'Not set'
            : validation === 'invalid'
              ? 'Key not accepted'
              : error
                ? 'Key saved · test failed'
                : validation === 'valid' || message === 'Connection works.'
                  ? 'Key works'
                  : 'Key saved'}
        </span>
      </div>
      {/* A connected key is one compact row; the paste field appears only to add or replace a key. */}
      {(!configured || replacing) && (
        <div className="row">
          <input
            className="input grow"
            type="password"
            autoFocus={replacing}
            autoComplete="new-password"
            spellCheck={false}
            aria-label={name + ' API key'}
            value={value}
            disabled={busy}
            placeholder={configured ? 'Paste a replacement key' : 'Paste API key'}
            onChange={e => setValue(e.target.value)}
          />
          <button className="btn primary" disabled={busy || !value.trim()} aria-label={'Save ' + name + ' key'}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {replacing && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setReplacing(false);
                setValue('');
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}
      <div className="row" style={{ fontSize: 13.5 }}>
        <a className="link" href={url} target="_blank" rel="noopener noreferrer">
          Get {/^[AEIOU]/.test(name) ? 'an' : 'a'} {name} key ↗
        </a>
        {configured && (
          <>
            <button
              type="button"
              className="btn quiet small"
              disabled={busy}
              onClick={() => void run('check')}
              aria-label={'Test ' + name + ' key'}
            >
              Test
            </button>
            {!replacing && (
              <button
                type="button"
                className="btn quiet small"
                disabled={busy}
                onClick={() => setReplacing(true)}
                aria-label={'Replace ' + name + ' key'}
              >
                Replace key
              </button>
            )}
            <button
              type="button"
              className="btn quiet small"
              disabled={busy}
              onClick={() => setRemoving(true)}
              aria-label={'Remove ' + name + ' key'}
            >
              Remove
            </button>
          </>
        )}
      </div>
      {message && (
        <span className="ready" role="status">
          {message}
        </span>
      )}
      {error && (
        <span className="ready bad" role="alert">
          {error}
        </span>
      )}
      {removing && (
        <Confirm
          title={'Remove the ' + name + ' key?'}
          body={'Seed stops using ' + name + ' until you paste a key again. The key is not kept anywhere else in Seed.'}
          action="Remove key"
          danger
          busy={busy}
          onClose={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false);
            void run('remove');
          }}
        />
      )}
    </form>
  );
}

function Content() {
  const { mode, setMode, go } = useApp();
  return (
    <div className="box">
      <b>Content mode</b>
      <p className="muted" style={{ margin: 0 }}>
        Standard is for general work. Spicy allows adult content and adult styles. Each mode keeps its own projects,
        Library and styles; switching does not move anything. The choice applies to this browser tab.
      </p>
      <div className="seg" role="group" aria-label="Content mode">
        <button
          aria-pressed={mode === 'sfw'}
          onClick={() => {
            setMode('sfw');
            go({ name: 'home' });
          }}
        >
          Standard
        </button>
        <button
          aria-pressed={mode === 'nsfw'}
          onClick={() => {
            setMode('nsfw');
            go({ name: 'home' });
          }}
        >
          Spicy
        </button>
      </div>
    </div>
  );
}

/** The style importer reports through react-hot-toast; show those messages in Seed's toast style. */
function HeadlessToasts() {
  const { toasts } = useToaster({ duration: 3000 });
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts
        .filter(t => t.visible)
        .map(t => (
          <div className="toast" key={t.id}>
            {resolveValue(t.message, t)}
          </div>
        ))}
    </div>
  );
}
