import { Upload } from 'tus-js-client';
import type { ImageRequest, InputReference } from '../../../shared/generation.js';
import {
  defaultPreferences,
  sizeChoices,
  resolveDimensions,
  dimensionLabel,
  type ResolutionSize,
} from '../../../shared/resolution.js';
import { DEFAULT_VIDEO_STEPS, DEFAULT_VIDEO_DETAIL } from '../../../shared/video-settings.js';
import { workflowOf, isVideoKind, type Kind } from '../api.js';

/** Settings for a direct make, remembered per kind. */
export type MakeSettings = {
  kind: Kind;
  aspect: '16:9' | '9:16' | '1:1' | '4:5';
  imageSize: ResolutionSize;
  videoSize: ResolutionSize;
  count: number;
  duration: number;
  sound: 'generated' | 'silent';
  detail: 'standard' | 'full';
  style?: { id: string; revision: string; scale: number };
  target: 'auto' | 'local' | 'cloud';
  /** 'random' for a new variation each time, or a starting seed to repeat a result. */
  seed?: string;
};
/** The model behind each kind, in plain words. */
export const engines: Record<Kind, string> = {
  image: 'Krea 2: fast stills, photographic or illustrated',
  edit: 'FLUX 3 Image Klein: edits a picture, or makes a new shot of the same character or place from reference images',
  video: 'MiniMax H3: 5 to 15 second clips, with sound if you want it',
  animate: 'MiniMax H3: clips guided by your images, video or audio',
};
export const defaultMake: MakeSettings = {
  kind: 'image',
  aspect: '16:9',
  imageSize: defaultPreferences.image,
  videoSize: defaultPreferences.video,
  count: 1,
  duration: 5,
  sound: 'generated',
  detail: DEFAULT_VIDEO_DETAIL,
  target: 'auto',
};

export type Attachment = {
  key: string;
  asset_id?: string;
  file?: File;
  name: string;
  kind: 'image' | 'video' | 'audio';
  url?: string;
  role?: InputReference['role'];
  framing?: 'fit' | 'fill';
  start?: number;
  length?: number;
  include_audio?: boolean;
  progress?: string;
  error?: string;
};

/** Roles an input may take for a kind. Only images can be frames or an edit source. */
export function rolesFor(kind: Kind, input: Attachment['kind']): InputReference['role'][] {
  if (kind === 'edit') return input === 'image' ? ['source', 'reference'] : [];
  if (kind === 'animate') return input === 'image' ? ['first_frame', 'last_frame', 'reference'] : ['reference'];
  return [];
}
export const roleLabels: Record<string, string> = {
  source: 'Source',
  reference: 'Reference',
  first_frame: 'Start frame',
  last_frame: 'End frame',
};
export function defaultRoles(kind: Kind, list: Attachment[]): Attachment[] {
  let source = false,
    first = false;
  const out: Attachment[] = list.map((a): Attachment => {
    const allowed = rolesFor(kind, a.kind);
    if (
      a.role &&
      allowed.includes(a.role) &&
      !(a.role === 'source' && source) &&
      !(a.role === 'first_frame' && first)
    ) {
      if (a.role === 'source') source = true;
      if (a.role === 'first_frame') first = true;
      return a;
    }
    if (kind === 'edit' && a.kind === 'image' && !source) {
      source = true;
      return { ...a, role: 'source' };
    }
    if (kind === 'animate' && a.kind === 'image' && !first) {
      first = true;
      return { ...a, role: 'first_frame' };
    }
    return { ...a, role: allowed.includes('reference') ? 'reference' : undefined };
  });
  // An edit always has a source: when every image came in as a reference, the first one is the picture to edit.
  if (kind === 'edit' && !out.some(a => a.role === 'source')) {
    const at = out.findIndex(a => a.kind === 'image');
    if (at >= 0) out[at] = { ...out[at]!, role: 'source' };
  }
  return out;
}
/** Why these inputs cannot make this kind, or null when they can. */
export function inputProblem(kind: Kind, list: Attachment[]) {
  if (kind === 'edit') {
    if (!list.some(a => a.kind === 'image')) return 'Edit needs one source image. Attach an image, or switch to Image.';
    if (list.some(a => a.kind !== 'image')) return 'Edit uses images only. Remove the video or audio.';
    if (list.filter(a => a.role === 'source').length !== 1) return 'Choose which attached image to edit.';
    if (list.length > 10) return 'Edit takes up to 10 images.';
  }
  if (kind === 'animate' && !list.length) return 'Animate needs at least one image, video or audio input.';
  if ((kind === 'image' || kind === 'video') && list.length)
    return kind === 'image'
      ? 'A new image is made from words only, so it can’t use the attachment.'
      : 'A new clip is made from words only, so it can’t use the attachment.';
  if (list.some(a => a.progress || a.error || !a.asset_id)) return 'Wait for attachments to finish uploading.';
  return null;
}

