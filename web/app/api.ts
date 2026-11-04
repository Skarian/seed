import type { ChatView, ChatMessage, ChatGroup, ChatCard, ChatRevision, ChatWorkflow } from '../../shared/chat.js';
import type { JobRecord } from '../../shared/jobs.js';
import type { LibraryAsset, AssetCollection } from '../../shared/studio.js';
import type { PoolSnapshot, OffersResponse, WorkerClass, LaunchRequest, PoolAction } from '../../shared/pool.js';
import type { ImageRequest } from '../../shared/generation.js';

export type { ChatView, ChatMessage, ChatGroup, ChatCard, ChatRevision, ChatWorkflow, JobRecord, LibraryAsset, AssetCollection, PoolSnapshot, OffersResponse, WorkerClass, ImageRequest };

/** A project as the API returns it: the chat view plus its jobs and the assets it can use. */
export type Project = ChatView & {
  jobs: JobRecord[];
  asset_manifest?: Array<{ id: string; name: string; kind: 'image' | 'video' | 'audio'; note: string; metadata?: Record<string, unknown> }>;
};
export type ProjectSummary = { id: string; title: string; activity: string; ready_to_review?: boolean; error: string | null; status?: string; last_reply_id?: string; updated_at: string };
export type AssetDetail = { kind: 'image' | 'video' | 'audio'; name: string; job_id?: string; width?: number; height?: number; duration?: number; executor?: 'local' | 'cloud'; state?: string; favorite?: boolean; collection_ids?: string[]; [key: string]: unknown };

export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

/** JSON request to Seed's API. Errors carry the server's message, which never contains prompt text by design. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/v1/' + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      signal: init.signal,
      headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError('Seed is not reachable. Check the connection and try again.', 0);
  }
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(result?.error?.message || 'That did not work. Try again.', response.status);
  return result as T;
}

export const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), v => v.toString(16).padStart(2, '0')).join('');

export const media = {
  content: (id: string) => '/api/v1/assets/' + encodeURIComponent(id) + '/content',
  preview: (id: string, large = false) => '/api/v1/assets/' + encodeURIComponent(id) + '/preview' + (large ? '?size=1280' : ''),
};

/** The server names new chats "New chat"; in Seed they are projects. */
const named = <T extends { title: string }>(p: T): T => p.title === 'New chat' ? { ...p, title: 'New project' } : p;
const pj = (path: string, init?: Parameters<typeof api>[1]) => api<Project>(path, init).then(named);
export const projects = {
  list: (mode: string) => api<{ items: ProjectSummary[] }>('chats?mode=' + mode).then(r => r.items.map(named)),
  create: (mode: string) => pj('chats', { body: { mode } }),
  get: (id: string, signal?: AbortSignal) => pj('chats/' + id, { signal }),
  setKind: (p: Project, workflow: string) => pj('chats/' + p.id, { method: 'PATCH', body: { version: p.version, workflow } }),
  rename: (p: Project, title: string) => pj('chats/' + p.id, { method: 'PATCH', body: { version: p.version, title } }),
  remove: (id: string) => api<{ deleted: boolean }>('chats/' + id, { method: 'DELETE' }),
  send: (p: Project, body: { text: string; assets: string[]; card_id?: string; revision?: number; keep_plan?: boolean }) =>
    pj('chats/' + p.id + '/messages', { body: { version: p.version, ...body } }),
  stopReply: (id: string) => pj('chats/' + id + '/stop', { body: { scope: 'reply' } }),
  decide: (id: string, group: string, decisions: Array<{ card: string; revision: number; decision: 'approved' | 'denied' }>) =>
    pj('chats/' + id + '/groups/' + group + '/decisions', { body: { decisions } }),
  revise: (id: string, card: string, revision: number, request: Record<string, unknown>) => pj('chats/' + id + '/cards/' + card + '/revise', { body: { revision, request } }),
  restore: (id: string, card: string, revision: number, request: Record<string, unknown>) => pj('chats/' + id + '/cards/' + card + '/restore', { body: { revision, request } }),
  repeat: (id: string, card: string, revision: number, opts: { fresh: boolean; failed_only?: boolean; job_id?: string }) =>
    pj('chats/' + id + '/cards/' + card + '/repeat', { body: { revision, ...opts } }),
  makeDirect: (id: string, request: Record<string, unknown>, clientRequestId: string) =>
    pj('chats/' + id + '/requests', { body: { request, client_request_id: clientRequestId } }),
  config: () => api<{ configured: boolean }>('chat-config'),
};

