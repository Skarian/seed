/** Serial GPU qualification: three fresh engines and ten warm repeats per case. */
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {sizeChoices} from '../dist/shared/resolution.js';
const root=path.resolve(process.env.SEED_LOCAL_ROOT||'.local/local-worker');
const {values}=parseArgs({options:{resume:{type:'string'}}});
const campaign=values.resume?path.resolve(values.resume):path.join(root,'qualification','images-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
const results=values.resume?JSON.parse(await readFile(campaign,'utf8')):[];
let cancelled=false,activeRun;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
  cancelled=true;
  if(activeRun)void writeFile(path.join(activeRun,'cancel-requested.json'),'{}',{flush:true});
});
await mkdir(path.dirname(campaign),{recursive:true});
for(const aspect of ['16:9','9:16'])for(const {id:size} of sizeChoices('text-to-image')){
  for(const [cold_index,repeat] of [11,1,1].entries()){
    if(cancelled){process.exitCode=130;break;}
    const prior=results.find(result=>result.size===size&&result.aspect===aspect&&result.cold_index===cold_index&&result.passed);
    if(prior){const saved=JSON.parse(await readFile(path.join(prior.run,'result.json'),'utf8'));if(saved.passed&&saved.repeat===repeat)continue;}
    const args=['scripts/qualify-local-worker.mjs','image','--size',size,'--aspect',aspect,'--repeat',String(repeat)];
    let run,output='';
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','inherit']});
      child.stdout.on('data',data=>{output+=data;let end;while((end=output.indexOf('\n'))>=0){const line=output.slice(0,end);output=output.slice(end+1);const value=JSON.parse(line);if(value.starting){run=activeRun=value.run;if(cancelled)void writeFile(path.join(run,'cancel-requested.json'),'{}',{flush:true});console.log(JSON.stringify({size,aspect,repeat,run}));}}});
      child.on('error',reject);child.on('exit',resolve);
    });
    results.push({size,aspect,cold_index,repeat,run,passed:code===0});await writeFile(campaign,JSON.stringify(results,null,2));
    if(code!==0)throw Error('Image qualification stopped at '+run);
  }
}
console.log(JSON.stringify({campaign,passed:true}));