export function buildRequest(
  settings: MakeSettings,
  prompt: string,
  inputs: Attachment[],
  title: string,
): Record<string, unknown> {
  const kind = settings.kind,
    workflow = workflowOf[kind],
    video = isVideoKind(kind);
  const references = inputs.map((a, i) => ({
    id: 'input' + (i + 1),
    asset_id: a.asset_id!,
    kind: a.kind,
    role: a.role ?? 'reference',
    ...(kind === 'animate' && a.kind === 'image' ? { framing: a.framing ?? 'fit' } : {}),
    ...(a.kind !== 'image'
      ? {
          range: { start_seconds: a.start ?? 0, duration_seconds: a.length ?? 5 },
          ...(a.kind === 'video' ? { include_audio: Boolean(a.include_audio) } : {}),
        }
      : {}),
  }));
  const base = {
    workflow,
    prompt: prompt.trim(),
    title,
    seed: settings.seed && settings.seed !== 'random' ? settings.seed : 'random',
    count: settings.count,
    ...(settings.target !== 'auto' ? { target: settings.target } : {}),
  };
  if (kind === 'edit')
    return { ...base, engine: 'klein' as const, references, output: { aspect: 'source', size: settings.imageSize } };
  if (!video)
    return {
      ...base,
      output: { aspect: settings.aspect, size: settings.imageSize },
      ...(settings.style ? { loras: [settings.style] } : {}),
    };
  return {
    ...base,
    ...(kind === 'animate' ? { references } : {}),
    output: {
      aspect: settings.aspect === '9:16' || settings.aspect === '4:5' ? '9:16' : '16:9',
      size: settings.videoSize,
      duration_seconds: settings.duration,
    },
    audio: { output: settings.sound },
    steps: DEFAULT_VIDEO_STEPS,
    detail: settings.detail,
    ...(settings.style ? { loras: [settings.style] } : {}),
  };
}

/** Editable fields of an existing draft, flattened for an inline editor. */
export function editableFields(r: ImageRequest) {
  return {
    title: r.title ?? '',
    prompt: r.prompt,
    aspect: r.output.aspect,
    size: r.output.size,
    count: r.count,
    duration: r.output.duration_seconds ?? 5,
    sound: r.audio?.output ?? 'generated',
    detail: r.detail ?? 'standard',
    target: r.target ?? 'auto',
    loras: r.loras ?? [],
    seed: r.seed,
  };
}
export type EditableFields = ReturnType<typeof editableFields>;
/** The revise payload: the full request with the user's edits, minus server-owned fields. */
export function revisedRequest(r: ImageRequest, f: EditableFields): Record<string, unknown> {
  const { workflow: _w, mode: _m, resolved_seeds: _s, ...rest } = r as ImageRequest & { resolved_seeds?: unknown };
  const video = r.workflow === 'text-to-video' || r.workflow === 'reference-to-video';
  return {
    ...rest,
    title: f.title.trim() || undefined,
    prompt: f.prompt,
    count: f.count,
    seed: f.seed || 'random',
    output: {
      ...r.output,
      ...(r.output.aspect === 'source' && !(r.workflow === 'image-to-image' && r.engine === 'klein')
        ? {}
        : { aspect: f.aspect }),
      size: f.size,
      ...(video ? { duration_seconds: f.duration } : {}),
    },
    ...(video ? { audio: { output: f.sound }, detail: f.detail } : {}),
    ...(r.workflow !== 'image-to-image' ? { loras: f.loras } : {}),
    ...(f.target === 'auto' ? { target: undefined } : { target: f.target }),
  };
}

export function sizeOptions(workflow: string, aspect: string) {
  return sizeChoices(workflow).map(p => ({
    id: p.id,
    label:
      aspect === 'source'
        ? p.id.replace('image-', '').replace('mp', ' MP') + (p.id.startsWith('image-') ? 'p' : '')
        : dimensionLabel(resolveDimensions(workflow, p.id, aspect)),
  }));
}
export function sizeName(workflow: string, size: string, aspect: string) {
  if (aspect === 'source') return sizeOptions(workflow, aspect).find(o => o.id === size)?.label ?? size;
  try {
    return dimensionLabel(resolveDimensions(workflow, size as ResolutionSize, aspect));
  } catch {
    return size;
  }
}

const uploaded = new Map<string, string>();
/** Uploads a file with resumable chunks, then waits until Seed has verified it. */
export async function uploadFile(
  file: File,
  kind: Attachment['kind'],
  mode: string,
  progress: (text: string) => void,
): Promise<string> {
  const cacheKey = [mode, file.name, file.size, file.lastModified].join(':');
  const known = uploaded.get(cacheKey);
  if (known) return known;
  progress('Uploading…');
  const id = await new Promise<string>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: '/api/v1/uploads',
      chunkSize: 8 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: true,
      fingerprint: async () => JSON.stringify(['seed', mode, file.name, file.size, file.lastModified, file.type]),
      metadata: { filename: file.name, filetype: file.type, kind, mode },
      onProgress: (sent, total) => progress(`Uploading ${Math.round((sent / total) * 100)}%`),
      onError: reject,
      onSuccess: () => resolve(upload.url!.split('/').pop()!),
    });
    upload
      .findPreviousUploads()
      .then(previous => {
        if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(reject);
  });
  progress('Checking…');
  for (let i = 0; ; i++) {
    const response = await fetch('/api/v1/assets/' + id);
    if (!response.ok) throw Error('Could not check the uploaded file.');
    const asset = await response.json();
    if (asset.state === 'ready') break;
    if (asset.state === 'error') throw Error(asset.error || 'The file could not be used.');
    if (i > 180) throw Error('Checking the file is taking longer than expected. Try again shortly.');
    await new Promise(r => setTimeout(r, 1000));
  }
  uploaded.set(cacheKey, id);
  return id;
}
export const kindOfFile = (file: File): Attachment['kind'] | null =>
  file.type.startsWith('image/')
    ? 'image'
    : file.type.startsWith('video/')
      ? 'video'
      : file.type.startsWith('audio/')
        ? 'audio'
        : null;
