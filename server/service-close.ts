/** All shutdown branches run even if one fails. */

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
