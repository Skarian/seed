import React, { useEffect, useRef, useState } from 'react';
import { shotFromTitle, shotNameKey, shotsFromBrief } from '../../../shared/shots.js';
import { chosenAs, chosenTake, shotKey } from '../../../shared/choices.js';
import {
  assets as assetsApi,
  collections as collectionsApi,
  jobs as jobsApi,
  projects as projectsApi,
  media,
  kindOf,
  isVideoKind,
  type AssetDetail,
  type JobRecord,
  type AssetCollection,
} from '../api.js';
import { useApp, useStoredState, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { Media, MenuButton, Thumb, Confirm, Dialog, Overlay, downloadAsset } from '../ui.js';
import { titleOf, settingChips, duration, targetLabel, promptChanges } from '../format.js';
import { roleLabels } from '../project/requests.js';
import { StatusControl } from '../App.js';
import { useStyles } from '../project/styles.js';
import { CropDialog } from './Crop.js';

/** Everything known about one result: its job, organization and family. */
function useDetail(item: ViewerItem) {
  const [detail, setDetail] = useState<AssetDetail | null>(null),
    [job, setJob] = useState<JobRecord | undefined>(item.job);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void assetsApi
      .get(item.asset)
      .then(d => {
        if (!live) return;
        setDetail(d);
        if (!item.job && d.job_id)
          void jobsApi
            .get(d.job_id)
            .then(j => live && setJob(j))
            .catch(() => {});
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [item.asset, tick]);
  useEffect(() => setJob(item.job), [item.job?.id]);
  return { detail, job, refresh: () => setTick(t => t + 1) };
}

function useFamily(item: ViewerItem, job?: JobRecord) {
  const { tasks } = useApp();
  const parents = (job?.request.references ?? []).map(r => {
    const made = tasks.find(j => j.outputs.includes(r.asset_id));
    return {
      asset: r.asset_id,
      kind: r.kind,
      role: r.role,
      title: made ? titleOf(made.request) : 'Uploaded ' + r.kind,
      job: made,
    };
  });
  const children = tasks
    .filter(j => j.state === 'completed' && j.request.references?.some(r => r.asset_id === item.asset))
    .flatMap(j => j.outputs.map(o => ({ asset: o, job: j })));
  return { parents, children };
}

export function AssetPanel({
  item,
  compact = false,
  actionsOnly = false,
  onClosed,
}: {
  item: ViewerItem;
  compact?: boolean;
  actionsOnly?: boolean;
  onClosed?: () => void;
}) {
  const app = useApp();
  const { detail, job, refresh } = useDetail(item);
  const { parents, children } = useFamily(item, job);
  const styles = useStyles(app.mode);
  const [cols, setCols] = useState<AssetCollection[] | null>(null),
    [colDialog, setColDialog] = useState(false),
    [del, setDel] = useState(false),
    [note, setNote] = useState<{ note: string; revision: number } | null>(null);
  useEffect(() => {
    void assetsApi
      .note(item.asset)
      .then(setNote)
      .catch(() => setNote({ note: '', revision: 0 }));
  }, [item.asset]);
  const [allCols, setAllCols] = useState<AssetCollection[]>([]),
    [crop, setCrop] = useState(false);
  // What this result is used as in its project ("Chosen for Shot 2", "Maren's reference"): one place to see it.
  const usedIn = job?.source?.chat_id ?? item.project;
  const [usedAs, setUsedAs] = useState<string[]>([]);
  // The shot this take belongs to, so it can be chosen right here where it is seen largest.
  const [shot, setShot] = useState<{ n: number; name: string; chosen: boolean } | null>(null);
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    if (!usedIn) return setUsedAs([]);
    let live = true;
    void projectsApi
      .get(usedIn)
      .then(p => {
        if (!live) return;
        const list = shotsFromBrief(p.brief);
        const own = shotFromTitle(job?.request.title ?? '');
        const listed = own.n !== null ? list.find(x => shotNameKey(x.name) === shotNameKey(own.name)) : undefined;
        if (own.n !== null) {
          const n = listed?.n ?? own.n,
            name = listed?.name ?? own.name;
          setShot({
            n,
            name,
            chosen: chosenTake(p.choices, n, name, item.kind === 'video' ? 'clip' : 'image') === item.asset,
          });
        } else setShot(null);
        setUsedAs(
          chosenAs(p.choices, item.asset).map(c => {
            if ('reference' in c) return `${c.reference}’s reference`;
            const listed = list.find(s => shotNameKey(s.name) === c.shot);
            const where = listed
              ? `Shot ${listed.n}: ${listed.name}`
              : c.shot.startsWith('#')
                ? 'Shot ' + c.shot.slice(1)
                : c.shot;
            return `Chosen ${c.kind === 'clip' ? 'clip' : 'keyframe'} for ${where}`;
          }),
        );
      })
      .catch(() => live && setUsedAs([]));
    return () => {
      live = false;
    };
  }, [usedIn, item.asset]);
  useEffect(() => {
    void collectionsApi
      .list(app.mode)
      .then(setAllCols)
      .catch(() => {});
  }, [app.mode, detail?.collection_ids?.join()]);
  const memberOf = allCols.filter(c => detail?.collection_ids?.includes(c.id));
  // A crop or a picked frame remembers the asset it came from; link back to it (and its project) instead of "Uploaded".
  const derivedFrom = (() => {
    const from = !detail?.job_id && typeof detail?.source_asset_id === 'string' ? detail.source_asset_id : '';
    if (!from) return null;
    const made = app.tasks.find(j => j.outputs.includes(from));
    const crop = detail?.crop as { shape?: string } | undefined;
    const at = detail?.source_time_seconds;
    return {
      asset: from,
      kind: (crop ? 'image' : 'video') as 'image' | 'video',
      job: made,
      title: made
        ? titleOf(made.request) + (made.request.count > 1 ? ` · take ${(made.submission_index ?? 0) + 1}` : '')
        : 'The original',
      how: crop
        ? `cropped to ${crop.shape ?? 'a new shape'}`
        : typeof at === 'number'
          ? `frame at ${at.toFixed(1)}s`
          : 'source',
    };
  })();
  const r = job?.request,
    video = item.kind === 'video';
  const fav = Boolean(detail?.favorite);
  const source = job?.source;
  // Repeating repeats the whole batch: say how many will be made.
  const againCount = job?.request.count ?? 1;
  const againLabel =
    againCount > 1 ? `Make ${againCount} more ${item.kind === 'video' ? 'clips' : 'images'} now` : 'Make another now';
  // A crop or picked frame belongs to the project of the image it came from.
  const home =
    source ??
    (!detail?.job_id && typeof detail?.source_asset_id === 'string'
      ? app.tasks.find(j => j.outputs.includes(detail.source_asset_id as string))?.source
      : undefined);
  async function variations() {
    if (!source?.chat_id || !source.card_id || !source.revision) return;
    try {
      await projectsApi.repeat(source.chat_id, source.card_id, source.revision, { fresh: true });
      onClosed?.();
      app.go({ name: 'project', id: source.chat_id, view: 'conversation' });
    } catch (e) {
      app.toast((e as Error).message);
    }
  }
  const more = [
    ...(actionsOnly && source?.card_id
      ? [
          {
            label: againLabel,
            hint: (job?.request.count ?? 1) > 1 ? 'The same batch again, new seeds.' : 'Same settings, a new seed.',
            onSelect: () => {
              onClosed?.();
              app.useResult({ ...item, job }, 'more');
            },
          },
        ]
      : []),
    {
      label: 'Use as input',
      hint: 'Attach it to the composer.',
      onSelect: () => app.useResult({ ...item, job }, 'input'),
    },
    ...(item.kind === 'image' && source?.chat_id
      ? [
          {
            label: 'Check against the brief',
            hint: 'Against the brief and the approved references.',
            onSelect: () => {
              onClosed?.();
              app.useResult({ ...item, job }, 'check');
            },
          },
        ]
      : []),
    ...(source?.card_id
      ? [
          {
            label: 'Reuse settings',
            hint: 'Load its prompt and settings into Make.',
            onSelect: () => {
              onClosed?.();
              app.useResult({ ...item, job }, 'reuse');
            },
          },
        ]
      : []),
    {
      label: fav ? 'Remove from favorites' : 'Add to favorites',
      onSelect: () => void assetsApi.favorite(item.asset, !fav).then(refresh),
    },
    {
      label: 'Add to collection…',
      onSelect: () => {
        setColDialog(true);
        void collectionsApi.list(app.mode).then(setCols);
      },
    },
    ...(!video
      ? [{ label: 'Crop…', hint: 'A new shape, on this device. No GPU.', onSelect: () => setCrop(true) }]
      : []),
    {
      label: 'Download',
      onSelect: () =>
        void downloadAsset(
          item.asset,
          job ? titleOf(job.request) + (job.request.count > 1 ? ' ' + (job.submission_index + 1) : '') : item.title,
        ),
    },
    ...(source?.chat_id
      ? [
          {
            label: 'Show in conversation',
            onSelect: () => {
              onClosed?.();
              app.go({ name: 'project', id: source.chat_id!, view: 'conversation', focus: source.card_id });
            },
          },
        ]
      : []),
    'divider' as const,
    { label: 'Delete…', danger: true, onSelect: () => setDel(true) },
  ];
  return (
    <>
      <div className="acts">
        <button className="btn primary" onClick={() => app.useResult({ ...item, job }, 'refine')}>
          <Icon.Pencil />
          Refine
        </button>
        {source?.card_id && !actionsOnly && (
          <button
            className="btn"
            onClick={() => {
              onClosed?.();
              app.useResult({ ...item, job }, 'more');
            }}
          >
            {againLabel}
          </button>
        )}
        {!video && (
          <button className="btn" onClick={() => app.useResult({ ...item, job }, 'animate')}>
            <Icon.Film />
            Animate
          </button>
        )}
        {!video && source?.chat_id && (
          <button
            className="btn"
            title="Seed looks at this picture and compares it with the shot and the approved references"
            onClick={() => {
              onClosed?.();
              app.useResult({ ...item, job }, 'check');
            }}
          >
            Check against the brief
          </button>
        )}
        {shot && usedIn && (
          <button
            className={'btn' + (shot.chosen ? ' on' : '')}
            aria-pressed={shot.chosen}
            disabled={choosing}
            title={shot.chosen ? 'Clear the choice' : 'Make this the chosen take on the Storyboard'}
            onClick={() => {
              setChoosing(true);
              void projectsApi
                .choose(usedIn, {
                  shot: shotKey(shot.n, shot.name),
                  kind: item.kind === 'video' ? 'clip' : 'image',
                  asset: shot.chosen ? null : item.asset,
                })
                .then(p => {
                  dispatchEvent(new CustomEvent('seed:project', { detail: p }));
                  setShot({ ...shot, chosen: !shot.chosen });
                  app.toast(shot.chosen ? 'Choice cleared' : `Chosen for Shot ${shot.n}`);
                })
                .catch(e => app.toast((e as Error).message))
                .finally(() => setChoosing(false));
            }}
          >
            {shot.chosen ? `Chosen for Shot ${shot.n}` : `Use for Shot ${shot.n}`}
          </button>
        )}
        {!actionsOnly && !video && (
          <button className="btn" onClick={() => setCrop(true)}>
            Crop
          </button>
        )}
        {!actionsOnly && (
          <button
            className="btn"
            onClick={() =>
              void downloadAsset(
                item.asset,
                job
                  ? titleOf(job.request) + (job.request.count > 1 ? ' ' + (job.submission_index + 1) : '')
                  : item.title,
              )
            }
          >
            Download
          </button>
        )}
        {!actionsOnly && (
          <button
            className="btn"
            aria-pressed={fav}
            aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => void assetsApi.favorite(item.asset, !fav).then(refresh)}
          >
            {fav ? <Icon.HeartFill style={{ color: 'var(--accent)' }} /> : <Icon.Heart />}
          </button>
        )}
        <MenuButton label="More actions" className="btn" items={more} placement={actionsOnly ? 'above' : undefined}>
          <Icon.More />
        </MenuButton>
      </div>
      {!actionsOnly && (
        <div className="kv">
          {usedAs.length > 0 && (
            <>
              <span>Used as</span>
              <div>{usedAs.join(' · ')}</div>
            </>
          )}
          <span>Made from</span>
          <div>
            {parents.length ? (
              <span className="lineage">
                {parents.map(p => (
                  <button
                    key={p.asset}
                    onClick={() =>
                      app.inspect({
                        asset: p.asset,
                        kind: p.kind,
                        title: p.title,
                        job: p.job,
                        project: p.job?.source?.chat_id,
                      })
                    }
                  >
                    <Thumb id={p.asset} kind={p.kind} alt="" />
                    <span>
                      <b style={{ fontWeight: 500 }}>{p.title}</b> · {roleLabels[p.role] ?? p.role}
                    </span>
                  </button>
                ))}
              </span>
            ) : derivedFrom ? (
              <span className="lineage">
                <button
                  onClick={() =>
                    app.inspect({
                      asset: derivedFrom.asset,
                      kind: derivedFrom.kind,
                      title: derivedFrom.title,
                      job: derivedFrom.job,
                      project: derivedFrom.job?.source?.chat_id,
                    })
                  }
                >
                  <Thumb id={derivedFrom.asset} kind={derivedFrom.kind} alt="" />
                  <span>
                    <b style={{ fontWeight: 500 }}>{derivedFrom.title}</b> · {derivedFrom.how}
                  </span>
                </button>
              </span>
            ) : (
              <span className="faint">
                {job ? 'A text prompt (no input image)' : detail && !detail.job_id ? 'Uploaded' : '—'}
              </span>
            )}
          </div>
          {children.length > 0 && (
            <>
              <span>Made from this</span>
              <div className="lineage">
                {children.slice(0, 8).map(c => (
                  <button
                    key={c.asset}
                    onClick={() =>
                      app.inspect({
                        asset: c.asset,
                        kind: isVideoKind(kindOf[c.job.request.workflow]) ? 'video' : 'image',
                        title: titleOf(c.job.request),
                        job: c.job,
                        project: c.job.source?.chat_id,
                      })
                    }
                  >
                    <Thumb id={c.asset} kind={isVideoKind(kindOf[c.job.request.workflow]) ? 'video' : 'image'} alt="" />
                    {titleOf(c.job.request)}
                    {(c.job.request.count ?? 1) > 1 ? ` · take ${(c.job.submission_index ?? 0) + 1}` : ''}
                  </button>
                ))}
              </div>
            </>
          )}
          {r && (
            <>
              <span>Settings</span>
              <div>
                {settingChips(r, id => id)
                  .filter(([k]) => !k.startsWith('style') && k !== 'target')
                  .map(([, v]) => v)
                  .join(' · ')}
                {detail?.width ? ` · saved at ${detail.width}×${detail.height}` : ''}
              </div>
            </>
          )}
          {r?.loras?.length ? (
            <>
              <span>Style</span>
              <div>
                {r.loras
                  .map(l => `${styles.find(s => s.id === l.id)?.name ?? 'Style'} · strength ${l.scale}`)
                  .join(', ')}
              </div>
            </>
          ) : null}
          {job && (
            <>
              <span>Seed</span>
              <div>{job.seed}</div>
            </>
          )}
          {job && (
            <>
              <span>Ran on</span>
              <div>
                {job.worker?.executor === 'local'
                  ? 'Seed PC'
                  : job.worker?.executor === 'cloud'
                    ? 'Cloud GPU'
                    : targetLabel(r?.target)}
                {(() => {
                  // Waiting in the queue and working on the GPU are different times: say both when they differ.
                  const m = job.metrics,
                    total = m?.elapsed_to_saved_seconds;
                  if (!total) return '';
                  const work =
                    m?.submitted_at && m.saved_at ? (Date.parse(m.saved_at) - Date.parse(m.submitted_at)) / 1000 : 0;
                  return work > 0 && total - work >= 2
                    ? ` · ready in ${duration(total)} (${duration(work)} on the GPU)`
                    : ` · ready in ${duration(total)}`;
                })()}
              </div>
            </>
          )}
          {home?.chat_id && (
            <>
              <span>Project</span>
              <div>
                <button
                  className="link"
                  onClick={() => {
                    onClosed?.();
                    app.go({ name: 'project', id: home.chat_id!, view: 'conversation', focus: home.card_id });
                  }}
                >
                  {app.projectList.find(p => p.id === home.chat_id)?.title ?? 'Open project'} · show in conversation
                </button>
              </div>
            </>
          )}
          {r && (
            <>
              <span>Prompt</span>
              <div>
                <details open={!app.narrow && r.prompt.length < 600}>
                  <summary
                    className="link"
                    style={{ cursor: 'pointer' }}
                  >{`${r.prompt.split(/\s+/).length} words`}</summary>
                  <div className="prompt">
                    {r.prompt.replace(
                      /\[\[input(\d+)\]\]|<(?:Picture|Video|Audio) (\d+)>|<image(\d+)>/g,
                      (m, x?: string, y?: string, z?: string) => {
                        const p = parents[Number(x ?? y ?? z) - 1];
                        return p ? '“' + p.title + '”' : m;
                      },
                    )}
                  </div>
                </details>
              </div>
            </>
          )}
          <>
            <span>Collections</span>
            <div className="chips">
              {memberOf.map(c => (
                <button
                  key={c.id}
                  className="chip"
                  aria-label={'Open collection ' + c.name}
                  onClick={() => {
                    onClosed?.();
                    app.go({ name: 'library', collection: c.id });
                  }}
                >
                  {c.name}
                </button>
              ))}
              <button
                className="chip"
                onClick={() => {
                  setColDialog(true);
                  void collectionsApi.list(app.mode).then(setCols);
                }}
              >
                <Icon.Plus />
                {memberOf.length ? 'Change' : 'Add to collection'}
              </button>
            </div>
          </>
          {
            <>
              <span>Note</span>
              <div>
                <NoteField asset={item.asset} note={note} onSaved={setNote} />
              </div>
            </>
          }
        </div>
      )}
      {crop && (
        <CropDialog
          asset={item.asset}
          title={item.title}
          project={item.project ?? job?.source?.chat_id}
          onClose={() => setCrop(false)}
        />
      )}
      {colDialog && (
        <Dialog
          title="Add to collection"
          onClose={() => setColDialog(false)}
          footer={
            <button className="btn primary" onClick={() => setColDialog(false)}>
              Done
            </button>
          }
        >
          {!cols ? (
            <p className="muted">Loading…</p>
          ) : (
            <CollectionChoices
              asset={item.asset}
              cols={cols}
              detail={detail}
              onChanged={() => {
                refresh();
                dispatchEvent(new Event('seed:collections'));
              }}
            />
          )}
        </Dialog>
      )}
      {del && (
        <Confirm
          title="Delete this result?"
          danger
          action="Delete permanently"
          onClose={() => setDel(false)}
          body={
            <p style={{ margin: 0 }}>
              “{item.title}” is removed from the Library and from its project. This can't be undone.
            </p>
          }
          onConfirm={() =>
            void assetsApi
              .remove(item.asset)
              .then(() => {
                setDel(false);
                app.toast('Deleted');
                // The project that showed it updates at once, so the deleted picture leaves its conversation and board.
                if (item.project)
                  void projectsApi
                    .get(item.project)
                    .then(p => dispatchEvent(new CustomEvent('seed:project', { detail: p })))
                    .catch(() => {});
                app.refreshTasks();
                onClosed?.();
                // Focus goes back into the page, never to nothing.
                requestAnimationFrame(() => {
                  const target =
                    document.querySelector<HTMLElement>('main h1 button') ??
                    document.querySelector<HTMLElement>('main h1, main h2');
                  if (target && !target.matches('button, [tabindex]')) target.setAttribute('tabindex', '-1');
                  target?.focus();
                });
              })
              .catch(e => {
                setDel(false);
                app.toast((e as Error).message);
              })
          }
        />
      )}
    </>
  );
}

