import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StudioPaths } from '../storage.js';

export const chatWorkflows = {
  'text-to-image': {label:'Create image', command:'/create-image', tool:'prepare_image', guide:'06-text-to-image.md'},
  'text-to-video': {label:'Create video', command:'/create-video', tool:'prepare_video', guide:'create-a-video.md'},
  'reference-to-video': {label:'Animate image', command:'/animate-image', tool:'animate_image', guide:'animate-an-image.md'},
} as const;
export type ChatWorkflow = keyof typeof chatWorkflows;
const names = ['chat/standard.md','chat/spicy.md','chat/summarize.md','chat/title.md', ...Object.values(chatWorkflows).map(w=>w.guide)];
const bundled = fileURLToPath(new URL('../../../prompting/', import.meta.url));
// Source and compiled modules have different depths from the package root.
function bundleRoot() { return existsSync(path.join(bundled,'chat/standard.md')) ? bundled : fileURLToPath(new URL('../../prompting/',import.meta.url)); }
export function initializeChatPrompts(paths: StudioPaths) {
  const directory=path.join(paths.config,'prompting');
  for(const name of names){const target=path.join(directory,name);mkdirSync(path.dirname(target),{recursive:true});
    if(!existsSync(target))writeFileSync(target,readFileSync(path.join(bundleRoot(),name)),{flag:'wx'});
  }
  return directory;
}
export function chatPromptSnapshot(paths: StudioPaths, mode:'sfw'|'nsfw', workflow:ChatWorkflow|null) {
  const files = [mode==='sfw'?'chat/standard.md':'chat/spicy.md', ...(workflow?[chatWorkflows[workflow].guide]:[]),'chat/summarize.md'];
  const contents=files.map(name=>{
    const custom=path.join(paths.config,'prompting',name);
    const value=readFileSync(existsSync(custom)?custom:path.join(bundleRoot(),name),'utf8');
    if(!value.trim()||value.includes('\0')||value.length>64000)throw Error(`Repair prompting/${name} before sending another message.`);
    return {name,content:value};
  });
  const system=contents[0]!.content + '\n\nA successful request tool call only prepares a request for review. Say the request is ready to review; never say a video or image is ready unless a completed job with an output exists. Tool rejection details are visible in the tool transcript; correct them when possible, and do not claim success after an unresolved rejection.' + (workflow?'\n\nActive workflow: '+workflow+'. The following guide governs the generation prompt FIELD only. “Return only the prompt” does not limit chat clarification or workflow tool calls.\n\n'+contents[1]!.content:'\n\nNo workflow is active. Chat normally; ask the user to select a workflow before preparing requests.');
  return {system,summarySystem:contents.at(-1)!.content,files:contents,hash:createHash('sha256').update(JSON.stringify(contents)).digest('hex')};
}

export function chatTitlePrompt(paths:StudioPaths){const custom=path.join(paths.config,'prompting/chat/title.md');return readFileSync(existsSync(custom)?custom:path.join(bundleRoot(),'chat/title.md'),'utf8');}
