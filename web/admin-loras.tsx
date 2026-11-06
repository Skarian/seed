import React, { useState } from 'react';
import { toast } from 'react-hot-toast/headless';
import {
  loraFamilyLabels,
  loraWorkflowLabels,
  type LoraGuidance,
  type LoraGroup,
  type LoraVersionPreview,
  suggestLoraMapping,
} from '../shared/loras.js';
import { adminApi } from './admin-api.js';
import { useLoraCatalog } from './hooks/use-lora-catalog.js';
import { useCivitaiPreview } from './hooks/use-civitai-preview.js';
import { LoraFileMappings, type FileMapping } from './lora-file-mappings.js';
import { ConfirmDialog } from './confirm-dialog.js';

const emptyGuidance: LoraGuidance = {
  name: '',
  description: '',
  default_scale: 1,
  trigger_words: [],
};
function submitted() {
  toast.success(
    'Style saved.',
    { duration: 6000 },
  );
  window.dispatchEvent(new Event('seed:activity-changed'));
}

export function AdminLoras({ mode }: { mode: 'sfw' | 'nsfw' }) {
  const catalog = useLoraCatalog(mode);
  const [importing, setImporting] = useState<{ url?: string; mode?: 'sfw' | 'nsfw' } | null>(null);
  return (
    <>
      <div className="admin-section-heading admin-lora-heading">
        <div>
          <h2>Your styles</h2>
          <p>Add a style from Civitai, then choose when Seed may use it.</p>
        </div>
        <button
          className={importing ? undefined : 'admin-primary'}
          onClick={() => setImporting((current) => (current ? null : {}))}
        >
          {importing ? 'Cancel adding' : '+ Add style'}
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
          // A style already imported (perhaps a moment ago, elsewhere) shows in the list at once.
          onDuplicate={() => catalog.refresh()}
        />
      )}
      {!catalog.items ? (
        <p role="status">Loading styles…</p>
      ) : catalog.items.length ? (
        <div className="admin-loras">
          <p className="admin-hint">Seed PC can use a new style right away. A cloud GPU picks up styles when it starts, so one already running keeps the styles it started with.</p>
          {catalog.items.map((group) => (
            <LoraEditor
              key={group.id}
              group={group}
              onSubmitted={() => {
                submitted();
                catalog.refresh();
              }}
              onDeleted={() => {
                toast.success('Style deleted');
                window.dispatchEvent(new Event('seed:loras-changed'));
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
            <h3>No styles yet</h3>
            <p>Add one from Civitai to give your drafts a recurring look, character or subject.</p>
            <button onClick={() => setImporting({})}>Add your first style</button>
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
        When should Seed use it?
        <textarea
          rows={Math.min(14, Math.max(4, Math.ceil(value.description.length / 70) + 1))}
          maxLength={4000}
          value={value.description}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
          placeholder="Describe the look and when Seed should use it."
        />
      </label>
      <label className="strength-field">
        Strength <output>{value.default_scale.toFixed(2)}</output>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={Math.min(2, value.default_scale)}
          aria-label="Style strength"
          aria-valuetext={`${value.default_scale.toFixed(2)}${value.default_scale >= 0.5 && value.default_scale <= 1 ? ', the usual range' : ''}`}
          onChange={(event) => onChange({ ...value, default_scale: Number(event.target.value) })}
        />
      </label>
      <p className="admin-hint">Most styles look right between 0.5 and 1. Seed starts from this and can go lower or higher when a draft needs it.</p>
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
  onDuplicate,
  mode,
  initialUrl = '',
  onSubmitted,
}: {
  mode: 'sfw' | 'nsfw';
  initialUrl?: string;
  onSubmitted: () => void;
  onDuplicate?: () => void;
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
    // Start from a suggested use for each file; the owner can change any of them.
    setMapping(next.family ? suggestLoraMapping(next.family, next.files) : {});
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
      if (/already have this style/i.test((error as Error).message)) onDuplicate?.();
    } finally {
      setBusy(false);
    }
  }
  const selected = Object.values(mapping).filter(Boolean);
  return (
    <section className="admin-import" aria-label="Add a style">
      <h3>Add from Civitai</h3>
      <p>Paste a Civitai link. Seed checks what it works with and picks its files; you name it and say when to use it.</p>
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
          {preview.state.preview.versions.length > 1 && (
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
          )}
          {version?.family ? (
            <>
              <p className="lora-detected-model">
                Works with<strong>{version.family === 'h3' ? 'Clips · ' : 'Images · '}{loraFamilyLabels[version.family]}</strong>
              </p>
              <GuidanceFields value={details} onChange={setDetails} />
              {/* Files are chosen automatically; the choice opens only when it needs the owner. */}
              <details className="lora-files" open={!selected.length || new Set(selected).size !== selected.length}>
                <summary>
                  {selected.length
                    ? `Files: ${selected.length} chosen automatically`
                    : 'Files: choose what each file is for'}
                </summary>
                <LoraFileMappings
                  family={version.family}
                  files={version.files}
                  value={mapping}
                  onChange={setMapping}
                  disabled={busy}
                />
              </details>
              {!selected.length && <p className="admin-hint" role="status">Choose a use for at least one file to continue.</p>}
              {!details.name.trim() && <p className="admin-hint" role="status">Give the style a name to continue.</p>}
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
                {busy ? 'Adding…' : 'Add style'}
              </button>
            </>
          ) : (
            <p role="alert">
              This style is for a model Seed doesn’t run. Choose one made for
              Krea 2 (images) or MiniMax H3 (video).
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
  onDeleted,
  onChangeFiles,
}: {
  group: LoraGroup;
  onSubmitted: () => void;
  onDeleted: () => void;
  onChangeFiles: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [details, setDetails] = useState<LoraGuidance>(group);
  const [mapping, setMapping] = useState<FileMapping>({}),
    [enabled, setEnabled] = useState(group.enabled);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
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
        <div className="lora-card-actions">
          <button aria-expanded={editing} disabled={busy} onClick={toggle} aria-label={(editing ? 'Close ' : 'Edit ') + group.name}>
            {editing ? 'Cancel editing' : 'Edit'}
          </button>
          <button className="admin-destructive" disabled={busy} onClick={() => setDeleting(true)} aria-label={'Delete ' + group.name}>
            Delete
          </button>
        </div>
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
            Seed may use this style
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
            {group.description || 'Add a description so Seed knows when to suggest this style.'}
          </p>
          <footer>
            <span className="admin-status">{group.enabled ? 'Enabled' : 'Disabled'}</span>
            <span>Strength {group.default_scale}</span>
            <span>
              {group.files.every((file) => file.compatibility === 'verified')
                ? 'Used successfully'
                : group.files.some((file) => file.compatibility === 'verified')
                  ? `Tried with ${group.files.filter((file) => file.compatibility === 'verified').length} of its ${group.files.length} files`
                  : 'No renders yet'}
            </span>
            {group.source_url && (
              <a href={group.source_url} target="_blank" rel="noopener noreferrer">
                Civitai ↗
              </a>
            )}
          </footer>

          {group.files.some(file=>file.source_status==='needs_source')&&<p role="status" className="admin-hint">An older version of Seed added this style. Choose source files to add it again before you start a GPU.</p>}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {deleting && <ConfirmDialog
        title={`Delete ${group.name}?`}
        description="Seed stops offering this style. Results made with it stay in your Library. A running GPU keeps its copy, and queued drafts that use it may fail."
        action="Delete style"
        onConfirm={async () => {
          await adminApi('/loras/' + encodeURIComponent(group.id), 'DELETE');
          onDeleted();
        }}
        onClose={() => setDeleting(false)}
      />}
    </article>
  );
}
