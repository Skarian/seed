import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {HttpAccess, normalizePublicOrigin} from '../server/http-access.js';
import {createApp} from '../server/http.js';
import {resolvePaths, type StudioPaths} from '../server/storage.js';
import {saveSettings, settings} from '../server/settings.js';

const host = '127.0.0.1:4311', localUrl = `http://${host}`, publicOrigin = 'https://seed.example.com';
const localHeaders = {host, origin: localUrl};
const remoteHeaders = {host: 'seed.example.com', origin: publicOrigin, 'sec-fetch-site': 'same-origin'};
let root: string, paths: StudioPaths, app: Awaited<ReturnType<typeof createApp>> | undefined;
const offline = vi.fn<typeof fetch>(async () => { throw Error('External requests are forbidden in this fixture.'); });

beforeEach(() => {
  mkdirSync('.local/tests', {recursive: true});
  root = mkdtempSync(path.resolve('.local/tests/http-access-'));
  paths = resolvePaths(root);
  mkdirSync(paths.config, {recursive: true});
  saveSettings(paths, {host: '127.0.0.1', port: 4311});
  offline.mockClear();
});
afterEach(async () => {
  await app?.close(); app = undefined;
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(offline).not.toHaveBeenCalled();
  rmSync(root, {recursive: true, force: true});
});
async function start() {
  app = await createApp({paths, port: 4311, webRoot: path.resolve('dist/web'), providerFetch: offline, chatFetch: offline});
  return app;
}
async function update(value: unknown, headers = localHeaders) {
  return app!.inject({method: 'PATCH', url: '/api/v1/admin/access', headers, payload: {publicOrigin: value}});
}

describe('explicit remote address settings', () => {
  it('defaults old settings to local-only and normalizes an HTTPS origin', () => {
    const access = new HttpAccess(paths, '127.0.0.1', 4311);
    expect(access.snapshot()).toEqual({localUrl, publicOrigin: null});
    expect(access.originFor(host)).toBe(localUrl);
    expect(access.originFor('seed.example.com')).toBeUndefined();
    expect(access.update('  https://SEED.Example.com:443/  ')).toEqual({localUrl, publicOrigin});
    expect(access.originFor('SEED.EXAMPLE.COM')).toBe(publicOrigin);
    expect(settings(paths)).toEqual({host: '127.0.0.1', port: 4311, publicOrigin});
    expect(new HttpAccess(paths, '127.0.0.1', 4311).snapshot()).toEqual(access.snapshot());
    expect(normalizePublicOrigin('https://seed.example.com:8443', localUrl)).toBe('https://seed.example.com:8443');
    expect(normalizePublicOrigin(null, localUrl)).toBeNull();
  });

  it.each([
    '', 'seed.example.com', 'http://seed.example.com', 'https:seed.example.com',
    'https://name:secret@seed.example.com', 'https://seed.example.com/path',
    'https://seed.example.com/path/..', 'https://seed.example.com/?', 'https://seed.example.com/#',
    'https://seed.example.com/?x=1', 'https://seed.example.com/#fragment',
    'https://*.example.com', 'https://seed.example.com\\', 'https://seed.example.com\n.evil.test',
    'https://127.0.0.1:4311', 'https://seed.example.com:invalid', 123, false, {},
  ])('rejects invalid or ambiguous origin %j without changing settings', value => {
    const access = new HttpAccess(paths, '127.0.0.1', 4311);
    const before = readFileSync(path.join(paths.config, 'settings.json'), 'utf8');
    expect(() => access.update(value as string)).toThrow();
    expect(access.snapshot()).toEqual({localUrl, publicOrigin: null});
    expect(readFileSync(path.join(paths.config, 'settings.json'), 'utf8')).toBe(before);
  });

  it('rejects invalid persisted access before database or coordinator creation', async () => {
    writeFileSync(path.join(paths.config, 'settings.json'), JSON.stringify({host: '127.0.0.1', port: 4311, publicOrigin: 'https://*.example.com'}));
    await expect(start()).rejects.toThrow('without a path');
    expect(existsSync(paths.data)).toBe(false);
  });

  it('keeps persisted and active settings unchanged when atomic persistence fails', () => {
    const access = new HttpAccess(paths, '127.0.0.1', 4311);
    access.update(publicOrigin);
    const before = readFileSync(path.join(paths.config, 'settings.json'), 'utf8');
    mkdirSync(path.join(paths.config, 'settings.json.tmp'));
    expect(() => access.update('https://replacement.example.com')).toThrow('Could not save access settings.');
    expect(access.snapshot()).toEqual({localUrl, publicOrigin});
    expect(access.originFor('seed.example.com')).toBe(publicOrigin);
    expect(access.originFor('replacement.example.com')).toBeUndefined();
    expect(readFileSync(path.join(paths.config, 'settings.json'), 'utf8')).toBe(before);
  });
});

