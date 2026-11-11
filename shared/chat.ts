import type { ImageRequest } from './generation.js';
import type {MentionBinding} from './chat-mentions.js';
export type ChatWorkflow='text-to-image'|'image-to-image'|'text-to-video'|'reference-to-video';
export type ChatMode='sfw'|'nsfw';
export interface ChatRevision {number:number;request:ImageRequest;notes:Record<string,string>;decision:'undecided'|'approved'|'denied';approved_snapshot?:boolean;job_ids:string[];source_job_id?:string;after_message_id?:string|null;run_id?:string}
export interface ChatCard {timeline_start?:number;id:string;workflow:ChatWorkflow;revisions:ChatRevision[];/** Seed left this draft out of the plan when the user narrowed it; shown unselected, never deleted. */left_out?:boolean}
export interface ChatGroup {id:string;after_message_id?:string|null;workflow:ChatWorkflow;state:'assembling'|'reviewing'|'revising'|'released'|'stopped';cards:ChatCard[];submission_error?:string;
  /** Made directly by the user rather than proposed by Seed. */
  direct?:boolean;
  /** Retry identity for a direct make. */
  client_request_id?:string}
export interface ChatMessage {id:string;role:'user'|'assistant'|'event';text:string;mention_bindings?:MentionBinding[];reasoning_text?:string;transcript?:TurnTranscript;request_attachment?:{card_id:string;revision:number;request:ImageRequest;notes:Record<string,string>};assets:string[];created_at:string}
export interface ChatView {
  /** Which change of the project (or of one of its jobs) this copy shows: a larger number is a newer copy. */
  revision?:number;
  id:string;title:string;mode:ChatMode;workflow:ChatWorkflow|null;version:number;epoch:number;
  reasoning:boolean;messages:ChatMessage[];groups:ChatGroup[];assets:string[];
  /** The project's lasting brief (Markdown): story, characters, locations, look, rules, shots. Kept by Seed and the owner. */
  brief?:string;brief_updated_by?:'you'|'seed';brief_updated_at?:string;
  /** The project's characters, places and props: added from the brief, edited or removed only on purpose. */
  cast?:import('./cast.js').CastEntry[];
  /** The owner's approved references and chosen takes. */
  choices?:import('./choices.js').ProjectChoices;
  /** The shape the owner will deliver ("2.39:1"), when it differs from what the models make; results show its guides and Crop starts there. */
  frame?:string;
  activity:'idle'|'thinking'|'preparing'|'generating';error:string|null;
  created_at:string;updated_at:string;
}

/**
 * Why a tool step failed, read once when it ended. `internal` is Seed's own slip (a stale id, a malformed call), which
 * the owner need not see when the turn otherwise got its work done; `fields` lists a draft's field problems.
 */
export interface StepFailure {error:string;internal:boolean;fields?:Array<{field:string;message:string}>}
export interface TurnStep {id:string;kind:'reasoning'|'text'|'tool';text?:string;name?:string;input?:unknown;result?:unknown;state?:'running'|'succeeded'|'failed'|'stopped';
  /** Set on a failed tool step. Turns saved before it existed are read from their result text. */
  failure?:StepFailure;
  started_at:string;ended_at?:string}
export interface TurnTranscript {started_at:string;ended_at?:string;state:'running'|'completed'|'failed'|'stopped';steps:TurnStep[];error?:string;
  /** What the turn was asked to work on: the kind of work then, the attached inputs, and the draft it revised. */
  scope?:{workflow?:ChatWorkflow|null;source_assets?:string[];target_request_id?:string}}
