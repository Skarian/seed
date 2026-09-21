import {afterEach,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {chatPromptSnapshot,initializeChatPrompts,CHAT_PROMPT_VERSION} from '../server/chat/prompts.js';
import {resolvePaths} from '../server/storage.js';

const roots:string[]=[];
function fixture(){mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/prompts-'));roots.push(root);return resolvePaths(root);}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const hash=(text:string)=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');


it('upgrades a recorded old default but preserves an edited guide',()=>{
 const paths=fixture(),directory=initializeChatPrompts(paths),file=path.join(directory,'animate-an-image.md');
 const prior='An older exact default\n';writeFileSync(file,prior);
 writeFileSync(path.join(directory,'.seed-defaults.json'),JSON.stringify({defaults:{'animate-an-image.md':hash(prior)}}));
 initializeChatPrompts(paths);expect(readFileSync(file,'utf8')).toContain('Full-reference format:');
 const custom='My intentional custom reference guide';writeFileSync(file,custom);
 initializeChatPrompts(paths);initializeChatPrompts(paths);
 expect(readFileSync(file,'utf8')).toBe(custom);
 expect(chatPromptSnapshot(paths,'sfw','reference-to-video').system).toContain(custom);
});

it('does not replace unknown local prompts when migration metadata is damaged',()=>{
 const paths=fixture(),directory=initializeChatPrompts(paths),file=path.join(directory,'animate-an-image.md');
 writeFileSync(file,'A customized starting-image guide');writeFileSync(path.join(directory,'.seed-defaults.json'),'{broken');
 initializeChatPrompts(paths);expect(readFileSync(file,'utf8')).toBe('A customized starting-image guide');
 const snapshot=chatPromptSnapshot(paths,'sfw','reference-to-video');
 expect(snapshot.system).toContain('Only images can be first or last frames');
 expect(snapshot.system).toContain('correct the reported field and create again');
});

it('hashes the effective system and changes when editable instructions change',()=>{
 const paths=fixture(),first=chatPromptSnapshot(paths,'sfw','text-to-image');
 const expected=createHash('sha256').update(JSON.stringify({version:first.version,system:first.system,summarySystem:first.summarySystem})).digest('hex');
 expect(first.hash).toBe(expected);
 writeFileSync(path.join(paths.config,'prompting','chat/standard.md'),'Custom creative direction');
 expect(chatPromptSnapshot(paths,'sfw','text-to-image').hash).not.toBe(first.hash);
});
