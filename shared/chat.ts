import type { ImageRequest } from '../server/workflows.js';
export type ChatWorkflow='text-to-image'|'text-to-video'|'reference-to-video';
export type ChatMode='sfw'|'nsfw';
export interface ChatRevision {number:number;request:ImageRequest;notes:Record<string,string>;decision:'undecided'|'approved'|'denied';approved_snapshot?:boolean;job_ids:string[]}
export interface ChatCard {id:string;workflow:ChatWorkflow;revisions:ChatRevision[]}
export interface ChatGroup {id:string;workflow:ChatWorkflow;state:'assembling'|'reviewing'|'revising'|'released'|'stopped';cards:ChatCard[]}
export interface ChatMessage {id:string;role:'user'|'assistant'|'event';text:string;assets:string[];created_at:string}
export interface ChatView {
  id:string;title:string;mode:ChatMode;workflow:ChatWorkflow|null;version:number;epoch:number;
  reasoning:boolean;messages:ChatMessage[];groups:ChatGroup[];assets:string[];
  partial?:string;
  activity:'idle'|'thinking'|'preparing'|'generating';error:string|null;
  created_at:string;updated_at:string;
}
