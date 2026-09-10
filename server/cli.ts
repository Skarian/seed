#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { openSync, closeSync, statSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareStorage, resolvePaths } from './storage.js';
import { settings, saveSettings, windowsStartup } from './settings.js';
import { control } from './lifecycle.js';
import { ensureCredentials, webServerEnvironment } from './credentials.js';

const paths = resolvePaths(process.env.STUDIO_DEV_ROOT);
const [command = 'help', ...args] = process.argv.slice(2);
const quiet = args.includes('--quiet');
const say = (value: string) => { if (!quiet) console.log(value); };
try {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  if (major !== 26 || minor! < 8 || (minor === 8 && patch! < 2)) throw new Error('seed requires Node 26.8.2 or newer in the 26.x line. Install it from nodejs.org.');
  if (!['setup', 'start', 'status', 'stop', 'help'].includes(command)) throw new Error(`Unknown command: ${command}. Use seed help.`);
  const known = ['--quiet', '--startup', '--no-startup', '--host', '--port'];
  for (let i = 0; i < args.length; i++) {
    if (!known.includes(args[i]!)) throw new Error(`Unknown option: ${args[i]}`);
    if (args[i] === '--host' || args[i] === '--port') { if (!args[++i]) throw new Error('Option needs a value.'); }
  }
  if (command === 'help') say('seed setup [--host LOCAL_IP] [--port 4310] [--startup | --no-startup]\nseed start [--quiet]\nseed status\nseed stop');
  else {
    prepareStorage(paths);
    if (command === 'setup') {
      const current = settings(paths);
      const value = (flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
      if (await control(paths, 'status')) throw new Error('Stop seed before changing setup: seed stop.');
      current.host = value('--host') ?? current.host;
      current.port = Number(value('--port') ?? current.port);
      const { validateAddress } = await import('./address.js'); validateAddress(current.host, current.port);
      if (args.includes('--startup') && args.includes('--no-startup')) throw new Error('Choose --startup or --no-startup.');
      const credentials = await ensureCredentials(paths, { interactive: Boolean(process.stdin.isTTY) && !quiet });
      if (process.platform === 'win32') {
        if (args.includes('--startup')) current.startup = true;
        else if (args.includes('--no-startup')) current.startup = false;
        else if (process.stdin.isTTY && !quiet) {
          const prompt = createInterface({ input: process.stdin, output: process.stdout });
          try {
            let answer = '';
            while (!['yes', 'no', 'y', 'n'].includes(answer)) answer = (await prompt.question('Would you like seed to start automatically when you sign in? (Yes/No) ')).trim().toLowerCase();
            current.startup = answer === 'yes' || answer === 'y';
          } finally { prompt.close(); }
        }
        windowsStartup(current.startup, process.execPath, fileURLToPath(import.meta.url));
      } else if (args.includes('--startup')) throw new Error('Automatic sign-in setup is currently supported on Windows only.');
      saveSettings(paths, current);
      say(`Setup complete. RunPod and Hugging Face configured.\nCivitai: ${credentials.civitaiConfigured ? 'configured' : 'skipped (optional)'}\nCredentials: ${credentials.file}\nThe repository .env is not modified.\nData: ${paths.data}\nSign-in startup: ${process.platform === 'win32' && current.startup ? 'enabled' : 'disabled'}\nRun seed start.`);
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
        for (let i = 0; i < 60 && !running; i++) { await delay(100); running = await control(paths, 'status'); }
        if (!running) throw new Error(`seed did not start. The address may be occupied or unavailable. See ${log}`);
      }
      say(`seed: ${running.url}`);
    }
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'seed could not complete the command.'); process.exitCode = 1; }
