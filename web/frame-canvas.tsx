import React, { useLayoutEffect, useRef } from 'react';

// Keep the previous pixels on screen until the requested frame is decoded.
// Drawing original bitmaps at their native size avoids a lossy render target.
export function FrameCanvas({ bitmap, crop, frameId, frameIndex, original, onDisplay }: {
  crop?: {x:number;y:number;width:number;height:number};
  bitmap?: ImageBitmap; frameId: string; frameIndex: number;
  original: boolean; onDisplay: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (!bitmap || !canvas.current) return;
    const element = canvas.current, context = element.getContext('2d', { alpha: false });
    if (!context) return;
    const source=crop??{x:0,y:0,width:bitmap.width,height:bitmap.height};
    element.width=source.width;element.height=source.height;
    context.drawImage(bitmap,source.x,source.y,source.width,source.height,0,0,source.width,source.height);
    element.dataset.frame = frameId;
    element.dataset.quality = original ? 'original' : 'preview';
    element.setAttribute('aria-label', `Frame ${frameIndex + 1}`);
    if (original) onDisplay(frameId);
  }, [bitmap, crop, frameId, original, frameIndex, onDisplay]);
  return <canvas ref={canvas} role="img" aria-label="Loading frame" />;
}
