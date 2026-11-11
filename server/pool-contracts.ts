import type {EnginePhase} from '../shared/generation-progress.js';
import type { PoolWorker, WorkerClass, WorkerOffer, InstalledLora, Provider } from "../shared/pool.js";
export type ModelSource = {
  path: string;
  url: string;
  sha256: string;
  size: number;
  routes?: Array<"image" | "fl" | "ref">;
};
export type RentalResource = {
  id: string;
  status: string;
  created_at?: string;
  hourly?: number;
  ssh?: { host: string; port: number; user: string };
  image?: string;
  account_id?: string;
  host_id?: string;
  startup_stage?: PoolWorker['startup_stage'];
};
export type RentalRecord = Omit<
  PoolWorker,
  "estimated_spend" | "elapsed_seconds" | "actions"
> & {
  offer: WorkerOffer;
  provider_data: Record<string, unknown>;
  manifest: ModelSource[];
  requested_loras: InstalledLora[];
  create_sent?: boolean;
  create_rejected?: boolean;
  resource?: RentalResource;
  ready?: boolean;
  adapters_frozen?: boolean;
  session_id?: string;
  preparation_revision?: number;
  finish_before?: string;
  submit_key: string;
  delete_sent?: boolean;
  last_verified_at?: string;
  access_prepared?: boolean;
};
export type OfferResult = { offer: WorkerOffer; data: Record<string, unknown> };
export interface ProviderDriver {
  collectStartupLogs?(worker:RentalRecord, signal:AbortSignal, cursor?:string):Promise<import('../shared/startup-logs.js').ProviderStartupLog>;
  configured(): boolean;
  offers(
    role: WorkerClass,
    requirements: { image: string; disk_gb: number },
  ): Promise<OfferResult[]>;
  create(
    worker: RentalRecord,
    auth: { public_key: string; pairing_secret: string },
  ): Promise<RentalResource>;
  find(worker: RentalRecord): Promise<RentalResource | null>;
  prepareAccess?(worker: RentalRecord, publicKey: string): Promise<void>;
  destroy(worker: RentalRecord): Promise<void>;
  validateCredential?(key: string, workers: RentalRecord[]): Promise<void>;
}
export type WorkerHealth = {
  workflows?: string[];
  busy?: boolean;
  active_job_id?: string;
  activity?: string;
  phase?: EnginePhase;
  ready: boolean;
  session_id?: string;
  installed_loras: Array<{
    filename: string;
    sha256: string;
    routes: string[];
  }>;
  preparation: NonNullable<PoolWorker["preparation"]>;
  revision?: number;
};
/** Fresh identity-checked engine observation; probing never prepares or restarts it. */
export type WorkerProbe = {
  state: "preparing" | "ready" | "busy";
  session_id: string | null;
  active_job_id?: string;
  workspace_id: string;
  worker_instance_id: string;
};
export type WorkerOutput = {
  id: string;
  path: string;
  size: number;
  sha256: string;
  mime_type: string;
};
export type WorkerReceipt = {
  submission?: {
    graph_digest?: string;
    job_id?: string;
    workspace_id?: string;
    engine_session_id?: string;
  };
  manifest?: {
    state: "completed" | "failed" | "cancelled";
    outputs: WorkerOutput[];
    error?: string | null;
  };
  manifest_digest?: string;
};
export interface WorkerDriver<W = RentalRecord> {
  preflight(role: WorkerClass): Promise<void>;
  probe?(worker: W): Promise<WorkerProbe>;
  fallbackBaseModels?(worker: W): Promise<void>;
  auth(
    worker: W,
  ): Promise<{ public_key: string; pairing_secret: string }>;
  prepare(
    worker: W,
    options?: { retry?: boolean; omit?: string[] },
  ): Promise<WorkerHealth>;
  upload(
    worker: W,
    job: string,
    file: string,
    name: string,
  ): Promise<void>;
  submit(worker: W, body: Record<string, unknown>, options?: { beforePost?: () => void }): Promise<void>;
  receipt(worker: W, job: string): Promise<WorkerReceipt | null>;
  cancel(worker: W, job: string): Promise<void>;
  download(
    worker: W,
    job: string,
    output: WorkerOutput,
    target: string,
  ): Promise<void>;
  acknowledge(worker: W, job: string, digest: string): Promise<void>;
  reconnect(worker: W): Promise<void>;
  disconnect(worker: W): Promise<void>;
  close(): Promise<void>;
}
export type PoolDependencies = {
  providers: Record<Provider, ProviderDriver>;
  worker: WorkerDriver;
  now?: () => number;
  releases?: Partial<
    Record<
      WorkerClass,
      { image: string; disk_gb: number; manifest: ModelSource[]; workflows?: string[] }
    >
  >;
};
