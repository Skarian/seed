import React, { useState } from 'react';
import { castFromBrief, castOf, referenceKey, sameCast, type CastEntry } from '../../../shared/cast.js';
import { useApp, type ViewerItem } from '../data.js';
import { projects as projectsApi } from '../api.js';
import { Media, Dialog } from '../ui.js';

/** What Seed is asked when the owner wants a reference drafted; Seed carries the look from the brief. */
export const referenceAsk = (e: CastEntry) =>
  e.kind === 'prop'
    ? `Draft a prop reference for ${e.name} from the brief: ${e.name} alone, whole and in focus, on a plain light-grey background in soft even light, no people, at 1:1 with 2 takes, titled "Reference: ${e.name}". Leave the other drafts as they are. Do not run anything.`
    : e.kind === 'place'
      ? `Draft a place reference for ${e.name} from the brief: a wide picture of ${e.name} with no people, in clear light, at 16:9 with 2 takes, titled "Reference: ${e.name}". Leave the other drafts as they are. Do not run anything.`
      : `Draft a character reference for ${e.name} from the brief: ${e.name} alone, full length, standing and facing the camera, on a plain light-grey background in soft even light, at 4:5 with 2 takes, titled "Reference: ${e.name}". Leave the other drafts as they are. Do not run anything.`;
export const sheetAsk = (e: CastEntry) =>
  `Draft a reference sheet for ${e.name} as an edit of ${e.name}'s approved reference, at 16:9: the same person full length from the front, three-quarter, side and back, plus a head-and-shoulders close-up, in the same outfit on a plain light-grey background, titled "Reference sheet: ${e.name}". Do not run anything.`;

/**
 * The characters and places of the brief, each with the reference image the owner approved for it. Seed drafts the
 * shots they appear in from these images (FLUX 3 Image Klein), so a face, a coat or a lighthouse carries from shot to shot.
 */
