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
  executor?: 'local'|'cloud';
  execution_profile?: string;
  /** The job that made this asset; absent for uploads. */
  job_id?: string;
  /** The draft title from the job that made it. */
  title?: string;
  /** The project (chat) the job came from. */
  chat_id?: string;
  /** Its place in a batch, 1-based, when the job was one of several ("2 of 4"). */
  variant?: number;
  variants?: number;
  /** The owner's note on this asset, when there is one. */
  note?: string;
  /** Pixel size, when known, so grids can show the whole frame. */
  width?: number;
  height?: number;
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
