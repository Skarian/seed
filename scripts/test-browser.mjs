import {fork,spawn} from 'node:child_process';
import {mkdir,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {execFileSync} from 'node:child_process';
await mkdir('.local',{recursive:true});
execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=green:s=480x270:r=24','-t','3','-c:v','libx264','-pix_fmt','yuv420p','.local/browser-preview.mp4'],{windowsHide:true});
const root=await mkdtemp(path.resolve('.local/browser-tests-'));
const server=fork('scripts/browser-server.mjs',[],{windowsHide:true,env:{...process.env,STUDIO_DEV_ROOT:root},stdio:['ignore','inherit','inherit','ipc']});
const closed=new Promise(resolve=>server.once('exit',resolve));
try{
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Browser fixture did not start.')),30000);
    server.once('message',()=>{clearTimeout(timeout);resolve();});
    server.once('error',error=>{clearTimeout(timeout);reject(error);});
    server.once('exit',()=>{clearTimeout(timeout);reject(Error('Browser fixture exited before startup.'));});
  });
  process.exitCode=await new Promise((resolve,reject)=>{
    const runner=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test',...process.argv.slice(2)],{windowsHide:true,stdio:'inherit'});
    runner.once('error',reject);runner.once('exit',code=>resolve(code??1));
  });
}finally{if(server.connected)server.send('stop');await closed;}