export const jobs = {
  list: (mode: string) => api<{ items: JobRecord[] }>('jobs?mode=' + mode).then(r => r.items),
  get: (id: string) => api<JobRecord>('jobs/' + encodeURIComponent(id)),
  cancel: (id: string) => api<JobRecord>('jobs/' + id + '/cancel', { body: {} }),
  recover: (id: string) => api<JobRecord>('jobs/' + id + '/recover', { body: {} }),
};

export type AssetQuery = { mode: string; kind?: string; favorites?: boolean; collection_id?: string; q?: string; source?: 'made' | 'uploaded'; chat_id?: string; order?: 'newest' | 'oldest'; cursor?: string };
export const assets = {
  list: (query: AssetQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '' && v !== false) params.set(k, String(v));
    return api<{ items: LibraryAsset[]; next_cursor: string | null }>('assets?' + params, { signal });
  },
  get: (id: string) => api<AssetDetail>('assets/' + encodeURIComponent(id)),
  remove: (id: string) => api<void>('assets/' + encodeURIComponent(id), { method: 'DELETE' }),
  favorite: (id: string, favorite: boolean) => api<unknown>('assets/' + id + '/favorite', { method: 'PUT', body: { favorite } }),
  inCollection: (id: string, collection: string, included: boolean) => api<unknown>('assets/' + id + '/collections/' + collection, { method: 'PUT', body: { included } }),
  pickFrame: (id: string, time_seconds: number) => api<{ id: string }>('assets/' + id + '/frames', { body: { time_seconds } }),
  note: (id: string) => api<{ note: string; revision: number }>('notes/' + id),
  saveNote: (id: string, note: string, revision: number) => api<{ note: string; revision: number }>('notes/' + id, { method: 'PUT', body: { note, revision } }),
};

export const collections = {
  list: (mode: string) => api<{ items: AssetCollection[] }>('collections?mode=' + mode).then(r => r.items),
  create: (mode: string, name: string) => api<AssetCollection>('collections', { body: { name, mode } }),
};

export const pool = {
  snapshot: (signal?: AbortSignal) => api<PoolSnapshot>('pool', { signal }),
  offers: (role: WorkerClass) => api<OffersResponse>('pool/offers?worker_class=' + role),
  launch: (request: LaunchRequest, key: string) => api<PoolSnapshot>('pool/launch', { body: request, headers: { 'Idempotency-Key': key } }),
  limits: (worker: string, body: { idle_release_minutes?: number; max_minutes?: number }) => api<PoolSnapshot>('pool/workers/' + worker, { method: 'PATCH', body }),
  act: (worker: string, action: PoolAction) => api<PoolSnapshot>('pool/workers/' + worker + '/actions', { body: { action } }),
  local: () => api<{ setup: LocalSetupStatus; worker: import('../../shared/local-worker.js').LocalWorkerView | null }>('pool/local'),
  localAction: (action: string) => api<unknown>('pool/local/actions', { body: { action } }),
  localSetup: () => api<unknown>('pool/local/setup', { body: {} }),
};
export type LocalSetupStatus = { state?: string; supported?: boolean; reason?: string; bytes_done?: number; bytes_total?: number; [key: string]: unknown };

export const kindOf: Record<ChatWorkflow, Kind> = { 'text-to-image': 'image', 'image-to-image': 'edit', 'text-to-video': 'video', 'reference-to-video': 'animate' };
export const workflowOf: Record<Kind, ChatWorkflow> = { image: 'text-to-image', edit: 'image-to-image', video: 'text-to-video', animate: 'reference-to-video' };
export type Kind = 'image' | 'edit' | 'video' | 'animate';
export const kindLabels: Record<Kind, string> = { image: 'Image', edit: 'Edit', video: 'Video', animate: 'Animate' };
export const isVideoKind = (k: Kind) => k === 'video' || k === 'animate';
