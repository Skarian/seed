import {
  createReadStream,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LoraGroup, LoraGuidance } from '../shared/loras.js';
import type { StudioPaths } from './storage.js';
import type { FalTransport } from './fal.js';
import { convertH3Lora, readTensorHeader } from './lora-convert.js';

export type LoraSelection = { id: string; revision: string; scale: number };
export type Lora = {
  group_id?: string;
  filename?: string;
  staged?: boolean;
  archived?: boolean;
  id: string;
  name: string;
  version?: string;
  description?: string;
  source_url?: string;
  availability?: 'all' | 'spicy';
  enabled?: boolean;
  default_scale?: number;
  trigger_words?: string[];
  route: 'image' | 'fl' | 'ref';
  revision: string;
  file: string;
  format: 'lora' | 'lokr';
  compatibility: 'untested' | 'verified';
  source_sha256?: string;
  conversion?: 'h3-kohya-v1';
  verification?: { request_id: string; endpoint: string; at: string };
  upload?: { url: string; expires_at: string };
};
export async function digest(file: string) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

export function loraGroupId(
  entry: Pick<Lora, 'id' | 'route' | 'source_url' | 'availability' | 'group_id'>,
) {
  if (entry.group_id) return entry.group_id;
  return entry.source_url
    ? 'lora-' +
        createHash('sha256')
          .update(
            entry.source_url +
              '|' +
              (entry.route === 'image' ? 'krea2' : 'h3') +
              '|' +
              (entry.availability ?? 'all'),
          )
          .digest('hex')
          .slice(0, 24)
    : entry.id;
}
export class Loras {
  private file: string;
  private uploads = new Map<string, Promise<string>>();
  constructor(private paths: StudioPaths) {
    this.file = path.join(paths.config, 'loras.json');
  }
  all(): Lora[] {
    try {
      const entries = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!Array.isArray(entries)) throw Error();
      return entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw Error('Cannot read loras.json.');
    }
  }
  private save(entries: Lora[]) {
    const tmp = this.file + '.' + randomUUID() + '.tmp';
    writeFileSync(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  list(mode?: 'sfw' | 'nsfw', admin = false) {
    return this.all()
      .filter(
        (entry) =>
          !entry.staged &&
          !entry.archived &&
          (admin || entry.enabled !== false) &&
          (mode !== 'sfw' || entry.availability !== 'spicy'),
      )
      .map(({ file, upload, ...entry }) => ({
        ...entry,
        enabled: entry.enabled !== false,
        availability: entry.availability ?? 'all',
        uploaded: Boolean(upload && Date.parse(upload.expires_at) > Date.now()),
        min_scale: 0,
        max_scale: 4,
        default_scale: entry.default_scale ?? 1,
      }));
  }
  update(
    id: string,
    patch: Partial<
      Pick<
        Lora,
        | 'name'
        | 'description'
        | 'availability'
        | 'default_scale'
        | 'trigger_words'
        | 'enabled'
        | 'version'
        | 'source_url'
      >
    >,
  ) {
    const entries = this.all();
    if (!entries.some((e) => e.id === id)) throw Error('LoRA not found.');
    if (patch.name !== undefined && (!patch.name.trim() || patch.name.length > 150))
      throw Error('Enter a name under 150 characters.');
    if (patch.description !== undefined && patch.description.length > 4000)
      throw Error('Keep the description under 4000 characters.');
    if (
      patch.default_scale !== undefined &&
      (!Number.isFinite(patch.default_scale) || patch.default_scale < 0 || patch.default_scale > 4)
    )
      throw Error('Strength must be between 0 and 4.');
    if (patch.availability !== undefined && !['all', 'spicy'].includes(patch.availability))
      throw Error('Choose a supported availability setting.');
    if (
      patch.trigger_words !== undefined &&
      (!Array.isArray(patch.trigger_words) ||
        patch.trigger_words.length > 30 ||
        patch.trigger_words.some((w) => typeof w !== 'string' || w.length > 200))
    )
      throw Error('Check the trigger words.');
    this.save(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }
  revision() {
    return existsSync(this.file) ? statSync(this.file).mtimeMs : 0;
  }
  groups(mode: 'sfw' | 'nsfw'): LoraGroup[] {
    const grouped = new Map<string, Lora[]>();
    for (const entry of this.all()) {
      if (entry.staged || entry.archived || (mode === 'sfw' && entry.availability === 'spicy'))
        continue;
      const id = loraGroupId(entry);
      grouped.set(id, [...(grouped.get(id) ?? []), entry]);
    }
    return [...grouped].map(([id, entries]) => {
      const first = entries[0]!;
      return {
        id,
        name: first.name,
        version: first.version,
        description: first.description ?? '',
        family: first.route === 'image' ? 'krea2' : 'h3',
        availability: first.availability ?? 'all',
        enabled: entries.some((e) => e.enabled !== false),
        default_scale: first.default_scale ?? 1,
        trigger_words: first.trigger_words ?? [],
        source_url: first.source_url,
        files: entries.map((e) => ({
          id: e.id,
          name: e.filename ?? 'Imported adapter',
          route: e.route,
          uploaded: Boolean(e.upload && Date.parse(e.upload.expires_at) > Date.now()),
          compatibility: e.compatibility,
        })),
      };
    });
  }
  applyGroup(
    groupId: string,
    files: Array<{ id: string; route: Lora['route']; name: string }>,
    guidance: LoraGuidance & {
      availability: 'all' | 'spicy';
      enabled: boolean;
      version?: string;
      source_url?: string;
    },
  ) {
    const entries = this.all();
    if (!files.length || new Set(files.map((f) => f.route)).size !== files.length)
      throw Error('Map one file to each workflow.');
    const selected = new Map(files.map((f) => [f.id, f]));
    for (const file of files) {
      const entry = entries.find((e) => e.id === file.id);
      if (!entry || entry.route !== file.route) throw Error('The mapped adapter is unavailable.');
    }
    this.save(
      entries.map((entry) => {
        const file = selected.get(entry.id);
        if (file)
          return {
            ...entry,
            ...guidance,
            group_id: groupId,
            filename: file.name,
            staged: false,
            archived: false,
          };
        return loraGroupId(entry) === groupId && !entry.staged
          ? { ...entry, archived: true, enabled: false }
          : entry;
      }),
    );
  }
  clearUploads() {
    this.save(this.all().map(({ upload, ...entry }) => entry));
  }
  setAvailability(id: string, availability: unknown) {
    if (availability !== 'all' && availability !== 'spicy')
      throw Error('Choose a supported availability setting.');
    const entries = this.all();
    if (!entries.some((entry) => entry.id === id)) throw Error('LoRA not found.');
    this.save(entries.map((entry) => (entry.id === id ? { ...entry, availability } : entry)));
  }
  async add(source: string, route: string, name: string, groupId?: string) {
    if (!['image', 'fl', 'ref'].includes(route) || !name.trim())
      throw Error('Choose image, fl, or ref and a name.');
    if (!source.endsWith('.safetensors')) throw Error('Choose a .safetensors adapter.');
    const sourceRevision = await digest(source);
    const tensors = Object.keys((await readTensorHeader(source)).tensors);
    let format: Lora['format'] = 'lora';
    if (tensors.some((k) => k.includes('lokr_'))) format = 'lokr';
    else if (!tensors.some((k) => /lora_[AB]|lora_down|lora_up/.test(k)))
      throw Error('No recognized adapter tensors.');
    const directory = path.join(this.paths.data, 'loras');
    mkdirSync(directory, { recursive: true });
    let revision = sourceRevision,
      file = path.join(directory, revision + '.safetensors');
    if (!existsSync(file)) copyFileSync(source, file);
    const converted = route !== 'image' && tensors.some((k) => k.startsWith('lora_unet_'));
    if (converted) {
      const temporary = path.join(directory, randomUUID() + '.safetensors');
      try {
        await convertH3Lora(file, temporary);
        revision = await digest(temporary);
        file = path.join(directory, revision + '.safetensors');
        if (!existsSync(file)) renameSync(temporary, file);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    const entries = this.all();
    if (groupId) {
      const existing = entries.find(
        (e) =>
          !e.archived && loraGroupId(e) === groupId && e.route === route && e.revision === revision,
      );
      if (existing) return existing.id;
    }
    const id = `${route}-${revision.slice(0, 16)}` + (groupId ? '-' + groupId : '');
    if (entries.some((e) => e.id === id)) return id;
    entries.push({
      ...(groupId ? { group_id: groupId, staged: true, enabled: false } : {}),
      id,
      name: name.trim(),
      route: route as Lora['route'],
      revision,
      file,
      format,
      compatibility: 'untested',
      ...(converted ? { source_sha256: sourceRevision, conversion: 'h3-kohya-v1' as const } : {}),
    });
    this.save(entries);
    return id;
  }
  markVerified(selected: LoraSelection[], request_id: string, endpoint: string) {
    if (!selected.length) return;
    this.save(
      this.all().map((entry) =>
        selected.some((s) => s.id === entry.id && s.revision === entry.revision)
          ? {
              ...entry,
              compatibility: 'verified',
              verification: { request_id, endpoint, at: new Date().toISOString() },
            }
          : entry,
      ),
    );
  }
  resolve(selected: LoraSelection[] = [], route: Lora['route'], mode: 'sfw' | 'nsfw' = 'sfw') {
    if (selected.length > 3 || new Set(selected.map((e) => e.id)).size !== selected.length)
      throw Error('Select at most three distinct LoRAs.');
    return selected.map((selection) => {
      const entry = this.all().find(
        (e) => e.id === selection.id && e.revision === selection.revision,
      );
      if (!entry || entry.enabled === false || entry.route !== route)
        throw Error(
          'LoRA version or model variant does not match this request, or the adapter is disabled.',
        );
      if (mode === 'sfw' && entry.availability === 'spicy')
        throw Error('This LoRA is unavailable for this request.');
      if (!Number.isFinite(selection.scale) || selection.scale < 0 || selection.scale > 4)
        throw Error('LoRA strength must be between 0 and 4.');
      return { ...entry, scale: selection.scale };
    });
  }
  async url(id: string, revision: string, fal: FalTransport) {
    const key = revision;
    let pending = this.uploads.get(key);
    if (!pending) {
      pending = this.ensureUrl(id, revision, fal).finally(() => this.uploads.delete(key));
      this.uploads.set(key, pending);
    }
    return pending;
  }
  private async ensureUrl(id: string, revision: string, fal: FalTransport) {
    const entries = this.all(),
      entry = entries.find((e) => e.id === id && e.revision === revision);
    if (!entry) throw Error('The selected adapter version is missing.');
    const previousUpload = entry.upload;
    const reusable = entries.find(
      (other) =>
        other.revision === revision &&
        other.upload &&
        Date.parse(other.upload.expires_at) > Date.now() + 86400000,
    )?.upload;
    if (reusable) entry.upload = reusable;
    if (!entry.upload || Date.parse(entry.upload.expires_at) < Date.now() + 86400000) {
      if ((await digest(entry.file)) !== entry.revision)
        throw Error('The local adapter has changed. Import it as a new version.');
      const url = await fal.upload(entry.file, true);
      entry.upload = { url, expires_at: new Date(Date.now() + 365 * 86400000).toISOString() };
      this.save(
        this.all().map((current) =>
          current.id === id && current.revision === revision
            ? { ...current, upload: entry.upload }
            : current,
        ),
      );
    }
    if (
      previousUpload?.url !== entry.upload.url ||
      previousUpload?.expires_at !== entry.upload.expires_at
    )
      this.save(
        this.all().map((current) =>
          current.id === id && current.revision === revision
            ? { ...current, upload: entry.upload }
            : current,
        ),
      );
    return fal.sign(entry.upload.url);
  }
}
