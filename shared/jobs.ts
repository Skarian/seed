import type { GenerationProgress } from "./generation-progress.js";
import type { ImageRequest, LoraSelection } from "./generation.js";
import type {
  HistoricalProviderIssue as ProviderIssue,
  HistoricalFalReceipt as Receipt,
  HistoricalEstimate as Estimate,
} from "./job-history.js";
export type JobRecord = {
  output_dimensions?: { width: number; height: number };
  worker?: { id?: string;executor?:'local'|'cloud';profile?:string;runtime_revision?:string };
  recovery?: {
    pending: boolean;
    action?: 'retry' | 'retry_local';
    reason: 'submission_unknown' | 'worker_unavailable' | 'submission_unavailable' | 'engine_interrupted' | 'local_preparation_failed' | 'local_stop_pending' | 'cancelled';
    worker_id?: string;
  };
  /** Older records only. Replaced by progress. */
  activity?: string;
  progress?: GenerationProgress;
  waiting_reason?: string;
  estimate?: Estimate;
  provider_issue?: ProviderIssue;
  source?: {
    chat_id?: string;
    card_id?: string;
    revision?: number;
    job_id?: string;
  };
  input_snapshot?: Array<{
    id: string;
    name: string;
    kind: string;
    note: string;
    metadata: Record<string, unknown>;
  }>;
  deleted_outputs?: string[];
  metrics?: {
    inputs: {
      total: number;
      image: number;
      video: number;
      audio: number;
      prepared_bytes: number;
      video_soundtracks: number;
    };
    submitted_at?: string;
    saved_at?: string;
    terminal_at?: string;
    elapsed_to_terminal_seconds?: number;
    elapsed_to_saved_seconds?: number;
  };
  id: string;
  state: string;
  submission_id: string;
  submission_index: number;
  request: ImageRequest;
  seed: string;
  /** Read-only migration data from releases before the worker pool. */
  fal?: {
    endpoint?: string;
    receipt?: Receipt;
    input?: Record<string, unknown>;
    result?: any;
    loras: LoraSelection[];
    queued_at?: string;
    running_at?: string;
    completed_at?: string;
    cancel_sent_at?: string;
    upload_seconds?: number;
  };
  outputs: string[];
  error: string | null;
  created_at: string;
  updated_at: string;
  uncertainty_acknowledged?: boolean;
  submission_pending?: boolean;
  recovery_blocked?: boolean;
};
/**
 * How a job stands: the one reading every route and screen uses. `held` waits for review before it may run;
 * `unsaved` was made on a GPU but has not reached this PC yet; `uncertain` lost contact mid-run.
 */
export type JobPhase =
  | 'queued' | 'held' | 'starting' | 'running' | 'saving' | 'unsaved' | 'cancelling' | 'uncertain'
  | 'completed' | 'failed' | 'cancelled';
const phases: Record<string, JobPhase> = {
  queued: 'queued', blocked: 'held', uploading: 'starting', submitting: 'starting', running: 'running',
  copying: 'saving', cancel_requested: 'cancelling', needs_attention: 'uncertain',
  completed: 'completed', failed: 'failed', cancelled: 'cancelled',
};
const finished: JobPhase[] = ['completed', 'failed', 'cancelled'];
export function jobPhase(job: Pick<JobRecord, 'state' | 'recovery_blocked'>): JobPhase {
  const phase = phases[job.state] ?? 'uncertain';
  return job.recovery_blocked && !finished.includes(phase) ? 'unsaved' : phase;
}
/** Work a GPU is doing or will do. */
export const jobActive = (job: JobRecord) =>
  ['queued', 'starting', 'running', 'saving', 'cancelling'].includes(jobPhase(job));
/** Acknowledging old API history must not hide unresolved worker assignments. */
export function jobNeedsAttention(job: JobRecord) {
  const phase = jobPhase(job);
  if (phase === 'uncertain') return Boolean(job.worker || job.recovery) || !job.uncertainty_acknowledged;
  return phase === 'failed' || phase === 'held' || phase === 'unsaved';
}
