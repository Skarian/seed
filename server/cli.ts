#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { openSync, closeSync, statSync, renameSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareStorage, resolvePaths } from './storage.js';
import { settings, saveSettings } from './settings.js';
import { control } from './lifecycle.js';
import { ensureCredentials, webServerEnvironment, falCredential } from './credentials.js';
import { setupChatCredential } from './chat/credentials.js';
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
    say(JSON.stringify({package:manifest.name,version:manifest.version,node:process.version,generation_provider:'fal'},null,2));
  } else {
  if (!['setup', 'loras', 'start', 'status', 'stop', 'help'].includes(command)) throw new Error(`Unknown command: ${command}. Use seed help.`);
  const known = ['--quiet','--host','--port','--chat-only'];
  if(command!=='loras')for (let i=0;i<args.length;i++){if(!known.includes(args[i]!))throw Error('Unknown option: '+args[i]);if(['--host','--port'].includes(args[i]!))i++;}
  if(command==='help')say('seed setup [--host LOCAL_IP] [--port 4310]\nseed setup --chat-only\nseed start\nseed status\nseed stop\nseed loras list\nseed loras add FILE image|fl|ref NAME\nseed loras upload ID');
  else {
    prepareStorage(paths);
    if (command === 'setup' || command === 'start') { const { verifyMediaTools } = await import('./media.js'); await verifyMediaTools(); }
    if (command === 'loras') {
      const { Loras }=await import('./loras.js');const catalog=new Loras(paths);
      if(!args[0]||args[0]==='list')say(JSON.stringify(catalog.list(),null,2));
      else if(args[0]==='add')say(await catalog.add(args[1]??'',args[2]??'',args.slice(3).join(' ')));
      else if(args[0]==='upload'){const entry=catalog.all().find(e=>e.id===args[1]);if(!entry)throw Error('Unknown adapter.');const {Fal}=await import('./fal.js');await catalog.url(entry.id,entry.revision,new Fal(falCredential(paths)));say('Adapter uploaded privately to fal.');}
      else throw Error('Use loras list, add, or upload.');
    } else if(command==='setup') {
      const current=settings(paths),value=(flag:string)=>args.includes(flag)?args[args.indexOf(flag)+1]:undefined;
      if(!args.includes('--chat-only')&&await control(paths,'status'))throw Error('Stop seed before changing setup: seed stop.');
      const configured=await setupChatCredential(paths,Boolean(process.stdin.isTTY)&&!quiet);
      say('Chat: '+(configured?'configured':'skipped (optional)')+'. Prompts: '+initializeChatPrompts(paths));
      if(!args.includes('--chat-only')){
        current.host=value('--host')??current.host;current.port=Number(value('--port')??current.port);
        const {validateAddress}=await import('./address.js');validateAddress(current.host,current.port);
        await ensureCredentials(paths,{interactive:Boolean(process.stdin.isTTY)&&!quiet});saveSettings(paths,{host:current.host,port:current.port});
        say('fal configured. Data: '+paths.data+'\nRun seed start.');
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
        let exited = false;
        child.once('exit', () => { exited = true; });
        await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
        // Fresh Windows installs can take longer while native dependencies load.
        for (let i = 0; i < 300 && !running && !exited; i++) { await delay(100); running = await control(paths, 'status'); }
        if (!running) throw new Error(`seed did not start. The address may be occupied or unavailable. See ${log}`);
      }
      say(`seed: ${running.url}`);
    }
  }
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'seed could not complete the command.'); process.exitCode = 1; }
