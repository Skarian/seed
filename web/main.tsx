import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { LibraryAsset, StudioSnapshot, WorkflowId } from '../shared/studio.js';
import './style.css';
import { ReferenceInputs, useReferences } from './references.js';

const workflows: Record<WorkflowId, { title: string; placeholder: string }> = {
  'text-to-image': { title: 'Text to image', placeholder: 'Describe your image…' },
  'image-to-image': { title: 'Image to image', placeholder: 'Describe what to change…' },
  'text-to-video': { title: 'Text to video', placeholder: 'Describe the scene, movement and sound…' },
  'reference-to-video': { title: 'Reference to video', placeholder: 'Describe the scene using your references…' },
};
type Draft = { prompt: string; aspect: '16:9' | '9:16'; duration: '5' | '10' | '15'; mode: 'sfw' | 'nsfw'; count: number; randomSeed: boolean; seed: string };
const emptyDraft = (): Draft => ({ prompt: '', aspect: '16:9', duration: '5', mode: 'sfw', count: 1, randomSeed: true, seed: '0' });
function loadDrafts(): Partial<Record<WorkflowId, Draft>> {
  try {
    const saved = JSON.parse(localStorage.getItem('seed.drafts.v2') ?? localStorage.getItem('studio.drafts.v2') ?? '{}');
    const legacy = JSON.parse(localStorage.getItem('studio.drafts.v1') ?? '{}');
    const result: Partial<Record<WorkflowId, Draft>> = {};
    for (const id of Object.keys(workflows) as WorkflowId[]) {
      const entry = saved?.[id];
      result[id] = {
        prompt: typeof entry?.prompt === 'string' ? entry.prompt : typeof legacy?.[id] === 'string' ? legacy[id] : '',
        aspect: entry?.aspect === '9:16' ? '9:16' : '16:9',
        duration: entry?.duration === '10' || entry?.duration === '15' ? entry.duration : '5',
        mode: entry?.mode === 'nsfw' ? 'nsfw' : 'sfw',
        count: Number.isInteger(entry?.count) && entry.count >= 1 && entry.count <= 16 ? entry.count : 1,
        randomSeed: entry?.randomSeed !== false,
        seed: typeof entry?.seed === 'string' ? entry.seed : '0',
      };
    }
    return result;
  } catch { return {}; }
}
function SeedMark() {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="7" y="5" width="19" height="22" rx="3" transform="rotate(12 16 16)" /><rect x="6" y="5" width="19" height="22" rx="3" transform="rotate(-12 16 16)" /></svg>;
}
function Icon({ name }: { name: 'reset' | 'jobs' | 'pod' | 'resize' | 'close' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'reset' && <><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /></>}
    {name === 'jobs' && <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4m8-4v4M8 11h8m-8 4h5" /></>}
    {name === 'pod' && <><rect x="4" y="4" width="16" height="7" rx="2" /><rect x="4" y="14" width="16" height="6" rx="2" /><path d="M8 7.5h.01M8 17h.01m5-9.5h3m-3 9.5h3" /></>}
    {name === 'resize' && <path d="m8 18 10-10m-4 10 4-4" />}
    {name === 'close' && <path d="m6 6 12 12M6 18 18 6" />}
  </svg>;
}

function App() {
  const references = useReferences();
  const [page, setPage] = useState(location.pathname === '/library' ? 'library' : 'generate');
  const [workflow, setWorkflow] = useState<WorkflowId>('text-to-image');
  const [drafts, setDrafts] = useState(loadDrafts);
  const [promptHeight, setPromptHeight] = useState(240);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const [studio, setStudio] = useState<StudioSnapshot | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [error, setError] = useState('');
  const [connectionCode, setConnectionCode] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [draftError, setDraftError] = useState(false);
  const draft = drafts[workflow] ?? emptyDraft();
  const updateDraft = (change: Partial<Draft>) => setDrafts(current => ({ ...current, [workflow]: { ...(current[workflow] ?? emptyDraft()), ...change } }));
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    async function refresh() {
      try {
        const responses = await Promise.all(['/api/v1/studio', '/api/v1/assets'].map(url => fetch(url, { signal: controller.signal })));
        if (responses.some(response => !response.ok)) throw new Error('Unavailable');
        const [status, library] = await Promise.all(responses.map(response => response.json()));
        if (!disposed) { setStudio(status); setAssets(library.items); setError(''); }
      } catch { if (!disposed) setError('seed is unavailable.'); }
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 3000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [connectionRevision]);
  useEffect(() => {
    try { localStorage.setItem('seed.drafts.v2', JSON.stringify(drafts)); setDraftError(false); }
    catch { setDraftError(true); }
  }, [drafts]);
  useEffect(() => {
    const onPopState = () => setPage(location.pathname === '/library' ? 'library' : 'generate');
    addEventListener('popstate', onPopState); return () => removeEventListener('popstate', onPopState);
  }, []);
  function navigate(next: string) { setPage(next); history.pushState(null, '', next === 'library' ? '/library' : '/'); }
  const video = workflow.endsWith('video');
  const seedValid = draft.randomSeed || (/^(0|[1-9][0-9]{0,15})$/.test(draft.seed) && BigInt(draft.seed) + BigInt(draft.count - 1) <= 9007199254740991n);
  const jobCount = studio ? studio.queue.active + studio.queue.waiting : null;
  async function changeConnection(remove = false) {
    setConnecting(true); setConnectionError('');
    const code = connectionCode.trim(); setConnectionCode('');
    try {
      const response = await fetch('/api/v1/connection', { method: remove ? 'DELETE' : 'PUT', headers: { 'Content-Type': 'application/json' }, ...(remove ? {} : { body: JSON.stringify({ connection_code: code }) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Connection failed.');
      setConnectionRevision(value => value + 1);
    } catch (failure) { setConnectionError((failure as Error).message); }
    finally { setConnecting(false); }
  }
  const workerLabel = error ? 'Unavailable' : studio?.worker.state ? studio.worker.state.charAt(0).toUpperCase() + studio.worker.state.slice(1) : 'Disconnected';
  function reset() { if (workflow === 'image-to-image') references.reset('edit'); if (workflow === 'reference-to-video') references.reset('video'); setDrafts(current => ({ ...current, [workflow]: emptyDraft() })); setPromptHeight(240); setAdvancedOpen(false); }

  return <div className="studio-shell">
    <header className="topbar">
      <a className="brand" href="/" onClick={event => { event.preventDefault(); navigate('generate'); }}><span className="brand-mark"><SeedMark /></span>seed</a>
      <nav aria-label="Main navigation">{['generate', 'library'].map(item => <button key={item} aria-current={page === item ? 'page' : undefined} onClick={() => navigate(item)}>{item === 'generate' ? 'Generate' : 'Library'}</button>)}</nav>
      <div className="header-status">
        <button className="pod-button" popoverTarget="pod-details" aria-label="Pod connection"><Icon name="pod" /><span className="status-dot" /><span className="pod-label">{workerLabel}</span></button>
        <button className="jobs-button" popoverTarget="job-details" aria-label={`Jobs${jobCount === null ? '' : `, ${jobCount}`}`}><Icon name="jobs" /><span className="job-count">{jobCount ?? '–'}</span></button>
      </div>
    </header>
    <section id="pod-details" popover="auto" className="status-popover" aria-labelledby="pod-title">
      <div className="popover-title"><h2 id="pod-title">Pod connection</h2><button className="icon-button" popoverTarget="pod-details" popoverTargetAction="hide" aria-label="Close pod details"><Icon name="close" /></button></div>
      <p className="popover-status"><span className="status-dot" />{workerLabel === 'Disconnected' ? 'No pod connected' : workerLabel}</p>
      <a className="popover-link" href="https://console.runpod.io/pods" target="_blank" rel="noreferrer">Open RunPod ↗</a>
      {studio?.worker.preparation && <p className="popover-note">{studio.worker.preparation.error?.message ?? studio.worker.preparation.phase}</p>}
      <form className="connection-form" onSubmit={event => { event.preventDefault(); void changeConnection(); }}>
        <label htmlFor="connection-code">Connection code</label>
        <textarea id="connection-code" autoComplete="off" spellCheck={false} value={connectionCode} onChange={event => setConnectionCode(event.target.value)} placeholder="Paste from your pod" rows={2} />
        <button type="submit" disabled={connecting || !connectionCode.trim()}>{connecting ? 'Connecting…' : 'Connect'}</button>
        {studio?.worker.connected && <button type="button" disabled={connecting} onClick={() => void changeConnection(true)}>Forget connection</button>}
        {connectionError && <p role="alert">{connectionError}</p>}
      </form>
    </section>
    <section id="job-details" popover="auto" className="status-popover" aria-labelledby="jobs-title">
      <div className="popover-title"><h2 id="jobs-title">Jobs</h2><button className="icon-button" popoverTarget="job-details" popoverTargetAction="hide" aria-label="Close jobs"><Icon name="close" /></button></div>
      {error ? <p role="status">Job status unavailable.</p> : <><div className="job-summary"><span>Active <strong>{studio?.queue.active ?? '–'}</strong></span><span>Waiting <strong>{studio?.queue.waiting ?? '–'}</strong></span></div><p className="popover-note">{studio ? 'No jobs yet.' : 'Loading…'}</p><span className="queue-state">{studio?.queue.paused ? 'Queue paused' : ''}</span></>}
    </section>
    <main>
      {page === 'generate' ? <>
        <div className="workflow-bar"><label className="workflow-select"><span>Workflow</span><select value={workflow} onChange={event => { setWorkflow(event.target.value as WorkflowId); setPromptHeight(240); setAdvancedOpen(false); }}>{Object.entries(workflows).map(([id, value]) => <option key={id} value={id}>{value.title}</option>)}</select></label>
          {workflow !== 'image-to-image' && <div className="mode-group" aria-label="Content mode"><span>Mode</span><div className="segmented">{(['sfw', 'nsfw'] as const).map(mode => <button key={mode} aria-pressed={draft.mode === mode} onClick={() => updateDraft({ mode })}>{mode.toUpperCase()}</button>)}</div></div>}
        </div>
        <section className="composer" aria-label={workflows[workflow].title}>
          <div className="prompt-heading"><label htmlFor="prompt">Prompt</label><button className="icon-button" onClick={reset} aria-label="Reset form" title="Reset this workflow"><Icon name="reset" /></button></div>
          <div className="prompt-editor"><textarea id="prompt" value={draft.prompt} onChange={event => updateDraft({ prompt: event.target.value })} placeholder={workflows[workflow].placeholder} style={{ height: promptHeight }} />
            <button className="resize-handle" aria-label="Resize prompt" title="Drag to resize; use arrow keys for small adjustments" onPointerDown={event => { drag.current = { y: event.clientY, height: promptHeight }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (drag.current) setPromptHeight(Math.max(140, Math.min(800, drag.current.height + event.clientY - drag.current.y))); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setPromptHeight(height => Math.max(140, Math.min(800, height + (event.key === 'ArrowDown' ? 20 : -20)))); } }}><Icon name="resize" /></button>
          </div>
          {draftError && <p role="alert">Draft could not be saved. Keep a copy before closing.</p>}
          {(workflow === 'image-to-image' || workflow === 'reference-to-video') && <ReferenceInputs key={workflow} group={workflow === 'image-to-image' ? 'edit' : 'video'} state={references} />}
          <div className="output-settings"><fieldset><legend>Aspect ratio</legend><div className="frame-options">{(['16:9', '9:16'] as const).map(aspect => <button key={aspect} className="frame-option" aria-pressed={draft.aspect === aspect} aria-label={`${aspect === '16:9' ? 'Landscape' : 'Portrait'} ${aspect}`} onClick={() => updateDraft({ aspect })}><span className={`frame-shape ${aspect === '9:16' ? 'portrait' : 'landscape'}`} /><span>{aspect === '16:9' ? 'Landscape' : 'Portrait'}<small>{aspect}</small></span></button>)}</div></fieldset>
            {video && <fieldset><legend>Length</legend><div className="duration-options">{(['5', '10', '15'] as const).map(duration => <button key={duration} aria-pressed={draft.duration === duration} onClick={() => updateDraft({ duration })}>{duration}s</button>)}</div></fieldset>}
          </div>
          <div className="generation-options"><label className="batch-field">Generations<select aria-label="Generations" value={draft.count} onChange={event => updateDraft({ count: Number(event.target.value) })}>{Array.from({ length: 16 }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count}</option>)}</select></label><button className="advanced-toggle" aria-expanded={advancedOpen} aria-controls="advanced-options" onClick={() => setAdvancedOpen(open => !open)}>Advanced <span aria-hidden="true">{advancedOpen ? '−' : '+'}</span></button></div>
          {advancedOpen && <section id="advanced-options" className="advanced-options" aria-label="Advanced settings"><label className="seed-switch"><input type="checkbox" checked={draft.randomSeed} onChange={event => updateDraft({ randomSeed: event.target.checked })} />Random seed</label>
            {draft.randomSeed ? <p>Different seed for each generation.</p> : <><label className="seed-field" htmlFor="seed">Starting seed<input id="seed" type="text" inputMode="numeric" maxLength={16} value={draft.seed} aria-invalid={!seedValid} aria-describedby="seed-help" onChange={event => updateDraft({ seed: event.target.value })} /></label><p id="seed-help">{seedValid ? 'For batches, each seed increases by 1.' : 'Use a whole number from 0 to 9007199254740991, leaving room for the batch.'}</p></>}
          </section>}
          {!advancedOpen && !seedValid && <p role="alert">Check the starting seed in Advanced.</p>}
          <button className="generate-button" disabled title="Generation is not available yet">Create {draft.count > 1 ? `${draft.count} ${video ? 'videos' : 'images'}` : video ? 'video' : 'image'} <span>↗</span></button>
        </section>
      </> : <section className="library"><h1>Library</h1>{assets.length === 0 ? <div className="library-empty"><div className="empty-mark"><SeedMark /></div><p>No saved files yet.</p></div> : <ul>{assets.map(asset => <li key={asset.id}>{asset.name} · {asset.kind}</li>)}</ul>}</section>}
      <footer>seed</footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
