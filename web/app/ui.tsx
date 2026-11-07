import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as RadixDialog from '@radix-ui/react-dialog';
import { createPortal } from 'react-dom';
import { Streamdown } from 'streamdown';
import { Icon } from './icons.js';
import { media } from './api.js';

/** The last button, link or field the user pressed (a tap does not always focus it on touch screens). */
let lastPressed: HTMLElement | null = null;
if (typeof document !== 'undefined')
  document.addEventListener(
    'pointerdown',
    e => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        'button,a[href],[role=button],[role=tab],input,select,textarea',
      );
      if (el) lastPressed = el;
    },
    true,
  );
/** What opened an overlay: the focused control, or else the control just pressed. */
function openerNow(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body) return active;
  return lastPressed?.isConnected ? lastPressed : null;
}

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
  return (
    text
      .replace(toolMarkup, '')
      .replace(/\[([^\]]+)\]\(asset:[^)]+\)/g, '$1')
      .replace(/\$\s*\\([a-zA-Z]+)\s*\$/g, (m, name: string) => latex[name] ?? m)
      .replace(/\\(rightarrow|leftarrow|Rightarrow|times|approx)\b/g, (_m, name: string) => latex[name]!)
      // Engine field names that slip into a reply read as the app's own words.
      .replace(/`?\bfirst_frame\b`?/g, 'start frame')
      .replace(/\s*<\s*Subject\s*\d+\s*>/gi, '')
      .replace(/`?\blast_frame\b`?/g, 'end frame')
      .trim()
  );
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

/**
 * Keyboard for any role="tablist": Left/Right (and Home/End) move to the neighbouring tab and select it, the
 * WAI-ARIA "automatic activation" pattern. Put on the tablist; selected tabs should carry aria-selected.
 * Only the selected tab is in the Tab order (tabIndex), so Tab moves on to the panel.
 */
