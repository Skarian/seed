import { useEffect, useRef, useState } from 'react';
import { cropShapes } from '../project/checks.js';
import { assets as assetsApi, media } from '../api.js';
import { Dialog } from '../ui.js';
import { chooseFrame, currentProject, useApp } from '../data.js';

const shapes = cropShapes;
const known = (s: string | null | undefined) => (s && shapes.some(([k]) => k === s) ? s : undefined);

/**
 * Crop an image, no GPU: pick a shape, then drag the frame or move it with the arrow keys. Save copy makes a new
 * image in the Library that links back to this one (same project, "Cropped from"); the original is not changed.
 * The shape starts at the one the project plans to crop to, when it has one.
 */
export function CropDialog({
  asset,
  title,
  project,
  onClose,
  initial,
}: {
  asset: string;
  title: string;
  project?: string;
  onClose: () => void;
  initial?: string;
}) {
  const app = useApp();
  const [img, setImg] = useState<HTMLImageElement | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const [shape, setShape] = useState<string>(
    () => known(initial) ?? known(project ? currentProject(project)?.frame : null) ?? '16:9',
  );
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setError('This image could not be loaded for cropping.');
    i.src = media.content(asset);
  }, [asset]);
  const ratio = shapes.find(([s]) => s === shape)![1];
  // The crop box: as large as fits, positioned by pos (0..1 along the free axis).
  const box = img
    ? (() => {
        const w = img.naturalWidth,
          h = img.naturalHeight;
        const cw = Math.min(w, h * ratio),
          ch = cw / ratio;
        return { x: (w - cw) * pos.x, y: (h - ch) * pos.y, w: cw, h: ch, W: w, H: h };
      })()
    : null;
  const freeX = box ? box.W - box.w > 1 : false,
    freeY = box ? box.H - box.h > 1 : false;
  async function render() {
    if (!img || !box) throw Error('Not loaded');
    const c = document.createElement('canvas');
    c.width = Math.round(box.w);
    c.height = Math.round(box.h);
    c.getContext('2d')!.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, bad) =>
      c.toBlob(b => (b ? ok(b) : bad(Error('Could not make the image.'))), 'image/png'),
    );
  }
  const name = `${title.replace(/[^\w\- ]+/g, '').trim() || 'image'} ${shape.replace(':', 'x')}.png`;
  async function save() {
    if (!box) return;
    setBusy('Saving…');
    setError('');
    try {
      const x = Math.max(0, Math.floor(box.x)),
        y = Math.max(0, Math.floor(box.y));
      await assetsApi.crop(asset, {
        x,
        y,
        width: Math.min(box.W - x, Math.round(box.w)),
        height: Math.min(box.H - y, Math.round(box.h)),
        shape,
      });
      if (project) void chooseFrame(project, shape).catch(() => {});
      app.toast(`Saved a ${shape} copy to the Library, linked to “${title}”`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  }
  async function download() {
    try {
      const url = URL.createObjectURL(await render());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const nudge = (dx: number, dy: number) =>
    setPos(p => ({ x: Math.min(1, Math.max(0, p.x + dx)), y: Math.min(1, Math.max(0, p.y + dy)) }));
  const view = 320;
  const scale = box ? Math.min(view / box.W, view / box.H) : 1;
  const where = freeX ? Math.round(pos.x * 100) : freeY ? Math.round(pos.y * 100) : 50;
  return (
    <Dialog
      title={'Crop “' + title + '”'}
      onClose={onClose}
      footer={
        <>
          <span className="faint" style={{ fontSize: '0.8125rem', marginRight: 'auto' }}>
            On this device, no GPU. The original stays as it is.
          </span>
          <button className="btn" disabled={!box || Boolean(busy)} onClick={() => void download()}>
            Download
          </button>
          <button className="btn primary" disabled={!box || Boolean(busy)} onClick={() => void save()}>
            {busy || 'Save copy to Library'}
          </button>
        </>
      }
    >
      <div className="seg" role="group" aria-label="Shape" style={{ flexWrap: 'wrap' }}>
        {shapes.map(([s]) => (
          <button
            key={s}
            aria-pressed={shape === s}
            onClick={() => {
              setShape(s);
              setPos({ x: 0.5, y: 0.5 });
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {box && img && (
        <div
          className="crop-stage"
          style={{ width: box.W * scale, height: box.H * scale }}
          onPointerDown={e => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
          }}
          onPointerMove={e => {
            const d = drag.current;
            if (!d) return;
            const fw = (box.W - box.w) * scale,
              fh = (box.H - box.h) * scale;
            setPos({
              x: fw ? Math.min(1, Math.max(0, d.px + (e.clientX - d.x) / fw)) : 0.5,
              y: fh ? Math.min(1, Math.max(0, d.py + (e.clientY - d.y) / fh)) : 0.5,
            });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        >
          <img src={img.src} alt="" draggable={false} />
          <div
            className="crop-box"
            role="slider"
            tabIndex={freeX || freeY ? 0 : -1}
            aria-label={freeX ? 'Crop position, left to right' : 'Crop position, top to bottom'}
            aria-orientation={freeX ? 'horizontal' : 'vertical'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={where}
            aria-valuetext={
              !freeX && !freeY
                ? 'The whole image fits this shape'
                : freeX
                  ? where < 34
                    ? `Left, ${where}%`
                    : where > 66
                      ? `Right, ${where}%`
                      : `Centre, ${where}%`
                  : where < 34
                    ? `Top, ${where}%`
                    : where > 66
                      ? `Bottom, ${where}%`
                      : `Middle, ${where}%`
            }
            onKeyDown={e => {
              const step = e.shiftKey ? 0.1 : 0.02;
              const moves: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              if (moves[e.key]) {
                e.preventDefault();
                nudge(...moves[e.key]!);
              } else if (e.key === 'Home') {
                e.preventDefault();
                setPos({ x: 0, y: 0 });
              } else if (e.key === 'End') {
                e.preventDefault();
                setPos({ x: 1, y: 1 });
              }
            }}
            style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }}
          />
        </div>
      )}
      {box && (
        <div className="crop-foot">
          <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
            {Math.round(box.w)} × {Math.round(box.h)} from {box.W} × {box.H}.{' '}
            {freeX || freeY
              ? 'Drag the frame, or focus it and use the arrow keys.'
              : 'The whole image fits this shape.'}
          </p>
          {(freeX || freeY) && (
            <div className="seg" role="group" aria-label="Place the frame">
              {(freeX
                ? [
                    ['Left', 0],
                    ['Centre', 0.5],
                    ['Right', 1],
                  ]
                : [
                    ['Top', 0],
                    ['Middle', 0.5],
                    ['Bottom', 1],
                  ]
              ).map(([label, v]) => (
                <button
                  key={label as string}
                  aria-pressed={(freeX ? pos.x : pos.y) === v}
                  onClick={() => setPos(freeX ? { x: v as number, y: 0.5 } : { x: 0.5, y: v as number })}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
