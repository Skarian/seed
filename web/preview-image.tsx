import React from 'react';
import {useImageZoom} from './hooks/use-image-zoom.js';

export function PreviewImage({src, name, onLoad,onSwipe}: {src: string; name: string; onLoad: React.ReactEventHandler<HTMLImageElement>;onSwipe?:(direction:-1|1)=>void}) {
  const zoom = useImageZoom(onSwipe);
  return <div className="preview-image">
    <div ref={zoom.surface} className={'preview-image-surface' + (zoom.view.scale > 1 ? ' is-zoomed' : '')} {...zoom.handlers}>
      <img ref={zoom.image} src={src} alt={name} draggable={false} onLoad={onLoad}
        style={{transform: `translate(${zoom.view.x}px, ${zoom.view.y}px) scale(${zoom.view.scale})`}} />
    </div>
    {zoom.view.scale > 1 && <button type="button" className="preview-zoom-reset" aria-label="Reset zoom" onClick={zoom.reset}>Reset zoom · {Math.round(zoom.view.scale * 100)}%</button>}
  </div>;
}
