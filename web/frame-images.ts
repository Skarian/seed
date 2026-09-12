import { useEffect, useRef, useState } from 'react';
import type { FrameSequence } from '../shared/studio.js';

type Entry = { bitmap: ImageBitmap; bytes: number };
const BUDGET = 96 * 1024 * 1024;

// Previews travel in 24-frame sheets. Keep a bounded decoded buffer and two
// requests in flight, prioritizing the current sheet on every seek.
class FrameBuffer {
  private cache = new Map<string, Entry>();
  private pending = new Map<string, AbortController>();
  private failed = new Map<string, string>();
  private queue: string[] = [];
  private bytes = 0;
  private disposed = false;
  private target = '';
  private originalTimer?: ReturnType<typeof setTimeout>;
  constructor(private sequence: FrameSequence, private changed: () => void) {}
  seek(frames: FrameSequence['frames'], index: number, retry: boolean) {
    this.target = frames[index]?.id ?? '';
    if (retry) this.failed.clear();
    clearTimeout(this.originalTimer);
    const page = Math.floor(index / 24), total = Math.ceil(frames.length / 24);
    this.queue = Array.from({length:total},(_,i)=>i).sort((a,b)=>Math.abs(a-page)-Math.abs(b-page)).map(i=>'preview:'+i);
    this.pump();
    this.originalTimer = setTimeout(() => {
      // Originals use a separate slot so a fast scrub cannot leave them behind
      // a long preview queue. Only the settled frame gets a new full-size fetch.
      for (const [key, controller] of this.pending) {
        if (key.startsWith('original:') && key !== 'original:' + this.target) controller.abort();
      }
      void this.load('original:' + this.target);
    }, 100);
  }
  private pump() {
    if (this.disposed) return;
    let active = [...this.pending.keys()].filter(k => k.startsWith('preview:')).length;
    while (active < 2 && this.queue.length) {
      const key = this.queue.shift()!;
      if (this.cache.has(key) || this.pending.has(key) || this.failed.has(key)) continue;
      active++; void this.load(key);
    }
  }
  private async load(key: string) {
    if (this.disposed || this.cache.has(key) || this.pending.has(key) || this.failed.has(key)) return;
    const [quality, id] = key.split(':') as [string, string];
    if (!id) return;
    const controller = new AbortController(); this.pending.set(key, controller);
    try {
      const response = await fetch(quality === 'original' ? '/api/v1/assets/' + id + '/content' : '/api/v1/sequences/'+this.sequence.id+'/preview/'+id+'?revision='+this.sequence.revision, { signal: controller.signal });
      if (!response.ok) throw Error('Could not load frame.');
      const bitmap = await createImageBitmap(await response.blob());
      if (this.disposed || controller.signal.aborted) { bitmap.close(); return; }
      const bytes = bitmap.width * bitmap.height * 4;
      this.cache.set(key, { bitmap, bytes }); this.bytes += bytes;
      for (const [old, entry] of this.cache) {
        if (this.bytes <= BUDGET) break;
        if (old === key || old === 'original:' + this.target || old === 'preview:' + Math.floor(this.sequence.frames.findIndex(f=>f.id===this.target)/24)) continue;
        entry.bitmap.close(); this.bytes -= entry.bytes; this.cache.delete(old);
      }
      if (id === this.target || quality==='preview') this.changed();
    } catch (e) {
      if (!this.disposed && !controller.signal.aborted) { this.failed.set(key, (e as Error).message); if (id === this.target || quality==='preview') this.changed(); }
    } finally { this.pending.delete(key); this.pump(); }
  }
  get(id: string) {
    const index=this.sequence.frames.findIndex(f=>f.id===id), page=Math.floor(index/24);
    const quality = this.cache.has('original:' + id) ? 'original' : 'preview';
    const key = quality === 'original' ? 'original:'+id : 'preview:'+page, entry = this.cache.get(key);
    if (entry) { this.cache.delete(key); this.cache.set(key, entry); }
    const first=this.sequence.frames[0], scale=first?320/Math.max(first.width,first.height):1;
    const w=Math.round((first?.width??1)*scale), h=Math.round((first?.height??1)*scale);
    const crop=quality==='preview'?{x:(index%24%6)*w,y:Math.floor(index%24/6)*h,width:w,height:h}:undefined;
    const buffering=[...this.pending.keys()].some(k=>k.startsWith('preview:')) || this.queue.some(k=>!this.cache.has(k)&&!this.failed.has(k));
    return { bitmap: entry?.bitmap, crop, quality, buffering, error: this.failed.get('original:' + id) ?? '' };
  }
  close() {
    this.disposed = true; clearTimeout(this.originalTimer);
    for (const controller of this.pending.values()) controller.abort();
    for (const entry of this.cache.values()) entry.bitmap.close();
    this.cache.clear(); this.queue = [];
  }
}

export function useFrameImage(sequence: FrameSequence | null, index: number, retry: number) {
  const buffer = useRef<FrameBuffer | null>(null), lastRetry = useRef(retry);
  const [, refresh] = useState(0);
  useEffect(() => {
    buffer.current = sequence ? new FrameBuffer(sequence, () => refresh(n => n + 1)) : null;
    return () => { buffer.current?.close(); buffer.current = null; };
  }, [sequence?.id, sequence?.revision]);
  useEffect(() => {
    buffer.current?.seek(sequence?.frames ?? [], index, retry !== lastRetry.current);
    lastRetry.current = retry;
  }, [sequence, index, retry]);
  return buffer.current?.get(sequence?.frames[index]?.id ?? '') ?? {bitmap:undefined, crop:undefined, quality:'preview', buffering:true, error:''};
}
