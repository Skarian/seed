import { useMemo, useState } from 'react';
import { projects as projectsApi, type Project } from '../api.js';
import { useApp, useAssets, useStoredState, type ViewerItem } from '../data.js';
import { titleOf, tileState, shapeClass } from '../format.js';
import { CastStrip } from './Cast.js';
import { Stages } from './Stages.js';
import { addToBrief, sameCast } from '../../../shared/cast.js';
import type { Choice } from '../../../shared/choices.js';
import { boardStages, buildBoard, byRequest, gridStyle, type Filter } from './board.js';
import { Icon } from '../icons.js';
import { MenuButton } from '../ui.js';
import { ShotBoard } from './ShotBoard.js';
import { TileFace } from './BoardTile.js';

const FILTER_LABEL: Record<Filter, string> = { all: 'All', fav: 'Favorites', image: 'Images', video: 'Videos' };
const FILTERS = Object.keys(FILTER_LABEL) as Filter[];
const VIEWS = { shots: 'By shot', grid: 'Grid' } as const;
const ARRANGE = ['shots', 'grid'] as const;

/**
 * The project board: every result in one packed grid (or grouped by request), work in progress
 * first, chosen results marked, and planned drafts listed. Beside the conversation on wide
 * screens, and the Results tab elsewhere. Selecting two compares them.
 */
