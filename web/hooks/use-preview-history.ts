import {useEffect, useRef} from 'react';
import {clientId} from '../identity.js';

const key = 'seedMediaPreviews';
const stack = (): string[] => history.state?.[key] ?? [];

/** One back step dismisses the top preview, without changing the page beneath it. */
export function usePreviewHistory(onClose: () => void, enabled = true) {
  const callback = useRef(onClose);
  callback.current = onClose;
  const entry = useRef({id: clientId(), registered: false, mounted: false, closing: false, after: undefined as (() => void) | undefined});

  useEffect(() => {
    if (!enabled) return;
    const current = entry.current;
    current.mounted = true;
    if (!current.registered) {
      history.pushState({...history.state, [key]: [...stack(), current.id]}, '');
      current.registered = true;
    }
    const pop = () => {
      if (stack().includes(current.id)) return;
      current.registered = false;
      callback.current();
      current.after?.();
      current.after = undefined;
    };
    window.addEventListener('popstate', pop);
    return () => {
      current.mounted = false;
      window.removeEventListener('popstate', pop);
      // React StrictMode immediately reattaches the effect. Only unwind a real unmount.
      queueMicrotask(() => {
        if (!current.mounted && stack().at(-1) === current.id) history.back();
      });
    };
  }, [enabled]);

  return (after?: () => void) => {
    const current = entry.current;
    if (current.closing) return;
    current.closing = true;
    if (stack().at(-1) === current.id) {
      current.after = after;
      history.back();
    } else {
      callback.current();
      after?.();
    }
  };
}
