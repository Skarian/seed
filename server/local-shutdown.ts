import {setTimeout as delay} from 'node:timers/promises';

export type StopPhase='draining'|'collecting'|'synchronizing'|'sync_failed'|'worker_dead'|'unsupported'|'identity_lost'|'unreachable'|'gateway_lost'|'termination_unconfirmed'|'termination_rejected';
export type StopIntent={stop_id:string;incarnation?:string;reason:string;requested_at:string;phase?:StopPhase;force?:boolean;cancel_running?:boolean};
export type StopReceipt=StopIntent&{engine_session_id?:string;engine_pid?:number;result:'quiesced'|'forced'|'engine_exited'|'no_engine';faults:string[];parked_at?:string;terminated_at:string};
export type StopOutcome={outcome:'stopped';receipt?:StopReceipt}|{outcome:'stop_pending';since:string;phase:StopPhase};
export type StopRecord=StopIntent&{outcome?:StopOutcome['outcome'];receipt?:StopReceipt};
export type EngineAck={engine_session_id:string;stop_id:string;pid:number;state:string;prepared:boolean;worker_alive:boolean;cancel_running:boolean;
  sync:{result:string};revision:{supported:boolean;pins_digest:string};faults:{kind:string}[];phases:Record<string,number>};

/** The caller retains ownership on every pending outcome, including timeouts. */
export async function drainLocalEngine(options:{intent:StopIntent;session?:string;gatewayPid?:number;pinsDigest:string;
  members:()=>{pid:number;created:string}[];request:(session?:string)=>Promise<unknown>;force:()=>boolean;
  timeout?:number;poll?:number;now?:()=>number;wait?:(ms:number)=>Promise<unknown>;onPhase?:(phase:StopPhase)=>void}){
  const now=options.now??Date.now,wait=options.wait??delay,deadline=now()+(options.timeout??120000);
  let phase:StopPhase='unreachable',session=options.session;
  do{
    if(options.force())return {force:true as const};
    try{
      const ack=await options.request(session) as EngineAck;
      // Only a Job member other than the gateway may identify the engine.
      const member=options.members().some(value=>value.pid===ack.pid)&&ack.pid!==options.gatewayPid;
      // Cancellation cannot change the engine's policy after draining. Keep
      // reporting its cleanup/failure phase; only the full parked barrier below
      // can authorize termination.
      const policyMatches=ack.cancel_running===(options.intent.cancel_running??false)||
        options.intent.cancel_running===true&&ack.cancel_running===false&&ack.state!=='draining';
      if(!member||typeof ack.engine_session_id!=='string'||!ack.engine_session_id||session&&session!==ack.engine_session_id||
        ack.stop_id!==options.intent.stop_id||!policyMatches){phase='identity_lost';}
      else{
        session??=ack.engine_session_id;
        if(ack.revision?.supported!==true||ack.revision.pins_digest!==options.pinsDigest)phase='unsupported';
        else if(ack.state==='parked'&&ack.worker_alive===true&&ack.prepared===true&&['ok','not_initialized'].includes(ack.sync?.result)&&
          Number.isFinite(ack.phases?.parked)&&Array.isArray(ack.faults)&&ack.faults.every(fault=>typeof fault?.kind==='string'))return {ack};
        else phase=(['draining','collecting','synchronizing','sync_failed','worker_dead','unsupported'] as string[]).includes(ack.state)?ack.state as StopPhase:'identity_lost';
      }
    }catch{phase='unreachable';}
    options.onPhase?.(phase);
    if(now()>=deadline)break;
    await wait(Math.min(options.poll??250,Math.max(0,deadline-now())));
  }while(now()<=deadline);
  return {pending:phase};
}

