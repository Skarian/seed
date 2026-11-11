import {it,expect} from 'vitest';
import {recordTurnEvent,finishTurn} from '../server/chat/transcript.js';
import type {TurnTranscript} from '../shared/chat.js';
it('keeps streaming tool output, stops pending tools, and ignores late events',()=>{
 const turn:TurnTranscript={started_at:'2026-09-13T10:00:00Z',state:'running',steps:[]};
 recordTurnEvent(turn,{type:'tool_execution_start',toolCallId:'one',toolName:'prepare_image',args:{operations:[]}},0,'2026-09-13T10:00:01Z');
 recordTurnEvent(turn,{type:'tool_execution_update',toolCallId:'one',toolName:'prepare_image',args:{},partialResult:{content:[{type:'text',text:'Checking'},{type:'image',data:'binary',mimeType:'image/png'}]}},0);
 expect(turn.steps[0]!.result).toEqual({content:[{type:'text',text:'Checking'},{type:'image',mimeType:'image/png'}]});finishTurn(turn,'stopped','2026-09-13T10:00:02Z');
 recordTurnEvent(turn,{type:'tool_execution_end',toolCallId:'one',toolName:'prepare_image',result:{content:[]},isError:false},0);expect(turn.steps[0]!.state).toBe('stopped');expect(turn.ended_at).toBe('2026-09-13T10:00:02Z');
});
it('stores a failed tool step as one typed failure, read once when it ends',()=>{
 const turn:TurnTranscript={started_at:'2026-09-13T10:00:00Z',state:'running',steps:[]};
 const end=(id:string,text:string,isError=true)=>{recordTurnEvent(turn,{type:'tool_execution_start',toolCallId:id,toolName:'create_request',args:{}},0);recordTurnEvent(turn,{type:'tool_execution_end',toolCallId:id,toolName:'create_request',result:{content:[{type:'text',text}],details:{}},isError},0);return turn.steps.find(s=>s.id===id)!.failure;};
 const fields=[{field:'inputs[0].role',message:'Use first_frame.'}];
 expect(end('a',JSON.stringify({ok:false,saved:false,error:'Use first_frame.',fields}))).toEqual({error:'Use first_frame.',internal:false,fields});
 expect(end('b',JSON.stringify({ok:false,error:'This run is no longer active.',internal:true}))).toEqual({error:'This run is no longer active.',internal:true});
 // A call the agent library refused never reached the tool: Seed's own slip.
 expect(end('c','Validation failed for tool "create_request": root')).toEqual({error:'Validation failed for tool "create_request": root',internal:true});
 expect(end('d','{"ok":true}',false)).toBeUndefined();
});
