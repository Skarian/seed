export const workflowIds = ['text-to-image', 'image-to-image', 'text-to-video', 'reference-to-video'] as const;
export type WorkflowId = typeof workflowIds[number];

export interface StudioSnapshot {
  loras_revision?: number;
  pool: import('./pool.js').PoolSnapshot['summary'];
  activity: { waiting: number; active: number; needs_attention: number };
  outputs: { pending: number | null };
}

export interface LibraryAsset {
  id: string;
  kind: 'image' | 'video' | 'audio';
  name: string;
  created_at: string;
  mode?: 'sfw' | 'nsfw';
  favorite?: boolean;
}

export interface AssetOrganization {
  id: string;
  mode: 'sfw' | 'nsfw';
  favorite: boolean;
  collection_ids: string[];
}

export interface AssetCollection {
  id: string;
  name: string;
  mode: 'sfw' | 'nsfw';
  count: number;
}

export interface FrameSequence {
  id: string; revision: number; mode: 'sfw' | 'nsfw'; cleanup_pending?: boolean;
  frames: Array<{ id: string; index: number; time: number; width: number; height: number }>;
}
