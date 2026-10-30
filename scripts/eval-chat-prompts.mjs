// Runs Standard-mode Chat scenarios through the real Chat service and Gemma 4 (OpenRouter),
// in a throwaway profile, and writes the resulting request cards for evaluation.
// Usage: node scripts/eval-chat-prompts.mjs [--prompts DIR] [--out FILE] [--only 1,2] [--holdout] [--concurrency 4]
// --prompts copies candidate prompt files (same relative names as prompting/) over the defaults.
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,cpSync,existsSync} from 'node:fs';
import path from 'node:path';
import {openDatabase} from '../dist/server/db.js';
import {resolvePaths,prepareStorage} from '../dist/server/storage.js';
import {Jobs} from '../dist/server/jobs.js';
import {Chats} from '../dist/server/chat/service.js';
import {initializeChatPrompts} from '../dist/server/chat/prompts.js';
import {storedCredentials} from '../dist/server/credential-store.js';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:fallback;};
const scenariosFile=arg('--scenarios','research/prompting/scenarios.json');
const only=arg('--only')?.split(',').map(Number);
const includeHoldout=process.argv.includes('--holdout');
const concurrency=Number(arg('--concurrency','4'));
const promptsDir=arg('--prompts');
const out=arg('--out',`.local/prompt-evals/run-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);

const live=resolvePaths(process.env.SEED_LIVE_ROOT??'C:/Services/Seed/profile');
const key=storedCredentials(live).openrouterApiKey??storedCredentials(resolvePaths()).openrouterApiKey;
if(!key)throw Error('No OpenRouter key found.');
const scenarios=JSON.parse(readFileSync(scenariosFile,'utf8')).filter(s=>(only?only.includes(s.id):true)&&(includeHoldout||only?true:!s.holdout));

mkdirSync('.local/tests',{recursive:true});
const root=mkdtempSync(path.resolve('.local/tests/prompt-eval-')),paths=resolvePaths(root);prepareStorage(paths);
writeFileSync(path.join(paths.config,'credentials.json'),JSON.stringify({openrouterApiKey:key}));
initializeChatPrompts(paths);
if(promptsDir)cpSync(promptsDir,path.join(paths.config,'prompting'),{recursive:true});
const db=openDatabase(paths.data);
// Chat never submits work here (cards are never approved), so every pool call is a no-op.
const pool=new Proxy({},{get:(_t,name)=>name==='then'?undefined:(()=>name==='all'||name==='workers'?[]:undefined)});
const jobs=new Jobs(db,paths,pool);
const chats=new Chats(db,paths,jobs);

async function idle(id){for(let i=0;i<1800;i++){const v=chats.view(id);if(v.activity==='idle')return v;await new Promise(r=>setTimeout(r,200));}throw Error('Agent did not settle.');}
const latest=card=>card.revisions.at(-1);
function summarizeRequest(r){const {prompt,count,output,audio,loras,references,seed}=r;return {prompt,count,output,audio,loras:loras?.map(l=>l.name??l.id),inputs:references?.length??0,seed};}

async function runScenario(s){
  const started=Date.now();
  let chat=chats.create('sfw');chat=chats.settings(chat.id,chat.version,{workflow:s.workflow});
  const turns=[],answers=[...(s.ifAsked??[])];
  async function say(text,scripted){
    const before=new Set(chat.groups.flatMap(g=>g.cards.map(c=>c.id+':'+latest(c).number)));
    chats.send(chat.id,{version:chat.version,text,assets:[]});chat=await idle(chat.id);
    const reply=chat.messages.filter(m=>m.role==='assistant').at(-1)?.text??'';
    const cards=chat.groups.flatMap(g=>g.cards).filter(c=>!before.has(c.id+':'+latest(c).number)).map(c=>({card:c.id.slice(0,8),revision:latest(c).number,workflow:c.workflow,...summarizeRequest(latest(c).request)}));
    turns.push({user:text,...(scripted?{}:{answer:true}),reply,cards,error:chat.error??undefined});
    return cards.length>0;
  }
  for(const raw of s.turns){
    const turn=typeof raw==='string'?{text:raw}:raw;
    if(turn.workflow&&turn.workflow!==chat.workflow){
      // A real user resolves pending cards before switching workflows; cancel them here (nothing is generated).
      for(const card of chat.groups.flatMap(g=>g.cards))if(latest(card).decision==='undecided')chat=await chats.decide(chat.id,card.id,latest(card).number,'denied');
      chat=chats.settings(chat.id,chat.version,{workflow:turn.workflow});
    }
    // When the agent asks instead of preparing a request, answer briefly like a real user (at most twice per turn).
    let made=await say(turn.text,true);
    for(let i=0;!made&&!turn.chat&&i<2&&answers.length;i++)made=await say(answers.shift(),false);
  }
  return {id:s.id,workflow:s.workflow,holdout:!!s.holdout,seconds:Math.round((Date.now()-started)/1000),turns};
}

const results=[];let next=0;
await Promise.all(Array.from({length:Math.min(concurrency,scenarios.length)},async()=>{
  while(next<scenarios.length){const s=scenarios[next++];
    try{results.push(await runScenario(s));process.stdout.write(`#${s.id} ok\n`);}
    catch(e){results.push({id:s.id,error:String(e?.message??e)});process.stdout.write(`#${s.id} FAILED ${e?.message}\n`);}}
}));
results.sort((a,b)=>a.id-b.id);
mkdirSync(path.dirname(out),{recursive:true});
writeFileSync(out,JSON.stringify({prompts:promptsDir??'bundled',at:new Date().toISOString(),results},null,1));
await chats.close();db.close();rmSync(root,{recursive:true,force:true});
console.log('wrote',out);
