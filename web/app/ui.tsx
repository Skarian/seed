import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as RadixDialog from '@radix-ui/react-dialog';
import { createPortal } from 'react-dom';
import { Streamdown } from 'streamdown';
import { Icon } from './icons.js';
import { media } from './api.js';

/* ---------- Markdown for Seed's replies ---------- */
const mdComponents = {
  a: ({ href, children }: any) => (
    <a href={href && /^(https?:|mailto:)/i.test(href) ? href : undefined} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ alt }: any) => <span>{alt || 'Image'}</span>,
};
/** Tool-call markup a model sometimes writes as text. It is never shown. */
export const toolMarkup = /<\|?tool_call\|?>[\s\S]*?(<\|?\/?tool_call\|?>|$)|call:[a-z_.]+\{[\s\S]*$/i;
/** Simple LaTeX the model sometimes writes for arrows and symbols, shown as the characters they mean. */
const latex: Record<string, string> = {
  rightarrow: '→',
  to: '→',
  leftarrow: '←',
  Rightarrow: '⇒',
  times: '×',
  approx: '≈',
  le: '≤',
  ge: '≥',
  pm: '±',
  cdot: '·',
  degree: '°',
};
export function cleanReply(text: string) {
  return text
    .replace(toolMarkup, '')
    .replace(/\[([^\]]+)\]\(asset:[^)]+\)/g, '$1')
    .replace(/\$\s*\\([a-zA-Z]+)\s*\$/g, (m, name: string) => latex[name] ?? m)
    .replace(/\\(rightarrow|leftarrow|Rightarrow|times|approx)\b/g, (_m, name: string) => latex[name]!)
    .trim();
}
export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className="md">
      <Streamdown
        mode={streaming ? 'streaming' : 'static'}
        isAnimating={streaming}
        controls={false}
        components={mdComponents}
        rehypePlugins={[]}
        skipHtml
      >
        {text}
      </Streamdown>
    </div>
  );
}

/* ---------- Menu anchored to a button (Radix: keyboard navigation, typeahead, focus return, roles) ---------- */
export type MenuItem =
  | { label: string; hint?: string; onSelect: () => void; danger?: boolean; checked?: boolean; disabled?: boolean }
  | 'divider';
