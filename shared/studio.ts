export const workflowIds = ['text-to-image', 'image-to-image', 'text-to-video', 'reference-to-video'] as const;
export type WorkflowId = typeof workflowIds[number];

export interface StudioSnapshot {
  worker: { state: 'disconnected'; observed_at: null; stale: true };
  queue: { paused: boolean; waiting: number; active: number };
  outputs: { pending: number };
  safe_to_terminate: null;
  checked_at: null;
  reasons: string[];
  implementation: { pairing: false; generation: false };
}

export interface LibraryAsset {
  id: string;
  kind: 'image' | 'video' | 'audio';
  name: string;
  created_at: string;
}
