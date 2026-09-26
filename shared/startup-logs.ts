export type StartupLogSnapshot = {
  worker_id: string;
  revision: number;
  phase: 'acquire' | 'models' | 'engine' | 'complete';
  collection: 'collecting' | 'sealed';
  availability: 'pending' | 'available' | 'unavailable';
  attempted_at?: string;
  checked_at?: string;
  captured_at?: string;
  sealed_at?: string;
  sealed_reason?: 'ready' | 'quit' | 'released' | 'rejected' | 'legacy';
  reason?: string;
  truncated: boolean;
  sections: Array<{source: string; captured_at: string; text: string}>;
};
export type ProviderStartupLog = {source: string; text: string; truncated: boolean; cursor?: string};
