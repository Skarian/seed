import { createFalClient } from '@fal-ai/client';
import { openAsBlob } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {FalError} from './fal-errors.js';
export {FalError} from './fal-errors.js';

export const endpoints = ['fal-ai/krea-2/turbo', 'minimax/h3/text-to-video', 'minimax/h3/image-to-video', 'minimax/h3/reference-to-video'].flatMap(id => [id, id + '/lora']);
export type Receipt = { request_id: string; status_url: string; response_url: string; cancel_url: string };
export type FalTransport = Pick<Fal, 'configured' | 'submit' | 'status' | 'result' | 'cancel' | 'upload' | 'sign' | 'download'> & { close?: () => void };
function https(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('Expected an HTTPS URL.');
  return url;
}
export function queueUrl(value: string) {
  const url = https(value);
  if (url.host !== 'queue.fal.run') throw Error('Invalid fal queue address.');
  return url.href;
}
function cdnUrl(value: string) {
  const url = https(value);
  if (url.host !== 'v3b.fal.media' || !/^\/files\/b\/[^/]+\/[^/]+$/.test(url.pathname)) throw Error('Expected a private fal CDN v3 file.');
  url.search = ''; return url;
}
export class Fal {
  private abort = new AbortController();
  constructor(private credential?: string | (()=>string|undefined), private fetchImpl: typeof fetch = fetch) {}
  private get key(){return typeof this.credential==='function'?this.credential():this.credential;}
  close() { this.abort.abort(); }
  get configured() { return Boolean(this.key); }
  private async http(url: string, init: RequestInit = {}, auth = true) {
    const target = https(url);
    if (auth && !['queue.fal.run', 'rest.fal.ai'].includes(target.host)) throw Error('Invalid fal API address.');
    if (auth && !this.key) throw Error('Set FAL_KEY or run seed setup.');
    const response = await this.fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.any([this.abort.signal, init.signal ?? AbortSignal.timeout(30000)]), headers: { ...(auth ? { Authorization: `Key ${this.key}` } : {}), ...init.headers } });
    if (!response.ok) {
      let body:unknown;try{body=await response.json();}catch{}
      throw new FalError(response.status,body,response.headers.get('retry-after'));
    }
    return response;
  }
  async submit(endpoint: string, input: Record<string, unknown>): Promise<Receipt> {
    if (!endpoints.includes(endpoint)) throw Error('Unsupported fal model.');
    // Never retry a paid POST. A timeout may occur after fal accepts the job.
    const ack = await (await this.http(`https://queue.fal.run/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: 604800, initial_acl: { default: 'forbid', rules: [] } }) }, body: JSON.stringify(input) })).json() as Receipt;
    if (!ack.request_id || typeof ack.request_id !== 'string') throw Error('fal did not return a request ID. Submission may have succeeded.');
    return ack;
  }
  async status(ack: Receipt): Promise<{ status: string; metrics?: Record<string, unknown>;error?:string;error_type?:string }> { return (await this.http(queueUrl(ack.status_url))).json(); }
  async result(ack: Receipt): Promise<any> { return (await this.http(queueUrl(ack.response_url))).json(); }
  async cancel(ack: Receipt): Promise<{ status?: string }> {
    try { return await (await this.http(queueUrl(ack.cancel_url), { method: 'PUT' })).json(); }
    catch (error) { if (error instanceof FalError && error.status === 400) return { status: 'ALREADY_COMPLETED' }; throw error; }
  }
  async upload(file: string, permanent = false) {
    if (!this.key) throw Error('Set FAL_KEY or run seed setup.');
    const client = createFalClient({ credentials: this.key, fetch: async (url, init) => {
      // SDK 1.10.1 still uses the older header on direct uploads.
      const headers = new Headers(init?.headers);
      const lifecycle = headers.get('X-Fal-Object-Lifecycle');
      if (lifecycle) { headers.delete('X-Fal-Object-Lifecycle'); headers.set('X-Fal-Object-Lifecycle-Preference', lifecycle); }
      const response=await this.fetchImpl(url, { ...init, headers, redirect: 'error', signal: AbortSignal.any([this.abort.signal, init?.signal ?? AbortSignal.timeout(180000)]) });
      if(!response.ok)throw new FalError(response.status,await response.json().catch(()=>null),response.headers.get('retry-after'));
      return response;
    } });
    const mime: Record<string,string> = { '.png': 'image/png', '.mp4': 'video/mp4', '.wav': 'audio/wav' };
    const type = mime[path.extname(file)] ?? 'application/octet-stream';
    const blob = await openAsBlob(file, { type });
    const url = await client.storage.upload(new File([blob], path.basename(file), { type }), { lifecycle: { expiresIn: permanent ? '1y' : '7d', initialAcl: { default: 'forbid', rules: [] } } });
    cdnUrl(url);
    // Verify the server applied the requested ACL before reusing the upload.
    const acl = await (await this.http('https://rest.fal.ai/storage/files/acl?url=' + encodeURIComponent(url))).json() as { default?: string; rules?: unknown[] };
    if (acl.default !== 'forbid' || acl.rules?.length) throw Error('fal did not confirm a private upload.');
    return url;
  }
  private async token() {
    const data = await (await this.http('https://rest.fal.ai/storage/auth/token?storage_type=fal-cdn-v3', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiration_seconds: 3600 }) })).json() as { token: string };
    if (!data.token) throw Error('Cannot obtain a fal storage token.');
    return data.token;
  }
  async sign(file: string) {
    const url = cdnUrl(file);
    const response = await this.http(url.href + '/sign', { method: 'POST', headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ duration: 604800, scope: ['read'] }) }, false);
    const signed = (await response.text()).trim();
    const target = https(signed);
    if (target.origin !== url.origin || target.pathname !== url.pathname) throw Error('Invalid signed file address.');
    return signed;
  }
  async download(file: string, target: string) {
    const url = https(file);
    // Outputs come from fal, never an arbitrary user-supplied URL. Credentials
    // are only sent to the private v3 CDN, never to redirects or other hosts.
    if (url.host !== 'fal.media' && !url.host.endsWith('.fal.media')) throw Error('Unexpected output host.');
    const headers = url.host === 'v3b.fal.media' ? { Authorization: `Bearer ${await this.token()}` } : undefined;
    const response = await this.http(url.href, { headers, signal: AbortSignal.timeout(180000) }, false);
    const temp = target + '.part'; const handle = await open(temp, 'w');
    const hash = createHash('sha256'); let size = 0;
    try {
      if (!response.body) throw Error('Empty output.');
      for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 ** 3) throw Error('Output exceeds 2 GiB.'); hash.update(chunk); await handle.writeFile(chunk); }
      const expected = response.headers.get('content-length');
      if (!size || expected && !response.headers.get('content-encoding') && size !== Number(expected)) throw Error('Incomplete output download.');
      await handle.sync(); await handle.close(); await rename(temp, target);
      return { size, sha256: hash.digest('hex') };
    } catch (error) { await handle.close().catch(() => {}); await rm(temp, { force: true }); throw error; }
  }
}