export function onTabKeys(e: React.KeyboardEvent<HTMLElement>) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])')];
  const at = tabs.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? tabs.length - 1
        : (at + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]!.click();
  tabs[next]!.focus();
}
export const tabStop = (selected: boolean, panel?: string, id?: string) => ({
  'aria-selected': selected,
  tabIndex: selected ? 0 : -1,
  ...(panel ? { 'aria-controls': panel } : {}),
  ...(id ? { id } : {}),
});

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
  const trigger = useRef<HTMLButtonElement>(null);
  // Inside a dialog or overlay the menu traps focus itself, so the layer's own trap waits instead of pulling focus back.
  const inLayer = useContext(Layered);
  return (
    <DropdownMenu.Root modal={inLayer}>
      <DropdownMenu.Trigger asChild>
        <button ref={trigger} className={className} aria-label={label} title={label} onClick={e => e.stopPropagation()}>
          {children}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          // Closing returns focus to the menu button, unless an item has already moved focus on purpose (a dialog).
          onCloseAutoFocus={e => {
            const active = document.activeElement;
            if (active && active !== document.body && !active.closest('[role=menu]')) {
              e.preventDefault();
              return;
            }
            e.preventDefault();
            trigger.current?.focus({ preventScroll: true });
          }}
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

/**
 * Dialogs and overlays open without a Radix trigger, so they remember what had focus and return there on close. If that
 * element was re-rendered meanwhile (a saved draft remounts), its replacement is found by the same accessible name; if it
 * is gone (a released GPU, a deleted picture), the page's heading takes focus, never nothing.
 */
function useReturnFocus() {
  const opener = useRef<{ el: HTMLElement | null; name: string | null }>({ el: null, name: null });
  if (!opener.current.el && typeof document !== 'undefined') {
    let el = openerNow();
    // Opened from a menu item: the item disappears with the menu, so return to the button that opened the menu.
    const trigger = el?.closest<HTMLElement>('[role="menu"]')?.getAttribute('aria-labelledby');
    if (trigger) el = document.getElementById(trigger) ?? el;
    if (el === document.body) el = null;
    opener.current = { el, name: el?.getAttribute('aria-label') ?? el?.textContent?.trim().slice(0, 60) ?? null };
  }
  return (e: Event) => {
    const { el, name } = opener.current;
    const target =
      (el?.isConnected ? el : null) ??
      (name
        ? (document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(name)}"]`) ??
          [...document.querySelectorAll<HTMLElement>('main button')].find(b => b.textContent?.trim() === name))
        : null) ??
      document.querySelector<HTMLElement>('main h1, main h2, [role="main"] h1');
    if (!target) return;
    e.preventDefault();
    if (target.matches('h1, h2') && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };
}

/**
 * A full-screen layer (the viewer, Compare, the projects drawer): a Radix dialog without the dialog frame. Tab stays
 * inside, Escape and a click outside close it, the page behind is hidden from focus and screen readers, and focus
 * returns to what opened it. Escape in a field is left to the field.
 */
export function Overlay({
  label,
  onClose,
  className,
  backdrop,
  onKeyDown,
  children,
}: {
  label: string;
  onClose: () => void;
  className: string;
  /** A backdrop around the layer (the drawer's); full-screen layers have none. */
  backdrop?: string;
  /** Keys pressed inside the layer itself (not in a field, a menu or a dialog opened from it). */
  onKeyDown?: (e: React.KeyboardEvent) => void;
  children: React.ReactNode;
}) {
  const returnFocus = useReturnFocus();
  const content = (
    <RadixDialog.Content
      className={className}
      aria-label={label}
      aria-describedby={undefined}
      onCloseAutoFocus={returnFocus}
      onEscapeKeyDown={e => {
        if ((e.target as HTMLElement).closest?.('input,textarea,select')) e.preventDefault();
      }}
      onKeyDown={e => {
        const target = e.target as HTMLElement;
        if (!onKeyDown || !e.currentTarget.contains(target) || target.closest('input,textarea,select,[role=menu]'))
          return;
        onKeyDown(e);
      }}
    >
      <RadixDialog.Title className="sr-only">{label}</RadixDialog.Title>
      <Layered.Provider value>{children}</Layered.Provider>
    </RadixDialog.Content>
  );
  return (
    <RadixDialog.Root open onOpenChange={open => !open && onClose()}>
      <RadixDialog.Portal>{backdrop ? <div className={backdrop}>{content}</div> : content}</RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Set inside dialogs and overlays. */
const Layered = createContext(false);

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
  const returnFocus = useReturnFocus();
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
            <div className="dialog-body">
              <Layered.Provider value>{children}</Layered.Provider>
            </div>
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
export class LocalBoundary extends React.Component<
  { label: string; children: React.ReactNode; onFailed?: (failed: boolean) => void; note?: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onFailed?.(true);
    void import('../client-failure.js').then(m => m.reportClientFailure(error, 'render')).catch(() => {});
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="notice error" role="alert">
        {this.props.label} couldn’t be shown. {this.props.note ?? 'Nothing was lost.'}{' '}
        <button
          className="link"
          onClick={() => {
            this.props.onFailed?.(false);
            this.setState({ failed: false });
          }}
        >
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

/**
 * While the phone writing sheet is open, everything behind it is inert: no focus, clicks or screen-reader reading leave
 * it. (Overlays and dialogs are Radix dialogs, which do this themselves.)
 */
export function useInertBehind(ref: React.RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const behind: HTMLElement[] = [];
    for (let el: HTMLElement | null = ref.current; el && el !== document.body; el = el.parentElement)
      for (const sib of Array.from(el.parentElement?.children ?? []))
        if (sib !== el && sib instanceof HTMLElement && !sib.inert && !sib.matches('[aria-live], .toasts')) {
          sib.inert = true;
          behind.push(sib);
        }
    return () => {
      for (const b of behind) b.inert = false;
    };
  }, [active]);
}
