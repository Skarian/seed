export const workflowIds = ['text-to-image', 'image-to-image', 'text-to-video', 'reference-to-video'] as const;
export type WorkflowId = typeof workflowIds[number];

export interface StudioSnapshot {
  worker: { state: 'disconnected' | 'preparing' | 'ready' | 'busy'; observed_at: string | null; stale: boolean; connected?: boolean; preparation?: { phase: string; bytes_done?: number; bytes_total?: number; error: { message: string } | null } };
  queue: { paused: boolean; waiting: number; active: number };
  outputs: { pending: number | null };
  safe_to_terminate: boolean | null;
  checked_at: string | null;
  reasons: string[];
  implementation: { pairing: boolean; generation: boolean };
}

export interface LibraryAsset {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'sequence';
  cover_id?: string;
  frame_count?: number;
  name: string;
  created_at: string;
  mode?: 'sfw' | 'nsfw';
}

export interface FrameSequence {
  id: string; revision: number; mode: 'sfw' | 'nsfw'; cleanup_pending?: boolean;
  frames: Array<{ id: string; index: number; time: number; width: number; height: number }>;
}
