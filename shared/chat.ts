import type { ImageRequest } from './generation.js';
import type {MentionBinding} from './chat-mentions.js';
export type ChatWorkflow='text-to-image'|'image-to-image'|'text-to-video'|'reference-to-video';
export type ChatMode='sfw'|'nsfw';
export interface ChatRevision {number:number;request:ImageRequest;notes:Record<string,string>;decision:'undecided'|'approved'|'denied';approved_snapshot?:boolean;job_ids:string[];source_job_id?:string;after_message_id?:string|null;run_id?:string}
export interface ChatCard {timeline_start?:number;id:string;workflow:ChatWorkflow;revisions:ChatRevision[]}
export interface ChatGroup {id:string;after_message_id?:string|null;workflow:ChatWorkflow;state:'assembling'|'reviewing'|'revising'|'released'|'stopped';cards:ChatCard[];submission_error?:string}
export interface ChatMessage {id:string;role:'user'|'assistant'|'event';text:string;mention_bindings?:MentionBinding[];reasoning_text?:string;transcript?:TurnTranscript;request_attachment?:{card_id:string;revision:number;request:ImageRequest;notes:Record<string,string>};assets:string[];created_at:string}
export interface ChatView {
  id:string;title:string;mode:ChatMode;workflow:ChatWorkflow|null;version:number;epoch:number;
  reasoning:boolean;messages:ChatMessage[];groups:ChatGroup[];assets:string[];
  partial?:string;partial_reasoning?:string;
  activity:'idle'|'thinking'|'preparing'|'generating';error:string|null;
  created_at:string;updated_at:string;
}

export interface TurnStep {id:string;kind:'reasoning'|'text'|'tool';text?:string;name?:string;input?:unknown;result?:unknown;state?:'running'|'succeeded'|'failed'|'stopped';started_at:string;ended_at?:string}
export interface TurnTranscript {started_at:string;ended_at?:string;state:'running'|'completed'|'failed'|'stopped';steps:TurnStep[];error?:string}
