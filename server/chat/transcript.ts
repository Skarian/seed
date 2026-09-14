import type {AgentEvent} from '@earendil-works/pi-agent-core';
import type {TurnTranscript} from '../../shared/chat.js';
// Keep display data structured; never persist binary media from tool output here.
export function displayResult(value:unknown):unknown {
 if(Array.isArray(value))return value.map(displayResult);
 if(value&&typeof value==='object'){const v=value as Record<string,unknown>;if(v.type==='image'||v.type==='audio')return {type:v.type,mimeType:v.mimeType};return Object.fromEntries(Object.entries(v).map(([k,v])=>[k,displayResult(v)]));}return value;
}
export function recordTurnEvent(turn:TurnTranscript,event:AgentEvent,messageIndex:number,at=new Date().toISOString()){
 if(turn.state!=='running')return;
 if((event.type==='message_update'||event.type==='message_end')&&event.message.role==='assistant'){
  event.message.content.forEach((part,index)=>{if(part.type!=='thinking'&&part.type!=='text')return;if(part.type==='thinking'&&part.redacted)return;
   const id=`message-${messageIndex}-${index}`,text=part.type==='thinking'?part.thinking:part.text;
   let step=turn.steps.find(s=>s.id===id);if(!step){step={id,kind:part.type==='thinking'?'reasoning':'text',started_at:at};turn.steps.push(step);}step.text=text;if(event.type==='message_end')step.ended_at=at;
  });
 }
 if(event.type==='tool_execution_start'){let step=turn.steps.find(s=>s.id===event.toolCallId);if(!step)turn.steps.push({id:event.toolCallId,kind:'tool',name:event.toolName,input:displayResult(event.args),state:'running',started_at:at});}
 if(event.type==='tool_execution_update'||event.type==='tool_execution_end'){
  const step=turn.steps.find(s=>s.id===event.toolCallId);if(step){step.result=displayResult(event.type==='tool_execution_end'?event.result:event.partialResult);if(event.type==='tool_execution_end'){step.state=event.isError?'failed':'succeeded';step.ended_at=at;}}
 }
}
export function finishTurn(turn:TurnTranscript,state:'completed'|'failed'|'stopped',at=new Date().toISOString()) {turn.state=state;turn.ended_at=at;for(const step of turn.steps)if(step.state==='running'){step.state='stopped';step.ended_at=at;}}
