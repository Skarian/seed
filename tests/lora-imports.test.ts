import { it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolvePaths, prepareStorage } from '../server/storage.js';
import { Loras } from '../server/loras.js';
import { LoraImports, civitaiLocation } from '../server/lora-imports.js';
import { FalError } from '../server/fal-errors.js';
import { fakeFal } from './fake-fal.js';
import Fastify from 'fastify';
import {registerAdmin} from '../server/admin.js';
import type {Jobs} from '../server/jobs.js';
import {Pricing} from '../server/pricing.js';
async function fixture(run: (f: any) => Promise<void>) {
  mkdirSync('.local/tests', { recursive: true });
  const root = mkdtempSync(path.resolve('.local/tests/import-')),
    paths = resolvePaths(root);
  prepareStorage(paths);
  writeFileSync(
    path.join(paths.config, 'credentials.json'),
    JSON.stringify({ civitaiKey: 'private-civitai-key' }),
  );
  const header = Buffer.from(
      JSON.stringify({ 'model.lokr_w1': { dtype: 'F32', shape: [1], data_offsets: [0, 4] } }),
    ),
    prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(header.length));
  const bytes = Buffer.concat([prefix, header, Buffer.alloc(4)]),
    sha = createHash('sha256').update(bytes).digest('hex');
  const version = {
    id: 10,
    modelId: 5,
    name: 'v1',
    baseModel: 'Krea 2',
    model: { name: 'Watercolor', type: 'LORA' },
    trainedWords: ['watercolor'],
    files: [
      {
        id: 20,
        name: 'watercolor.safetensors',
        sizeKB: bytes.length / 1024,
        hashes: { SHA256: sha },
        downloadUrl: 'https://civitai.com/api/download/models/10',
      },
    ],
  };
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const target = String(url);
    if (target.includes('/api/v1/')) return Response.json(version);
    if (target.includes('/api/download/'))
      return new Response(null, {
        status: 302,
        headers: { location: 'https://models.r2.cloudflarestorage.com/fixture' },
      });
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    return new Response(bytes);
  });
  const fal = fakeFal(),
    loras = new Loras(paths),
    imports = new LoraImports(paths, loras, fal, fetcher);
  const input = {
    version_id: 10,
    files: [{ file_id: 20, route: 'image' }],
    mode: 'sfw',
    name: 'Watercolor',
    description: 'Gentle watercolor; use strength 0.8 for landscapes.',
    default_scale: 0.8,
    trigger_words: ['watercolor'],
  };
  try {
    await run({ paths, version, bytes, sha, fetcher, fal, loras, imports, input });
  } finally {
    await imports.close();
    rmSync(root, { recursive: true, force: true });
  }
}
async function settled(imports: LoraImports) {
  for (let i = 0; i < 300; i++) {
    if (!imports.busy()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error('Import did not settle.');
}
it('only accepts Civitai model URLs', () => {
  expect(civitaiLocation('https://civitai.com/models/5?modelVersionId=10')).toEqual({
    modelId: 5,
    versionId: 10,
  });
  for (const url of [
    'http://civitai.com/models/1',
    'https://evil.test/models/1',
    'https://civitai.com@evil.test/models/1',
    'https://civitai.com/api/v1/me',
  ])
    expect(() => civitaiLocation(url)).toThrow();
});
it('acquires actual weights, verifies the hash, uploads privately, and exposes Standard metadata in both modes', async () =>
  fixture(async ({ imports, loras, fal, input, fetcher }) => {
    const preview = (await imports.inspect('https://civitai.com/models/5?modelVersionId=10'))
      .versions[0];
    expect(preview.family).toBe('krea2');
    expect(preview.files[0]).not.toHaveProperty('route_hint');
    await imports.add(input);
    await settled(imports);
    expect(imports.list('sfw')[0].state).toBe('ready');
    expect(fal.upload).toHaveBeenCalledTimes(1);
    const entry = loras.list('sfw')[0];
    expect(entry).toMatchObject({
      name: 'Watercolor',
      description: input.description,
      default_scale: 0.8,
      trigger_words: ['watercolor'],
      availability: 'all',
      enabled: true,
    });
    expect(loras.list('nsfw')[0].id).toBe(entry.id);
    expect(entry).not.toHaveProperty('file');
    const request = fetcher.mock.calls.find(([u]: any[]) => String(u).includes('/api/download/'));
    expect(new Headers(request[1].headers).get('Authorization')).toBe('Bearer private-civitai-key');
  }));
it('persists upload failure and retries without downloading again', async () =>
  fixture(async ({ imports, loras, fal, input, fetcher, paths }) => {
    fal.upload.mockRejectedValueOnce(new FalError(401));
    const job = await imports.add(input);
    await settled(imports);
    expect(imports.list('sfw')[0].state).toBe('failed');
    expect(loras.list('sfw')).toEqual([]);
    const requests = fetcher.mock.calls.length;
    await imports.close();
    const restarted = new LoraImports(paths, loras, fal, fetcher);
    try {
      restarted.retry(job.id);
      await settled(restarted);
      expect(restarted.list('sfw')[0]!.state).toBe('ready');
      expect(fetcher.mock.calls.length).toBe(requests);
      expect(loras.list('sfw')).toHaveLength(1);
    } finally {
      await restarted.close();
    }
  }));
it('rejects a corrupt cached file before uploading', async () =>
  fixture(async ({ imports, paths, sha, fal, input }) => {
    mkdirSync(path.join(paths.data, 'loras'), { recursive: true });
    writeFileSync(path.join(paths.data, 'loras', sha + '.safetensors'), 'corrupt');
    await imports.add(input);
    await settled(imports);
    expect(imports.list('sfw')[0]).toMatchObject({ state: 'failed' });
    expect(imports.list('sfw')[0].error).toContain('checksum');
    expect(fal.upload).not.toHaveBeenCalled();
  }));
it('rejects wrong architecture and mismatched download hashes before enabling an adapter', async () =>
  fixture(async ({ imports, version, fal, input, loras }) => {
    version.baseModel = 'Other model';
    await expect(imports.add(input)).rejects.toThrow('not supported');
    expect(imports.list('sfw')).toHaveLength(0);
    version.baseModel = 'Krea 2';
    version.files[0].hashes.SHA256 = '0'.repeat(64);
    await imports.add(input);
    await settled(imports);
    expect(imports.list('sfw')[0].error).toContain('checksum');
    expect(fal.upload).not.toHaveBeenCalled();
    expect(loras.list('sfw')).toEqual([]);
  }));

function twoFiles(f: any) {
  f.version.baseModel = 'MiniMax H3';
  f.version.files[0].name = 'alpha.safetensors';
  const second = Buffer.from(f.bytes);
  second[second.length - 1] = 1;
  f.version.files.push({
    ...f.version.files[0],
    id: 21,
    name: 'beta.safetensors',
    hashes: { SHA256: createHash('sha256').update(second).digest('hex') },
    downloadUrl: 'https://civitai.com/api/download/models/11',
  });
  f.fetcher.mockImplementation(async (url: string) =>
    String(url).includes('/api/v1/')
      ? Response.json(f.version)
      : new Response(String(url).endsWith('/11') ? second : f.bytes),
  );
  f.input.files = [
    { file_id: 20, route: 'fl' },
    { file_id: 21, route: 'ref' },
  ];
}

it('uses explicit mappings for arbitrary filenames, rejects duplicate workflows, and never guesses from names', async () =>
  fixture(async (f) => {
    twoFiles(f);
    const preview = await f.imports.inspect('https://civitai.com/models/5?modelVersionId=10');
    expect(preview.versions[0]).toMatchObject({ family: 'h3' });
    expect(preview.versions[0].files.map((file: any) => file.name)).toEqual([
      'alpha.safetensors',
      'beta.safetensors',
    ]);
    await expect(
      f.imports.add({
        ...f.input,
        files: [
          { file_id: 20, route: 'fl' },
          { file_id: 21, route: 'fl' },
        ],
      }),
    ).rejects.toThrow('one file');
    await expect(
      f.imports.add({ ...f.input, files: [{ file_id: 20, route: 'image' }] }),
    ).rejects.toThrow('one file');
    await expect(
      f.imports.add({ ...f.input, files: [{ file_id: 999, route: 'ref' }] }),
    ).rejects.toThrow('supported adapter file');
    expect(f.fal.upload).not.toHaveBeenCalled();
    await f.imports.add(f.input);
    await settled(f.imports);
    const groups = f.loras.groups('sfw');
    expect(groups).toHaveLength(1);
    expect(groups[0].files.map((file: any) => [file.name, file.route])).toEqual([
      ['alpha.safetensors', 'fl'],
      ['beta.safetensors', 'ref'],
    ]);
    const text = JSON.stringify(f.imports.list('sfw'));
    expect(text).not.toMatch(/download_url|sha256|lora_id|identity=|private-civitai-key/);
  }));

it('activates a mapped LoRA atomically and resumes only the failed file after restart', async () =>
  fixture(async (f) => {
    twoFiles(f);
    f.fal.upload
      .mockResolvedValueOnce('https://v3b.fal.media/files/b/test/first')
      .mockRejectedValueOnce(new FalError(401));
    const job = await f.imports.add(f.input);
    await settled(f.imports);
    expect(f.imports.list('sfw')[0]).toMatchObject({
      state: 'failed',
      files: [{ state: 'ready' }, { state: 'failed' }],
    });
    expect(f.loras.list('sfw')).toEqual([]);
    expect(f.loras.groups('sfw')).toEqual([]);
    const calls = f.fetcher.mock.calls.length;
    await f.imports.close();
    const restarted = new LoraImports(f.paths, f.loras, f.fal, f.fetcher);
    try {
      restarted.retry(job.id);
      await settled(restarted);
      expect(restarted.list('sfw')[0]!.state).toBe('ready');
      expect(f.fetcher.mock.calls).toHaveLength(calls);
      expect(f.fal.upload).toHaveBeenCalledTimes(3);
      expect(f.loras.groups('sfw')).toHaveLength(1);
      expect(f.loras.list('sfw')).toHaveLength(2);
    } finally {
      await restarted.close();
    }
  }));

it('updates mappings without duplicating uploads or claiming tested compatibility', async () =>
  fixture(async (f) => {
    twoFiles(f);
    await f.imports.add(f.input);
    await settled(f.imports);
    const group = f.loras.groups('sfw')[0];
    const entries = f.loras.list('sfw');
    f.loras.markVerified(
      entries.map((e: any) => ({ id: e.id, revision: e.revision, scale: 1 })),
      'test-request',
      'test-endpoint',
    );
    f.imports.edit(group.id, {
      ...f.input,
      enabled: true,
      files: group.files.map((file: any) => ({
        id: file.id,
        route: file.route === 'fl' ? 'ref' : 'fl',
      })),
    });
    await settled(f.imports);
    const updated = f.loras.groups('sfw')[0];
    expect(f.loras.groups('sfw')).toHaveLength(1);
    expect(updated.files.map((file: any) => file.compatibility)).toEqual(['untested', 'untested']);
    expect(updated.files.find((file: any) => file.name === 'alpha.safetensors').route).toBe('ref');
    expect(f.fal.upload).toHaveBeenCalledTimes(2);
    expect(f.loras.list('sfw').map((e: any) => e.id)).not.toEqual(entries.map((e: any) => e.id));
  }));

it('keeps the old mapped files available if a replacement import fails', async () =>
  fixture(async (f) => {
    await f.imports.add(f.input);
    await settled(f.imports);
    const before = f.loras.list('sfw');
    f.version.files[0].hashes.SHA256 = '0'.repeat(64);
    await f.imports.add({ ...f.input, name: 'Changed name' });
    await settled(f.imports);
    expect(f.imports.list('sfw')[0].state).toBe('failed');
    expect(f.loras.list('sfw')).toEqual(before);
  }));

it('groups pre-existing FL and Ref files without changing their IDs, hashes, or private upload receipts', async () =>
  fixture(async (f) => {
    twoFiles(f);
    await f.imports.add(f.input);
    await settled(f.imports);
    const file = path.join(f.paths.config, 'loras.json');
    const legacy = JSON.parse(readFileSync(file, 'utf8')).map(
      ({ group_id, staged, archived, ...entry }: any) => entry,
    );
    writeFileSync(file, JSON.stringify(legacy));
    const groups = f.loras.groups('sfw');
    expect(groups).toHaveLength(1);
    expect(groups[0].files).toHaveLength(2);
    expect(f.loras.all()).toEqual(legacy);
    expect(f.loras.list('sfw').map((entry: any) => entry.id)).toEqual(
      legacy.map((entry: any) => entry.id),
    );
  }));

it('returns grouped Admin data and reports imports only through Activity, scoped by mode', async () =>
  fixture(async (f) => {
    twoFiles(f);
    await f.imports.add({ ...f.input, mode: 'nsfw' });
    await settled(f.imports);
    const app=Fastify();
    registerAdmin(app,f.paths,{loras:f.loras} as Jobs,f.imports,new Pricing(f.paths,f.loras,f.fetcher),f.fetcher);
    const headers = { host: '127.0.0.1:4311', origin: 'http://127.0.0.1:4311' };
    try {
      const admin = (await app.inject({ url: '/api/v1/admin/loras?mode=nsfw', headers })).json();
      expect(admin.items).toHaveLength(1);
      expect(admin.items[0].files).toHaveLength(2);
      expect(admin).not.toHaveProperty('imports');
      expect(
        (await app.inject({ url: '/api/v1/admin/loras?mode=sfw', headers })).json().items,
      ).toEqual([]);
      expect(
        (await app.inject({ url: '/api/v1/lora-imports?mode=sfw', headers })).json().items,
      ).toEqual([]);
      const activity = (
        await app.inject({ url: '/api/v1/lora-imports?mode=nsfw', headers })
      ).json();
      expect(activity.items[0].files).toHaveLength(2);
      expect(JSON.stringify(admin) + JSON.stringify(activity)).not.toMatch(
        /cloudflarestorage|download_url|private-civitai-key|identity=/,
      );
    } finally {
      await app.close();
    }
  }));