export function ResultsView({
  project,
  embedded = false,
  onChanged,
  onAsk,
}: {
  project: Project;
  embedded?: boolean;
  onChanged?: (p: Project) => void;
  /** Sends a message to Seed in this project's conversation. */
  onAsk?: (text: string) => void;
}) {
  const app = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [size, setSize] = useStoredState<'s' | 'm' | 'l'>(embedded ? 'seed.board.size' : 'seed.results.size', 'm');
  const [grouped, setGrouped] = useStoredState('seed.results.grouped', false);
  // A film or set made of numbered shots is shown shot by shot, in story order; anything else as one grid.
  const [viewPref, setView] = useStoredState<'auto' | 'shots' | 'grid'>('seed.results.view', 'auto');
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const list = useAssets(
    {
      mode: app.mode,
      chat_id: project.id,
      source: 'made',
      ...(filter === 'fav' ? { favorites: true } : {}),
      ...(filter === 'image' || filter === 'video' ? { kind: filter } : {}),
    },
    project.jobs.map(j => j.state).join(),
  );
  const b = useMemo(() => buildBoard(project, list.items, filter), [project, list.items, filter]);
  const { items, fav, running, planned, cut, cast } = b;
  const view = viewPref === 'auto' ? (b.hasShots ? 'shots' : 'grid') : viewPref;
  // The choice being saved: a cast name, or "<shot key>:<kind>".
  const [picking, setPicking] = useState('');
  async function choose(choice: Choice) {
    setPicking('reference' in choice ? choice.reference : choice.shot + ':' + choice.kind);
    try {
      onChanged?.(await projectsApi.choose(project.id, choice));
    } catch (e) {
      app.toast((e as Error).message);
    } finally {
      setPicking('');
    }
  }
  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s.slice(-1), id]));
  // Before two are chosen, the button starts choosing: every take shows its box until two are ticked.
  const compare = () => {
    if (selected.length < 2) {
      setComparing(c => !c);
      return;
    }
    const [x, y] = selected.map(id => items.find(i => i.asset === id)!);
    if (x && y) app.compare(x, y);
  };
  const images = items.filter(i => i.kind === 'image');
  const pick = { selected, toggle, picking, choose };
  const playCut = cut.length ? () => app.view(cut[0]!, cut) : undefined;
  const playInOrder = view === 'shots' && cut.length > 1 ? playCut : undefined;
  const ticked = selected.length;
  const compareClass = ticked || comparing ? 'btn primary small' : 'btn small';
  const comparePressed = ticked < 2 ? comparing : undefined;
  const grid = gridStyle(b.dims, size, embedded);
  const tile = (it: ViewerItem) => (
    <figure key={it.asset} className="cell">
      <TileFace it={it} b={b} siblings={items} className="tile" {...pick} />
      <figcaption>
        <span>{it.title}</span>
        {it.job?.request && (
          <small>
            {it.kind === 'video' ? 'Video' : 'Image'}
            {it.job.request.workflow === 'reference-to-video' ? ' · animated' : ''}
          </small>
        )}
      </figcaption>
    </figure>
  );
  return (
    <div className={(embedded ? 'board' : 'board full') + (comparing ? ' selecting' : '')}>
      {app.narrow && !embedded ? (
        // Phones: the board's tools are three buttons that fit one row; each choice sits in its menu.
        <div className="toolbar phone-tools">
          <MenuButton
            className="btn small"
            label={'Show: ' + FILTER_LABEL[filter]}
            align="start"
            items={FILTERS.map(k => ({ label: FILTER_LABEL[k], checked: filter === k, onSelect: () => setFilter(k) }))}
          >
            {FILTER_LABEL[filter]} ▾
          </MenuButton>
          <MenuButton
            className="btn small"
            label={'Arrange: ' + VIEWS[view]}
            align="start"
            items={[
              ...ARRANGE.map(v => ({ label: VIEWS[v], checked: view === v, onSelect: () => setView(v) })),
              ...(view === 'grid'
                ? [{ label: 'Group by request', checked: grouped, onSelect: () => setGrouped(!grouped) }]
                : []),
              ...(playInOrder
                ? [{ label: 'Play in order', hint: 'The chosen clips, shot by shot', onSelect: playInOrder }]
                : []),
            ]}
          >
            {VIEWS[view]} ▾
          </MenuButton>
          <span style={{ flex: 1 }} />
          <button
            className={compareClass}
            aria-pressed={comparePressed}
            aria-label={ticked === 2 ? 'Compare' : ticked ? 'Select one more to compare' : 'Select two to compare'}
            onClick={compare}
          >
            <Icon.Compare />
            {ticked === 2 ? 'Compare' : ticked ? '1 of 2' : 'Compare'}
          </button>
        </div>
      ) : (
        <div className="toolbar">
          {embedded && <b style={{ marginRight: 4 }}>Board</b>}
          <div className="seg" role="group" aria-label="Show">
            {FILTERS.map(k => (
              <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {k === 'fav' ? <Icon.Heart width={14} height={14} /> : null}
                {FILTER_LABEL[k]}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          {playInOrder && (
            <button className="btn small" onClick={playInOrder}>
              <Icon.Play width={14} height={14} />
              Play in order
            </button>
          )}
          <div className="seg" role="group" aria-label="Arrange">
            {ARRANGE.map(v => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                {VIEWS[v]}
              </button>
            ))}
          </div>
          {view === 'grid' && (
            <button className="btn small quiet" aria-pressed={grouped} onClick={() => setGrouped(!grouped)}>
              {grouped ? 'Grouped by request' : 'All together'}
            </button>
          )}
          {view === 'grid' && (
            <div className="seg no-phone" role="group" aria-label="Tile size">
              {(['s', 'm', 'l'] as const).map(k => (
                <button
                  key={k}
                  aria-pressed={size === k}
                  aria-label={{ s: 'Small tiles', m: 'Medium tiles', l: 'Large tiles' }[k]}
                  onClick={() => setSize(k)}
                >
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <button className={compareClass} aria-pressed={comparePressed} onClick={compare}>
            <Icon.Compare />
            {ticked === 2 ? 'Compare' : ticked ? 'Select one more' : 'Select two to compare'}
          </button>
        </div>
      )}
      <div className="scroll">
        <div
          className={embedded ? 'boardpad' : 'col'}
          style={embedded ? undefined : { maxWidth: 1400, paddingBottom: 24 }}
        >
          {filter === 'all' && view === 'shots' && b.numbered.length > 0 && (
            <Stages
              stages={boardStages(b).filter(s => s.label)}
              onAsk={onAsk}
              onPlay={playCut}
              finished={
                b.film
                  ? undefined
                  : {
                      text: `Your ${b.numbered.length}-image sequence is ready.`,
                      label: 'Open it in the Library',
                      onClick: () => app.go({ name: 'library', project: project.id }),
                    }
              }
            />
          )}
          {filter === 'all' && (
            <CastStrip
              brief={project.brief}
              cast={cast}
              shotsMade={items.some(i => i.kind === 'image' && /^shot\s*\d/i.test(i.title))}
              onEdit={async (from, entry) => {
                try {
                  onChanged?.(await projectsApi.editCast(project.id, from, entry));
                } catch (e) {
                  app.toast((e as Error).message);
                  throw e;
                }
              }}
              choices={project.choices}
              images={images}
              busy={picking}
              onChoose={(reference, asset) => void choose({ reference, asset })}
              onAsk={onAsk}
              projectId={project.id}
              onImport={async picked => {
                // A name this project already has ("Tomo", or "Ines" for "Ines Varga") gets the picture under its own
                // name; new names join the brief with their look. Then each picture is approved here.
                const target = (name: string) => cast.find(e => sameCast(e.name, name))?.name;
                const added = picked.filter(x => !target(x.entry.name)).map(x => x.entry);
                let p = await projectsApi.setBrief(project, addToBrief(project.brief, added));
                for (const x of picked)
                  p = await projectsApi.choose(project.id, {
                    reference: target(x.entry.name) ?? x.entry.name,
                    asset: x.asset,
                  });
                onChanged?.(p);
                app.toast(`Brought in ${picked.map(x => x.entry.name).join(', ')}`);
              }}
              onOpen={it => app.view(it, images)}
            />
          )}
          {view === 'shots' &&
            (items.length > 0 || running.length > 0 || planned.length > 0 || b.briefShots.length > 0) && (
              <ShotBoard b={b} filter={filter} {...pick} />
            )}
          {view === 'grid' && running.length > 0 && (
            <section>
              <div className="day">Making now</div>
              <div className="grid" style={grid}>
                {running.map(j => {
                  const s = tileState(j);
                  return (
                    <figure key={j.id} className="cell">
                      <div className={`tile pending shimmer ${shapeClass(j.request)}`} style={{ aspectRatio: '1' }}>
                        <span className="state pill">
                          <span className={'dot ' + (s.tone === 'wait' ? 'amber' : 'live')} />
                          {s.label.split(' · ')[0]}
                        </span>
                        {s.percent !== undefined && (
                          <div className="prog">
                            <i style={{ width: s.percent + '%' }} />
                          </div>
                        )}
                      </div>
                      <figcaption>
                        <span>{titleOf(j.request)}</span>
                        <small>{s.label}</small>
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            </section>
          )}
          {view === 'grid' && planned.length > 0 && filter === 'all' && (
            <section>
              <div className="day">In the plan, not made yet</div>
              <div className="chips">
                {planned.map(t => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            </section>
          )}
          {list.loaded && !items.length && !running.length && !planned.length && (
            <div className="empty" style={{ minHeight: 240 }}>
              <div>
                <h2 className="serif" style={{ fontSize: '1.375rem' }}>
                  {filter === 'fav' ? 'No favorites yet' : 'Nothing made yet'}
                </h2>
                <p>
                  {filter === 'fav'
                    ? 'Tap ♥ on a result to mark it as the one you want.'
                    : 'Everything made in this project gathers here.'}
                </p>
                {filter !== 'all' && (
                  <button className="btn" onClick={() => setFilter('all')}>
                    Show all
                  </button>
                )}
              </div>
            </div>
          )}
          {view === 'grid' &&
            items.length > 0 &&
            (grouped ? (
              [...byRequest(items).entries()].map(([title, its]) => (
                <section key={title}>
                  <div className="day">
                    {title}{' '}
                    <span className="faint" style={{ fontWeight: 400 }}>
                      · {its.length}
                      {its.some(i => fav.has(i.asset)) ? ' · favorite ♥' : ''}
                    </span>
                  </div>
                  <div className="grid" style={grid}>
                    {its.map(tile)}
                  </div>
                </section>
              ))
            ) : (
              <section>
                {(running.length > 0 || planned.length > 0) && <div className="day">Made</div>}
                <div className="grid" style={grid}>
                  {[...items]
                    // Newest batch first, its takes in order (take 1 before take 2).
                    .sort((x, y) => b.made(y)[0] - b.made(x)[0] || b.made(x)[1] - b.made(y)[1])
                    .map(tile)}
                </div>
              </section>
            ))}
          {list.cursor && (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <button className="btn" disabled={list.loading} onClick={() => void list.more()}>
                {list.loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
