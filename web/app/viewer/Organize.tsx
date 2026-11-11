/** The user's own organization of one result: its note, and the collections it belongs to. */
import { useEffect, useRef, useState } from 'react';
import { assets as assetsApi, collections as collectionsApi, type AssetCollection, type AssetDetail } from '../api.js';
import { collectionsChanged, noteSaved, useApp } from '../data.js';
import { Icon } from '../icons.js';
import { Dialog } from '../ui.js';

export type Note = { note: string; revision: number };

export function NoteField({ asset, note, onSaved }: { asset: string; note: Note | null; onSaved: (n: Note) => void }) {
  const [value, setValue] = useState(note?.note ?? ''),
    [saved, setSaved] = useState('');
  // Text you are typing is never replaced by a save from another editor; it saves over it when you leave the box.
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setValue(note?.note ?? '');
  }, [note?.revision, asset]);
  // Another open editor of this note saved: take its text and revision.
  noteSaved.useHear(
    d => {
      if (d.asset === asset && d.note.revision !== note?.revision) onSaved(d.note);
    },
    [asset, note?.revision],
  );
  if (!note) return <span className="faint">…</span>;
  // Notes save when you leave the box; the line under it says so, so closing the panel never feels risky.
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <textarea
        className="textarea note"
        style={{ minHeight: 56, height: Math.min(320, 56 + Math.ceil(value.length / 48) * 20) }}
        value={value}
        placeholder="Add a note (searchable in the Library)"
        aria-label="Note"
        onChange={e => {
          typing.current = true;
          setValue(e.target.value);
          setSaved(e.target.value === note.note ? '' : 'Saves when you leave this box');
        }}
        onBlur={() => {
          if (value === note.note) return;
          setSaved('Saving…');
          const done = (n: Note) => {
            typing.current = false;
            onSaved(n);
            setSaved('Saved');
            noteSaved.send({ asset, note: n });
          };
          void assetsApi
            .saveNote(asset, value, note.revision)
            .then(done)
            // Saved meanwhile in another open editor: this is the newest edit, so it saves on the latest revision.
            .catch(() =>
              assetsApi
                .note(asset)
                .then(latest => assetsApi.saveNote(asset, value, latest.revision))
                .then(done),
            )
            .catch(e => setSaved((e as Error).message));
        }}
      />
      {saved && (
        <span className="faint" role="status" style={{ fontSize: '0.8125rem' }}>
          {saved}
        </span>
      )}
    </div>
  );
}

/** Ticks a result into and out of collections, and makes new ones. */
export function CollectionsDialog({
  asset,
  detail,
  onChanged,
  onClose,
}: {
  asset: string;
  detail: AssetDetail | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const app = useApp();
  const [list, setList] = useState<AssetCollection[] | null>(null),
    [name, setName] = useState(''),
    [inside, setInside] = useState<string[]>(detail?.collection_ids ?? []);
  useEffect(() => void collectionsApi.list(app.mode).then(setList), []);
  const changed = () => {
    onChanged();
    collectionsChanged.send();
  };
  return (
    <Dialog
      title="Add to collection"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {!list ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {list.map(c => {
            const on = inside.includes(c.id);
            return (
              <button
                key={c.id}
                className="option"
                role="checkbox"
                aria-checked={on}
                onClick={() =>
                  void assetsApi.inCollection(asset, c.id, !on).then(() => {
                    setInside(s => (on ? s.filter(x => x !== c.id) : [...s, c.id]));
                    changed();
                  })
                }
              >
                <span className="check" aria-checked={on}>
                  {on && <Icon.Check />}
                </span>
                <span>
                  {c.name}
                  <small>
                    {c.count} {c.count === 1 ? 'item' : 'items'}
                  </small>
                </span>
              </button>
            );
          })}
          <form
            style={{ display: 'flex', gap: 8 }}
            onSubmit={e => {
              e.preventDefault();
              if (!name.trim()) return;
              void collectionsApi.create(app.mode, name.trim()).then(c =>
                assetsApi.inCollection(asset, c.id, true).then(() => {
                  setList(l => [...l!, { ...c, count: 1 }]);
                  setInside(s => [...s, c.id]);
                  setName('');
                  changed();
                }),
              );
            }}
          >
            <input
              className="input"
              placeholder="New collection"
              aria-label="New collection name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <button className="btn" disabled={!name.trim()}>
              Create
            </button>
          </form>
        </>
      )}
    </Dialog>
  );
}
