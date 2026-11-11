// One result on the board (picture or clip, open button, compare box, favorite mark, clip length), shared by the
// grid and the shot lanes, and the frame guide the lanes draw over a take.
import type { CSSProperties, ReactNode } from 'react';
import { useApp, type ViewerItem } from '../data.js';
import { Icon } from '../icons.js';
import { Media } from '../ui.js';
import type { Board, Picking } from './board.js';

/** `siblings` are what Previous and Next step through in the viewer; `children` are drawn under the buttons. */
export function TileFace(
  p: { it: ViewerItem; b: Board; siblings: ViewerItem[]; className: string; style?: CSSProperties } & Picking & {
      children?: ReactNode;
    },
) {
  const { it, b, siblings, className, style } = p;
  const app = useApp();
  const selected = p.selected.includes(it.asset);
  return (
    <div className={className + (selected ? ' selected' : '')} style={style}>
      <Media id={it.asset} kind={it.kind} alt={it.title} />
      {p.children}
      <button className="open" aria-label={'Open ' + it.title} onClick={() => app.inspect(it, siblings)} />
      <button
        className="sel check big"
        role="checkbox"
        aria-checked={selected}
        aria-label={'Select ' + it.title + ' to compare'}
        onClick={() => p.toggle(it.asset)}
      >
        {selected && <Icon.Check />}
      </button>
      <span className="corner">
        {b.fav.has(it.asset) && (
          <span className="pill" aria-label="Favorite">
            <Icon.HeartFill width={12} height={12} style={{ color: 'var(--accent)' }} />
          </span>
        )}
      </span>
      {it.kind === 'video' && (
        <span className="badge pill" aria-hidden="true">
          <Icon.Play width={11} height={11} />
          {it.job?.request.output.duration_seconds ?? 5} s
        </span>
      )}
    </div>
  );
}

/** The project's delivery frame ("2.39:1") drawn over a take: what stays after the crop, with the rest dimmed. */
export function FrameGuide({ frame, ratio }: { frame?: string; ratio?: number }) {
  const [w, h] = (frame ?? '').split(':').map(Number);
  if (!w || !h || !ratio) return null;
  const target = w / h;
  if (Math.abs(target - ratio) / ratio < 0.03) return null;
  const wide = target > ratio;
  return (
    <span
      className="frame-guide"
      aria-hidden="true"
      title={'Crops to ' + frame}
      style={
        wide
          ? { left: 0, right: 0, height: (ratio / target) * 100 + '%', top: ((1 - ratio / target) / 2) * 100 + '%' }
          : { top: 0, bottom: 0, width: (target / ratio) * 100 + '%', left: ((1 - target / ratio) / 2) * 100 + '%' }
      }
    >
      <small>{frame}</small>
    </span>
  );
}

/** A take's own shape from its request, when its pixel size is not known yet. */
export function frameOf(it: ViewerItem) {
  const a = it.job?.request.output.aspect;
  return a === '16:9' ? 16 / 9 : a === '9:16' ? 9 / 16 : a === '4:5' ? 4 / 5 : a === '1:1' ? 1 : undefined;
}
