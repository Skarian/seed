import React, { useEffect, useState } from 'react';
import { collections as collectionsApi, type AssetCollection, type LibraryAsset } from '../api.js';
import { useApp, useAssets } from '../data.js';
import { Icon } from '../icons.js';
import { Dialog, Media } from '../ui.js';
import { assetTitle, Caption } from './LibraryPage.js';

/** Attach from the Library without leaving the composer. Same shelves and filters as the Library; unsent text stays put. */
/** Pick media from the Library. A fixed project and kind narrow it, for example to replace a draft's start frame. */
export function LibraryPicker({
  onClose,
  onPick,
  inProject,
  onlyKind,
  heading,
}: {
  onClose: () => void;
  onPick: (items: Array<LibraryAsset & { title?: string }>) => void;
  inProject?: string;
  onlyKind?: 'image' | 'video';
  heading?: string;
}) {
  const app = useApp();
  const [q, setQ] = useState(''),
    [query, setQuery] = useState(''),
    [kind, setKind] = useState<'' | 'image' | 'video' | 'audio'>(onlyKind ?? '');
  const [shelf, setShelf] = useState<'' | 'fav' | string>(''),
    [project, setProject] = useState(inProject ?? '');
  const [cols, setCols] = useState<AssetCollection[]>([]);
  const [chosen, setChosen] = useState<LibraryAsset[]>([]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    void collectionsApi
      .list(app.mode)
      .then(setCols)
      .catch(() => {});
  }, [app.mode]);
  const list = useAssets({
    mode: app.mode,
    q: query || undefined,
    kind: kind || undefined,
    favorites: shelf === 'fav' || undefined,
    collection_id: shelf && shelf !== 'fav' ? shelf : undefined,
    chat_id: project || undefined,
  });
  const toggle = (a: LibraryAsset) =>
    setChosen(c => (c.some(x => x.id === a.id) ? c.filter(x => x.id !== a.id) : heading ? [a] : [...c, a]));
  return (
    <Dialog
      title={heading ?? 'Attach from Library'}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }}>
            {chosen.length ? `${chosen.length} chosen` : ''}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!chosen.length}
            onClick={() => onPick(chosen.map(a => ({ ...a, title: assetTitle(a) })))}
          >
            Attach {chosen.length || ''}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="search-box" style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Icon.Search />
          <input
            type="search"
            placeholder="Search prompts, titles and notes"
            aria-label="Search the Library"
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
          />
        </label>
        {!inProject && (
          <select
            className="select"
            style={{ width: 'auto', maxWidth: '100%', minWidth: 0 }}
            aria-label="Project"
            value={project}
            onChange={e => setProject(e.target.value)}
          >
            <option value="">All projects</option>
            {app.projectList.map(p => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        )}
      </div>
      <nav
        className="chips shelves"
        aria-label="Collections"
        style={{ flex: 'none', minHeight: 36, minWidth: 0, maxWidth: '100%', overflowX: 'auto' }}
      >
        <button className={'chip' + (!shelf ? ' on' : '')} onClick={() => setShelf('')}>
          Everything
        </button>
        <button
          className={'chip' + (shelf === 'fav' ? ' on' : '')}
          onClick={() => setShelf(shelf === 'fav' ? '' : 'fav')}
        >
          <Icon.Heart width={13} height={13} />
          Favorites
        </button>
        {cols.map(c => (
          <button
            key={c.id}
            className={'chip' + (shelf === c.id ? ' on' : '')}
            onClick={() => setShelf(shelf === c.id ? '' : c.id)}
          >
            {c.name} <span className="faint">{c.count}</span>
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {(
          [
            ['', 'All'],
            ['image', 'Images'],
            ['video', 'Videos'],
            ['audio', 'Audio'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>
            {l}
          </button>
        ))}
      </nav>
      {list.loaded && !list.items.length && (
        <p className="muted">{query ? `Nothing matches “${query}”.` : 'Nothing here yet.'}</p>
      )}
      <div className="grid dense">
        {list.items.map(a => {
          const on = chosen.some(x => x.id === a.id);
          return (
            <figure key={a.id} className="cell">
              <div className={'tile' + (on ? ' selected' : '')}>
                <Media id={a.id} kind={a.kind} alt={assetTitle(a)} />
                <button
                  className="open"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={assetTitle(a)}
                  onClick={() => toggle(a)}
                />
                {on && (
                  <span
                    className="check sel"
                    aria-hidden="true"
                    style={{ position: 'absolute', top: 6, left: 6, background: 'var(--accent)' }}
                  >
                    <Icon.Check />
                  </span>
                )}
                {a.kind !== 'image' && (
                  <span className="badge pill" aria-hidden="true">
                    {a.kind === 'video' ? 'Video' : 'Audio'}
                  </span>
                )}
              </div>
              <figcaption title={assetTitle(a)}>
                <Caption title={assetTitle(a)} />
                <small>{app.projectList.find(p => p.id === a.chat_id)?.title ?? (a.job_id ? '' : 'Uploaded')}</small>
              </figcaption>
            </figure>
          );
        })}
      </div>
      {list.cursor && (
        <button className="btn" disabled={list.loading} onClick={() => void list.more()}>
          Load more
        </button>
      )}
    </Dialog>
  );
}
