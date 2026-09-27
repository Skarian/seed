import {useEffect, useRef, useState, type PointerEvent} from 'react';
import {usePreviewSwipe} from './use-preview-swipe.js';

type Point = {x: number; y: number};
type View = Point & {scale: number};
const fitted: View = {scale: 1, x: 0, y: 0};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});

export function useImageZoom(onSwipe?:(direction:-1|1)=>void) {
  const surface = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const current = useRef<View>(fitted);
  const [view, setView] = useState(fitted);
  const swipe=usePreviewSwipe(onSwipe);

  function update(next: View) {
    const box = surface.current, img = image.current;
    if (!box || !img?.naturalWidth) return;
    const fit = Math.min(box.clientWidth / img.naturalWidth, box.clientHeight / img.naturalHeight);
    const limitX = Math.max(0, (img.naturalWidth * fit * next.scale - box.clientWidth) / 2);
    const limitY = Math.max(0, (img.naturalHeight * fit * next.scale - box.clientHeight) / 2);
    current.current = {...next, x: Math.max(-limitX, Math.min(limitX, next.x)), y: Math.max(-limitY, Math.min(limitY, next.y))};
    setView(current.current);
  }
  function reset() { pointers.current.clear(); current.current = fitted; setView(fitted); }
  useEffect(() => {
    const observer = new ResizeObserver(reset);
    if (surface.current) observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);

  function point(event: PointerEvent): Point {
    const rect = surface.current!.getBoundingClientRect();
    return {x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2};
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if(current.current.scale===1)swipe.onPointerDown(event);else swipe.onPointerCancel();
    if (event.button !== 0 || pointers.current.size >= 2) return;
    pointers.current.set(event.pointerId, point(event));
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    swipe.onPointerMove(event);
    if (!pointers.current.has(event.pointerId)) return;
    const before = [...pointers.current.values()], previous = pointers.current.get(event.pointerId)!;
    const next = point(event), value = current.current;
    pointers.current.set(event.pointerId, next);
    if (before.length === 2) {
      const after = [...pointers.current.values()];
      const start = midpoint(before[0]!, before[1]!), end = midpoint(after[0]!, after[1]!);
      const scale = Math.max(1, Math.min(6, value.scale * distance(after[0]!, after[1]!) / Math.max(1, distance(before[0]!, before[1]!))));
      const ratio = scale / value.scale;
      update({scale, x: end.x - (start.x - value.x) * ratio, y: end.y - (start.y - value.y) * ratio});
    } else if (value.scale > 1) update({...value, x: value.x + next.x - previous.x, y: value.y + next.y - previous.y});
  }
  function end(event: PointerEvent) { pointers.current.delete(event.pointerId); }

  return {surface, image, view, reset, handlers: {
    onPointerDown: down, onPointerMove: move,
    onClickCapture:swipe.onClickCapture,
    onPointerUp:(event:PointerEvent<HTMLDivElement>)=>{end(event);swipe.onPointerUp(event);},
    onPointerCancel:(event:PointerEvent<HTMLDivElement>)=>{end(event);swipe.onPointerCancel();},
    onLostPointerCapture:(event:PointerEvent<HTMLDivElement>)=>{end(event);swipe.onLostPointerCapture();},
    onDoubleClick: () => view.scale > 1 ? reset() : update({scale: 2.5, x: 0, y: 0}),
  }};
}
