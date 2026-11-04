import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Streamdown } from 'streamdown';
import { Icon } from './icons.js';
import { media } from './api.js';

/* ---------- Markdown for Seed's replies ---------- */
const mdComponents = {
  a: ({ href, children }: any) => <a href={href && /^(https?:|mailto:)/i.test(href) ? href : undefined} target="_blank" rel="noopener noreferrer">{children}</a>,
  img: ({ alt }: any) => <span>{alt || 'Image'}</span>,
};
/** Tool-call markup a model sometimes writes as text. It is never shown. */
export const toolMarkup = /<\|?tool_call\|?>[\s\S]*?(<\|?\/?tool_call\|?>|$)|call:[a-z_.]+\{[\s\S]*$/i;
export function cleanReply(text: string) { return text.replace(toolMarkup, '').replace(/\[([^\]]+)\]\(asset:[^)]+\)/g, '$1').trim(); }
export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return <div className="md"><Streamdown mode={streaming ? 'streaming' : 'static'} isAnimating={streaming} controls={false} components={mdComponents} rehypePlugins={[]} skipHtml>{text}</Streamdown></div>;
}

/* ---------- Popover menu anchored to a button ---------- */
export type MenuItem = { label: string; hint?: string; onSelect: () => void; danger?: boolean; checked?: boolean; disabled?: boolean } | 'divider';
export function MenuButton({ label, items, children, className = 'icon-btn', align = 'end', placement = 'below' }: { label: string; items: MenuItem[]; children: React.ReactNode; className?: string; align?: 'start' | 'end'; placement?: 'below' | 'above' }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!open) setPos({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' });
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect(), w = Math.min(280, innerWidth - 16);
    const left = align === 'end' ? Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) : Math.max(8, Math.min(r.left, innerWidth - w - 8));
    const above = placement === 'above' || r.bottom + 320 > innerHeight;
    setPos({ position: 'fixed', left, width: w, maxHeight: Math.max(160, above ? r.top - 16 : innerHeight - r.bottom - 16), overflowY: 'auto', ...(above ? { bottom: innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
  }, [open, align, placement]);
  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'); requestAnimationFrame(() => first?.focus({ preventScroll: true }));
    const close = (e: Event) => { if (!menu.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); anchor.current?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])], i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); e.preventDefault();
      }
    };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  return <>
    <button ref={anchor} className={className} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>{children}</button>
    {open && createPortal(<div ref={menu} className="menu" role="menu" style={pos}>
      {items.map((item, i) => item === 'divider' ? <hr key={i} /> : <button key={i} role={item.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={item.checked} disabled={item.disabled} className={item.danger ? 'danger' : ''} onClick={e => { e.stopPropagation(); setOpen(false); item.onSelect(); }}>
        <span>{item.label}{item.hint && <small>{item.hint}</small>}</span>
      </button>)}
    </div>, document.body)}
  </>;
}

/* ---------- Dialog (a bottom sheet on phones) ---------- */
export function Dialog({ title, onClose, children, footer, wide = false, sheet = true, label }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; sheet?: boolean; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current; node?.querySelector<HTMLElement>('[autofocus], input, textarea, select, button:not(.close)')?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && node) {
        const f = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')];
        if (!f.length) return; const first = f[0]!, last = f.at(-1)!;
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); opener?.focus?.(); };
  }, []);
  return createPortal(<div className={`backdrop ${sheet ? 'sheet' : ''}`} onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={ref} className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
      <div className="dialog-head"><h2>{title}</h2><button className="icon-btn close" aria-label="Close" onClick={onClose}><Icon.Close /></button></div>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-foot">{footer}</div>}
    </div>
  </div>, document.body);
}
export function Confirm({ title, body, action, danger = false, onConfirm, onClose, busy = false }: { title: string; body: React.ReactNode; action: string; danger?: boolean; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  return <Dialog title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={onConfirm}>{action}</button></>}>{body}</Dialog>;
}

/* ---------- Media ---------- */
export function Media({ id, kind, alt, large = false, controls = false, autoPlay = false }: { id: string; kind: 'image' | 'video' | 'audio'; alt: string; large?: boolean; controls?: boolean; autoPlay?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (kind === 'image') return failed ? <img src={media.content(id)} alt={alt} loading="lazy" /> : <img src={media.preview(id, large)} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  if (kind === 'video') return <video src={media.content(id) + '#t=0.1'} aria-label={alt} preload="metadata" muted={!controls} playsInline controls={controls} autoPlay={autoPlay} loop={!controls} />;
  return <div className="placeholder"><audio src={media.content(id)} controls aria-label={alt} /></div>;
}
export function Thumb({ id, kind, alt }: { id: string; kind: 'image' | 'video' | 'audio'; alt: string }) {
  if (kind === 'image') return <img src={media.preview(id)} alt={alt} loading="lazy" />;
  if (kind === 'video') return <video src={media.content(id) + '#t=0.1'} aria-label={alt} preload="metadata" muted playsInline />;
  return <span className="ph" aria-label={alt}>♪</span>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) { return <span className="statusline" role="status"><span className="dot live" />{label}</span>; }

/** Keeps a failure inside one card: the rest of the project, navigation and GPUs stay usable. */
export class LocalBoundary extends React.Component<{ label: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { void import('../client-failure.js').then(m => m.reportClientFailure(error, 'render')).catch(() => {}); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="notice error" role="alert">{this.props.label} couldn't be shown. Everything else is fine. <button className="link" onClick={() => this.setState({ failed: false })}>Try again</button></div>;
  }
}

/** Downloads a result under a readable name ("moss-and-kettle-storefront-2.png") instead of its storage id. */
export async function downloadAsset(id: string, title: string) {
  let ext = '';
  try { const head = await fetch(media.content(id), { method: 'HEAD' }); const type = head.headers.get('content-type') ?? ''; ext = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav' } as Record<string, string>)[type.split(';')[0]!.trim()] ?? ''; } catch { /* keep the server's name */ }
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'seed-result';
  // The server names files by id in its response headers; fetching the bytes lets the readable name win.
  const blob = await (await fetch(media.content(id))).blob();
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = slug + ext; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
