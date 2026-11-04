import React, { useEffect, useRef } from 'react';
import { jobs as jobsApi, kindOf, isVideoKind } from '../api.js';
import { useApp } from '../data.js';
import { Icon } from '../icons.js';
import { Thumb } from '../ui.js';
import { tileState, titleOf, relativeTime } from '../format.js';
import { jobActive } from '../../../shared/jobs.js';
import { GpuOverview } from '../gpus/GpusPage.js';

/** Every task across projects and every GPU, one click from any screen. */
export function StatusPanel({ tab, onTab, onClose }: { tab: 'tasks' | 'gpus'; onTab: (t: 'tasks' | 'gpus') => void; onClose: () => void }) {
  const app = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null; ref.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const out = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.status')) onClose(); };
    addEventListener('keydown', key); addEventListener('pointerdown', out);
    return () => { removeEventListener('keydown', key); removeEventListener('pointerdown', out); opener?.focus?.(); };
  }, []);
  const recent = app.tasks.filter(j => jobActive(j) || Date.now() - Date.parse(j.updated_at) < 6 * 3600_000).slice(0, 40);
  const active = recent.filter(jobActive), rest = recent.filter(j => !jobActive(j));
  const row = (j: typeof recent[number]) => {
    const s = tileState(j), project = app.projectList.find(p => p.id === j.source?.chat_id);
    const out = j.outputs[0], video = isVideoKind(kindOf[j.request.workflow]);
    return <div key={j.id} className="task" style={{ cursor: project ? 'pointer' : undefined }} onClick={() => { if (project) { onClose(); app.go({ name: 'project', id: project.id, view: 'conversation', focus: j.source?.card_id }); } }}>
      {out ? <Thumb id={out} kind={video ? 'video' : 'image'} alt="" /> : <span className="thumb" style={{ display: 'grid', placeItems: 'center' }}><span className={'dot ' + (s.tone === 'live' ? 'live' : s.tone === 'bad' ? 'red' : s.tone === 'wait' ? 'amber' : 'off')} /></span>}
      <span className="t"><b>{titleOf(j.request)}</b><small>{s.label}{project ? ' · ' + project.title : ''} · {relativeTime(j.updated_at)}</small></span>
      {s.cancellable && <button className="btn small" onClick={e => { e.stopPropagation(); void jobsApi.cancel(j.id).then(app.refreshTasks); }}>Cancel</button>}
      {project && <Icon.Next />}
    </div>;
  };
  return <div className="panel" ref={ref} role="dialog" aria-label="Activity and GPUs">
    <div className="dialog-head" style={{ paddingBottom: 0, borderBottom: 0 }}><h2>Activity</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><Icon.Close /></button></div>
    <div className="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'tasks'} onClick={() => onTab('tasks')}>Tasks{active.length ? ` (${active.length})` : ''}</button>
      <button role="tab" aria-selected={tab === 'gpus'} onClick={() => onTab('gpus')}>GPUs{app.pool?.summary.active ? ` (${app.pool.summary.active})` : ''}</button>
    </div>
    <div style={{ overflow: 'auto' }}>
      {tab === 'tasks' ? <>
        {!recent.length && <p className="muted" style={{ padding: 16, margin: 0 }}>Nothing has run in the last few hours.</p>}
        {active.length > 0 && <div className="day" style={{ padding: '0 16px' }}>Now</div>}{active.map(row)}
        {rest.length > 0 && <div className="day" style={{ padding: '0 16px' }}>Earlier</div>}{rest.map(row)}
      </> : <div style={{ padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}><GpuOverview compact /><button className="btn" onClick={() => { onClose(); app.go({ name: 'gpus' }); }}>Open GPUs</button></div>}
    </div>
  </div>;
}
