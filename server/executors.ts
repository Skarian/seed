import type {RentalRecord,WorkerDriver,WorkerProbe} from './pool-contracts.js';
import type {LocalWorkerRecord} from './local-worker.js';
import type {LocalRuntime} from './local-runtime.js';
import {WorkerTransport} from './worker-transport.js';

export type ExecutionWorker=RentalRecord|LocalWorkerRecord;
export const localExecutor=(worker:ExecutionWorker):worker is LocalWorkerRecord=>'executor' in worker&&worker.executor==='local';
type JobMethods='probe'|'upload'|'submit'|'receipt'|'cancel'|'download'|'acknowledge';
export function bindExecutor<W>(driver:Pick<WorkerDriver<W>,JobMethods>,worker:W){
  return {
    probe:driver.probe?()=>driver.probe!(worker):undefined,
    upload:(job:string,file:string,name:string)=>driver.upload(worker,job,file,name),
    submit:(body:Record<string,unknown>,options?:{beforePost?:()=>void})=>driver.submit(worker,body,options),
    receipt:(job:string)=>driver.receipt(worker,job),cancel:(job:string)=>driver.cancel(worker,job),
    download:(job:string,output:Parameters<WorkerDriver['download']>[2],target:string)=>driver.download(worker,job,output,target),
    acknowledge:(job:string,digest:string)=>driver.acknowledge(worker,job,digest),
  };
}
export class LocalTransport extends WorkerTransport<LocalWorkerRecord>{
  constructor(private runtime:Pick<LocalRuntime,'connection'>){super();}
  protected async connection(_worker:LocalWorkerRecord){return this.runtime.connection();}
  async probe(worker:LocalWorkerRecord):Promise<WorkerProbe>{
    const connection=await this.connection(worker),status=await connection.status({fresh:true});
    if(!status||status.worker_class!==worker.worker_class)throw Error('The local engine identity could not be verified.');
    return {state:status.state,session_id:status.engine_session_id,active_job_id:status.active_prompt_id??undefined,
      workspace_id:status.workspace_id,worker_instance_id:status.worker_instance_id};
  }
}
