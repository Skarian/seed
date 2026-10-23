import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { defaultPreferences, type GeneratePreferences, type ResolutionFamily, type ResolutionSize } from '../shared/resolution.js';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type PreferencesContext = {
  preferences?: GeneratePreferences;
  candidates: boolean;
  error: string;
  status: Record<ResolutionFamily, SaveState>;
  refresh: () => Promise<void>;
  remember: (family: ResolutionFamily, size: ResolutionSize) => void;
};
const Context = createContext<PreferencesContext>({ candidates: false, error: '', status: { image: 'idle', video: 'idle' }, refresh: async () => {}, remember: () => {} });
export const useGeneratePreferences = () => useContext(Context);

/** One preference owner for Generate and availability information for the shared editor. */
export function GeneratePreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<GeneratePreferences>();
  const [candidates, setCandidates] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Record<ResolutionFamily, SaveState>>({ image: 'idle', video: 'idle' });
  const intents = useRef<Partial<GeneratePreferences>>({});
  const versions = useRef({ image: 0, video: 0 });
  const queue = useRef(Promise.resolve());
  const readVersion = useRef(0);
  const appliedReads = useRef(0);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    const version = ++readVersion.current;
    try {
      const response = await fetch('/api/v1/generate-preferences');
      const data = await response.json();
      if (!response.ok) throw Error(data.error?.message ?? 'Remembered resolution unavailable.');
      if (!alive.current || version !== readVersion.current) return;
      setPreferences({ ...data.preferences, ...intents.current });
      appliedReads.current++;
      setCandidates(data.candidates === true);
      setError('');
    } catch {
      if (alive.current && version === readVersion.current) setError('Remembered resolution unavailable. Choose a resolution or retry loading.');
    }
  }, []);
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, [refresh]);
  const remember = useCallback((family: ResolutionFamily, size: ResolutionSize) => {
    const version = ++versions.current[family];
    ++readVersion.current;
    intents.current = { ...intents.current, [family]: size };
    setPreferences(value => ({ ...(value ?? defaultPreferences), [family]: size } as GeneratePreferences));
    setStatus(value => ({ ...value, [family]: 'saving' }));
    queue.current = queue.current.catch(() => {}).then(async () => {
      const readsAtStart = appliedReads.current;
      try {
        const response = await fetch('/api/v1/generate-preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [family]: size }) });
        const data = await response.json();
        if (!response.ok) throw Error(data.error?.message ?? 'Selection not remembered.');
        if (!alive.current || version !== versions.current[family]) return;
        ++readVersion.current;
        delete intents.current[family];
        setCandidates(data.candidates === true);
        const readDuringSave = appliedReads.current !== readsAtStart;
        setPreferences(current => ({ ...(readDuringSave ? current : data.preferences), [family]: size, ...intents.current } as GeneratePreferences));
        setStatus(value => ({ ...value, [family]: 'saved' }));
        setError('');
      } catch {
        if (alive.current && version === versions.current[family]) setStatus(value => ({ ...value, [family]: 'error' }));
      }
    });
  }, []);
  return <Context.Provider value={{ preferences, candidates, error, status, refresh, remember }}>{children}</Context.Provider>;
}
