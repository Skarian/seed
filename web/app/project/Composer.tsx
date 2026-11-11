import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons.js';
import { MenuButton, Thumb, Dialog, useInertBehind } from '../ui.js';
import { kindLabels, isVideoKind, type Kind } from '../api.js';
import { useApp, type ViewerItem } from '../data.js';
import {
  type Attachment,
  type MakeSettings,
  rolesFor,
  roleLabels,
  inputProblem,
  kindOfFile,
  uploadFile,
  engines,
  defaultRoles,
} from './requests.js';
import { RequestFields } from './RequestFields.js';
import type { StyleEntry } from './readiness.js';
import { LibraryPicker } from '../library/LibraryPicker.js';
import { workflowOf } from '../api.js';

export type ComposerContext =
  | { type: 'talk' }
  | { type: 'plan' }
  | { type: 'keep' }
  | { type: 'draft'; card: string; revision: number; title: string }
  | { type: 'using'; item: ViewerItem; intent: 'refine' | 'animate' | 'input' | 'more' | 'reuse' };

type Props = {
  context: ComposerContext;
  onContext: (c: ComposerContext) => void;
  planOpen: boolean;
  mode: 'ask' | 'make';
  /** The project has approved references, which Make now does not use. */
  castApproved?: boolean;
  onMode: (m: 'ask' | 'make') => void;
  text: string;
  onText: (t: string) => void;
  attachments: Attachment[];
  onAttachments: (a: Attachment[] | ((a: Attachment[]) => Attachment[])) => void;
  settings: MakeSettings;
  onSettings: (s: MakeSettings) => void;
  styles: StyleEntry[];
  replying: boolean;
  disabled?: string;
  queued?: boolean;
  onQueue?: () => void;
  onSend: () => void;
  onMake: () => void;
  onStopReply: () => void;
  onSetAside: () => void;
  focusToken?: number;
};

const ctxLabel = (c: ComposerContext) =>
  c.type === 'talk'
    ? 'Talking with Seed'
    : c.type === 'plan'
      ? 'Revising plan'
      : c.type === 'keep'
        ? 'Talking · plan kept'
        : c.type === 'draft'
          ? 'Revising: ' + c.title
          : (c.intent === 'animate'
              ? 'Animating: '
              : c.intent === 'refine'
                ? c.item.kind === 'video'
                  ? 'New take of: '
                  : 'Refining: '
                : 'Using: ') + c.item.title;
const placeholder = (c: ComposerContext, mode: 'ask' | 'make') =>
  mode === 'make'
    ? 'Describe exactly what to make…'
    : c.type === 'plan'
      ? 'Ask Seed to change the plan, or ask a question…'
      : c.type === 'draft'
        ? `How should “${c.title}” change?`
        : c.type === 'using'
          ? c.intent === 'animate'
            ? 'How should it move? (Seed plans an Animate draft)'
            : c.intent === 'refine'
              ? 'What should change in this picture?'
              : 'What should Seed make with it?'
          : 'Ask Seed, or describe what to make…';

