import type {AccessSettings} from '../shared/access.js';
import type {StudioPaths} from './storage.js';
import {settings, saveSettings} from './settings.js';

export function normalizePublicOrigin(value: unknown, localUrl: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    throw Error('Enter an HTTPS address, or clear the remote URL.');
  }
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw Error('Enter a complete HTTPS address, such as https://seed.example.com.'); }
  if (!/^https:\/\/[^/?#\\\s]+\/?$/i.test(value.trim()) || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname.includes('*')) {
    throw Error('Use an HTTPS address without a path, query, login, or wildcard.');
  }
  if (url.host === new URL(localUrl).host) throw Error('The remote URL must use a different hostname or port from the local address.');
  return url.origin;
}

/** Explicit browser origins; proxy headers never establish trust. */
export class HttpAccess {
  private state: AccessSettings;
  private origins: ReadonlyMap<string, string>;

  constructor(private paths: StudioPaths, host: string, port: number) {
    const localUrl = `http://${host}:${port}`;
    this.state = {localUrl, publicOrigin: normalizePublicOrigin(settings(paths).publicOrigin, localUrl)};
    this.origins = this.policy(this.state);
  }

  private policy(value: AccessSettings): ReadonlyMap<string, string> {
    const origins = new Map([[new URL(value.localUrl).host, value.localUrl]]);
    if (value.publicOrigin) origins.set(new URL(value.publicOrigin).host, value.publicOrigin);
    return origins;
  }

  snapshot(): AccessSettings { return {...this.state}; }
  originFor(host: string | undefined): string | undefined { return host ? this.origins.get(host.toLowerCase()) : undefined; }

  update(value: string | null): AccessSettings {
    const next = {...this.state, publicOrigin: normalizePublicOrigin(value, this.state.localUrl)};
    const origins = this.policy(next);
    try { saveSettings(this.paths, {...settings(this.paths), publicOrigin: next.publicOrigin}); }
    catch { throw Error('Could not save access settings. Try again.'); }
    this.state = next;
    this.origins = origins;
    return this.snapshot();
  }
}
