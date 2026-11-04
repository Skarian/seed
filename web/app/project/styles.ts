import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { StyleEntry } from './readiness.js';

const cache = new Map<string, StyleEntry[]>();
/** Styles (LoRAs) available in this content mode. Refreshes when Settings changes them. */
export function useStyles(mode: string) {
  const [items, setItems] = useState<StyleEntry[]>(cache.get(mode) ?? []);
  useEffect(() => {
    let live = true;
    const load = () => void api<{ items: Array<StyleEntry & { route: string }> }>('loras?mode=' + mode).then(r => { cache.set(mode, r.items); if (live) setItems(r.items); }).catch(() => {});
    load();
    // Styles added in another tab or window appear when you come back to this one.
    const visible = () => { if (document.visibilityState === 'visible') load(); };
    addEventListener('seed:styles-changed', load); addEventListener('focus', load); document.addEventListener('visibilitychange', visible);
    return () => { live = false; removeEventListener('seed:styles-changed', load); removeEventListener('focus', load); document.removeEventListener('visibilitychange', visible); };
  }, [mode]);
  return items;
}
