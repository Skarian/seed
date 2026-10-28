import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';

/** Qualification keeps ownership indefinitely when the barrier is unconfirmed. */
export async function settleQualificationEngine({request,workspaceId,sessionId,pinsDigest,members,isExited,onWait=()=>{},poll=1000,stopId=randomUUID()}){
  let attempt=0;
  while(!isExited()){
    try{
      const session=await request('/studio/session');
      if(session.workspace_id!==workspaceId||sessionId&&session.engine_session_id!==sessionId)throw Error('Engine identity changed; retaining ownership.');
      if(!members().some(member=>member.pid===session.pid))throw Error('Engine process ownership is unconfirmed.');
      sessionId??=session.engine_session_id;
      const ack=await request('/studio/quiesce',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Engine-Session':sessionId},body:JSON.stringify({stop_id:stopId,cancel_running:true})});
      if(ack.engine_session_id===sessionId&&ack.stop_id===stopId&&ack.pid===session.pid&&ack.state==='parked'&&ack.prepared&&ack.worker_alive&&ack.cancel_running===true&&
        ack.revision?.supported&&ack.revision.pins_digest===pinsDigest&&['ok','not_initialized'].includes(ack.sync?.result))return {stop_id:stopId,ack};
      if(attempt%30===0)onWait('Engine barrier is pending; ownership is retained.');
    }catch{if(attempt%30===0)onWait('Engine shutdown is unconfirmed; ownership is retained.');}
    await delay(poll);attempt++;
  }
}
