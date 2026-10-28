import type {InstalledLora,WorkerClass,WorkerState} from './pool.js';

export const LOCAL_MODEL_IDLE_MINUTES=20;

export type LocalWorkerState=WorkerState|'sleeping'|'disabled'|'recovering';
export type LocalWorkerView={
  executor:'local';id:string;enabled:boolean;paused:boolean;state:LocalWorkerState;
  gpu:string;vram_gb:number;worker_class:WorkerClass;workflows:string[];
  current_job_id?:string;current_activity?:string;session_id?:string;
  adapter_download?:{phase:string;bytes_done:number;bytes_total:number};
  installed_loras:InstalledLora[];ready:boolean;created_at:string;ready_at?:string;
  quit_mode?:'finish'|'now';issue?:{code:string;message:string;retryable:boolean};
  idle_deadline?:string;runtime_revision:string;
};
export type ExecutionTarget='auto'|'local'|'cloud';
