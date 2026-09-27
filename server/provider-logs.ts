import {readFileSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import type {StudioPaths} from './storage.js';
import type {RentalRecord} from './pool-contracts.js';
import type {ProviderStartupLog} from '../shared/startup-logs.js';
import {credential} from './credential-store.js';
import {Diagnostics} from './diagnostics.js';

export class LogCollectionError extends Error {
  constructor(message: string, readonly auth = false, readonly retryAfterMs = 30000) { super(message); }
}

/** Provider boot sources only. Scheduling and persistence belong to StartupLogs. */
export class ProviderLogs {
  constructor(private paths: StudioPaths, private diagnostics: Diagnostics, private fetcher: typeof fetch = fetch) {}
  async collect(w: RentalRecord, signal: AbortSignal, cursor?: string): Promise<ProviderStartupLog> {
    const key = credential(this.paths, w.provider === 'vast' ? 'vastApiKey' : 'runpodApiKey');
    if (!key) throw new LogCollectionError('Add the provider key in Admin to read startup logs.', true);
    this.diagnostics.registerSecret(key);
    try { this.diagnostics.registerSecret(JSON.parse(readFileSync(path.join(this.paths.config, 'workers', w.id, 'bootstrap.json'), 'utf8')).pairing_secret); } catch {}
    const result = w.provider === 'runpod'
      ? await this.runpod(w.resource!.id, key, signal, cursor)
      : await this.vast(w.resource!.id, key, signal);
    signal.throwIfAborted();
    const text = String(this.diagnostics.clean({message: result.text}).message ?? '')
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
    return {...result, text};
  }
  private check(response: Response) {
    if (response.ok) return;
    const seconds = Number(response.headers.get('retry-after'));
    const date = Date.parse(response.headers.get('retry-after') ?? '');
    const retry = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Number.isFinite(date) ? date - Date.now() : 30000;
    throw new LogCollectionError([401, 403].includes(response.status)
      ? 'The provider denied access to startup logs. Check its key in Admin.'
      : response.status === 404 ? 'The provider has no startup logs available yet.'
      : response.status === 429 ? 'The provider limited log updates. Updates will retry shortly.'
      : `Provider startup logs are temporarily unavailable (HTTP ${response.status}).`,
      [401, 403].includes(response.status), Math.max(30000, Math.min(300000, retry)));
  }
  private async body(response: Response, limit: number, partialOnTimeout = false) {
    if (!response.body) return {text: '', truncated: false};
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0, truncated = false;
    try {
      while (size < limit) {
        const item = await reader.read();
        if (item.done) break;
        const chunk = item.value.subarray(0, limit - size);
        chunks.push(chunk); size += chunk.length;
        if (size === limit) { truncated = true; break; }
      }
    } catch (error) {
      if (!partialOnTimeout || !['AbortError', 'TimeoutError'].includes((error as Error).name)) throw error;
    } finally { await reader.cancel().catch(() => {}); }
    return {text: Buffer.concat(chunks).toString('utf8'), truncated};
  }
  private tail(text: string) {
    const lines = text.split('\n');
    return {text: lines.slice(-100).join('\n').slice(-8192), truncated: lines.length > 100 || text.length > 8192};
  }
  private async runpod(id: string, key: string, signal: AbortSignal, cursor?: string): Promise<ProviderStartupLog> {
    const response = await this.fetcher(`https://api.runpod.io/v2/pods/${encodeURIComponent(id)}/logs?source=system&tail=100`, {
      headers: {Authorization: `Bearer ${key}`, ...(cursor ? {'Last-Event-ID': cursor} : {})},
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    this.check(response);
    const raw = await this.body(response, 65536, true);
    signal.throwIfAborted();
    const lines: string[] = [];
    let next = cursor;
    for (const frame of raw.text.replace(/\r\n/g, '\n').split('\n\n').slice(0, -1)) {
      try {
        const data = JSON.parse(frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n'));
        if (data.source !== 'system' || typeof data.line !== 'string') continue;
        const eventId = frame.split('\n').find(l => l.startsWith('id:'))?.slice(3).trim();
        if (eventId && eventId === cursor) continue;
        lines.push(`${typeof data.ts === 'string' ? data.ts + ' ' : ''}${data.line}`);
        if (eventId && eventId.length <= 256) next = eventId;
      } catch { /* Partial frames are replayed on reconnect. */ }
    }
    const tail = this.tail(lines.join('\n'));
    return {source: 'RunPod startup', ...tail, truncated: raw.truncated || tail.truncated, cursor: next};
  }
  private async vast(id: string, key: string, parent: AbortSignal): Promise<ProviderStartupLog> {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(15000)]);
    const response = await this.fetcher(`https://console.vast.ai/api/v0/instances/request_logs/${encodeURIComponent(id)}/`, {
      method: 'PUT', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({tail: '100', daemon_logs: 'true'}), redirect: 'error', signal,
    });
    this.check(response);
    const raw = await this.body(response, 65536);
    let url: URL;
    try {
      const result = JSON.parse(raw.text);
      if (raw.truncated || result.success === false || typeof result.result_url !== 'string') throw Error();
      url = new URL(result.result_url);
      if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.endsWith('.amazonaws.com')) throw Error();
    } catch { throw new LogCollectionError('The provider returned an invalid startup-log export.'); }
    for (let attempt = 0; attempt < 8; attempt++) {
      const log = await this.fetcher(url, {redirect: 'error', signal});
      if (log.ok) {
        const body = await this.body(log, 1024 * 1024), tail = this.tail(body.text);
        return {source: 'Vast startup', ...tail, truncated: body.truncated || tail.truncated};
      }
      await log.body?.cancel();
      if (![403, 404].includes(log.status)) this.check(log);
      await delay(500, undefined, {signal});
    }
    throw new LogCollectionError('The provider is preparing startup logs. Updates will retry shortly.');
  }
}
