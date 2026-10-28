/** Summarize measured runs; a successful render alone is not qualification. */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
const root=path.resolve(process.argv[2]||'.local/local-worker/qualification');
const reports=[];
for(const name of await readdir(root)){
  const run=path.join(root,name);let result,runtime;
  try{result=JSON.parse(await readFile(path.join(run,'result.json'),'utf8'));}catch{continue;}
  try{runtime=JSON.parse(await readFile(path.join(run,'runtime.json'),'utf8'));}catch{
    try{runtime=JSON.parse(await readFile(path.join(run,'runtime.recovery.json'),'utf8'));}catch{runtime={};}
  }
  const samples=[];let corrupt_samples=0;
  for(const line of (await readFile(path.join(run,'memory.jsonl'),'utf8').catch(()=>'')).trim().split('\n').filter(Boolean)){
    try{samples.push(JSON.parse(line));}catch{corrupt_samples++;}
  }
  const valid=samples.filter(sample=>Number.isFinite(sample.commit_bytes));
  const row={name,role:runtime.role,route:runtime.route,flags:(runtime.flags??[]).filter(flag=>['--fast-disk','--disable-pinned-memory','--disable-comfy-compiler'].includes(flag)||flag.startsWith('--reserve-vram=')||flag.startsWith('--vram-headroom=')),...result,
    ...(runtime.reconstructed?{runtime_reconstructed:true}:{}),corrupt_memory_samples:corrupt_samples,
    startup_seconds:runtime.startup_seconds??null,
    memory:valid.length?{sample_count:valid.length,commit_peak_gib:Math.max(...valid.map(s=>s.commit_bytes))/1024**3,
      commit_limit_start_gib:valid[0].commit_limit_bytes/1024**3,commit_limit_end_gib:valid.at(-1).commit_limit_bytes/1024**3,
      commit_peak_ratio:Math.max(...valid.map(s=>s.commit_bytes/s.commit_limit_bytes)),
      minimum_commit_headroom_gib:Math.min(...valid.map(s=>s.commit_limit_bytes-s.commit_bytes))/1024**3,
      minimum_available_ram_gib:Math.min(...valid.map(s=>s.available_bytes))/1024**3,
      tree_working_set_peak_gib:Math.max(...valid.map(s=>s.tree_working_set_bytes||0))/1024**3,
      tree_private_peak_gib:Math.max(...valid.map(s=>s.tree_private_bytes||0))/1024**3,
      gpu_peak_gib:Math.max(...valid.flatMap(s=>(s.gpus??[]).map(g=>g.used_mib)))/1024}:null,jobs:[]};
  for(const child of await readdir(run)){
    const directory=path.join(run,child);let job,request;
    try{job=JSON.parse(await readFile(path.join(directory,'result.json'),'utf8'));request=JSON.parse(await readFile(path.join(directory,'request.json'),'utf8'));}catch{continue;}
    const output=job.outputs?.[0];
    const record={id:child,state:job.state,seconds:job.elapsed_seconds,preparation_seconds:job.preparation_seconds??null,output:request.output};
    record.workflow=request.workflow;record.references=request.references?.length??0;
    if(request.workflow.endsWith('video'))record.steps=request.steps??30;
    record.reference_kinds=Object.fromEntries(['image','video','audio'].map(kind=>[kind,request.references?.filter(ref=>ref.kind===kind).length??0]));
    if(output){
      const file=path.join(run,'workspace/.seed/spool/outputs',output.path);
      const probe=spawnSync(ffprobe.path,['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8',windowsHide:true});
      if(probe.status!==0)throw Error('Output inspection failed: '+probe.stderr);
      const media=JSON.parse(probe.stdout);record.streams=media.streams.map(({codec_type,codec_name,width,height,nb_frames,duration,sample_rate,channels})=>({codec_type,codec_name,width,height,nb_frames,duration,sample_rate,channels}));
      if(output.mime_type==='video/mp4'){
        const audio=spawnSync(ffmpeg,['-hide_banner','-i',file,'-vn','-af','volumedetect','-f','null','-'],{encoding:'utf8',windowsHide:true});
        record.audio_mean_db=audio.stderr.match(/mean_volume: ([\d.-]+) dB/)?.[1]??null;
        record.audio_max_db=audio.stderr.match(/max_volume: ([\d.-]+) dB/)?.[1]??null;
        const seconds=Number(media.format.duration),sheet=path.join(directory,'frames.jpg');
        const result=spawnSync(ffmpeg,['-v','error','-y','-i',file,'-vf',`fps=5/${seconds},scale=320:-1,tile=5x1`,'-frames:v','1',sheet],{encoding:'utf8',windowsHide:true});
        if(result.status!==0)throw Error(result.stderr);
      }
    }
    row.jobs.push(record);
  }
  reports.push(row);
}
await writeFile(path.join(root,'report.json'),JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports,null,2));
