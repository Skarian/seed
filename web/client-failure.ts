import {failureAsset, failureClasses, type ClientFailure} from '../shared/client-failure.js';

export function clientFailure(error: unknown, kind: ClientFailure['kind'], location: Pick<Location,'origin'|'pathname'>, buildUrl?: string): ClientFailure {
  const route = location.pathname === '/' ? 'generate' : location.pathname.split('/')[1];
  const evidence: ClientFailure = {kind, route: ['generate','chat','library','admin'].includes(route ?? '') ? route as ClientFailure['route'] : 'unknown',
    error_class: error instanceof Error && failureClasses.includes(error.name as any) ? error.name as ClientFailure['error_class'] : 'Unknown'};
  const asset = (raw: string) => {
    try { const url = new URL(raw, location.origin), name = url.pathname.slice('/assets/'.length);
      return url.origin === location.origin && !url.search && !url.hash && url.pathname.startsWith('/assets/') && failureAsset(name) ? name : undefined;
    } catch { return undefined; }
  };
  const build = buildUrl && asset(buildUrl); if (build) evidence.build = build;
  // Only numbered first-party JS coordinates survive. Never send the error message or raw stack.
  if (error instanceof Error && typeof error.stack === 'string') {
    // Messages can contain newlines that look like stack frames. Remove the entire
    // native header; an unfamiliar/custom stack format supplies no coordinates.
    const header=error.name+(error.message ? ': '+error.message : '')+'\n';
    const frames=error.stack.startsWith(header)?error.stack.slice(header.length,header.length+16000):'';
    for (const lineText of frames.split('\n').slice(0,15)) {
      if (!/^\s*at\s/.test(lineText)) continue;
      const match = lineText.match(/(https?:\/\/[^\s()]+?):(\d+):(\d+)\)?$/);
      if (!match) continue;
      const name = asset(match[1]!), line = Number(match[2]), column = Number(match[3]);
      if (name && line > 0 && column > 0 && line <= 10_000_000 && column <= 10_000_000) {evidence.frame = {asset:name,line,column};break;}
    }
  }
  return evidence;
}

const sent = new Set<string>();
export function reportClientFailure(error: unknown, kind: ClientFailure['kind']) {
  try {
    const build = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    const evidence = clientFailure(error,kind,window.location,build), body = JSON.stringify(evidence);
    if (sent.has(body) || sent.size >= 10) return;
    sent.add(body);
    void fetch('/api/v1/diagnostics/client-failure',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});
  } catch { /* Recovery must also work when reporting is unavailable. */ }
}

export function listenForClientFailures() {
  window.addEventListener('error', event => {if (event.error) reportClientFailure(event.error,'async');});
  window.addEventListener('unhandledrejection', event => reportClientFailure(event.reason,'async'));
}