export function CastStrip({
  brief,
  cast: stored,
  onEdit,
  picks,
  images,
  busy,
  onChoose,
  onAsk,
  onOpen,
  onImport,
  projectId,
}: {
  brief: string | null | undefined;
  /** The project's cast record (read from the brief when the project has none yet). */
  cast?: CastEntry[];
  /** Adds (from null), changes or removes (entry null) one entry; the brief follows. */
  onEdit?: (from: string | null, entry: CastEntry | null) => Promise<void>;
  picks: Record<string, string>;
  images: ViewerItem[];
  busy: string;
  onChoose: (key: string, asset: string | null) => void;
  onAsk?: (text: string) => void;
  onOpen: (item: ViewerItem) => void;
  /** Brings characters, places and props (brief entry and approved picture) from another project. */
  onImport?: (items: Array<{ entry: CastEntry; asset: string }>) => Promise<void>;
  /** This project, left out of the projects to bring from. */
  projectId?: string;
}) {
  const cast = stored ?? castFromBrief(brief);
  const [picking, setPicking] = useState<CastEntry | null>(null);
  const [importing, setImporting] = useState(false);
  // The entry being edited, or a new one of a kind ("Add character").
  const [editing, setEditing] = useState<{ from: string | null; entry: CastEntry } | null>(null);
  if (!cast.length && !(onImport && brief?.trim()) && !onEdit) return null;
  // Entries the owner marked Not needed stop counting; they stay listed so the choice can be undone.
  const skipped = (name: string) => Boolean(picks['skip:' + name]);
  const approved = cast.filter(e => picks[referenceKey(e.name)] || skipped(e.name)).length;
  return (
    // Once every reference is approved, the cast becomes a compact row so the film stays near the top.
    <section className={'cast-strip' + (approved === cast.length ? ' compact' : '')} aria-label="Cast and places">
      <div className="film-board-head">
        <b role="heading" aria-level={2}>
          {cast.some(e => e.kind === 'prop') ? 'Cast, places & props' : 'Cast & places'}
        </b>
        <span className="faint">
          {(() => {
            const skips = cast.filter(e => !picks[referenceKey(e.name)] && skipped(e.name)).length;
            return `${approved - skips} of ${cast.length - skips} approved${skips ? ` · ${skips} not needed` : ''} · drafts from references use these pictures`;
          })()}
        </span>
      </div>
      <div className="cast-tools">
        {onEdit && (
          <button
            className="btn small"
            onClick={() => setEditing({ from: null, entry: { kind: 'character', name: '', look: '' } })}
          >
            Add…
          </button>
        )}
        {onImport && (
          <button className="btn small quiet cast-import" onClick={() => setImporting(true)}>
            From another project…
          </button>
        )}
      </div>
      {!cast.length && (
        <p className="faint" style={{ margin: 0 }}>
          No characters, places or props yet. Add one, bring them from another project, or ask Seed.
        </p>
      )}
      <ul className="cast-cells">
        {cast.map(e => {
          const key = referenceKey(e.name),
            id = picks[key],
            item = images.find(i => i.asset === id);
          const name = e.name.toLowerCase();
          // Results drafted as this name's reference come first in the menu.
          const options = [
            ...images.filter(i => i.title.toLowerCase().includes(name)),
            ...images.filter(i => !i.title.toLowerCase().includes(name)),
          ].slice(0, 30);
          const kind = { character: 'Character', place: 'Place', prop: 'Prop' }[e.kind];
          return (
            <li key={e.name} className={'cast-cell ' + e.kind + (id ? ' done' : '')}>
              <button
                className="cast-thumb"
                disabled={!item}
                onClick={() => item && onOpen(item)}
                aria-label={id ? `Open ${e.name}’s reference` : `${e.name} has no reference yet`}
              >
                {id ? <Media id={id} kind="image" alt="" /> : <span className="faint">No reference</span>}
              </button>
              <span className="cast-text">
                <b>{e.name}</b>
                <small className="faint" title={e.look}>
                  {kind} · {id ? 'Approved' : skipped(e.name) ? 'Not needed' : 'No picture yet'}
                </small>
              </span>
              <span className="cast-actions">
                {onAsk && !id && !skipped(e.name) && (
                  <button className="btn small" onClick={() => onAsk(referenceAsk(e))}>
                    Draft reference
                  </button>
                )}
                {!id && (
                  <button
                    className="btn small quiet"
                    aria-pressed={skipped(e.name)}
                    onClick={() => onChoose('skip:' + e.name, skipped(e.name) ? null : 'skip')}
                  >
                    {skipped(e.name) ? 'Needed after all' : 'Not needed'}
                  </button>
                )}
                {onAsk && id && e.kind === 'character' && (
                  <button className="btn small" onClick={() => onAsk(sheetAsk(e))}>
                    Draft sheet
                  </button>
                )}
                {options.length > 0 && (
                  <button
                    className="btn small"
                    aria-label={id ? `Change ${e.name}’s reference` : `Approve a picture as ${e.name}’s reference`}
                    onClick={() => setPicking(e)}
                  >
                    {id ? 'Change' : 'Approve…'}
                  </button>
                )}
                {onEdit && (
                  <button
                    className="btn small quiet"
                    aria-label={`Edit ${e.name}`}
                    onClick={() => setEditing({ from: e.name, entry: { ...e } })}
                  >
                    Edit
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {picking &&
        (() => {
          const key = referenceKey(picking.name),
            id = picks[key],
            name = picking.name.toLowerCase();
          const own = images
            .filter(i => i.title.toLowerCase().includes(name))
            .sort((x, y) => x.title.localeCompare(y.title, undefined, { numeric: true }))
            .slice(0, 24);
          const rest = images.filter(i => !i.title.toLowerCase().includes(name)).slice(0, 30);
          const tile = (o: ViewerItem) => (
            <li key={o.asset}>
              <button
                className={'pick-tile' + (o.asset === id ? ' on' : '')}
                aria-pressed={o.asset === id}
                aria-label={`${o.title.replace(/^Reference:\s*/i, '') || 'Untitled picture'} as ${picking.name}’s reference`}
                disabled={busy === key}
                onClick={() => {
                  onChoose(key, o.asset);
                  setPicking(null);
                }}
              >
                <span className="pick-thumb">
                  <Media id={o.asset} kind="image" alt="" />
                </span>
                <small>{o.title.replace(/^Reference:\s*/i, '')}</small>
              </button>
            </li>
          );
          return (
            <Dialog
              title={`${picking.name}’s reference`}
              wide
              onClose={() => setPicking(null)}
              footer={
                id ? (
                  <button
                    className="btn danger"
                    onClick={() => {
                      onChoose(key, null);
                      setPicking(null);
                    }}
                  >
                    Clear the reference
                  </button>
                ) : undefined
              }
            >
              <p className="faint" style={{ marginTop: 0 }}>
                Pick the picture that shows {picking.name} best. Drafts made from references (FLUX 3 Image Klein) use it; drafts made from words use {picking.name}’s description.
              </p>
              {own.length > 0 && <ul className="pick-grid">{own.map(tile)}</ul>}
              {rest.length > 0 && (
                <details open={!own.length}>
                  <summary className="link">Other pictures in this project ({rest.length})</summary>
                  <ul className="pick-grid">{rest.map(tile)}</ul>
                </details>
              )}
            </Dialog>
          );
        })()}
      {editing && onEdit && (
        <CastEditor
          editing={editing}
          taken={cast.filter(x => x.name !== editing.from).map(x => x.name.toLowerCase())}
          approved={Boolean(editing.from && picks[referenceKey(editing.from)])}
          onClose={() => setEditing(null)}
          onSave={async entry => {
            await onEdit(editing.from, entry);
            setEditing(null);
          }}
        />
      )}
      {importing && onImport && (
        <ImportCast
          projectId={projectId}
          have={cast.filter(e => picks[referenceKey(e.name)]).map(e => e.name)}
          onClose={() => setImporting(false)}
          onImport={async items => {
            await onImport(items);
            setImporting(false);
          }}
        />
      )}
    </section>
  );
}

/** Other projects' approved characters, places and props, as pictures to tick and bring into this project. */
function ImportCast({
  projectId,
  have,
  onClose,
  onImport,
}: {
  projectId?: string;
  have: string[];
  onClose: () => void;
  onImport: (items: Array<{ entry: CastEntry; asset: string }>) => Promise<void>;
}) {
  const { projectList } = useApp();
  const [found, setFound] = useState<Array<{
    project: string;
    items: Array<{ entry: CastEntry; asset: string }>;
  }> | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    let live = true;
    void Promise.all(
      projectList
        .filter(p => p.id !== projectId)
        .slice(0, 16)
        .map(p => projectsApi.get(p.id).catch(() => null)),
    ).then(list => {
      if (!live) return;
      setFound(
        list
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
          .map(p => ({
            project: p.title,
            items: castOf(p)
              .filter(e => p.picks?.[referenceKey(e.name)] && !have.some(h => sameCast(h, e.name)))
              .map(e => ({ entry: e, asset: p.picks![referenceKey(e.name)]! })),
          }))
          .filter(g => g.items.length),
      );
    });
    return () => {
      live = false;
    };
  }, [projectId]);
  const all = (found ?? []).flatMap(g => g.items);
  const picked = all.filter(x => chosen.has(x.asset + x.entry.name));
  return (
    <Dialog
      title="Bring from another project"
      wide
      onClose={onClose}
      footer={
        <button
          className="btn primary"
          disabled={!picked.length || busy}
          onClick={() => {
            setBusy(true);
            void onImport(picked).finally(() => setBusy(false));
          }}
        >
          {busy
            ? 'Bringing them in…'
            : picked.length
              ? `Bring ${picked.length} into this project`
              : 'Choose who to bring'}
        </button>
      }
    >
      <p className="faint" style={{ marginTop: 0 }}>
        Each one comes with its approved picture and its look from that project's brief, so new shots here are drawn
        from the same picture.
      </p>
      {found === null ? (
        <p className="faint">Looking through your projects…</p>
      ) : !found.length ? (
        <p className="faint">No other project has an approved character, place or prop yet.</p>
      ) : (
        found.map(g => (
          <section key={g.project} aria-label={g.project}>
            <h3 className="pick-group">{g.project}</h3>
            <ul className="pick-grid">
              {g.items.map(x => {
                const k = x.asset + x.entry.name,
                  on = chosen.has(k);
                return (
                  <li key={k}>
                    <button
                      className={'pick-tile' + (on ? ' on' : '')}
                      aria-pressed={on}
                      onClick={() =>
                        setChosen(c => {
                          const next = new Set(c);
                          if (on) next.delete(k);
                          else next.add(k);
                          return next;
                        })
                      }
                    >
                      <span className="pick-thumb">
                        <Media id={x.asset} kind="image" alt="" />
                      </span>
                      <small>
                        {x.entry.name} · {{ character: 'Character', place: 'Place', prop: 'Prop' }[x.entry.kind]}
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </Dialog>
  );
}

/** Adds, changes or removes one character, place or prop. The brief's cast sections follow. */
function CastEditor({
  editing,
  taken,
  approved,
  onClose,
  onSave,
}: {
  editing: { from: string | null; entry: CastEntry };
  taken: string[];
  approved: boolean;
  onClose: () => void;
  onSave: (entry: CastEntry | null) => Promise<void>;
}) {
  const [e, setE] = useState(editing.entry);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const name = e.name.trim();
  const problem = !name ? 'Give it a name.' : taken.includes(name.toLowerCase()) ? name + ' is already in the cast.' : '';
  const save = async (entry: CastEntry | null) => {
    setBusy(true);
    setError('');
    try {
      await onSave(entry);
    } catch (x) {
      setError((x as Error).message);
      setBusy(false);
    }
  };
  const noun = { character: 'character', place: 'place', prop: 'prop' }[e.kind];
  return (
    <Dialog
      title={editing.from ? 'Edit ' + editing.from : 'Add to the cast'}
      onClose={onClose}
      footer={
        <>
          {editing.from && !removing && (
            <button className="btn danger" disabled={busy} onClick={() => setRemoving(true)}>
              Remove…
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || Boolean(problem)}
            onClick={() => void save({ ...e, name, look: e.look.trim() })}
          >
            {editing.from ? 'Save' : 'Add ' + noun}
          </button>
        </>
      }
    >
      {removing ? (
        <div className="notice warn" role="alert">
          Remove {editing.from} from the cast and the brief?{approved ? ' Its approved picture stays in the Library.' : ''}
          <div className="actions">
            <button className="btn small danger" disabled={busy} onClick={() => void save(null)}>
              Remove {editing.from}
            </button>
            <button className="btn small" autoFocus onClick={() => setRemoving(false)}>
              Keep
            </button>
          </div>
        </div>
      ) : (
        <div className="form-stack">
          <div className="seg" role="radiogroup" aria-label="Kind">
            {(['character', 'place', 'prop'] as const).map(k => (
              <button key={k} role="radio" aria-checked={e.kind === k} onClick={() => setE({ ...e, kind: k })}>
                {{ character: 'Character', place: 'Place', prop: 'Prop' }[k]}
              </button>
            ))}
          </div>
          <label className="field">
            <span>Name</span>
            <input
              className="input"
              value={e.name}
              maxLength={60}
              autoFocus
              onChange={x => setE({ ...e, name: x.target.value })}
              aria-invalid={Boolean(problem && e.name)}
            />
          </label>
          <label className="field">
            <span>Look</span>
            <textarea
              className="input"
              rows={4}
              maxLength={600}
              value={e.look}
              placeholder={
                e.kind === 'character'
                  ? 'Age, face, hair, clothes, anything that must stay the same in every shot'
                  : e.kind === 'place'
                    ? 'What it looks like: shape, materials, light'
                    : 'Size, shape, material, colour'
              }
              onChange={x => setE({ ...e, look: x.target.value })}
            />
          </label>
          {editing.from && approved && name && name !== editing.from && (
            <p className="faint" style={{ margin: 0 }}>
              Renaming keeps {editing.from}’s approved picture and updates the brief.
            </p>
          )}
          {problem && e.name && (
            <p className="changed" role="alert" style={{ margin: 0 }}>
              {problem}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="changed" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
