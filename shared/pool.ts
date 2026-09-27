export type WorkerClass = "image" | "video";
export type Provider = "vast" | "runpod";
export type WorkerState =
  | "starting"
  | "preparing"
  | "ready"
  | "generating"
  | "saving"
  | "reconnecting"
  | "finishing"
  | "releasing"
  | "released"
  | "needs_attention";
export type PoolAction =
  | "dismiss_launch_failure"
  | "reconnect"
  | "retry_preparation"
  | "omit_loras"
  | "local_fallback"
  | "finish"
  | "quit";
export type PoolIssue = {
  code: string;
  message: string;
  retryable: boolean;
  action?: string;
  provider?: Provider;
  worker_id?: string;
};
export type WorkerOffer = {
  id: string;
  provider: Provider;
  worker_class: WorkerClass;
  gpu: string;
  vram_gb: number;
  region: string;
  hourly: number;
  compute_hourly: number;
  storage_hourly: number;
  disk_gb: number;
  max_quantity: number;
  quoted_at: string;
  expires_at: string;
  cpu_cores?: number;
  ram_gb?: number;
  power_watts?: number;
  transfer_per_gb?: number;
  download_mbps?: number;
  download_per_gb?: number;
  upload_per_gb?: number;
  model_download_bytes?: number;
  reliability?: number;
  verified?: boolean;
  cloud?: "secure" | "community";
  stock?: "HIGH" | "MEDIUM" | "LOW";
  locations?: Array<{ id: string; name: string; stock: "HIGH" | "MEDIUM" | "LOW" }>;
  min_ram_gb?: number;
  machine_id?: string;
  image: string;
  available: boolean;
};
export type InstalledLora = {
  id: string;
  revision: string;
  route: "image" | "fl" | "ref";
  name: string;
  filename: string;
  sha256: string;
};
export type PreparationFile = {
  path: string;
  name: string;
  ready: boolean;
  optional: boolean;
  omitted?: boolean;
  bytes?: number;
  total?: number;
  error?: string;
  state?: string;
};
export type PoolWorker = {
  workflows?: string[];
  id: string;
  launch_id: string;
  provider: Provider;
  worker_class: WorkerClass;
  gpu: string;
  vram_gb: number;
  region: string;
  state: WorkerState;
  hourly: number;
  compute_hourly: number;
  storage_hourly: number;
  estimated_spend: number;
  elapsed_seconds: number;
  created_at: string;
  allocated_at?: string;
  ready_at?: string;
  released_at?: string;
  create_rejected?: boolean;
  launch_failure_dismissed_at?: string;
  startup_stage?: "downloading_container" | "verifying_container" | "retrying_container" | "waiting_for_ssh";
  provider_id?: string;
  current_job_id?: string;
  current_activity?: string;
  quit_mode?: "finish" | "now";
  issue?: PoolIssue;
  preparation?: {
    error?: string;
    phase: string;
    stage?: "pending" | "downloading" | "verifying" | "starting_engine";
    bytes_per_second?: number;
    eta_seconds?: number | null;
    stalled?: boolean;
    last_transfer_update_at?: string;
    bytes_done: number;
    bytes_total: number;
    files: PreparationFile[];
  };
  installed_loras: InstalledLora[];
  actions: PoolAction[];
  console_url: string;
};
export type PoolSnapshot = {
  server_time: string;
  workers: PoolWorker[];
  summary: {
    active: number;
    ready: number;
    busy: number;
    preparing: number;
    needs_attention: number;
    hourly: number;
    estimated_spend: number;
    image: number;
    video: number;
  };
};
export type OffersResponse = {
  items: WorkerOffer[];
  issues: PoolIssue[];
  searched_at: string;
};
export type LaunchRequest = {
  selections: Array<{ offer_id: string; quantity: number }>;
  max_hourly: number;
};
export const workerStateLabels: Record<WorkerState, string> = {
  starting: "Starting",
  preparing: "Preparing",
  ready: "Ready",
  generating: "Generating",
  saving: "Saving",
  reconnecting: "Reconnecting",
  finishing: "Finishing",
  releasing: "Releasing",
  released: "Released",
  needs_attention: "Needs attention",
};
export const workerClassLabels: Record<WorkerClass, string> = {
  image: "Image",
  video: "Video",
};
export function workerClassFor(workflow: string): WorkerClass {
  return workflow === "text-to-image" || workflow === "image-to-image" ? "image" : "video";
}
