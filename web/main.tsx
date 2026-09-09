import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { LibraryAsset, StudioSnapshot, WorkflowId } from '../shared/studio.js';
import './style.css';

const workflows: Record<WorkflowId, { title: string; heading: string; description: string; placeholder: string }> = {
  'text-to-image': { title: 'Text to image', heading: 'Start with an idea.', description: 'Describe the image you have in mind.', placeholder: 'A place, a character, a little detail. What do you want to make?' },
  'image-to-image': { title: 'Image to image', heading: 'Give it a new direction.', description: 'Edit an image while keeping the details that matter.', placeholder: 'Describe what should change, and what should stay the same.' },
  'text-to-video': { title: 'Text to video', heading: 'Set the scene in motion.', description: 'Describe the scene, movement and sound.', placeholder: 'What happens in the scene? Describe the camera, action and sound.' },
  'reference-to-video': { title: 'Reference to video', heading: 'Bring your references to life.', description: 'Build a scene around images, video and audio.', placeholder: 'Describe how your references come together in the scene.' },
};

function App() {
  const [page, setPage] = useState(location.pathname === '/library' ? 'library' : 'generate');
  const [workflow, setWorkflow] = useState<WorkflowId>('text-to-image');
  const [prompts, setPrompts] = useState<Record<string, string>>(() => {
    try { const value = JSON.parse(localStorage.getItem('studio.drafts.v1') ?? '{}') as unknown;
      return value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter(([key, text]) => key in workflows && typeof text === 'string')) : {};
    } catch { return {}; }
  });
  const [aspect, setAspect] = useState('16:9');
  const [duration, setDuration] = useState('5');
  const [studio, setStudio] = useState<StudioSnapshot | null>(null);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [error, setError] = useState('');
  const [draftError, setDraftError] = useState(false);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    async function refresh() {
      try {
        const responses = await Promise.all(['/api/v1/studio', '/api/v1/assets'].map(url => fetch(url, { signal: controller.signal })));
        if (responses.some(response => !response.ok)) throw new Error('Unavailable');
        const [status, library] = await Promise.all(responses.map(response => response.json()));
        if (!disposed) { setStudio(status); setAssets(library.items); setError(''); }
      } catch { if (!disposed) setError('The local studio is unavailable. Your saved files remain on this PC.'); }
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10_000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem('studio.drafts.v1', JSON.stringify(prompts)); setDraftError(false); }
    catch { setDraftError(true); }
  }, [prompts]);
  useEffect(() => {
    const onPopState = () => setPage(location.pathname === '/library' ? 'library' : 'generate');
    addEventListener('popstate', onPopState); return () => removeEventListener('popstate', onPopState);
  }, []);
  function navigate(next: string) { setPage(next); history.pushState(null, '', next === 'library' ? '/library' : '/'); }
  const choice = workflows[workflow];
  const video = workflow.endsWith('video');

  return <div className="studio-shell">
    <header className="topbar">
      <a className="brand" href="/" onClick={event => { event.preventDefault(); navigate('generate'); }}><span className="brand-mark" aria-hidden="true">r/</span> runpod <span className="brand-sub">studio</span></a>
      <nav aria-label="Main navigation">{['generate', 'library'].map(item => <button key={item} aria-current={page === item ? 'page' : undefined} onClick={() => navigate(item)}>{item === 'generate' ? 'Generate' : 'Library'}</button>)}</nav>
      <span className="local-badge">On your PC</span>
    </header>
    <main>
      <div className="connection-strip" role="status"><span className="status-dot" /> <strong>{error ? 'Studio unavailable' : 'No pod connected'}</strong><span className="connection-detail">{error || 'Draft here. Connect a GPU when you’re ready to create.'}</span><a href="https://console.runpod.io/pods" target="_blank" rel="noreferrer">Open RunPod ↗</a></div>
      {page === 'generate' ? <>
        <div className="workflow-bar"><label className="workflow-select"><span>Workflow</span><select value={workflow} onChange={event => setWorkflow(event.target.value as WorkflowId)}>{Object.entries(workflows).map(([id, value]) => <option key={id} value={id}>{value.title}</option>)}</select></label>
          {workflow !== 'image-to-image' && <div className="mode-group" aria-label="Content mode"><span>Mode</span><div className="segmented"><button aria-pressed="true">SFW</button><button disabled title="Choose and validate a LoRA preset before enabling NSFW.">NSFW</button></div></div>}
        </div>
        <div className="workspace"><section className="composer"><p className="eyebrow">YOUR NEXT CREATION</p><h1>{choice.heading}</h1><p className="intro">{choice.description}</p>
          <label className="prompt-label" htmlFor="prompt">Prompt <span>Saved on this browser</span></label><textarea id="prompt" value={prompts[workflow] ?? ''} onChange={event => setPrompts({ ...prompts, [workflow]: event.target.value })} placeholder={choice.placeholder} rows={7} />
          {draftError && <p role="alert">This browser could not save the draft. Keep a copy before closing.</p>}
          {(workflow === 'image-to-image' || workflow === 'reference-to-video') && <div className="reference-placeholder"><strong>{video ? 'Images, video & audio' : 'Source image'}</strong><p>Reference uploads will be available when this workflow is connected.</p></div>}
          <div className="output-settings"><label>Frame<select value={aspect} onChange={event => setAspect(event.target.value)}><option value="16:9">Landscape · 16:9</option><option value="9:16">Portrait · 9:16</option></select></label>{video && <label>Length<select value={duration} onChange={event => setDuration(event.target.value)}>{['5', '10', '15'].map(value => <option key={value} value={value}>{value} seconds</option>)}</select></label>}<div className="resolution"><span>Output</span><strong>{video ? '720p' : '1 megapixel'}</strong></div></div>
          <button className="generate-button" disabled>Create {video ? 'video' : 'image'} <span>↗</span></button><p className="preview-note">Interface preview · Pairing and generation are the next steps.</p>
        </section><section className="preview-panel" aria-label="Output preview"><div className="preview-top"><span>Preview</span><span>{video ? 'VIDEO' : 'IMAGE'}</span></div><div className="empty-preview"><div className="frame-art" aria-hidden="true"><div /></div><h2>A little space for your next idea.</h2><p>Your result will appear here.<br />Saved creations stay in your Library.</p></div><div className="preview-bottom"><span>Originals & results, kept on your PC</span><span>↙</span></div></section></div>
      </> : <section className="library"><p className="eyebrow">YOUR COLLECTION</p><h1>A home for what you make.</h1><p className="intro">Your images, videos and source files stay with you.</p>{assets.length === 0 ? <div className="library-empty"><span aria-hidden="true">▧</span><h2>Your Library is ready.</h2><p>Saved creations will appear here, even when your GPU is disconnected.</p><button onClick={() => navigate('generate')}>Go to Generate ↗</button></div> : <ul>{assets.map(asset => <li key={asset.id}>{asset.name} · {asset.kind}</li>)}</ul>}</section>}
      <footer><span>Runpod Studio <span className="footer-separator">/</span> An idea, then an image.</span><span>{studio?.queue.paused ? 'Queue paused' : 'Loading studio…'}</span></footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
