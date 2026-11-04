import React, { useState } from 'react';
import { useApp } from '../data.js';
import { projects as projectsApi } from '../api.js';
import { Icon } from '../icons.js';
import { relativeTime } from '../format.js';
import { jobActive } from '../../../shared/jobs.js';
import { StatusControl } from '../App.js';

/** Every project, newest first. The phone's top level, and the tablet drawer. */
export function ProjectsList({ compact = false, onChosen }: { compact?: boolean; onChosen?: () => void }) {
  const { projectList, go, mode, refreshProjects, tasks } = useApp();
  const [query, setQuery] = useState('');
  const active = new Set(tasks.filter(jobActive).map(j => j.source?.chat_id));
  const shown = projectList.filter(p => p.title.toLowerCase().includes(query.trim().toLowerCase()));
  async function create() { const p = await projectsApi.create(mode); refreshProjects(); onChosen?.(); go({ name: 'project', id: p.id, view: 'conversation' }); }
  const body = <div className="plist">
    <button className="btn primary" onClick={() => void create()}><Icon.Plus />New project</button>
    {projectList.length > 5 && <label className="search-box"><Icon.Search /><input placeholder="Find a project by title" aria-label="Find a project by title" value={query} onChange={e => setQuery(e.target.value)} /></label>}
    {shown.map(p => <button key={p.id} className="prow" onClick={() => { onChosen?.(); go({ name: 'project', id: p.id, view: 'conversation' }); }}>
      {active.has(p.id) || p.activity !== 'idle' ? <span className="dot live" aria-label="Working" /> : p.status === 'Failed' ? <span className="dot red" aria-label="Has a failed result" /> : <span className="dot off" aria-hidden="true" />}
      <span className="t"><b>{p.title}</b><small>{active.has(p.id) ? 'Making now' : p.activity !== 'idle' ? 'Seed is replying' : p.status === 'Failed' ? 'Something failed' : relativeTime(p.updated_at)}</small></span>
      <Icon.Next />
    </button>)}
    {!projectList.length && <p className="muted" style={{ textAlign: 'center' }}>No projects yet. Start one and describe what you want to make.</p>}
    {projectList.length > 0 && !shown.length && <p className="muted">No project titles match “{query}”.</p>}
  </div>;
  if (compact) return body;
  return <>
    <header className="head"><h1 className="serif">Projects</h1><span className="spacer" /><StatusControl /></header>
    <div className="scroll"><div className="col">{body}</div></div>
  </>;
}
