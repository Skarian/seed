import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  rmSync,
  createWriteStream,
} from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import type { StudioPaths } from './storage.js';
import { credential } from './credential-store.js';
import { Loras, digest, loraGroupId } from './loras.js';
import type { FalTransport } from './fal.js';
import { FalError } from './fal-errors.js';
import {
  familyRoutes,
  type LoraFamily,
  type LoraRoute,
  type LoraGuidance,
  type LoraPreview,
  type LoraImportActivity,
  type ImportState,
} from '../shared/loras.js';

type ImportFile = LoraImportActivity['files'][number] & {
  file_id?: number;
  sha256?: string;
  download_url?: string;
  lora_id?: string;
  source_id?: string;
};
type ImportJob = LoraGuidance & {
  id: string;
  group_id: string;
  mode: 'sfw' | 'nsfw';
  version_id?: number;
  version?: string;
  source_url?: string;
  enabled: boolean;
  family: LoraFamily;
  state: ImportState;
  files: ImportFile[];
  created_at: string;
  updated_at: string;
  error?: string;
};
const validId = (v: unknown) => Number.isSafeInteger(Number(v)) && Number(v) > 0;
const familyOf = (base: string): LoraFamily | null =>
  /krea[ -]?2/i.test(base) ? 'krea2' : /minimax.*h3|\bh3\b/i.test(base) ? 'h3' : null;
