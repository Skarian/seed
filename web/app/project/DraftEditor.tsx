/** The edit dialog for one plan draft: title, prompt and the shared request fields. Kind stays fixed. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChatCard, Project } from '../api.js';
import { kindOf, isVideoKind } from '../api.js';
import { Dialog } from '../ui.js';
import { stylesChanged, useApp } from '../data.js';
import { latest, titleOf, settingChips } from '../format.js';
import { routeOf, type StyleEntry } from './readiness.js';
import { editableFields, revisedRequest, type EditableFields } from './requests.js';
import { editablePrompt } from './checks.js';
import { RequestFields } from './RequestFields.js';

/** Edits one draft. Saving keeps the draft selected; it never approves anything. Closing with changes asks first. */
export function DraftEditor({
  card,
  project,
  styles,
  busy,
  onClose,
  onSave,
}: {
  card: ChatCard;
  project: Project;
  styles: StyleEntry[];
  busy: boolean;
  onClose: () => void;
  /** Sends the revision; the dialog closes once it is accepted. */
  onSave: (r: Record<string, unknown>) => Promise<boolean>;
}) {
  const r = latest(card).request,
    kind = kindOf[r.workflow],
    video = isVideoKind(kind),
    { tasks, pool } = useApp();
  // Cloud GPUs say what they can make; pictures from references need FLUX 3 Image Klein there.
  const cloudKlein = Boolean(pool?.cloud_workflows?.includes('image-to-image:klein'));
  // Structured video prompts are edited as readable sections and converted back on save.
  const [readable] = useState(() => editablePrompt(r, project, tasks));
  const [f, setF] = useState<EditableFields>(() => ({ ...editableFields(r), prompt: readable?.text ?? r.prompt }));
  const engine = settingChips(r, id => id).find(([k]) => k === 'engine')?.[1];
  const [saving, setSaving] = useState(false),
    [discarding, setDiscarding] = useState(false);
  const set = (patch: Partial<EditableFields>) => setF(v => ({ ...v, ...patch }));
  const [initial] = useState(() => JSON.stringify(f));
  const close = () => (JSON.stringify(f) !== initial ? setDiscarding(true) : onClose());
  const route = routeOf(r);
  const available = useMemo(() => styles.filter(s => s.route === route), [styles, route]);
  const style = f.loras[0];
  // A style added since this page loaded (in Settings or another tab) shows as soon as the editor opens.
  useEffect(() => stylesChanged.send(), []);
  // A style added in another tab is not in this tab's list yet: ask for the current list once.
  useEffect(() => {
    if (style && !available.some(s => s.id === style.id)) stylesChanged.send();
  }, [style?.id]);
  // The dialog mounts its content a render late, so the form is placed when it appears rather than on mount.
  const form = useCallback((el: HTMLFormElement | null) => {
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el?.querySelector<HTMLElement>('textarea, input')?.focus({ preventScroll: true });
  }, []);
  return (
    <Dialog title={'Edit ' + titleOf(r)} wide onClose={close}>
      {discarding && (
        <div className="notice" role="alert">
          Discard your changes to this draft?
          <div className="actions">
            <button className="btn small danger" onClick={onClose}>
              Discard changes
            </button>
            <button className="btn small" autoFocus onClick={() => setDiscarding(false)}>
              Keep editing
            </button>
          </div>
        </div>
      )}
      <form
        ref={form}
        className="editor"
        onSubmit={async e => {
          e.preventDefault();
          setSaving(true);
          try {
            if (await onSave(revisedRequest(r, { ...f, prompt: readable ? readable.back(f.prompt) : f.prompt })))
              onClose();
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="field">
          <span>Title</span>
          <input
            className="input"
            value={f.title}
            maxLength={80}
            onChange={e => set({ title: e.target.value })}
            placeholder={titleOf(r)}
          />
        </label>
        <label className="field">
          <span>Prompt</span>
          {/* The prompt is the main thing being edited: it gets the focus and room for a long shot description. */}
          <textarea
            className="textarea prompt-editor"
            value={f.prompt}
            autoFocus
            // The caret starts at the end once, when the editor opens; later focus (a click mid-text, select-all) is left alone.
            ref={el => {
              if (el && !el.dataset.placed) {
                el.dataset.placed = '1';
                el.setSelectionRange(el.value.length, el.value.length);
              }
            }}
            onChange={e => set({ prompt: e.target.value })}
            rows={Math.min(18, Math.max(6, Math.ceil(f.prompt.length / 60)))}
          />
        </label>
        <RequestFields
          workflow={r.workflow}
          route={route}
          styles={styles}
          shape={r.output.aspect !== 'source' || (r.workflow === 'image-to-image' && r.engine === 'klein')}
          fromSource={r.workflow === 'image-to-image'}
          cloudBlocked={r.workflow === 'image-to-image' && r.engine === 'klein' && !cloudKlein}
          value={{ ...f, style }}
          onChange={patch => {
            const { style: next, ...rest } = patch;
            set({ ...(rest as Partial<EditableFields>), ...('style' in patch ? { loras: next ? [next] : [] } : {}) });
          }}
        />
        {engine && (
          <p className="faint" style={{ margin: 0, fontSize: '0.875rem' }}>
            {video ? 'Video' : 'Image'} model: {engine}
          </p>
        )}
        <details>
          <summary className="faint">Advanced</summary>
          {readable && (
            <div className="field" style={{ marginTop: 8 }}>
              <span>Prompt as the model receives it</span>
              <div className="prompt" style={{ whiteSpace: 'pre-wrap', fontSize: '0.9375rem' }}>
                {readable.back(f.prompt)}
              </div>
            </div>
          )}
          <label className="field" style={{ marginTop: 8 }}>
            <span>Seed (random, or a number to repeat a result)</span>
            <input className="input" value={f.seed} onChange={e => set({ seed: e.target.value })} />
          </label>
        </details>
        <div className="buttons">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || saving || !f.prompt.trim()}>
            {saving ? 'Saving…' : 'Save edit'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
