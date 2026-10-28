/** All shutdown branches run even if one fails. Call recordIntent before this. */
import type {StopOutcome} from './local-shutdown.js';

/** Also bounds background/cloud/control cleanup, beyond the local 120s budget. */
export async function closeManagedService(close:()=>Promise<unknown>,control:()=>Promise<unknown>,exit:(code:number)=>void,budget=140000){
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<number>(resolve=>{timer=setTimeout(()=>resolve(1),budget);});
  const cleanup=async()=>{
    let code=0;
    try{await close();}catch{code=1;}
    try{await control();}catch{code=1;}
    return code;
  };
  try{exit(await Promise.race([deadline,cleanup()]));}finally{clearTimeout(timer);}
}

export async function boundedLocalClose(drain:()=>Promise<StopOutcome>,force:()=>Promise<StopOutcome>,
  pending:()=>StopOutcome,budgets={drain:90000,total:120000}):Promise<StopOutcome>{
  let forceTimer:ReturnType<typeof setTimeout>|undefined,totalTimer:ReturnType<typeof setTimeout>|undefined;
  try{
    return await new Promise<StopOutcome>(resolve=>{
      const finish=(result:StopOutcome)=>{if(result.outcome==='stopped')resolve(result);};
      forceTimer=setTimeout(()=>{void force().then(finish).catch(()=>{});},budgets.drain);
      totalTimer=setTimeout(()=>{
        try{resolve(pending());}catch{resolve({outcome:'stop_pending',since:new Date().toISOString(),phase:'termination_unconfirmed'});}
      },budgets.total);
      void drain().then(finish).catch(()=>{});
    });
  }finally{clearTimeout(forceTimer);clearTimeout(totalTimer);}
}

export async function closeService(parts:{local:()=>Promise<unknown>;background:(()=>Promise<unknown>)[];
  cloud:()=>Promise<unknown>;jobs:()=>Promise<unknown>;failed:(stage:string)=>void}){
  const attempt=async(stage:string,close:()=>Promise<unknown>)=>{
    try{await close();}catch{try{parts.failed(stage);}catch{ /* A broken journal must not skip other cleanup. */ }}
  };
  const local=attempt('local',parts.local);
  await Promise.all([local,...parts.background.map((close,index)=>attempt('background_'+index,close))]);
  await attempt('cloud',parts.cloud);
  await attempt('jobs',parts.jobs);
}
