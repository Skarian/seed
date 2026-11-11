/** The two ways to look at one result: the Inspector side panel beside the page, and the full-screen Viewer. */
import { useEffect, useRef, useState } from 'react';
import { assets as assetsApi, media } from '../api.js';
import { useApp, useStoredState, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { Media, Overlay } from '../ui.js';
import { StatusControl } from '../App.js';
import { useDetail } from './assetDetail.js';
import { AssetPanel, FavoriteButton } from './AssetPanel.js';

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
  const toggleZoom = () => setZoom(z => (z === 1 ? 2 : 1));
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
          <button className="btn small no-phone" onClick={toggleZoom}>
            {zoom === 1 ? 'Zoom' : 'Fit'}
          </button>
        )}
        {!info && (
          <FavoriteButton
            className="btn small"
            fav={fav}
            onToggle={() => void assetsApi.favorite(item.asset, !fav).then(refresh)}
          />
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
            onClick={toggleZoom}
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
            <AssetPanel item={item} onClosed={onClose} />
          </div>
        </div>
      ) : (
        <div className="bottom">
          <AssetPanel item={item} actionsOnly onClosed={onClose} />
        </div>
      )}
    </Overlay>
  );
}