function NoteField({
  asset,
  note,
  onSaved,
}: {
  asset: string;
  note: { note: string; revision: number } | null;
  onSaved: (n: { note: string; revision: number }) => void;
}) {
  const [value, setValue] = useState(note?.note ?? ''),
    [saved, setSaved] = useState('');
  // Text you are typing is never replaced by a save from another editor; it saves over it when you leave the box.
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setValue(note?.note ?? '');
  }, [note?.revision, asset]);
  // Another open editor of this note saved: take its text and revision.
  useEffect(() => {
    const other = (e: Event) => {
      const d = (e as CustomEvent<{ asset: string; note: { note: string; revision: number } }>).detail;
      if (d.asset === asset && d.note.revision !== note?.revision) onSaved(d.note);
    };
    addEventListener('seed:note', other);
    return () => removeEventListener('seed:note', other);
  }, [asset, note?.revision]);
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
          if (value !== note.note) {
            setSaved('Saving…');
            const done = (n: { note: string; revision: number }) => {
              typing.current = false;
              onSaved(n);
              setSaved('Saved');
              dispatchEvent(new CustomEvent('seed:note', { detail: { asset, note: n } }));
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
          }
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

function CollectionChoices({
  asset,
  cols,
  detail,
  onChanged,
}: {
  asset: string;
  cols: AssetCollection[];
  detail: AssetDetail | null;
  onChanged: () => void;
}) {
  const app = useApp();
  const [list, setList] = useState(cols),
    [name, setName] = useState(''),
    [inside, setInside] = useState<string[]>(detail?.collection_ids ?? []);
  return (
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
                onChanged();
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
              setList(l => [...l, { ...c, count: 1 }]);
              setInside(s => [...s, c.id]);
              setName('');
              onChanged();
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
  );
}

/** Side panel for a selected result (desktop). */
export function Inspector({
  item,
  siblings,
  onClose,
  onPick,
}: {
  item: ViewerItem;
  siblings: ViewerItem[];
  onClose: () => void;
  onPick: (i: ViewerItem) => void;
}) {
  const app = useApp();
  const i = siblings.findIndex(s => s.asset === item.asset);
  // Wider gives the picture most of the screen beside the board; the choice is remembered.
  const [wide, setWide] = useStoredState('seed.inspector.wide', false);
  useEffect(() => {
    document.body.classList.toggle('inspector-wide', wide);
    return () => {
      document.body.classList.remove('inspector-wide');
    };
  }, [wide]);
  // Escape closes the panel only when nothing inside it (a menu, a dialog, a field) has already handled the key,
  // and focus returns to the result it was opened from. Enter on the image opens it full screen (the button does that).
  const latest = useRef({ onClose, item, onPick, siblings, i });
  latest.current = { onClose, item, onPick, siblings, i };
  // Closing (Escape or the Close button) returns focus to the result it was opened from.
  const close = () => {
    const title = latest.current.item.title;
    latest.current.onClose();
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[aria-label="${CSS.escape('Open ' + title)}"]`)
        ?.focus({ preventScroll: true }),
    );
  };
  // Opening the panel moves focus to its title, so keyboard and screen-reader users land in what they opened.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        !['Escape', 'ArrowLeft', 'ArrowRight'].includes(e.key) ||
        e.defaultPrevented ||
        target.closest('input,textarea,select,[role=menu],[role=dialog],[role=slider],video') ||
        document.querySelector('[role=menu],[role=dialog]')
      )
        return;
      // The arrows move through the results only while focus is in the panel (elsewhere they belong to the page).
      if (e.key !== 'Escape') {
        if (!target.closest('.inspector')) return;
        const { siblings: list, i: at, onPick: pick } = latest.current;
        const next = list[at + (e.key === 'ArrowRight' ? 1 : -1)];
        if (next) {
          e.preventDefault();
          pick(next);
        }
        return;
      }
      close();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  return (
    <aside className="inspector" aria-label={'Details: ' + item.title}>
      <div className="vtop">
        <button className="btn small close" onClick={close} aria-label="Close details">
          <Icon.Close />
          Close
        </button>
        <h2 className="inspector-title" ref={heading} tabIndex={-1}>
          {item.title}
        </h2>
        <button
          className="btn small quiet no-phone"
          aria-pressed={wide}
          title={wide ? 'Give the board more room' : 'Give the picture more room'}
          onClick={() => setWide(!wide)}
        >
          {wide ? 'Narrower' : 'Wider'}
        </button>
        {siblings.length > 1 && (
          <span className="history">
            <button aria-label="Previous result" disabled={i <= 0} onClick={() => onPick(siblings[i - 1]!)}>
              <Icon.Back />
            </button>
            {i + 1}/{siblings.length}
            <button
              aria-label="Next result"
              disabled={i >= siblings.length - 1}
              onClick={() => onPick(siblings[i + 1]!)}
            >
              <Icon.Next />
            </button>
          </span>
        )}
      </div>
      <div className="body">
        {item.kind === 'video' ? (
          // A clip plays right here with its own controls; full screen is a separate button.
          <div className="hero hero-video">
            <Media id={item.asset} kind="video" alt={item.title} controls />
            <button className="btn small hero-full" onClick={() => app.view(item, siblings)}>
              Full screen
            </button>
          </div>
        ) : (
          <button
            className="hero"
            onClick={() => app.view(item, siblings)}
            aria-label={'Open ' + item.title + ' full screen'}
            style={{ display: 'block' }}
          >
            <Media id={item.asset} kind={item.kind} alt={item.title} large />
          </button>
        )}
        <AssetPanel item={item} onClosed={onClose} />
      </div>
    </aside>
  );
}

/** Full-screen viewer with zoom, sibling navigation, before/after for edits, and frame picking for video. */
export function Viewer({
  item,
  siblings,
  onClose,
  onPick,
}: {
  item: ViewerItem;
  siblings: ViewerItem[];
  onClose: () => void;
  onPick: (i: ViewerItem) => void;
}) {
  const app = useApp();
  const i = siblings.findIndex(s => s.asset === item.asset);
  const { job, detail, refresh } = useDetail(item);
  const fav = Boolean(detail?.favorite);
  // Before/After compares an edit with the picture it changed; a new frame drawn from references has no "before".
  const source =
    job?.request.workflow === 'image-to-image' && (job.request.output.aspect === 'source' || !job.request.engine)
      ? job.request.references?.find(r => r.role === 'source')?.asset_id
      : undefined;
  const [before, setBefore] = useState(false),
    [zoom, setZoom] = useState(1),
    [info, setInfo] = useState(!app.narrow);
  const videoRef = useRef<HTMLVideoElement>(null),
    touch = useRef<number | null>(null);
  const step = (d: number) => {
    const next = siblings[i + d];
    if (next) {
      onPick(next);
      setZoom(1);
      setBefore(false);
    }
  };
  async function pickFrame() {
    const t = videoRef.current?.currentTime ?? 0;
    try {
      const frame = await assetsApi.pickFrame(item.asset, t);
      app.toast('Frame saved to Library', {
        label: 'Animate it',
        run: () =>
          app.useResult(
            { asset: frame.id, kind: 'image', title: item.title + ' · frame', project: item.project },
            'animate',
          ),
      });
    } catch (e) {
      app.toast((e as Error).message);
    }
  }
  const shown = before && source ? source : item.asset;
  return (
    <Overlay
      className="viewer"
      label={item.title}
      onClose={onClose}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') step(-1);
        if (e.key === 'ArrowRight') step(1);
      }}
    >
      <div className="vtop">
        <button className="btn small close" onClick={onClose} autoFocus>
          <Icon.Close />
          Close
        </button>
        <b>
          {item.title}
          {siblings.length > 1 && !/ of \d+$/.test(item.title) ? ` · ${i + 1} of ${siblings.length}` : ''}
        </b>
        {source && (
          <div className="seg" role="group" aria-label="Before or after">
            <button aria-pressed={before} onClick={() => setBefore(true)}>
              Before
            </button>
            <button aria-pressed={!before} onClick={() => setBefore(false)}>
              After
            </button>
          </div>
        )}
        {item.kind === 'image' && (
          <button className="btn small no-phone" onClick={() => setZoom(z => (z === 1 ? 2 : 1))}>
            {zoom === 1 ? 'Zoom' : 'Fit'}
          </button>
        )}
        {!info && (
          <button
            className="btn small"
            aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={fav}
            onClick={() => void assetsApi.favorite(item.asset, !fav).then(refresh)}
          >
            {fav ? <Icon.HeartFill style={{ color: 'var(--accent)' }} /> : <Icon.Heart />}
          </button>
        )}
        <button className="btn small" aria-pressed={info} onClick={() => setInfo(v => !v)}>
          Details
        </button>
        <span className="no-phone">
          <StatusControl />
        </span>
      </div>
      <div
        className="stage"
        onTouchStart={e => {
          touch.current = e.touches[0]!.clientX;
        }}
        onTouchEnd={e => {
          if (touch.current === null || zoom > 1) return;
          const dx = e.changedTouches[0]!.clientX - touch.current;
          if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
          touch.current = null;
        }}
      >
        {item.kind === 'video' && !before ? (
          <video
            ref={videoRef}
            src={media.content(shown)}
            controls
            playsInline
            // Reduced motion: show the first frame and wait for Play, except when playing the film in order.
            autoPlay={item.sequence || !matchMedia('(prefers-reduced-motion: reduce)').matches}
            aria-label={item.title}
            onEnded={() => {
              if (item.sequence && i >= 0 && i < siblings.length - 1) step(1);
            }}
          />
        ) : (
          <img
            src={item.kind === 'image' || before ? media.preview(shown, true) : media.content(shown)}
            alt={before ? 'Before: the source image' : item.title}
            style={{
              transform: `scale(${zoom})`,
              transition: 'transform .15s',
              cursor: zoom > 1 ? 'zoom-out' : 'zoom-in',
            }}
            onClick={() => setZoom(z => (z === 1 ? 2 : 1))}
            onError={e => {
              (e.currentTarget as HTMLImageElement).src = media.content(shown);
            }}
          />
        )}
        {i > 0 && (
          <button className="nav-arrow prev" aria-label="Previous" onClick={() => step(-1)}>
            <Icon.Back />
          </button>
        )}
        {i >= 0 && i < siblings.length - 1 && (
          <button className="nav-arrow next" aria-label="Next" onClick={() => step(1)}>
            <Icon.Next />
          </button>
        )}
      </div>
      {item.kind === 'video' && !(info && innerWidth < 700) && (
        <div className="bottom" style={{ borderTop: 'none', paddingBottom: 0 }}>
          <button className="btn small" onClick={() => void pickFrame()}>
            <Icon.Frame />
            Save this frame as an image
          </button>
        </div>
      )}
      {info ? (
        <div
          className="bottom"
          style={{ display: 'block', maxHeight: innerWidth < 700 ? '66vh' : '40vh', overflow: 'auto' }}
        >
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 12 }}>
            <AssetPanel item={item} compact onClosed={onClose} />
          </div>
        </div>
      ) : (
        <div className="bottom">
          <AssetPanel item={item} compact actionsOnly onClosed={onClose} />
        </div>
      )}
    </Overlay>
  );
}

/** Two results, A and B, at matched size. Phones show one at a time with an A | B switch. */
export function Compare({ a, b, onClose }: { a: ViewerItem; b: ViewerItem; onClose: () => void }) {
  const app = useApp();
  const [side, setSide] = useState<'A' | 'B'>('A'),
    [zoom, setZoom] = useState(1),
    [diff, setDiff] = useState(!app.narrow);
  const [favs, setFavs] = useState<Record<string, boolean>>({});
  // Both takes of one numbered shot: either can be chosen for the shot right here.
  const shotOf = (x: ViewerItem) => shotFromTitle(x.job ? titleOf(x.job.request) : x.title);
  const shotN = (x: ViewerItem) => shotOf(x).n?.toString();
  const sameShot =
    shotN(a) &&
    shotN(a) === shotN(b) &&
    shotNameKey(shotOf(a).name) === shotNameKey(shotOf(b).name) &&
    a.project &&
    a.kind === b.kind
      ? shotN(a)
      : undefined;
  const [chosenId, setChosenId] = useState<string | null>(null);
  async function useForShot(x: ViewerItem) {
    try {
      const p = await projectsApi.choose(x.project!, {
        shot: shotKey(Number(sameShot), shotOf(x).name),
        kind: x.kind === 'video' ? 'clip' : 'image',
        asset: x.asset,
      });
      setChosenId(x.asset);
      dispatchEvent(new CustomEvent('seed:project', { detail: p }));
      app.toast(`Chosen for Shot ${sameShot}`);
    } catch (e) {
      app.toast((e as Error).message);
    }
  }
  useEffect(() => {
    for (const x of [a, b])
      void assetsApi
        .get(x.asset)
        .then(d => setFavs(f => ({ ...f, [x.asset]: Boolean(d.favorite) })))
        .catch(() => {});
  }, [a.asset, b.asset]);
  const fig = (x: ViewerItem, letter: 'A' | 'B') => (
    <figure
      key={letter}
      className={app.narrow && side !== letter ? 'hidden-phone' : ''}
      aria-label={letter + ': ' + x.title}
    >
      {/* The label sits above the picture, never over a face. */}
      <span className="pill letter">
        {letter} · {x.title}
      </span>
      <div className="frame" onClick={() => setZoom(z => (z === 1 ? 2 : 1))}>
        {x.kind === 'video' ? (
          <video src={media.content(x.asset)} controls playsInline muted loop />
        ) : (
          <img
            src={media.preview(x.asset, true)}
            alt={x.title}
            style={{ transform: `scale(${zoom})`, transition: 'transform .15s' }}
          />
        )}
      </div>
      <figcaption>
        <button
          className="btn"
          aria-pressed={favs[x.asset]}
          aria-label={favs[x.asset] ? 'Remove ' + letter + ' from favorites' : 'Add ' + letter + ' to favorites'}
          onClick={() =>
            void assetsApi
              .favorite(x.asset, !favs[x.asset])
              .then(() => setFavs(f => ({ ...f, [x.asset]: !f[x.asset] })))
          }
        >
          {favs[x.asset] ? <Icon.HeartFill style={{ color: 'var(--accent)' }} /> : <Icon.Heart />}
        </button>
        <button
          className="btn primary"
          onClick={() => {
            onClose();
            app.useResult(x, 'refine');
          }}
        >
          Refine {letter}
        </button>
        {sameShot && (
          <button className="btn" aria-pressed={chosenId === x.asset} onClick={() => void useForShot(x)}>
            {chosenId === x.asset ? `Chosen for Shot ${sameShot}` : `Use ${letter} for Shot ${sameShot}`}
          </button>
        )}
      </figcaption>
    </figure>
  );
  return (
    <Overlay
      className="viewer"
      label="Compare two results"
      onClose={onClose}
      onKeyDown={e => {
        if (e.key === 'a' || e.key === 'ArrowLeft') setSide('A');
        if (e.key === 'b' || e.key === 'ArrowRight') setSide('B');
      }}
    >
      <div className="vtop">
        <button className="btn small close" onClick={onClose} autoFocus>
          <Icon.Close />
          Close
        </button>
        <b className="compare-title">Compare</b>
        <div className="seg phone-only" role="group" aria-label="Show A or B">
          <button aria-pressed={side === 'A'} onClick={() => setSide('A')}>
            A
          </button>
          <button aria-pressed={side === 'B'} onClick={() => setSide('B')}>
            B
          </button>
        </div>
        <span className="faint no-phone no-touch" style={{ fontSize: '0.875rem' }}>
          Click a picture to zoom both
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="btn small"
          onClick={() => setZoom(z => (z === 1 ? 2 : 1))}
          title={zoom > 1 ? 'Both are at 2×; show both whole again' : 'Zoom both to 2×'}
        >
          {zoom > 1 ? '2× · Fit both' : 'Zoom 2×'}
        </button>
        <button className="btn small" aria-pressed={diff} onClick={() => setDiff(d => !d)}>
          Settings differences
        </button>
      </div>
      {diff && <Differences a={a} b={b} />}
      <div className="compare-grid">
        {fig(a, 'A')}
        {fig(b, 'B')}
      </div>
    </Overlay>
  );
}

/** A long difference (a whole prompt): three lines, with the rest one tap away. */
function DiffText({ label, text }: { label: string; text: string }) {
  const [all, setAll] = useState(false);
  return (
    <div className="diff-wrap">
      <p className={'diff-text' + (all ? ' all' : '')}>
        <b style={{ fontWeight: 600 }}>{label}</b> {text}
      </p>
      {text.length > 220 && (
        <button className="link" style={{ fontSize: '0.875rem' }} onClick={() => setAll(x => !x)} aria-expanded={all}>
          {all ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
}

/** What separates A from B: settings, seed, prompt words, and whether one was made from the other. */
function Differences({ a, b }: { a: ViewerItem; b: ViewerItem }) {
  const ja = useDetail(a).job,
    jb = useDetail(b).job,
    app = useApp(),
    styles = useStyles(app.mode);
  if (!ja || !jb) return <div className="diffbar faint">Reading how each was made…</div>;
  const named = (id: string) => styles.find(s => s.id === id)?.name ?? 'a style';
  const ca = new Map(settingChips(ja.request, named)),
    cb = new Map(settingChips(jb.request, named));
  const keys = [...new Set([...ca.keys(), ...cb.keys()])].filter(k => ca.get(k) !== cb.get(k));
  const rows: Array<[string, string]> = keys.map(k => [
    k.startsWith('style') ? 'Style' : k[0]!.toUpperCase() + k.slice(1),
    `${ca.get(k) ?? '—'} → ${cb.get(k) ?? '—'}`,
  ]);
  // What changed creatively comes first; seeds are technical detail.
  // Variations of one idea get a phrase diff; two different requests (members of a set) are named instead.
  const childJob = jb.request.references?.some(r => r.asset_id === a.asset)
    ? jb
    : ja.request.references?.some(r => r.asset_id === b.asset)
      ? ja
      : null;
  const technical = rows.length;
  let phrases: string[] = [];
  // An edit of the other one: the change that was asked for leads, ahead of engine and size.
  if (childJob) {
    // Each input token reads as the picture it stands for: "Tomo’s reference", not "the source".
    const nameOf = (asset: string) => {
      const t = app.tasks.find(j => j.outputs.includes(asset));
      const title = t ? titleOf(t.request) : '';
      return title
        ? title.replace(
            /^Reference( sheet)?:\s*(.+)$/i,
            (_m, sheet, who) => `${who}’s reference${sheet ? ' sheet' : ''}`,
          )
        : 'the attached picture';
    };
    const refs = childJob.request.references ?? [];
    const named = childJob.request.prompt.replace(
      /<(?:image|Picture|Video|Audio) ?(\d+)>|\[\[input(\d+)\]\]/gi,
      (_m, x?: string, y?: string) => {
        const r = refs[Number(x ?? y) - 1];
        return r ? nameOf(r.asset_id) : 'the source';
      },
    );
    rows.unshift(['Change asked', '“' + named + '”']);
  } else if (ja.request.prompt !== jb.request.prompt) {
    // Variations of one idea (most words shared) show only what changed; different requests show what each asks for.
    const wa = new Set(ja.request.prompt.toLowerCase().split(/\W+/).filter(Boolean)),
      wb = new Set(jb.request.prompt.toLowerCase().split(/\W+/).filter(Boolean));
    const shared = [...wa].filter(w => wb.has(w)).length / Math.max(1, new Set([...wa, ...wb]).size);
    // Every changed phrase, one per line, after the settings: nothing is folded into "and 7 more".
    if (shared >= 0.5) phrases = promptChanges(ja.request.prompt, jb.request.prompt);
    else {
      const brief = (p: string) => '“' + p + '”';
      rows.unshift(['A asks for', brief(ja.request.prompt)], ['B asks for', brief(jb.request.prompt)]);
    }
  }
  // Seeds only matter between takes of the same request.
  if (ja.seed !== jb.seed && ja.request.prompt === jb.request.prompt) rows.push(['Seed', `${ja.seed} → ${jb.seed}`]);
  const lineage = jb.request.references?.some(r => r.asset_id === a.asset)
    ? 'B was made from A'
    : ja.request.references?.some(r => r.asset_id === b.asset)
      ? 'A was made from B'
      : '';
  return (
    <div className="diffbar" aria-label="Differences between A and B">
      {lineage && <span className="chip on">{lineage}</span>}
      {!rows.length && !phrases.length && !lineage && (
        <span className="faint">Same prompt and settings{ja.seed === jb.seed ? ' and seed' : ''}.</span>
      )}
      {rows.map(([k, v], n) =>
        v.length > 70 ? (
          <DiffText
            key={k}
            label={k}
            text={v.replace(/<(?:image|Picture|Video|Audio) ?\d+>|\[\[input\d+\]\]/gi, 'the source')}
          />
        ) : (
          <span
            key={k}
            className={
              'chip' +
              (n >= rows.length - technical - (ja.seed !== jb.seed && ja.request.prompt === jb.request.prompt ? 1 : 0)
                ? ' faint'
                : '')
            }
          >
            <b style={{ fontWeight: 600 }}>{k}</b>&nbsp;{v}
          </span>
        ),
      )}
      {phrases.length > 0 && <PromptPhrases phrases={phrases} a={ja.request.prompt} b={jb.request.prompt} />}
    </div>
  );
}

/** The prompt's changed phrases, each on its own line, with both whole prompts one click away. */
function PromptPhrases({ phrases, a, b }: { phrases: string[]; a: string; b: string }) {
  const [whole, setWhole] = useState(false);
  const plain = (p: string) => p.replace(/<(?:image|Picture|Video|Audio) ?\d+>|\[\[input\d+\]\]/gi, 'the reference');
  return (
    <div className="diff-phrases">
      <b style={{ fontWeight: 600 }}>Prompt changes</b>
      <ul>
        {phrases.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      <button className="link" style={{ fontSize: '0.875rem' }} aria-expanded={whole} onClick={() => setWhole(w => !w)}>
        {whole ? 'Hide both prompts' : 'Show both prompts'}
      </button>
      {whole && (
        <div className="diff-both">
          <p>
            <b>A</b> {plain(a)}
          </p>
          <p>
            <b>B</b> {plain(b)}
          </p>
        </div>
      )}
    </div>
  );
}