export function Composer(p: Props) {
  const { mode: contentMode, narrow } = useApp();
  const area = useRef<HTMLTextAreaElement>(null),
    file = useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [expanded, setExpanded] = useState(false),
    [focused, setFocused] = useState(false),
    [picker, setPicker] = useState(false),
    [roleFor, setRoleFor] = useState<string | null>(null);
  const touch = useMemo(() => matchMedia('(pointer: coarse)').matches, []);
  // Expanded, the composer is a writing sheet over the page: everything behind it is inert, so focus and screen
  // readers stay in it until Collapse or Escape.
  const root = useRef<HTMLDivElement>(null);
  useInertBehind(root, expanded && narrow);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    // Empty, the box takes its resting size from the stylesheet; it never keeps the height of what was just sent.
    if (!p.text) {
      el.style.height = '';
      return;
    }
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, innerHeight * 0.4) + 'px';
  }, [p.text, expanded, narrow]);
  useEffect(() => {
    if (p.focusToken) area.current?.focus();
  }, [p.focusToken]);
  // The result being refined or animated is an input like any attachment, in Ask and in Make alike.
  const inputs =
    p.context.type === 'using'
      ? defaultRoles(p.settings.kind, [
          {
            key: p.context.item.asset,
            asset_id: p.context.item.asset,
            name: p.context.item.title,
            kind: p.context.item.kind,
            role:
              p.context.intent === 'animate'
                ? 'first_frame'
                : p.context.intent === 'refine'
                  ? p.context.item.kind === 'video'
                    ? 'reference'
                    : 'source'
                  : undefined,
          },
          ...p.attachments,
        ])
      : p.attachments;
  const problem =
    p.mode === 'make'
      ? inputProblem(p.settings.kind, inputs)
      : p.attachments.some(a => a.progress)
        ? 'Wait for attachments to finish uploading.'
        : null;
  // The usual fix for an attached image in the wrong mode is one step: use it as the source (Edit) or start frame (Animate).
  const firstImage = p.attachments.find(a => a.kind === 'image' && a.asset_id);
  const asRole = (role: 'source' | 'first_frame') =>
    p.onAttachments(list =>
      list.map(a =>
        a.key === firstImage!.key ? { ...a, role } : a.role === role ? { ...a, role: 'reference' as const } : a,
      ),
    );
  const inputFix =
    p.mode !== 'make' || !problem || !firstImage
      ? null
      : p.settings.kind === 'image' || p.settings.kind === 'edit'
        ? {
            label: `Edit “${firstImage.name}” with this prompt`,
            run: () => {
              p.onSettings({ ...p.settings, kind: 'edit' });
              asRole('source');
            },
          }
        : {
            label: `Animate “${firstImage.name}” with this prompt`,
            run: () => {
              p.onSettings({ ...p.settings, kind: 'animate' });
              asRole('first_frame');
            },
          };
  const canSend = !p.disabled && !problem && p.text.trim().length > 0;
  const count = p.settings.count,
    video = isVideoKind(p.settings.kind);
  const makeLabel = `Make ${count} ${video ? (count === 1 ? 'clip' : 'clips') : count === 1 ? 'image' : 'images'} from this prompt`;

  function addFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      const kind = kindOfFile(f);
      if (!kind) continue;
      const key = Math.random().toString(36).slice(2);
      p.onAttachments(list => [
        ...list,
        { key, file: f, name: f.name, kind, url: URL.createObjectURL(f), progress: 'Uploading…' },
      ]);
      void uploadFile(f, kind, contentMode, text =>
        p.onAttachments(list => list.map(a => (a.key === key ? { ...a, progress: text } : a))),
      )
        .then(id =>
          p.onAttachments(list => list.map(a => (a.key === key ? { ...a, asset_id: id, progress: undefined } : a))),
        )
        .catch(e =>
          p.onAttachments(list =>
            list.map(a => (a.key === key ? { ...a, progress: undefined, error: (e as Error).message } : a)),
          ),
        );
    }
  }
  const ctxItems = [
    ...(p.planOpen
      ? [
          {
            label: 'Revise this plan',
            hint: 'Your message can change the open plan.',
            checked: p.context.type === 'plan',
            onSelect: () => p.onContext({ type: 'plan' }),
          },
          {
            label: 'Talk without changing this plan',
            hint: 'Seed answers; the plan stays exactly as it is.',
            checked: p.context.type === 'keep',
            onSelect: () => p.onContext({ type: 'keep' }),
          },
        ]
      : [
          {
            label: 'Talking with Seed',
            checked: p.context.type === 'talk',
            onSelect: () => p.onContext({ type: 'talk' }),
          },
        ]),
  ];
  const submit = () => {
    if (!canSend) return;
    p.mode === 'make' ? p.onMake() : p.onSend();
    // Sent: the writing sheet closes so the reply and Seed's progress are in view.
    setExpanded(false);
  };
  return (
    <div
      ref={root}
      className={
        'composer' +
        (expanded ? ' expanded' : '') +
        // On a phone, an empty composer nobody is typing in rests as one row: more room to read.
        (narrow && !focused && !p.text && !expanded ? ' resting' : '')
      }
      onFocus={() => setFocused(true)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={e => {
        if (e.key === 'Escape' && expanded) {
          e.stopPropagation();
          setExpanded(false);
        }
      }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      {(p.attachments.length > 0 || p.context.type === 'using') && (
        <div className="attached">
          {p.context.type === 'using' && (
            <span className="att source" title={p.context.item.title}>
              <Thumb id={p.context.item.asset} kind={p.context.item.kind} alt={p.context.item.title} />
              <span>
                <span className="name">{p.context.item.title}</span>
                <br />
                <span className="role">
                  {p.context.intent === 'animate' ? 'Start frame' : p.context.intent === 'refine' ? 'Source' : 'Input'}
                </span>
              </span>
              <button
                className="x"
                aria-label="Remove"
                onClick={() => p.onContext({ type: p.planOpen ? 'plan' : 'talk' })}
              >
                <Icon.Close width={14} height={14} />
              </button>
            </span>
          )}
          {p.attachments.map(a => (
            <span className="att" key={a.key}>
              {a.kind === 'image' && a.url ? (
                <img src={a.url} alt="" />
              ) : a.asset_id ? (
                <Thumb id={a.asset_id} kind={a.kind} alt={a.name} />
              ) : (
                <span className="ph">{a.kind === 'video' ? '▶' : '♪'}</span>
              )}
              <span>
                <span className="name">{a.name}</span>
                <br />
                <span className="role" style={a.error ? { color: 'var(--red)' } : undefined}>
                  {a.error ??
                    a.progress ??
                    (p.mode === 'make' && rolesFor(p.settings.kind, a.kind).length ? (
                      <button className="link" onClick={() => setRoleFor(a.key)}>
                        {roleLabels[a.role ?? 'reference']} ▾
                      </button>
                    ) : a.kind === 'image' ? (
                      'Image'
                    ) : a.kind === 'video' ? (
                      'Video'
                    ) : (
                      'Audio'
                    ))}
                </span>
              </span>
              <button
                className="x"
                aria-label={'Remove ' + a.name}
                onClick={() => p.onAttachments(list => list.filter(x => x.key !== a.key))}
              >
                <Icon.Close width={14} height={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={area}
        rows={1}
        value={p.text}
        placeholder={placeholder(p.context, p.mode)}
        aria-label={p.mode === 'make' ? 'Prompt to make' : 'Message to Seed'}
        onChange={e => p.onText(e.target.value)}
        onPaste={e => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            addFiles(e.clipboardData.files);
          }
        }}
        onKeyDown={e => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
          if (p.mode === 'make') {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              submit();
            }
            return;
          }
          if (!e.shiftKey && !touch) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {(problem || p.disabled) && p.text.trim() && (
        <p className="faint" role="status" style={{ margin: '0 8px', fontSize: '0.875rem' }}>
          {p.disabled ?? problem}
          {!p.disabled && inputFix && (
            <>
              {' '}
              <button type="button" className="link" onClick={inputFix.run}>
                {inputFix.label}
              </button>
            </>
          )}
        </p>
      )}
      {p.mode === 'make' && p.castApproved && !p.attachments?.length && (
        <p className="faint make-note" role="note">
          Make now works from these words only; your approved cast pictures aren’t used. Plan with Seed to draw from
          them.
        </p>
      )}
      <div className="tools">
        {/* Long messages and prompts get a large writing area; it shows once the text is long. */}
        {(expanded || p.text.length > 280 || p.text.split('\n').length > 4) && (
          <button
            className="btn small quiet expand-toggle"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded(v => !v);
              requestAnimationFrame(() => area.current?.focus());
            }}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
        {p.mode === 'ask' ? (
          p.planOpen || p.context.type !== 'talk' ? (
            <MenuButton
              label={'Message context: ' + ctxLabel(p.context)}
              className="ctx"
              items={ctxItems}
              placement="above"
              align="start"
            >
              <Icon.Chat />
              {ctxLabel(p.context)} ▾
            </MenuButton>
          ) : null
        ) : (
          <button className="settings-line" onClick={() => setSettingsOpen(true)} aria-label="Make settings">
            <Icon.Tune />
            {summary(p.settings, p.styles)}
          </button>
        )}
        <MenuButton
          label="Attach"
          items={[
            { label: 'Upload files', hint: 'Images, video or audio', onSelect: () => file.current?.click() },
            { label: 'From Library', onSelect: () => setPicker(true) },
          ]}
          placement="above"
          align="start"
        >
          <Icon.Attach />
        </MenuButton>
        <input
          ref={file}
          type="file"
          hidden
          multiple
          accept="image/*,video/*,audio/*"
          onChange={e => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <span className="grow" />
        <span className="modes" role="group" aria-label="Ask Seed or make directly">
          <button
            aria-pressed={p.mode === 'ask'}
            onClick={() => p.onMode('ask')}
            title="Talk it through; Seed prepares drafts you approve"
          >
            Plan with Seed
          </button>
          <button
            aria-pressed={p.mode === 'make'}
            onClick={() => p.onMode('make')}
            title="Write the prompt and settings yourself; it runs when you press Make"
          >
            Make now
          </button>
        </span>
        {p.replying && p.mode === 'ask' ? (
          <>
            {p.text.trim() && p.onQueue && !p.queued && (
              <button className="btn" onClick={p.onQueue} title="Sends as soon as Seed finishes this reply">
                Send next
              </button>
            )}
            <button className="btn" onClick={p.onStopReply}>
              <Icon.Stop />
              Stop reply
            </button>
          </>
        ) : p.mode === 'make' ? (
          <>
            {p.replying && (
              <button className="btn quiet" onClick={p.onStopReply}>
                <Icon.Stop />
                Stop reply
              </button>
            )}
            <button
              className="btn primary"
              disabled={!canSend}
              onClick={submit}
              title={touch ? undefined : 'Ctrl+Enter'}
            >
              {narrow ? makeLabel.replace(' from this prompt', '') : makeLabel}
              {!touch && !narrow && <span className="kbd">Ctrl ↵</span>}
            </button>
          </>
        ) : (
          <button className="send" disabled={!canSend} onClick={submit} aria-label="Send to Seed">
            <Icon.Send />
          </button>
        )}
      </div>
      {settingsOpen && (
        <MakeSettingsDialog
          settings={p.settings}
          onChange={p.onSettings}
          styles={p.styles}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {picker && (
        <LibraryPicker
          onClose={() => setPicker(false)}
          onPick={items => {
            p.onAttachments(list => [
              ...list,
              ...items
                .filter(i => !list.some(a => a.asset_id === i.id))
                .map(i => ({ key: i.id, asset_id: i.id, name: i.title ?? i.name, kind: i.kind })),
            ]);
            setPicker(false);
          }}
        />
      )}
      {roleFor && (
        <RoleDialog
          attachment={p.attachments.find(a => a.key === roleFor)!}
          kind={p.settings.kind}
          onClose={() => setRoleFor(null)}
          onChange={a =>
            p.onAttachments(list =>
              list.map(x =>
                x.key === a.key
                  ? a
                  : (a.role === 'source' && x.role === 'source') ||
                      (a.role === 'first_frame' && x.role === 'first_frame') ||
                      (a.role === 'last_frame' && x.role === 'last_frame')
                    ? { ...x, role: 'reference' }
                    : x,
              ),
            )
          }
        />
      )}
    </div>
  );
}

function summary(s: MakeSettings, styles: StyleEntry[]) {
  const video = isVideoKind(s.kind);
  return [
    kindLabels[s.kind],
    s.kind === 'edit'
      ? 'source shape'
      : ({ '16:9': 'Landscape', '9:16': 'Portrait', '1:1': 'Square', '4:5': 'Portrait 4:5' } as Record<string, string>)[
          s.aspect
        ],
    '×' + s.count,
    ...(video ? [s.duration + ' s', s.sound === 'silent' ? 'silent' : 'sound'] : []),
    ...(s.style && s.kind !== 'edit' ? [styles.find(x => x.id === s.style!.id)?.name ?? 'style'] : []),
    s.target === 'local' ? 'Seed PC' : s.target === 'cloud' ? 'Cloud' : 'Auto',
    ...(s.seed && s.seed !== 'random' ? ['seed ' + s.seed] : []),
  ].join(' · ');
}

function MakeSettingsDialog({
  settings: s,
  onChange,
  styles,
  onClose,
}: {
  settings: MakeSettings;
  onChange: (s: MakeSettings) => void;
  styles: StyleEntry[];
  onClose: () => void;
}) {
  const set = (patch: Partial<MakeSettings>) => onChange({ ...s, ...patch });
  const video = isVideoKind(s.kind),
    workflow = workflowOf[s.kind];
  const route = s.kind === 'image' ? 'image' : s.kind === 'video' ? 'fl' : 'ref';
  return (
    <Dialog
      title="Make settings"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="field">
        <span>Kind</span>
        <div className="seg" role="group" aria-label="Kind">
          {(['image', 'edit', 'video', 'animate'] as Kind[]).map(k => (
            <button key={k} aria-pressed={s.kind === k} onClick={() => set({ kind: k, style: undefined })}>
              {kindLabels[k]}
            </button>
          ))}
        </div>
        <span className="faint" style={{ fontSize: '0.875rem' }}>
          {s.kind === 'image'
            ? 'A new still from words.'
            : s.kind === 'edit'
              ? 'Change an image you attach (one source, optional references).'
              : s.kind === 'video'
                ? 'A new clip from words.'
                : 'A clip guided by images, video or audio you attach.'}{' '}
          Engine: {engines[s.kind]}.
        </span>
      </div>
      <div className="editor">
        <RequestFields
          workflow={workflow}
          route={route}
          styles={styles}
          shape={s.kind !== 'edit'}
          value={{
            ...s,
            aspect: video && (s.aspect === '1:1' || s.aspect === '4:5') ? '9:16' : s.aspect,
            size: video ? s.videoSize : s.imageSize,
          }}
          onChange={({ size, aspect, ...rest }) =>
            set({
              ...rest,
              ...(aspect ? { aspect: aspect as MakeSettings['aspect'] } : {}),
              ...(size ? (video ? { videoSize: size as never } : { imageSize: size as never }) : {}),
            })
          }
        />
        <div className="row">
          <label className="field">
            <span>Variation</span>
            <select
              aria-label="Variation"
              className="select"
              value={!s.seed || s.seed === 'random' ? 'random' : 'fixed'}
              onChange={e =>
                set({ seed: e.target.value === 'random' ? 'random' : s.seed && s.seed !== 'random' ? s.seed : '1' })
              }
            >
              <option value="random">New each time</option>
              <option value="fixed">Repeat a seed</option>
            </select>
          </label>
          {s.seed && s.seed !== 'random' && (
            <label className="field">
              <span>Seed</span>
              <input
                className="input"
                inputMode="numeric"
                value={s.seed}
                onChange={e => set({ seed: e.target.value.replace(/[^0-9]/g, '') || '0' })}
              />
            </label>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function RoleDialog({
  attachment: a,
  kind,
  onClose,
  onChange,
}: {
  attachment: Attachment;
  kind: Kind;
  onClose: () => void;
  onChange: (a: Attachment) => void;
}) {
  const roles = rolesFor(kind, a.kind);
  return (
    <Dialog
      title={'How to use ' + a.name}
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="field">
        <span>Role</span>
        <div className="seg" role="group" aria-label="Role">
          {roles.map(r => (
            <button key={r} aria-pressed={(a.role ?? 'reference') === r} onClick={() => onChange({ ...a, role: r })}>
              {roleLabels[r]}
            </button>
          ))}
        </div>
      </div>
      {kind === 'animate' && a.kind === 'image' && a.role !== 'reference' && (
        <div className="field">
          <span>Framing</span>
          <div className="seg" role="group" aria-label="Framing">
            {(['fit', 'fill'] as const).map(f => (
              <button key={f} aria-pressed={(a.framing ?? 'fit') === f} onClick={() => onChange({ ...a, framing: f })}>
                {f === 'fit' ? 'Fit (keep all of it)' : 'Fill (crop to the shape)'}
              </button>
            ))}
          </div>
        </div>
      )}
      {a.kind !== 'image' && (
        <div className="editor">
          <div className="row">
            <label className="field">
              <span>Clip starts at (s)</span>
              <input
                className="input"
                type="number"
                min={0}
                step={0.5}
                value={a.start ?? 0}
                onChange={e => onChange({ ...a, start: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Clip length (2–15 s)</span>
              <input
                className="input"
                type="number"
                min={2}
                max={15}
                step={0.5}
                value={a.length ?? 5}
                onChange={e => onChange({ ...a, length: Number(e.target.value) })}
              />
            </label>
            {a.kind === 'video' && (
              <label className="field">
                <span>Its sound</span>
                <select
                  aria-label="Its sound"
                  className="select"
                  value={a.include_audio ? 'yes' : 'no'}
                  onChange={e => onChange({ ...a, include_audio: e.target.value === 'yes' })}
                >
                  <option value="no">Ignore</option>
                  <option value="yes">Use as guidance</option>
                </select>
              </label>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
