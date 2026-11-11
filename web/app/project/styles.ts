import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { stylesChanged } from '../data.js';
import type { StyleEntry } from './readiness.js';

const cache = new Map<string, StyleEntry[]>();
/** Styles (LoRAs) available in this content mode. Refreshes when Settings changes them. */
export function useStyles(mode: string) {
  const [items, setItems] = useState<StyleEntry[]>(cache.get(mode) ?? []);
  const load = useCallback(
    () =>
      void api<{ items: Array<StyleEntry & { route: string }> }>('loras?mode=' + mode)
        .then(r => {
          cache.set(mode, r.items);
          setItems(r.items);
        })
        .catch(() => {}),
    [mode],
  );
  useEffect(() => {
    load();
    // Styles added in another tab or window appear when you come back to this one.
    const visible = () => {
      if (document.visibilityState === 'visible') load();
    };
    addEventListener('focus', load);
    document.addEventListener('visibilitychange', visible);
    return () => {
      removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load]);
  stylesChanged.useHear(load, [load]);
  return items;
}
