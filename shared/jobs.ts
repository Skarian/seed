import type { ImageRequest, LoraSelection } from "./generation.js";
import type {
  HistoricalProviderIssue as ProviderIssue,
  HistoricalFalReceipt as Receipt,
  HistoricalEstimate as Estimate,
} from "./job-history.js";
export type JobRecord = {
  worker?: { id?: string };
  recovery?: {
    pending: boolean;
    action?: 'retry';
    reason: 'submission_unknown' | 'worker_unavailable' | 'submission_unavailable' | 'engine_interrupted' | 'cancelled';
    worker_id?: string;
  };
  activity?: string;
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
export function jobState(job: JobRecord) {
  if (job.state === "completed") return "completed";
  if (job.recovery_blocked) return "failed";
  return (
    (
      {
        needs_attention: "unknown",
        uploading: "starting",
        submitting: "starting",
        copying: "saving",
        cancel_requested: "cancelling",
      } as Record<string, string>
    )[job.state] ?? job.state
  );
}
export const jobStateLabels: Record<string, string> = {
  queued: "Queued",
  starting: "Starting",
  running: "Generating",
  saving: "Saving",
  cancelling: "Cancelling",
  completed: "Complete",
  failed: "Failed",
  blocked: "Needs action",
  unknown: "Status unknown",
  cancelled: "Cancelled",
};
export const jobActive = (j: JobRecord) =>
  !["completed", "failed", "cancelled", "unknown", "blocked"].includes(
    jobState(j),
  );
/** Acknowledging old API history must not hide unresolved worker assignments. */
export const jobNeedsAttention = (job: JobRecord) =>
  ['failed', 'blocked'].includes(jobState(job)) ||
  (jobState(job) === 'unknown' && (Boolean(job.worker || job.recovery) || !job.uncertainty_acknowledged));
export function groupJobs(jobs: JobRecord[]) {
  const groups = new Map<string, JobRecord[]>();
  for (const job of jobs) {
    const key = job.submission_id || job.id;
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.values()].map((g) =>
    g.sort((a, b) => a.submission_index - b.submission_index),
  );
}
