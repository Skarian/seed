// Fingerprint exactly the built application and pinned worker assets used by a
// live acceptance cohort. Git HEAD alone is insufficient in a dirty worktree.
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const [command,file]=process.argv.slice(2);
if(!['snapshot','verify'].includes(command)||!file)throw Error('Use snapshot|verify EVIDENCE_FILE');
const files={};
function walk(directory){for(const item of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const name=path.join(directory,item.name);if(item.isDirectory())walk(name);else files[name.split(path.sep).join('/')]=createHash('sha256').update(readFileSync(name)).digest('hex');}}
walk('dist');
const fingerprint=createHash('sha256').update(JSON.stringify(files)).digest('hex');
const releases=JSON.parse(readFileSync('dist/worker/releases.json','utf8'));
if(command==='snapshot'){
  mkdirSync(path.dirname(file),{recursive:true});
  const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim();
  writeFileSync(file,JSON.stringify({created_at:new Date().toISOString(),branch:git(['branch','--show-current']),head:git(['rev-parse','HEAD']),dirty:Boolean(git(['status','--porcelain'])),fingerprint,releases,files},null,2)+'\n',{flag:'wx'});
}else assert.equal(fingerprint,JSON.parse(readFileSync(file,'utf8')).fingerprint,'Built release changed: create a new acceptance cohort');
console.log(JSON.stringify({command,file,fingerprint,images:Object.fromEntries(Object.entries(releases).map(([role,r])=>[role,r.image]))}));
