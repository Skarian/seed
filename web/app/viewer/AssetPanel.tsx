/** What you can do with one result (Refine, Animate, choose it for its shot, the More menu) above the facts about it. */
import { useEffect, useState } from 'react';
import { shotKey } from '../../../shared/choices.js';
import { assets as assetsApi, projects as projectsApi } from '../api.js';
import { putProject, useApp, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { MenuButton, Confirm, downloadAsset } from '../ui.js';
import { CropDialog } from './Crop.js';
import { downloadName, placeInProject, useDetail } from './assetDetail.js';
import { AssetFacts } from './AssetFacts.js';
import { CollectionsDialog } from './Organize.js';

type Props = { item: ViewerItem; actionsOnly?: boolean; onClosed?: () => void };

/** The heart that adds a result to favorites or removes it; `subject` names it when two are side by side ("A"). */
export function FavoriteButton(p: { fav?: boolean; onToggle: () => void; className?: string; subject?: string }) {
  const { fav, subject } = p;
  const label = `${fav ? 'Remove' : 'Add'} ${subject ? subject + ' ' : ''}${fav ? 'from' : 'to'} favorites`;
  return (
    <button className={p.className ?? 'btn'} aria-pressed={fav} aria-label={label} onClick={p.onToggle}>
      {fav ? <Icon.HeartFill style={{ color: 'var(--accent)' }} /> : <Icon.Heart />}
    </button>
  );
}

export function AssetPanel({ item, actionsOnly = false, onClosed }: Props) {
  const app = useApp();
  const { detail, job, refresh } = useDetail(item);
  const [colDialog, setColDialog] = useState(false),
    [del, setDel] = useState(false),
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
        const place = placeInProject(p, item, job);
        setShot(place.shot);
        setUsedAs(place.usedAs);
      })
      .catch(() => live && setUsedAs([]));
    return () => {
      live = false;
    };
  }, [usedIn, item.asset]);
  const video = item.kind === 'video';
  const fav = Boolean(detail?.favorite);
  const source = job?.source;
  const use = (how: Parameters<typeof app.useResult>[1]) => app.useResult({ ...item, job }, how);
  // Actions that carry on somewhere else close the viewer first.
  const leave = (how: Parameters<typeof app.useResult>[1]) => {
    onClosed?.();
    use(how);
  };
  const toggleFavorite = () => void assetsApi.favorite(item.asset, !fav).then(refresh);
  const download = () => void downloadAsset(item.asset, downloadName(item, job));
  // Repeating repeats the whole batch: say how many will be made.
  const againCount = job?.request.count ?? 1;
  const againLabel = againCount > 1 ? `Make ${againCount} more ${video ? 'clips' : 'images'} now` : 'Make another now';
  const more = [
    ...(actionsOnly && source?.card_id
      ? [
          {
            label: againLabel,
            hint: againCount > 1 ? 'The same batch again, new seeds.' : 'Same settings, a new seed.',
            onSelect: () => leave('more'),
          },
        ]
      : []),
    { label: 'Use as input', hint: 'Attach it to the composer.', onSelect: () => use('input') },
    ...(item.kind === 'image' && source?.chat_id
      ? [
          {
            label: 'Check against the brief',
            hint: 'Against the brief and the approved references.',
            onSelect: () => leave('check'),
          },
        ]
      : []),
    ...(source?.card_id
      ? [{ label: 'Reuse settings', hint: 'Load its prompt and settings into Make.', onSelect: () => leave('reuse') }]
      : []),
    { label: fav ? 'Remove from favorites' : 'Add to favorites', onSelect: toggleFavorite },
    { label: 'Add to collection…', onSelect: () => setColDialog(true) },
    ...(!video
      ? [{ label: 'Crop…', hint: 'A new shape, on this device. No GPU.', onSelect: () => setCrop(true) }]
      : []),
    { label: 'Download', onSelect: download },
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
  function chooseForShot(s: NonNullable<typeof shot>) {
    setChoosing(true);
    void projectsApi
      .choose(usedIn!, {
        shot: shotKey(s.n, s.name),
        kind: video ? 'clip' : 'image',
        asset: s.chosen ? null : item.asset,
      })
      .then(p => {
        putProject(p);
        setShot({ ...s, chosen: !s.chosen });
        app.toast(s.chosen ? 'Choice cleared' : `Chosen for Shot ${s.n}`);
      })
      .catch(e => app.toast((e as Error).message))
      .finally(() => setChoosing(false));
  }
  function remove() {
    void assetsApi
      .remove(item.asset)
      .then(() => {
        setDel(false);
        app.toast('Deleted');
        // The project that showed it updates at once, so the deleted picture leaves its conversation and board.
        if (item.project)
          void projectsApi
            .get(item.project)
            .then(p => putProject(p))
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
      });
  }
  return (
    <>
      <div className="acts">
        <button className="btn primary" onClick={() => use('refine')}>
          <Icon.Pencil />
          Refine
        </button>
        {source?.card_id && !actionsOnly && (
          <button className="btn" onClick={() => leave('more')}>
            {againLabel}
          </button>
        )}
        {!video && (
          <button className="btn" onClick={() => use('animate')}>
            <Icon.Film />
            Animate
          </button>
        )}
        {!video && source?.chat_id && (
          <button
            className="btn"
            title="Seed looks at this picture and compares it with the shot and the approved references"
            onClick={() => leave('check')}
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
            onClick={() => chooseForShot(shot)}
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
          <button className="btn" onClick={download}>
            Download
          </button>
        )}
        {!actionsOnly && <FavoriteButton fav={fav} onToggle={toggleFavorite} />}
        <MenuButton label="More actions" className="btn" items={more} placement={actionsOnly ? 'above' : undefined}>
          <Icon.More />
        </MenuButton>
      </div>
      {!actionsOnly && (
        <AssetFacts
          item={item}
          job={job}
          detail={detail}
          usedAs={usedAs}
          onClosed={onClosed}
          onCollections={() => setColDialog(true)}
        />
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
        <CollectionsDialog asset={item.asset} detail={detail} onChanged={refresh} onClose={() => setColDialog(false)} />
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
          onConfirm={remove}
        />
      )}
    </>
  );
}
