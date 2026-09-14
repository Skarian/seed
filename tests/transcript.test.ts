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
