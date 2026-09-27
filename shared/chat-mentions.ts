export interface MentionBinding {token:string;asset_id:string;input_id?:string;channel?:'audio';card_id?:string;revision?:number;input_settings?:{role:string;start_seconds?:number;duration_seconds?:number;include_audio?:boolean;framing?:string}}
export const chatMentionPattern=/\[([^\]]+)\]\(asset:([^)]+)\)/g;
export function chatMentions(text:string){return [...text.matchAll(chatMentionPattern)].map(match=>({token:match[0],label:match[1]!,asset_id:match[2]!}));}
