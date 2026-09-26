#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { openSync, closeSync, statSync, renameSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareStorage, resolvePaths } from './storage.js';
import { settings, saveSettings } from './settings.js';
import { control } from './lifecycle.js';
import { ensureCredentials, webServerEnvironment } from './credentials.js';
import { initializeChatPrompts } from './chat/prompts.js';

const paths = resolvePaths(process.env.STUDIO_DEV_ROOT);
const [command = 'help', ...args] = process.argv.slice(2);
const quiet = args.includes('--quiet');
const say = (value: string) => { if (!quiet) console.log(value); };
try {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  if (major !== 26 || minor! < 8 || (minor === 8 && patch! < 2)) throw new Error('seed requires Node 26.8.2 or newer in the 26.x line. Install it from nodejs.org.');
  if (command === 'version') {
    const manifest=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
    say(JSON.stringify({package:manifest.name,version:manifest.version,node:process.version,generation_provider:'worker-pool'},null,2));
  } else {
  if (!['setup', 'loras', 'start', 'status', 'stop', 'help','diagnostics'].includes(command)) throw new Error(`Unknown command: ${command}. Use seed help.`);
  const known = ['--quiet','--host','--port','--chat-only',...(command==='diagnostics'?['--since','--until','--worker','--provider','--class']:[])];
  if(command!=='loras')for (let i=0;i<args.length;i++){if(!known.includes(args[i]!))throw Error('Unknown option: '+args[i]);if(['--host','--port','--since','--until','--worker','--provider','--class'].includes(args[i]!)){if(!args[i+1]||args[i+1]!.startsWith('--'))throw Error('Missing option value.');i++;}}
  if(command==='help')say('seed setup [--host LOCAL_IP] [--port 4310]\nseed start\nseed status\nseed stop\nseed loras list\nseed diagnostics [--since ISO_DATE] [--until ISO_DATE] [--provider vast|runpod] [--class image|video]\nseed diagnostics --worker WORKER_ID\nManage credentials, LoRAs, and workers in the application.');
  else {
    prepareStorage(paths);
    if (command === 'setup' || command === 'start') { const { verifyMediaTools } = await import('./media.js'); await verifyMediaTools(); }
    if(command==='diagnostics') {
      const {default:Database}=await import('better-sqlite3');const {Diagnostics}=await import('./diagnostics.js');
      const db=new Database(path.join(paths.data,'studio.sqlite'),{readonly:true,fileMustExist:true});
      try {
        if(!db.prepare("SELECT name FROM sqlite_master WHERE name='acquisition_history'").get())throw Error('Acquisition history starts after running the updated app.');
        const value=(flag:string)=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
        const date=(flag:string)=>{const v=value(flag);if(!v)return undefined;const n=Date.parse(v);if(!Number.isFinite(n))throw Error('Use an ISO date for '+flag);return new Date(n).toISOString();};
        const d=new Diagnostics(db,paths);say(JSON.stringify(value('--worker')?d.details(value('--worker')!):d.history({from:date('--since'),to:date('--until'),provider:value('--provider'),worker_class:value('--class')}),null,2));
      }finally{db.close();}
    } else if (command === 'loras') {
      const { Loras }=await import('./loras.js');const catalog=new Loras(paths);
      if(!args[0]||args[0]==='list')say(JSON.stringify(catalog.list(),null,2));
      else throw Error('Add and map LoRAs in Admin → LoRAs.');
    } else if(command==='setup') {
      const current=settings(paths),value=(flag:string)=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
      if(!args.includes('--chat-only')&&await control(paths,'status'))throw Error('Stop seed before changing setup: seed stop.');
      say('Prompts: '+initializeChatPrompts(paths));
      if(!args.includes('--chat-only')){
        current.host=value('--host')??current.host;current.port=Number(value('--port')??current.port);
        const {validateAddress}=await import('./address.js');validateAddress(current.host,current.port);
        await ensureCredentials(paths,{interactive:Boolean(process.stdin.isTTY)&&!quiet});saveSettings(paths,current);
        say('Data: '+paths.data+'\nRun seed start, then add your keys in Admin → Credentials.');
      }
    } else if (command === 'status') {
      const running = await control(paths, 'status'); say(running ? `Running: ${running.url}` : 'seed is stopped.');
    } else if (command === 'stop') {
      const running = await control(paths, 'stop');
      if (running) {
        for (let i = 0; i < 50 && await control(paths, 'status'); i++) await delay(100);
        if (await control(paths, 'status')) throw new Error('seed has not finished stopping. Check its logs.');
      }
      say(running ? 'seed stopped.' : 'seed is already stopped.');
    } else {
      let running = await control(paths, 'status');
      if (!running) {
        const log = path.join(paths.log, 'server.log');
        try { if (statSync(log).size > 5 * 1024 * 1024) { rmSync(`${log}.1`, { force: true }); renameSync(log, `${log}.1`); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        const fd = openSync(log, 'a');
        const child = spawn(process.execPath, [fileURLToPath(new URL('./main.js', import.meta.url))], { detached: true, windowsHide: true, stdio: ['ignore', fd, fd], env: { ...webServerEnvironment(process.env), SEED_MANAGED: '1' } });
        closeSync(fd);
        await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
        // Fresh Windows installs can take longer while native dependencies load.
        for (let i = 0; i < 300 && !running; i++) { await delay(100); running = await control(paths, 'status'); }
        if (!running) throw new Error(`seed did not start. The address may be occupied or unavailable. See ${log}`);
      }
      say(`seed: ${running.url}`);
    }
  }
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'seed could not complete the command.'); process.exitCode = 1; }
