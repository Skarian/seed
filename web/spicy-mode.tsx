import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useToaster, resolveValue } from 'react-hot-toast/headless';
import type { LibraryAsset } from '../shared/studio.js';

export function presentAsset(asset: LibraryAsset): LibraryAsset {
  return { ...asset, name: asset.name.replace(/^(Image|Video) · (SFW|NSFW|Standard|Spicy)$/, '$1') };
}

const SpicyContext = createContext({ spicy: false, setSpicy: (_value: boolean) => {} });
export const useSpicy = () => useContext(SpicyContext);

export function SpicyProvider({ children }: { children: React.ReactNode }) {
  const [spicy, update] = useState(() => {
    try { return sessionStorage.getItem('seed.spicy') === 'true'; } catch { return false; }
  });
  function setSpicy(value: boolean) {
    update(value);
    try { sessionStorage.setItem('seed.spicy', String(value)); } catch { /* Keep working in memory. */ }
  }
  return <SpicyContext.Provider value={{ spicy, setSpicy }}>
    {children}
    <ModeToasts />
  </SpicyContext.Provider>;
}

function ModeToasts() {
  const { toasts } = useToaster({ duration: 2000, removeDelay: 200 });
  return <div className="mode-toasts">
    {toasts.map(item => <div key={`${item.id}-${item.createdAt}`} className={`mode-toast ${item.className ?? ""} ${item.visible ? "is-visible" : "is-exiting"}`} {...item.ariaProps} aria-hidden={!item.visible}>
      {(item.icon||item.type==='success')&&<span className="mode-toast-icon" aria-hidden="true">{item.icon??<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6"/></svg>}</span>}
      <span>{resolveValue(item.message, item)}</span>
    </div>)}
  </div>;
}

export function SpicyBrand({ children, onNavigate, expanded }: { children: React.ReactNode; expanded?:boolean; onNavigate: () => void }) {
  const { spicy, setSpicy } = useSpicy();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  function cancel() { clearTimeout(timer.current); timer.current = undefined; }
  function start() {
    cancel(); held.current = false;
    timer.current = setTimeout(() => { held.current = true; setSpicy(!spicy); }, 800);
  }
  useEffect(() => cancel, []);
  return <div className="brand-controls">
    <button className="brand" aria-label="Seed" aria-haspopup={expanded===undefined?undefined:"menu"} aria-expanded={expanded} type="button"
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        origin.current = { x: event.clientX, y: event.clientY }; start();
      }}
      onPointerMove={event => {
        if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) cancel();
      }}
      onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel} onBlur={cancel}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) start(); }
      }}
      onKeyUp={event => {
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); cancel(); if (!held.current) onNavigate(); }
      }}
      onClick={() => { if (!held.current) onNavigate(); }}>
      {children}
    </button>
    {spicy && <button className="spicy-off" type="button" aria-label="Return to Seed" title="Return to Seed" onClick={() => setSpicy(false)}>🌶️</button>}
  </div>;
}