export function civitaiLocation(raw: unknown) {
  if (typeof raw !== 'string') throw Error('Paste a Civitai model or model-version URL.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Error('Paste a Civitai model URL.');
  }
  if (
    url.protocol !== 'https:' ||
    !['civitai.com', 'www.civitai.com'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  )
    throw Error('Use an HTTPS Civitai model URL.');
  const model = url.pathname.match(/^\/models\/(\d+)(?:\/.*)?$/),
    version = url.pathname.match(/^\/api\/(?:v1\/model-versions|download\/models)\/(\d+)\/?$/);
  const versionId = url.searchParams.get('modelVersionId') ?? version?.[1];
  if ((versionId && !validId(versionId)) || (!model && !version))
    throw Error('Choose a Civitai model or model-version page.');
  return {
    modelId: model ? Number(model[1]) : undefined,
    versionId: versionId ? Number(versionId) : undefined,
  };
}
function guidance(input: any): LoraGuidance {
  if (
    typeof input?.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 150 ||
    typeof input.description !== 'string' ||
    input.description.length > 4000 ||
    !Number.isFinite(input.default_scale) ||
    input.default_scale < 0 ||
    input.default_scale > 4 ||
    !Array.isArray(input.trigger_words) ||
    input.trigger_words.length > 30 ||
    input.trigger_words.some((s: unknown) => typeof s !== 'string' || s.length > 200)
  )
    throw Error('Check the LoRA name, description, trigger words, and strength.');
  return {
    name: input.name.trim(),
    description: input.description,
    default_scale: input.default_scale,
    trigger_words: input.trigger_words,
  };
}
function mappings(input: any, family: LoraFamily) {
  if (
    !Array.isArray(input) ||
    !input.length ||
    input.length > familyRoutes(family).length ||
    input.some((f) => !f || !familyRoutes(family).includes(f.route)) ||
    new Set(input.map((f) => f.route)).size !== input.length
  )
    throw Error('Map one file to each workflow you want to use.');
}

export class LoraImports {
  private file: string;
  private jobs: ImportJob[];
  private active: Promise<void> | undefined;
  private closing = false;
  private abort = new AbortController();
  constructor(
    private paths: StudioPaths,
    private loras: Loras,
    private fal: FalTransport,
    private fetcher: typeof fetch = fetch,
  ) {
    this.file = path.join(paths.config, 'lora-imports.json');
    const saved = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : [];
    this.jobs = saved.map((old: any) => {
      if (old.files) return old;
      const entry = this.loras.all().find((e) => e.id === old.lora_id);
      return {
        ...old,
        group_id: entry ? loraGroupId(entry) : 'import-' + old.id,
        enabled: true,
        family: old.route === 'image' ? 'krea2' : 'h3',
        updated_at: old.created_at,
        files: [
          {
            file_id: old.file_id,
            name: entry?.filename ?? 'Imported adapter',
            route: old.route,
            state: old.state,
            bytes: old.bytes,
            total: old.total,
            lora_id: old.lora_id,
          },
        ],
        source_url: entry?.source_url,
        version: entry?.version,
      };
    });
    for (const job of this.jobs)
      if (!['queued', 'ready', 'failed'].includes(job.state)) {
        job.state = 'failed';
        job.error = 'Import was interrupted. Retry in Activity to finish.';
        for (const file of job.files) if (file.state !== 'ready') file.state = 'failed';
      }
    this.save();
    queueMicrotask(() => this.pump());
  }
  private save() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.jobs, null, 2));
    renameSync(tmp, this.file);
  }
  private changed(job: ImportJob) {
    job.updated_at = new Date().toISOString();
    this.save();
  }
  list(mode: 'sfw' | 'nsfw'): LoraImportActivity[] {
    return this.jobs
      .filter((j) => mode === 'nsfw' || j.mode === 'sfw')
      .map((j) => ({
        id: j.id,
        name: j.name,
        version: j.version,
        state: j.state,
        created_at: j.created_at,
        updated_at: j.updated_at,
        error: j.error,
        files: j.files.map(({ name, route, state, bytes, total, error }) => ({
          name,
          route,
          state,
          bytes,
          total,
          error,
        })),
      }));
  }
  busy() {
    return this.jobs.some((j) => !['ready', 'failed'].includes(j.state));
  }
  async close() {
    this.closing = true;
    this.abort.abort();
    await this.active;
  }
  private async metadata(route: string) {
    const key = credential(this.paths, 'civitaiKey');
    const response = await this.fetcher('https://civitai.com/api/v1/' + route, {
      headers: key ? { Authorization: 'Bearer ' + key } : {},
      redirect: 'error',
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(
        response.status === 401 || response.status === 403
          ? 'Civitai denied access. Check your Civitai key and access to this version.'
          : response.status === 404
            ? 'This Civitai model or version is unavailable.'
            : response.status === 429
              ? 'Civitai is busy. Wait and retry.'
              : 'Could not read Civitai metadata. Try again.',
      );
    }
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) throw Error('Civitai metadata is too large.');
    return JSON.parse(text);
  }
  async inspect(url: string): Promise<LoraPreview> {
    const location = civitaiLocation(url);
    if (location.versionId) {
      const v = await this.metadata('model-versions/' + location.versionId);
      if (location.modelId && v.modelId !== location.modelId)
        throw Error('The version does not belong to this model.');
      return this.preview(v.model, v.modelId, [v]);
    }
    const model = await this.metadata('models/' + location.modelId);
    return this.preview(model, model.id, model.modelVersions ?? []);
  }
  private preview(model: any, modelId: number, versions: any[]): LoraPreview {
    if (!['lora', 'locon'].includes(String(model?.type).toLowerCase()))
      throw Error('Choose a LoRA or LoKR adapter, not a base model.');
    return {
      name: String(model.name).slice(0, 150),
      model_id: modelId,
      versions: versions
        .slice(0, 80)
        .map((v) => ({
          id: v.id,
          name: String(v.name).slice(0, 100),
          base_model: String(v.baseModel),
          family: familyOf(String(v.baseModel)),
          supported: familyOf(String(v.baseModel)) !== null,
          trigger_words: (v.trainedWords ?? [])
            .filter((w: unknown) => typeof w === 'string')
            .slice(0, 30),
          files: (v.files ?? []).map((f: any) => ({
            id: f.id,
            name: String(f.name),
            size_bytes: Math.round(f.sizeKB * 1024),
            supported: /\.safetensors$/i.test(f.name),
          })),
        })),
    };
  }
  private enqueue(job: ImportJob) {
    if (
      this.jobs.some((j) => j.group_id === job.group_id && !['ready', 'failed'].includes(j.state))
    )
      throw Error('An import for this LoRA is already in Activity.');
    this.jobs = this.jobs.filter((j) => j.group_id !== job.group_id || j.state !== 'failed');
    this.jobs.unshift(job);
    this.save();
    this.pump();
    return this.list(job.mode).find((j) => j.id === job.id)!;
  }
  async add(input: any) {
    const details = guidance(input);
    if (!this.fal.configured) throw Error('Set the fal key in Credentials before importing.');
    if (!validId(input.version_id) || !['sfw', 'nsfw'].includes(input.mode))
      throw Error('Choose a model version.');
    const version = await this.metadata('model-versions/' + input.version_id),
      preview = this.preview(version.model, version.modelId, [version]).versions[0]!;
    if (!preview.family)
      throw Error('This model is not supported. Choose a Krea 2 or MiniMax H3 LoRA.');
    mappings(input.files, preview.family);
    if (new Set(input.files.map((f: any) => f.file_id)).size !== input.files.length)
      throw Error('Choose each file once.');
    const files: ImportFile[] = input.files.map((mapping: any) => {
      const file = version.files.find(
        (f: any) => f.id === mapping.file_id && /\.safetensors$/i.test(f.name),
      );
      if (
        !file ||
        !/^[a-f0-9]{64}$/i.test(file.hashes?.SHA256 ?? '') ||
        !Number.isFinite(file.sizeKB) ||
        file.sizeKB <= 0 ||
        file.sizeKB * 1024 > 8 * 1024 ** 3
      )
        throw Error('Choose a supported adapter file with a checksum and size under 8 GiB.');
      return {
        file_id: file.id,
        name: file.name,
        route: mapping.route,
        sha256: file.hashes.SHA256.toLowerCase(),
        download_url: file.downloadUrl,
        state: 'queued',
        bytes: 0,
        total: Math.round(file.sizeKB * 1024),
      };
    });
    const source_url = `https://civitai.com/models/${version.modelId}?modelVersionId=${version.id}`;
    const group_id = loraGroupId({
      id: '',
      route: files[0]!.route,
      source_url,
      availability: input.mode === 'nsfw' ? 'spicy' : 'all',
    });
    const existing = this.loras.groups(input.mode).find((g) => g.id === group_id);
    const now = new Date().toISOString();
    return this.enqueue({
      ...details,
      id: randomUUID(),
      group_id,
      mode: input.mode,
      version_id: version.id,
      version: preview.name,
      source_url,
      family: preview.family,
      enabled: existing?.enabled ?? true,
      state: 'queued',
      files,
      created_at: now,
      updated_at: now,
    });
  }
  edit(groupId: string, input: any) {
    const details = guidance(input),
      group = this.loras.groups('nsfw').find((g) => g.id === groupId);
    if (!group) throw Error('This LoRA is no longer available.');
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
      throw Error('Choose whether this LoRA is enabled.');
    mappings(input.files, group.family);
    if (new Set(input.files.map((f: any) => f.id)).size !== input.files.length)
      throw Error('Choose each file once.');
    const files: ImportFile[] = input.files.map((mapping: any) => {
      const source = group.files.find((f) => f.id === mapping.id);
      if (!source) throw Error('A selected file is not part of this LoRA.');
      return {
        source_id: source.id,
        name: source.name,
        route: mapping.route,
        state: 'queued',
        bytes: 0,
        total: 0,
      };
    });
    const now = new Date().toISOString();
    return this.enqueue({
      ...details,
      id: randomUUID(),
      group_id: groupId,
      mode: group.availability === 'all' ? 'sfw' : 'nsfw',
      version: group.version,
      source_url: group.source_url,
      family: group.family,
      enabled: input.enabled ?? group.enabled,
      state: 'queued',
      files,
      created_at: now,
      updated_at: now,
    });
  }
  retry(id: string) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.state !== 'failed') throw Error('This import cannot be retried yet.');
    if (
      this.jobs.some(
        (j) => j.id !== id && j.group_id === job.group_id && !['ready', 'failed'].includes(j.state),
      )
    )
      throw Error('An import for this LoRA is already in Activity.');
    job.state = 'queued';
    delete job.error;
    for (const file of job.files)
      if (file.state !== 'ready') {
        file.state = 'queued';
        delete file.error;
      }
    this.changed(job);
    this.pump();
    return { queued: true };
  }
  private pump() {
    if (this.closing || this.active) return;
    const job = [...this.jobs].reverse().find((j) => j.state === 'queued');
    if (!job) return;
    this.active = this.run(job)
      .catch((error) => {
        job.state = 'failed';
        job.error = this.abort.signal.aborted
          ? 'Import was interrupted. Retry to finish.'
          : error instanceof FalError
            ? error.message
            : error instanceof Error &&
                /^(Civitai|This |The |Imported |Choose )/.test(error.message)
              ? error.message
              : 'Could not finish this import. Check Civitai access, storage, and your fal key, then retry.';
        const current = job.files.find((f) => !['ready', 'queued'].includes(f.state));
        if (current) {
          current.state = 'failed';
          current.error = job.error;
        }
        this.changed(job);
      })
      .finally(() => {
        this.active = undefined;
        this.pump();
      });
  }
  private async download(url: string, file: string, job: ImportFile, expected: string) {
    let target = new URL(url),
      response: Response | undefined;
    for (let redirects = 0; redirects < 6; redirects++) {
      if (
        target.protocol !== 'https:' ||
        target.username ||
        target.password ||
        target.port ||
        !(
          target.hostname === 'civitai.com' ||
          target.hostname.endsWith('.civitai.com') ||
          target.hostname.endsWith('.r2.cloudflarestorage.com') ||
          target.hostname.endsWith('.civitai.net')
        )
      )
        throw Error('Civitai returned an unsupported download host.');
      const key = target.hostname === 'civitai.com' ? credential(this.paths, 'civitaiKey') : '';
      response = await this.fetcher(target, {
        headers: key ? { Authorization: 'Bearer ' + key } : {},
        redirect: 'manual',
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30 * 60 * 1000)]),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get('location');
        await response.body?.cancel();
        if (!next) throw Error('Civitai download redirect is missing.');
        target = new URL(next, target);
        continue;
      }
      break;
    }
    if (!response?.ok || !response.body) {
      await response?.body?.cancel();
      throw Error('Civitai download failed. Check your key and access to this file.');
    }
    job.total = Number(response.headers.get('content-length')) || job.total;
    job.bytes = 0;
    this.save();
    const hash = createHash('sha256');
    let saved = Date.now();
    const counter = new Transform({
      transform: (bytes, _encoding, callback) => {
        job.bytes += bytes.length;
        if (job.bytes > 8 * 1024 ** 3) {
          callback(Error('Civitai adapter exceeds the 8 GiB limit.'));
          return;
        }
        hash.update(bytes);
        if (Date.now() - saved > 1000) {
          saved = Date.now();
          this.save();
        }
        callback(null, bytes);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as any),
      counter,
      createWriteStream(file, { flags: 'w' }),
      { signal: this.abort.signal },
    );
    if (hash.digest('hex').toLowerCase() !== expected.toLowerCase())
      throw Error('Civitai file checksum did not match. Retry the download.');
  }

  private async run(job: ImportJob) {
    for (const file of job.files) {
      if (file.state === 'ready') continue;
      if (!file.lora_id) {
        if (file.source_id) {
          const source = this.loras.all().find((e) => e.id === file.source_id);
          if (!source) throw Error('The original adapter is missing.');
          job.state = file.state = 'validating';
          this.changed(job);
          if ((await digest(source.file)) !== source.revision)
            throw Error('The local adapter checksum has changed. Import the file again.');
          file.lora_id = await this.loras.add(source.file, file.route, job.name, job.group_id);
        } else {
          if (!file.sha256) {
            const version = await this.metadata('model-versions/' + job.version_id);
            const source = version.files.find((f: any) => f.id === file.file_id);
            if (
              !source ||
              !familyOf(version.baseModel) ||
              !/^[a-f0-9]{64}$/i.test(source.hashes?.SHA256 ?? '')
            )
              throw Error('Civitai file is no longer available.');
            file.sha256 = source.hashes.SHA256.toLowerCase();
            file.download_url = source.downloadUrl;
            file.name = source.name;
            job.version = version.name;
          }
          const directory = path.join(this.paths.data, 'loras');
          mkdirSync(directory, { recursive: true });
          const local = path.join(directory, file.sha256 + '.safetensors');
          if (!existsSync(local)) {
            const temporary = path.join(
              this.paths.temp,
              job.id + '-' + file.route + '.safetensors',
            );
            try {
              job.state = file.state = 'downloading';
              this.changed(job);
              await this.download(file.download_url!, temporary, file, file.sha256!);
              job.state = file.state = 'validating';
              this.changed(job);
              file.lora_id = await this.loras.add(temporary, file.route, job.name, job.group_id);
            } finally {
              rmSync(temporary, { force: true });
            }
          } else {
            job.state = file.state = 'validating';
            this.changed(job);
            if ((await digest(local)) !== file.sha256)
              throw Error(
                'Civitai file checksum does not match the local copy. Import a valid file before retrying.',
              );
            file.lora_id = await this.loras.add(local, file.route, job.name, job.group_id);
          }
        }
        this.changed(job);
      }
      const entry = this.loras.all().find((e) => e.id === file.lora_id);
      if (!entry) throw Error('Imported adapter is missing.');
      job.state = file.state = 'uploading';
      this.changed(job);
      await this.loras.url(entry.id, entry.revision, this.fal);
      file.state = 'ready';
      this.changed(job);
    }
    this.loras.applyGroup(
      job.group_id,
      job.files.map((f) => ({ id: f.lora_id!, name: f.name, route: f.route })),
      {
        name: job.name,
        description: job.description,
        default_scale: job.default_scale,
        trigger_words: job.trigger_words,
        version: job.version,
        source_url: job.source_url,
        enabled: job.enabled,
        availability: job.mode === 'sfw' ? 'all' : 'spicy',
      },
    );
    job.state = 'ready';
    delete job.error;
    this.changed(job);
  }
}
