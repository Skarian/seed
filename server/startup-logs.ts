import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import type {StartupLogSnapshot} from '../shared/startup-logs.js';
import type {RentalRecord, ProviderDriver} from './pool-contracts.js';
import {Diagnostics, sanitize} from './diagnostics.js';
import {LogCollectionError} from './provider-logs.js';

type Record = StartupLogSnapshot & {
  provider_closed?: boolean; resource_id?: string; cursor?: string;
  progress_key?: string; progress_at?: number;
};
const executed = (w: RentalRecord) => !!(w.ready_at || w.adapters_frozen || w.ready || w.current_job_id || w.issue?.code === 'worker_busy' || ['ready', 'generating', 'saving'].includes(w.state));
const stopped = (w: RentalRecord) => !!(w.quit_mode || w.released_at || ['released', 'releasing'].includes(w.state));
const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.max(0, value)} bytes`;

/** Small durable startup archive; never reads general worker/job diagnostic history. */
export class StartupLogs {
  private running = new Map<string, AbortController>();
  private next = new Map<string, number>();
  private denied = new Set<string>();
  private closing = false;
  constructor(private db: Database.Database, private diagnostics?: Diagnostics, private now = Date.now) {}
  private date() { return new Date(this.now()).toISOString(); }
  private worker(id: string): RentalRecord | null {
    const row = this.db.prepare('SELECT snapshot_json FROM pool_workers WHERE id=?').get(id) as {snapshot_json: string} | undefined;
    return row ? JSON.parse(row.snapshot_json) : null;
  }
  private record(id: string): Record | null {
    const row = this.db.prepare('SELECT snapshot_json FROM worker_startup_logs WHERE worker_id=?').get(id) as {snapshot_json: string} | undefined;
    return row ? JSON.parse(row.snapshot_json) : null;
  }
  private clean(text: string) {
    const result = this.diagnostics ? this.diagnostics.clean({message: text}) : sanitize({message: text});
    return String(result.message ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  }
  private write(r: Record) {
    r.revision++;
    // Provider tails are already small; bound the entire serialized record as well.
    while (Buffer.byteLength(JSON.stringify(r)) > 64000) {
      const section = r.sections.reduce((a, b) => a.text.length > b.text.length ? a : b);
      section.text = section.text.slice(Math.max(1, Math.floor(section.text.length / 4)));
      r.truncated = true;
    }
    this.db.prepare('INSERT INTO worker_startup_logs VALUES (?,?) ON CONFLICT(worker_id) DO UPDATE SET snapshot_json=excluded.snapshot_json')
      .run(r.worker_id, JSON.stringify(r));
  }
  private protect(fn: () => void) {
    try { fn(); } catch {
      // Storage failures must not stop readiness or termination. No original payload.
      this.diagnostics?.event({category: 'startup', operation: 'startup.storage_unavailable', data: {message: 'Startup logs could not be saved. Check local storage.'}});
    }
  }
  private append(r: Record, text: string) {
    const at = this.date();
    let section = r.sections.find(s => s.source === 'Worker setup');
    if (!section) { section = {source: 'Worker setup', captured_at: at, text: ''}; r.sections.push(section); }
    const lines = (section.text ? section.text.split('\n') : []).concat(`${at} ${this.clean(text).slice(0, 2000)}`);
    if (lines.length > 100) r.truncated = true;
    section.text = lines.slice(-100).join('\n'); section.captured_at = at;
    r.captured_at = at;
  }
  private cancel(id: string) { this.running.get(id)?.abort(); }
  observe(w: RentalRecord, previous: RentalRecord | null) {
    // Always abort first, even if storage is unavailable.
    if (w.preparation || executed(w) || stopped(w)) this.cancel(w.id);
    this.protect(() => {
      let r = this.record(w.id);
      if (!r) {
        if (previous) return; // Legacy acquisitions do not gain a raw capture window.
        r = {worker_id: w.id, revision: 0, phase: 'acquire', collection: 'collecting', availability: 'pending', truncated: false, sections: []};
        this.append(r, 'Worker requested. Waiting for the provider.');
      }
      if (r.collection === 'sealed') {
        if (w.released_at && r.sealed_reason === 'quit') {
          r.sealed_reason = 'released'; this.append(r, 'Worker released.'); this.write(r);
        }
        return;
      }
      const before = JSON.stringify(r);
      if (w.resource && !r.resource_id) r.resource_id = w.resource.id;
      if (r.resource_id && w.resource && r.resource_id !== w.resource.id) {
        r.provider_closed = true;
        r.reason = 'The provider resource changed. No further provider logs will be collected.';
      }
      if (executed(w) || stopped(w)) {
        r.collection = 'sealed'; r.provider_closed = true; r.sealed_at = this.date();
        r.sealed_reason = w.create_rejected ? 'rejected' : executed(w) ? 'ready' : w.released_at ? 'released' : 'quit';
        r.phase = 'complete';
        this.append(r, w.create_rejected ? 'The provider rejected this launch. No rental was created.'
          : executed(w) ? 'Startup complete. The generation engine is available.'
          : w.released_at ? 'Worker released before startup completed.' : 'Startup capture stopped. Worker shutdown requested.');
        delete r.reason;
      } else if (w.preparation) {
        const prep = w.preparation;
        r.provider_closed = true;
        r.phase = prep.stage === 'starting_engine' ? 'engine' : 'models';
        r.availability = 'available';
        const key = createHash('sha256').update(JSON.stringify([prep.stage, prep.phase, prep.error, prep.stalled, prep.files.map(f => [f.path, f.state, f.ready, f.omitted, f.error])])).digest('hex');
        const changed = r.progress_key !== key;
        if (changed || this.now() - (r.progress_at ?? 0) >= 30000) {
          r.checked_at = this.date();
          const title = r.phase === 'engine' ? 'Starting generation engine.' : prep.stage === 'verifying' ? 'Verifying model files.' : 'Preparing model files.';
          this.append(r, `${title} ${bytes(prep.bytes_done)} of ${bytes(prep.bytes_total)}.`);
          if (changed) {
            if (prep.error) this.append(r, `Setup error: ${prep.error}`);
            if (prep.stalled) this.append(r, 'Waiting for transfer updates.');
            for (const file of prep.files) {
              const old = previous?.preparation?.files.find(f => f.path === file.path);
              // Only files from the acquisition manifest, never job input files.
              const known = w.manifest.some(m => m.path === file.path) || w.requested_loras.some(l => file.path.endsWith('/' + l.filename));
              if (!known) continue;
              if (file.error && file.error !== old?.error) this.append(r, `${file.name}: ${file.error}`);
              else if (file.omitted && !old?.omitted) this.append(r, `${file.name}: skipped.`);
              else if (file.ready && !old?.ready) this.append(r, `${file.name}: verified.`);
            }
          }
          r.progress_key = key; r.progress_at = this.now();
        }
        delete r.reason;
      } else if (w.issue && w.issue.code !== previous?.issue?.code) {
        // Pool errors are controlled status messages, not raw job errors/stack traces.
        this.append(r, `Startup needs attention (${w.issue.code}). ${w.issue.message}`);
      }
      if (JSON.stringify(r) !== before || !previous) this.write(r);
    });
  }
  action(id: string, action: string) {
    const labels: {[key: string]: string} = {reconnect: 'Reconnecting to the worker.', retry_preparation: 'Retrying model preparation.', omit_loras: 'Skipping selected failed adapters.', local_fallback: 'Retrying model download through this PC.'};
    this.protect(() => { const r = this.record(id); if (r?.collection === 'collecting' && labels[action]) { this.append(r, labels[action]); this.write(r); } });
  }
  private eligible(w: RentalRecord | null, r: Record | null) {
    return !this.closing && w && r && r.collection === 'collecting' && !r.provider_closed && !w.preparation
      && !executed(w) && !stopped(w) && w.resource && (!r.resource_id || r.resource_id === w.resource.id);
  }
  credentialsChanged() { for (const controller of this.running.values()) controller.abort(); this.denied.clear(); this.next.clear(); }
  async collect(w: RentalRecord, driver: ProviderDriver) {
    if (!driver.collectStartupLogs || this.running.has(w.id) || this.denied.has(w.id) || this.now() < (this.next.get(w.id) ?? 0)) return;
    const r = this.record(w.id);
    if (!this.eligible(this.worker(w.id), r)) return;
    const controller = new AbortController();
    this.running.set(w.id, controller);
    this.next.set(w.id, this.now() + (w.provider === 'runpod' ? 10000 : 15000) + Math.random() * 1000);
    this.protect(() => { r!.attempted_at = this.date(); this.write(r!); });
    const valid = () => !controller.signal.aborted && this.eligible(this.worker(w.id), this.record(w.id));
    try {
      const result = await driver.collectStartupLogs(w, controller.signal, r!.cursor);
      if (!valid()) return;
      this.protect(() => {
        const current = this.record(w.id)!;
        current.checked_at = this.date(); current.availability = 'available'; delete current.reason;
        current.cursor = result.cursor; current.truncated ||= result.truncated;
        let section = current.sections.find(s => s.source === result.source);
        const incoming = this.clean(result.text);
        // SSE delivers new lines; Vast delivers a repeated tail snapshot.
        const text = w.provider === 'runpod' && section && incoming ? section.text + '\n' + incoming : incoming;
        if (text && section?.text !== text) {
          const lines = text.split('\n'); const tail = lines.slice(-100).join('\n').slice(-8192);
          current.truncated ||= tail.length < text.length;
          if (!section) { section = {source: result.source, text: '', captured_at: this.date()}; current.sections.unshift(section); }
          section.text = tail; section.captured_at = this.date(); current.captured_at = this.date();
        }
        this.write(current);
      });
    } catch (error) {
      if (!valid()) return;
      const known = error instanceof LogCollectionError ? error : new LogCollectionError('Startup log updates are delayed. They will retry automatically.');
      this.next.set(w.id, this.now() + known.retryAfterMs);
      if (known.auth) this.denied.add(w.id);
      this.protect(() => {
        const current = this.record(w.id)!; current.availability = 'unavailable'; current.reason = known.message; this.write(current);
        this.diagnostics?.event({category: 'startup', operation: 'startup.collection_unavailable', worker_id: w.id, provider: w.provider, data: {message: known.message}});
      });
    } finally { if (this.running.get(w.id) === controller) this.running.delete(w.id); }
  }
  read(id: string): StartupLogSnapshot | null {
    const r = this.record(id);
    if (r) {
      const {provider_closed, resource_id, cursor, progress_key, progress_at, ...snapshot} = r;
      return snapshot;
    }
    const w = this.worker(id);
    return w ? {worker_id: id, revision: 0, phase: 'complete', collection: 'sealed', availability: 'unavailable',
      sealed_reason: 'legacy', reason: 'Startup logs were not captured for this worker.', truncated: false, sections: []} : null;
  }
  close() { this.closing = true; for (const controller of this.running.values()) controller.abort(); }
}