export function MenuButton({
  label,
  items,
  children,
  className = 'icon-btn',
  align = 'end',
  placement = 'below',
}: {
  label: string;
  items: MenuItem[];
  children: React.ReactNode;
  className?: string;
  align?: 'start' | 'end';
  placement?: 'below' | 'above';
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className={className} aria-label={label} title={label} onClick={e => e.stopPropagation()}>
          {children}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="menu"
          side={placement === 'above' ? 'top' : 'bottom'}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          onClick={e => e.stopPropagation()}
        >
          {items.map((item, i) =>
            item === 'divider' ? (
              <DropdownMenu.Separator key={i} className="menu-sep" />
            ) : item.checked === undefined ? (
              <DropdownMenu.Item
                key={i}
                disabled={item.disabled}
                className={'menu-item' + (item.danger ? ' danger' : '')}
                onSelect={() => item.onSelect()}
              >
                <span>
                  {item.label}
                  {item.hint && <small>{item.hint}</small>}
                </span>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.CheckboxItem
                key={i}
                checked={item.checked}
                disabled={item.disabled}
                className={'menu-item' + (item.danger ? ' danger' : '')}
                onSelect={() => item.onSelect()}
              >
                <span>
                  {item.label}
                  {item.hint && <small>{item.hint}</small>}
                </span>
              </DropdownMenu.CheckboxItem>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ---------- Dialog, a bottom sheet on phones (Radix: focus trap and return, Escape, labelling, scroll lock) ---------- */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide = false,
  sheet = true,
  label,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  sheet?: boolean;
  label?: string;
}) {
  // These dialogs open without a Radix trigger, so remember what had focus and return there on close. If that
  // element was re-rendered meanwhile (a saved draft remounts), find its replacement by the same accessible name.
  const opener = useRef<{ el: HTMLElement | null; name: string | null }>({ el: null, name: null });
  if (!opener.current.el && typeof document !== 'undefined') {
    const el = document.activeElement as HTMLElement | null;
    opener.current = { el, name: el?.getAttribute('aria-label') ?? null };
  }
  const returnFocus = (e: Event) => {
    const { el, name } = opener.current;
    const target = el?.isConnected
      ? el
      : name
        ? document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(name)}"]`)
        : null;
    if (target) {
      e.preventDefault();
      target.focus({ preventScroll: true });
    }
  };
  return (
    <RadixDialog.Root
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <RadixDialog.Portal>
        <div className={`backdrop ${sheet ? 'sheet' : ''}`}>
          <RadixDialog.Content
            className={`dialog ${wide ? 'wide' : ''}`}
            aria-describedby={undefined}
            {...(label ? { 'aria-label': label } : {})}
            onCloseAutoFocus={returnFocus}
            onOpenAutoFocus={e => {
              const node = e.currentTarget as HTMLElement | null;
              const first = node?.querySelector<HTMLElement>(
                '[autofocus], input, textarea, select, button:not(.close)',
              );
              if (first) {
                e.preventDefault();
                first.focus({ preventScroll: true });
              }
            }}
          >
            <div className="dialog-head">
              <RadixDialog.Title asChild>
                <h2>{title}</h2>
              </RadixDialog.Title>
              <RadixDialog.Close asChild>
                <button className="icon-btn close" aria-label="Close">
                  <Icon.Close />
                </button>
              </RadixDialog.Close>
            </div>
            <div className="dialog-body">{children}</div>
            {footer && <div className="dialog-foot">{footer}</div>}
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
export function Confirm({
  title,
  body,
  action,
  danger = false,
  onConfirm,
  onClose,
  busy = false,
}: {
  title: string;
  body: React.ReactNode;
  action: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={onConfirm}>
            {action}
          </button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}

/* ---------- Media ---------- */
export function Media({
  id,
  kind,
  alt,
  large = false,
  controls = false,
  autoPlay = false,
}: {
  id: string;
  kind: 'image' | 'video' | 'audio';
  alt: string;
  large?: boolean;
  controls?: boolean;
  autoPlay?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (kind === 'image')
    return failed ? (
      <img src={media.content(id)} alt={alt} loading="lazy" />
    ) : (
      <img src={media.preview(id, large)} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    );
  if (kind === 'video')
    return (
      <video
        src={media.content(id) + '#t=0.1'}
        aria-label={alt}
        preload="metadata"
        muted={!controls}
        playsInline
        controls={controls}
        autoPlay={autoPlay}
        loop={!controls}
      />
    );
  return (
    <div className="placeholder">
      <audio src={media.content(id)} controls aria-label={alt} />
    </div>
  );
}
export function Thumb({ id, kind, alt }: { id: string; kind: 'image' | 'video' | 'audio'; alt: string }) {
  if (kind === 'image') return <img src={media.preview(id)} alt={alt} loading="lazy" />;
  if (kind === 'video')
    return <video src={media.content(id) + '#t=0.1'} aria-label={alt} preload="metadata" muted playsInline />;
  return (
    <span className="ph" aria-label={alt}>
      ♪
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="statusline" role="status">
      <span className="dot live" />
      {label}
    </span>
  );
}

/** Keeps a failure inside one card: the rest of the project, navigation and GPUs stay usable. */
export class LocalBoundary extends React.Component<{ label: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    void import('../client-failure.js').then(m => m.reportClientFailure(error, 'render')).catch(() => {});
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="notice error" role="alert">
        {this.props.label} couldn't be shown. Everything else is fine.{' '}
        <button className="link" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}

/** Downloads a result under a readable name ("moss-and-kettle-storefront-2.png") instead of its storage id. */
export async function downloadAsset(id: string, title: string) {
  let ext = '';
  try {
    const head = await fetch(media.content(id), { method: 'HEAD' });
    const type = head.headers.get('content-type') ?? '';
    ext =
      (
        {
          'image/png': '.png',
          'image/jpeg': '.jpg',
          'image/webp': '.webp',
          'video/mp4': '.mp4',
          'video/webm': '.webm',
          'audio/mpeg': '.mp3',
          'audio/wav': '.wav',
          'audio/x-wav': '.wav',
        } as Record<string, string>
      )[type.split(';')[0]!.trim()] ?? '';
  } catch {
    /* keep the server's name */
  }
  const slug =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'seed-result';
  // The server names files by id in its response headers; fetching the bytes lets the readable name win.
  const blob = await (await fetch(media.content(id))).blob();
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = slug + ext;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
