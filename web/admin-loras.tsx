import React, { useState } from 'react';
import { toast } from 'react-hot-toast/headless';
import {
  loraFamilyLabels,
  loraWorkflowLabels,
  type LoraGuidance,
  type LoraGroup,
  type LoraVersionPreview,
} from '../shared/loras.js';
import { adminApi } from './admin-api.js';
import { useLoraCatalog } from './hooks/use-lora-catalog.js';
import { useCivitaiPreview } from './hooks/use-civitai-preview.js';
import { LoraFileMappings, type FileMapping } from './lora-file-mappings.js';

const emptyGuidance: LoraGuidance = {
  name: '',
  description: '',
  default_scale: 1,
  trigger_words: [],
};
function submitted() {
  toast.success('LoRA request submitted · Track it in Activity', { duration: 4500 });
  window.dispatchEvent(new Event('seed:activity-changed'));
}

export function AdminLoras({ mode }: { mode: 'sfw' | 'nsfw' }) {
  const catalog = useLoraCatalog(mode);
  const [importing, setImporting] = useState<{ url?: string; mode?: 'sfw' | 'nsfw' } | null>(null);
  return (
    <>
      <div className="admin-section-heading admin-lora-heading">
        <div>
          <h2>Your LoRAs</h2>
          <p>Manage the adapters available to Generate and Chat.</p>
        </div>
        <button
          className="admin-primary"
          onClick={() => setImporting((current) => (current ? null : {}))}
        >
          {importing ? 'Close import' : '+ Add LoRA'}
        </button>
      </div>
      {catalog.error && <p role="alert">{catalog.error}</p>}
      {importing && (
        <ImportLora
          key={importing.url ?? 'new'}
          initialUrl={importing.url}
          mode={importing.mode ?? mode}
          onSubmitted={() => {
            submitted();
            setImporting(null);
            catalog.refresh();
          }}
        />
      )}
      {!catalog.items ? (
        <p role="status">Loading LoRAs…</p>
      ) : catalog.items.length ? (
        <div className="admin-loras">
          {catalog.items.map((group) => (
            <LoraEditor
              key={group.id}
              group={group}
              onSubmitted={() => {
                submitted();
                catalog.refresh();
              }}
              onChangeFiles={() => {
                setImporting({
                  url: group.source_url,
                  mode: group.availability === 'all' ? 'sfw' : 'nsfw',
                });
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          ))}
        </div>
      ) : (
        !importing && (
          <div className="admin-empty">
            <span aria-hidden="true">✧</span>
            <h3>No LoRAs yet</h3>
            <p>Add a Civitai adapter to give Generate and Chat a new subject or style.</p>
            <button onClick={() => setImporting({})}>Add your first LoRA</button>
          </div>
        )
      )}
    </>
  );
}

function GuidanceFields({
  value,
  onChange,
}: {
  value: LoraGuidance;
  onChange: (next: LoraGuidance) => void;
}) {
  return (
    <>
      <label>
        Name
        <input
          required
          maxLength={150}
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </label>
      <label>
        Description &amp; usage guidance
        <textarea
          rows={3}
          maxLength={4000}
          value={value.description}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
          placeholder="Describe what this LoRA does and when to use it."
        />
      </label>
      <p className="admin-hint">Chat uses this guidance to choose a LoRA and its strength.</p>
      <label>
        Default strength
        <input
          type="number"
          min={0}
          max={4}
          step={0.1}
          value={value.default_scale}
          onChange={(event) => onChange({ ...value, default_scale: Number(event.target.value) })}
        />
      </label>
      <label>
        Trigger words
        <input
          value={value.trigger_words.join(', ')}
          onChange={(event) =>
            onChange({
              ...value,
              trigger_words: event.target.value.split(',').map((word) => word.trimStart()),
            })
          }
          placeholder="Comma-separated words"
        />
      </label>
    </>
  );
}
function cleanGuidance(value: LoraGuidance) {
  return {
    name: value.name,
    description: value.description,
    default_scale: value.default_scale,
    trigger_words: value.trigger_words.map((word) => word.trim()).filter(Boolean),
  };
}

function ImportLora({
  mode,
  initialUrl = '',
  onSubmitted,
}: {
  mode: 'sfw' | 'nsfw';
  initialUrl?: string;
  onSubmitted: () => void;
}) {
  const [url, setUrl] = useState(initialUrl),
    preview = useCivitaiPreview();
  const [version, setVersion] = useState<LoraVersionPreview | null>(null);
  const [details, setDetails] = useState(emptyGuidance),
    [mapping, setMapping] = useState<FileMapping>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function chooseVersion(next: LoraVersionPreview) {
    setVersion(next);
    setMapping({});
    setDetails((current) => ({ ...current, trigger_words: next.trigger_words }));
    setError('');
  }
  async function lookup() {
    setError('');
    setVersion(null);
    const result = await preview.lookup(url);
    if (result) {
      setDetails({ ...emptyGuidance, name: result.name });
      if (result.versions[0]) chooseVersion(result.versions[0]);
    }
  }
  async function apply() {
    setBusy(true);
    setError('');
    try {
      await adminApi('/loras/import', 'POST', {
        ...cleanGuidance(details),
        mode,
        version_id: version!.id,
        files: Object.entries(mapping)
          .filter(([, route]) => route)
          .map(([file_id, route]) => ({ file_id: Number(file_id), route })),
      });
      onSubmitted();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selected = Object.values(mapping).filter(Boolean);
  return (
    <section className="admin-import" aria-label="Import LoRA">
      <h3>Add from Civitai</h3>
      <p>Choose a version, then map its files to the workflows you want to use. New workers download enabled LoRAs directly from Civitai when they start.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void lookup();
        }}
      >
        <label htmlFor="civitai-url">Civitai URL</label>
        <div className="credential-input">
          <input
            id="civitai-url"
            type="url"
            required
            value={url}
            disabled={busy}
            onChange={(event) => {
              setUrl(event.target.value);
              preview.reset();
              setVersion(null);
              setError('');
            }}
            placeholder="https://civitai.com/models/…"
          />
          <button disabled={busy || preview.state.status === 'loading' || !url.trim()}>
            {preview.state.status === 'loading' ? 'Looking up…' : 'Look up'}
          </button>
        </div>
      </form>
      {preview.state.status === 'error' && <p role="alert">{preview.state.message}</p>}
      {preview.state.status === 'ready' && (
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            void apply();
          }}
        >
          <label>
            Version
            <select
              value={version?.id ?? ''}
              disabled={busy}
              onChange={(event) =>
                chooseVersion(
                  preview.state.status === 'ready'
                    ? preview.state.preview.versions.find(
                        (item) => item.id === Number(event.target.value),
                      )!
                    : version!,
                )
              }
            >
              {preview.state.preview.versions.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.base_model}
                </option>
              ))}
            </select>
          </label>
          {version?.family ? (
            <>
              <p className="lora-detected-model">
                Model family<strong>{loraFamilyLabels[version.family]}</strong>
              </p>
              <LoraFileMappings
                family={version.family}
                files={version.files}
                value={mapping}
                onChange={setMapping}
                disabled={busy}
              />
              <GuidanceFields value={details} onChange={setDetails} />
              <button
                type="submit"
                className="admin-primary"
                disabled={
                  busy ||
                  !selected.length ||
                  new Set(selected).size !== selected.length ||
                  !details.name.trim()
                }
              >
                {busy ? 'Submitting…' : 'Apply'}
              </button>
            </>
          ) : (
            <p role="alert">
              {version?.base_model ?? 'This model'} is not supported. Choose a Krea 2 or MiniMax H3
              LoRA.
            </p>
          )}
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function LoraEditor({
  group,
  onSubmitted,
  onChangeFiles,
}: {
  group: LoraGroup;
  onSubmitted: () => void;
  onChangeFiles: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [details, setDetails] = useState<LoraGuidance>(group);
  const [mapping, setMapping] = useState<FileMapping>({}),
    [enabled, setEnabled] = useState(group.enabled);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function toggle() {
    setError('');
    setDetails(group);
    setEnabled(group.enabled);
    setMapping(Object.fromEntries(group.files.map((file) => [file.id, file.route])));
    setEditing((value) => !value);
  }
  async function apply() {
    setBusy(true);
    setError('');
    try {
      await adminApi('/loras/' + group.id, 'PATCH', {
        ...cleanGuidance(details),
        enabled,
        files: Object.entries(mapping)
          .filter(([, route]) => route)
          .map(([id, route]) => ({ id, route })),
      });
      setEditing(false);
      onSubmitted();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="admin-lora-card">
      <header>
        <div>
          <h3>
            {group.name} <small>{group.version}</small>
          </h3>
          <p>{loraFamilyLabels[group.family]}</p>
        </div>
        <button aria-expanded={editing} disabled={busy} onClick={toggle}>
          {editing ? 'Close' : 'Edit'}
        </button>
      </header>
      {editing ? (
        <form
          className="admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            void apply();
          }}
        >
          <GuidanceFields value={details} onChange={setDetails} />
          <LoraFileMappings
            family={group.family}
            files={group.files}
            value={mapping}
            onChange={setMapping}
            disabled={busy}
          />
          <label className="admin-checkbox">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enabled for Generate and Chat
          </label>
          <div className="lora-edit-actions">
            <button
              type="submit"
              className="admin-primary"
              disabled={busy || !details.name.trim() || !Object.values(mapping).some(Boolean)}
            >
              {busy ? 'Submitting…' : 'Apply'}
            </button>
            {group.source_url && (
              <button type="button" disabled={busy} onClick={onChangeFiles}>
                Choose source files
              </button>
            )}
          </div>
        </form>
      ) : (
        <>
          <ul className="lora-supported-workflows">
            {group.files.map((file) => (
              <li key={file.id}>{loraWorkflowLabels[file.route]}</li>
            ))}
          </ul>
          <p className="admin-lora-description">
            {group.description || 'Add a description to help Chat choose this LoRA.'}
          </p>
          <footer>
            <span className="admin-status">{group.enabled ? 'Enabled' : 'Disabled'}</span>
            <span>Strength {group.default_scale}</span>
            <span>
              {group.files.every((file) => file.compatibility === 'verified')
                ? 'Runtime verified'
                : `${group.files.filter((file) => file.compatibility === 'verified').length} of ${group.files.length} mappings tested`}
            </span>
            {group.source_url && (
              <a href={group.source_url} target="_blank" rel="noopener noreferrer">
                Civitai ↗
              </a>
            )}
          </footer>
          <p className="admin-hint">Changes apply to newly started workers. Existing workers keep their prepared LoRAs.</p>
          {group.files.some(file=>file.source_status==='needs_source')&&<p role="status" className="admin-hint">This older import needs a pinned Civitai source. Choose Change files to reimport it before starting a new worker.</p>}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
