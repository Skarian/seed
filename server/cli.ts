#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { openSync, closeSync, statSync, renameSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { prepareStorage, resolvePaths } from './storage.js';
import { settings, saveSettings } from './settings.js';
import { control } from './lifecycle.js';
import { ensureCredentials, webServerEnvironment } from './credentials.js';

const paths = resolvePaths(process.env.STUDIO_DEV_ROOT);
const [command = 'help', ...args] = process.argv.slice(2);
const quiet = args.includes('--quiet');
const say = (value: string) => { if (!quiet) console.log(value); };
try {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  if (major !== 26 || minor! < 8 || (minor === 8 && patch! < 2)) throw new Error('seed requires Node 26.8.2 or newer in the 26.x line. Install it from nodejs.org.');
  if (command === 'version') {
    const {workerRelease} = await import('../shared/worker-release.js');
    const manifest=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
    say(JSON.stringify({package:manifest.name,version:manifest.version,node:process.version,worker_image:workerRelease.image,worker_protocol:1},null,2));
  } else if (command === 'gpu') {
    const { gpuCommand } = await import('./gpu-cli.js');
    await gpuCommand(args);
  } else {
  if (!['setup', 'models', 'start', 'status', 'stop', 'help'].includes(command)) throw new Error(`Unknown command: ${command}. Use seed help.`);
  const known = command === 'models' ? ['--quiet'] : ['--quiet', '--host', '--port', ...(command === 'setup' ? ['--provider', '--cache-models', '--no-cache-models'] : [])];
  for (let i = 0; i < args.length; i++) {
    if (!known.includes(args[i]!)) throw new Error(`Unknown option: ${args[i]}`);
    if (args[i] === '--host' || args[i] === '--port' || args[i] === '--provider') { if (!args[++i] || args[i]!.startsWith('--')) throw new Error('Option needs a value.'); }
  }
  if (command === 'help') say('seed setup [--provider vast|runpod] [--cache-models | --no-cache-models] [--host LOCAL_IP] [--port 4310]\nseed models [--quiet]\nseed start [--quiet]\nseed status\nseed stop\nseed gpu vast <doctor|offers|rent|wait|boot|connect|reconnect|status|reconcile|destroy|billing>\nseed gpu runpod <help|catalog|datacenters|status|create|wait|prepare|connect|safe|logs|billing|reconcile|destroy>');
  else {
    prepareStorage(paths);
    if (command === 'setup' || command === 'start') { const { verifyMediaTools } = await import('./media.js'); await verifyMediaTools(); }
    if (command === 'models') {
      const { prepareModels } = await import('./model-cache.js');
      await prepareModels(paths, say);
    } else if (command === 'setup') {
      const current = settings(paths);
      const value = (flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
      if (await control(paths, 'status')) throw new Error('Stop seed before changing setup: seed stop.');
      current.host = value('--host') ?? current.host;
      current.port = Number(value('--port') ?? current.port);
      const { validateAddress } = await import('./address.js'); validateAddress(current.host, current.port);
      if (args.includes('--cache-models') && args.includes('--no-cache-models')) throw new Error('Choose --cache-models or --no-cache-models.');
      const provider = value('--provider') ?? current.provider ?? 'vast';
      if (provider !== 'vast' && provider !== 'runpod') throw new Error('Choose --provider vast or --provider runpod.');
      const credentials = await ensureCredentials(paths, { provider, interactive: Boolean(process.stdin.isTTY) && !quiet });
      current.provider = provider;
      if (args.includes('--cache-models')) current.localModelCache = true;
      else if (args.includes('--no-cache-models')) current.localModelCache = false;
      else if (process.stdin.isTTY && !quiet) {
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        try {
          let answer = '';
          while (!['yes', 'no', 'y', 'n'].includes(answer)) answer = (await prompt.question('Keep a local model cache for fallback? Downloads all configured models now and uses local disk space. (Yes/No) ')).trim().toLowerCase();
          current.localModelCache = answer === 'yes' || answer === 'y';
        } finally { prompt.close(); }
      } else current.localModelCache ??= false;
      // Save the choice before downloading so an interruption can be resumed.
      saveSettings(paths, current);
      if (current.localModelCache) {
        const { prepareModels } = await import('./model-cache.js');
        await prepareModels(paths, say);
      }
      say(`Local model fallback: ${current.localModelCache ? 'enabled' : 'disabled'}. GPU downloads are attempted first.`);
      say(`Setup complete. ${current.provider === 'vast' ? 'Vast' : 'RunPod'} and Hugging Face configured.\nCivitai: ${credentials.civitaiConfigured ? 'configured' : 'skipped (optional)'}\nCredentials: ${credentials.file}\nThe repository .env is not modified.\nData: ${paths.data}\nRun seed start.`);
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
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'seed could not complete the command.'); process.exitCode = 1; }