describe('local and proxy HTTP boundary', () => {
  it('enables, replaces and clears the address immediately while retaining LAN and the same server instance', async () => {
    await start();
    const health = () => app!.inject({url: '/api/v1/health', headers: {host}});
    const before = (await health()).json().instance_id;
    expect((await app!.inject({url: '/api/v1/admin/access', headers: {host}})).json()).toEqual({localUrl, publicOrigin: null});
    expect((await app!.inject({url: '/api/v1/health', headers: remoteHeaders})).statusCode).toBe(403);
    expect((await update(publicOrigin)).json()).toEqual({localUrl, publicOrigin});
    expect((await app!.inject({url: '/api/v1/admin/access', headers: remoteHeaders})).json()).toEqual({localUrl, publicOrigin});
    expect((await app!.inject({url: '/api/v1/health', headers: {host: remoteHeaders.host}})).statusCode).toBe(200);
    expect((await app!.inject({method: 'HEAD', url: '/api/v1/health', headers: {host: remoteHeaders.host}})).statusCode).toBe(200);
    const renamed = 'https://new.example.com';
    expect((await update(renamed, remoteHeaders)).statusCode).toBe(200);
    expect((await app!.inject({url: '/api/v1/health', headers: remoteHeaders})).statusCode).toBe(403);
    expect((await app!.inject({url: '/api/v1/health', headers: {host: 'new.example.com', origin: renamed}})).statusCode).toBe(200);
    expect((await health()).json().instance_id).toBe(before);
    expect((await update(null)).json()).toEqual({localUrl, publicOrigin: null});
    expect((await app!.inject({url: '/api/v1/health', headers: {host: 'new.example.com'}})).statusCode).toBe(403);
    expect((await health()).statusCode).toBe(200);
    expect(settings(paths)).toEqual({host: '127.0.0.1', port: 4311, publicOrigin: null});
  });

  it('accepts only the exact Host and Origin pair and never trusts forwarded headers', async () => {
    saveSettings(paths, {...settings(paths), publicOrigin});
    await start();
    const cases = [
      {host: 'evil.test', origin: publicOrigin},
      {host: 'seed.example.com.evil.test', origin: publicOrigin},
      {host: 'seed.example.com:8443', origin: publicOrigin},
      {...localHeaders, origin: publicOrigin},
      {...remoteHeaders, origin: localUrl},
      {...remoteHeaders, origin: 'http://seed.example.com'},
      {...remoteHeaders, origin: 'null'},
      {...remoteHeaders, 'sec-fetch-site': 'cross-site'},
      {...remoteHeaders, 'sec-fetch-site': 'same-site'},
      {host: 'evil.test', origin: publicOrigin, 'x-forwarded-host': 'seed.example.com', 'x-forwarded-proto': 'https'},
      {...localHeaders, origin: publicOrigin, 'x-forwarded-host': 'seed.example.com', 'x-forwarded-proto': 'https', forwarded: 'host=seed.example.com;proto=https'},
    ];
    for (const headers of cases) {
      const response = await app!.inject({url: '/api/v1/admin/access', headers});
      expect(response.statusCode, JSON.stringify(headers)).toBe(403);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
    // Contradictory proxy metadata cannot change a correctly paired request either.
    expect((await app!.inject({url: '/api/v1/health', headers: {...remoteHeaders, 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'http'}})).statusCode).toBe(200);
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] as const) {
      const result = await app!.inject({method, url: '/api/v1/admin/access', headers: {host: remoteHeaders.host}, payload: {publicOrigin: null}});
      expect(result.statusCode).toBe(403); expect(result.json().error.code).toBe('origin_required');
    }
  });

  it('loads page navigations after an identity-provider redirect', async () => {
    saveSettings(paths, {...settings(paths), publicOrigin});
    await start();
    for (const site of ['cross-site', 'same-site']) {
      const headers = {host: remoteHeaders.host, 'sec-fetch-site': site, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document'};
      for (const url of ['/', '/index.html', '/library', '/chat?chat=example', '/admin']) {
        const response = await app!.inject({url, headers});
        expect(response.statusCode, `${site} ${url}`).toBe(200);
        expect(response.headers['content-type']).toContain('text/html');
        expect(response.body).toContain('<div id="root">');
      }
    }
  });

  it('keeps cross-site APIs, embeds, writes and hostile origins blocked during navigation', async () => {
    saveSettings(paths, {...settings(paths), publicOrigin});
    await start();
    const navigation = {host: remoteHeaders.host, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document'};
    for (const url of ['/api/v1/admin/access', '/api/v1/assets', '/api/v1/assets/example/content', '/admin/../api/v1/assets']) {
      expect((await app!.inject({url, headers: navigation})).statusCode, url).toBe(403);
    }
    for (const headers of [
      {...navigation, 'sec-fetch-mode': 'cors'},
      {...navigation, 'sec-fetch-mode': 'no-cors'},
      {...navigation, 'sec-fetch-dest': 'iframe'},
      {...navigation, 'sec-fetch-dest': 'image'},
      {...navigation, 'sec-fetch-dest': 'script'},
      {...navigation, 'sec-fetch-dest': ''},
      {...navigation, origin: 'https://evil.test'},
      {...navigation, origin: 'null'},
      {...navigation, host: 'evil.test'},
      {host: remoteHeaders.host, 'sec-fetch-site': 'cross-site'},
    ]) {
      expect((await app!.inject({url: '/', headers})).statusCode, JSON.stringify(headers)).toBe(403);
    }
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] as const) {
      expect((await app!.inject({method, url: '/', headers: navigation})).statusCode, method).toBe(403);
    }
    expect((await app!.inject({url: '/api/v1/admin/access', headers: remoteHeaders})).statusCode).toBe(200);
    expect((await app!.inject({method: 'PATCH', url: '/api/v1/admin/access', headers: remoteHeaders, payload: {publicOrigin}})).statusCode).toBe(200);
  });

  it('rejects malformed settings and reports a save failure without changing the active policy', async () => {
    saveSettings(paths, {...settings(paths), publicOrigin});
    await start();
    expect((await update('http://seed.example.com')).statusCode).toBe(409);
    for (const payload of [{}, {publicOrigin: null, host: '0.0.0.0'}, {publicOrigin: {}}]) {
      expect((await app!.inject({method: 'PATCH', url: '/api/v1/admin/access', headers: localHeaders, payload})).statusCode).toBe(400);
    }
    const before = readFileSync(path.join(paths.config, 'settings.json'), 'utf8');
    mkdirSync(path.join(paths.config, 'settings.json.tmp'));
    const result = await update(null);
    expect(result.statusCode).toBe(409); expect(result.json().error.message).toBe('Could not save access settings. Try again.');
    expect((await app!.inject({url: '/api/v1/admin/access', headers: remoteHeaders})).json()).toEqual({localUrl, publicOrigin});
    expect(readFileSync(path.join(paths.config, 'settings.json'), 'utf8')).toBe(before);
  });

  it('restores the saved origin after restart and preserves a cleared setting', async () => {
    await start(); await update(publicOrigin);
    await app!.close(); app = undefined; await start();
    expect((await app!.inject({url: '/api/v1/admin/access', headers: remoteHeaders})).json()).toEqual({localUrl, publicOrigin});
    await update(null); await app!.close(); app = undefined; await start();
    expect((await app!.inject({url: '/api/v1/admin/access', headers: {host}})).json()).toEqual({localUrl, publicOrigin: null});
    expect((await app!.inject({url: '/api/v1/health', headers: remoteHeaders})).statusCode).toBe(403);
  });
});
