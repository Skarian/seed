import React, { useEffect, useRef, useState } from 'react';
import { cropShapes } from '../project/checks.js';
import { media } from '../api.js';
import { Dialog } from '../ui.js';
import { useApp } from '../data.js';
import { uploadFile } from '../project/requests.js';

/** Crop shapes people ask for. "Original" keeps the frame and only re-exports. */
const shapes = cropShapes;

/** Crop an image on this device, no GPU: pick a shape, drag to frame, save a copy to the Library or download it. */
export function CropDialog({
  asset,
  title,
  onClose,
  initial,
}: {
  asset: string;
  title: string;
  onClose: () => void;
  initial?: string;
}) {
  const app = useApp();
  const [img, setImg] = useState<HTMLImageElement | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const [shape, setShape] = useState<string>(initial && shapes.some(([s]) => s === initial) ? initial : '1:1');
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
    setBusy('Saving…');
    setError('');
    try {
      const file = new File([await render()], name, { type: 'image/png', lastModified: Date.now() });
      await uploadFile(file, 'image', app.mode, setBusy);
      app.toast(`Saved a ${shape} copy to the Library`);
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
  const view = 320;
  const scale = box ? Math.min(view / box.W, view / box.H) : 1;
  return (
    <Dialog
      title={'Crop “' + title + '”'}
      onClose={onClose}
      footer={
        <>
          <span className="faint" style={{ fontSize: 12.5, marginRight: 'auto' }}>
            On this device. No GPU, the original stays as it is.
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
          <img src={img.src} alt={title} draggable={false} />
          <div
            className="crop-box"
            aria-label="Crop area. Drag to move."
            style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale }}
          />
        </div>
      )}
      {box && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {Math.round(box.w)} × {Math.round(box.h)} from {box.W} × {box.H}. Drag the frame to choose what stays.
        </p>
      )}
    </Dialog>
  );
}
