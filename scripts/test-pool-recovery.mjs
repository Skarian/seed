import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {providerReplay} from './provider-replay.mjs';

mkdirSync('.local/tests', { recursive: true });
const root = mkdtempSync(path.resolve('.local/tests/process-recovery-'));
const results = [];
const safeEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|LOCALAPPDATA|APPDATA|USERPROFILE|PROGRAMFILES|PROGRAMFILES\(X86\)|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(key)));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(fn, label, timeout = 20000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch (error) { last = error; } await pause(100); }
  throw Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
}
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
for (const provider of ['vast','runpod']) for (const checkpoint of ['create', 'submit', 'partial-save', 'saved-file', 'acknowledge', 'destroy']) {
  const directory = path.join(root, provider+'-'+checkpoint), port = await freePort(), origin = `http://127.0.0.1:${port}`;
  let child, boundary = false, stderr = '';
  const replay=await providerReplay({directory,provider,checkpoint,boundary:()=>{boundary=true;}});
  const external = () => JSON.parse(readFileSync(path.join(directory, 'external-state.json'), 'utf8'));
  const request = async (route, body, key) => {
    const response = await fetch(origin + '/api/v1/' + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    const value = await response.json(); assert.equal(response.ok, true, JSON.stringify(value)); return value;
  };
  async function start(crashAt = '') {
    stderr = ''; let ready = false;
    child = fork('scripts/recovery-fixture.mjs', [], { cwd: process.cwd(), windowsHide: true, silent: true,
      env: { ...safeEnvironment, SEED_RECOVERY_ROOT: directory, SEED_RECOVERY_PORT: String(port), SEED_CRASH_AT: crashAt, SEED_PROVIDER_REPLAY:replay.origin } });
    child.stderr.on('data', chunk => { stderr += chunk; }); child.stdout.resume();
    child.on('message', event => { if (event.ready) ready = true; if (event.checkpoint === checkpoint) boundary = true; });
    await eventually(() => { if (child.exitCode !== null) throw Error(stderr); return ready; }, 'app start');
  }
  async function stop(abrupt) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exit = once(child, 'exit');
    if (abrupt) child.kill('SIGKILL'); else child.send('close');
    let timer;
    try {
      await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => {
        child.kill('SIGKILL'); reject(Error('App did not shut down.'));
      }, 10000); })]);
    } finally { clearTimeout(timer); }
  }
  try {
    const started = Date.now();
    await start(checkpoint);
    const quotes=await request('pool/offers?worker_class=image');
    const offer=quotes.items.find(o=>o.provider===provider);assert.ok(offer,'Recorded offer available');
    const launch = { selections: [{ offer_id: offer.id, quantity: 1 }], max_hourly: offer.hourly };
    await request('pool/launch', launch, 'recovery-launch-fixture');
    if (checkpoint !== 'create') {
      await eventually(async () => (await request('pool')).workers.some(w => w.state === 'ready'), 'worker ready');
      await request('jobs', { workflow: 'text-to-image', prompt: 'Offline recovery fixture', mode: 'sfw', output: { aspect: '16:9', size: '1mp' }, seed: '42', count: 1 }, 'recovery-job-fixture');
      if (checkpoint === 'destroy') {
        await eventually(async () => (await request('jobs')).items[0]?.state === 'completed', 'saved output');
        await request('pool/actions', { action: 'finish' });
      }
    }
    await eventually(() => boundary, `${checkpoint} crash boundary`);
    const beforeCrash = (await request('pool')).workers[0];
    assert.ok(beforeCrash.allocated_at);
    assert.ok(beforeCrash.actions.includes('quit'), 'quit remains available at the crash boundary');
    await stop(true);
    await start();
    // Startup must reclaim its stale lock and reconcile durable intent without
    // replaying an accepted rental or generation.
    if (checkpoint === 'create') {
      await eventually(async () => (await request('pool')).workers[0]?.state === 'ready', 'recovered rental');
      await request('pool/offers?worker_class=image');
      await request('pool/launch', launch, 'recovery-launch-fixture');
    } else {
      await eventually(async () => (await request('jobs')).items[0]?.state === 'completed', 'recovered saved output');
      const assets = await request('assets'); assert.equal(assets.items.length, 1, 'one saved asset');
      const jobs = await request('jobs'); assert.equal(jobs.items[0].outputs.length, 1);
      await eventually(() => external().audit.some(a => a.operation === 'acknowledge'), 'worker receipt acknowledged');
    }
    const recovered = (await request('pool')).workers[0];
    assert.equal(recovered.allocated_at, beforeCrash.allocated_at, 'billing clock survives restart');
    assert.ok(recovered.estimated_spend >= beforeCrash.estimated_spend, 'accrued spend does not reset');
    await request('pool/actions', { action: checkpoint === 'destroy' ? 'finish' : 'quit' });
    const pool = await eventually(async () => { const p = await request('pool'); return p.workers.every(w => w.state === 'released') && p; }, 'rental release confirmed');
    assert.equal(pool.summary.active, 0); assert.equal(pool.summary.hourly, 0);
    assert.ok(pool.workers[0].estimated_spend > 0);
    await pause(100);
    assert.equal((await request('pool')).workers[0].estimated_spend, pool.workers[0].estimated_spend, 'spend freezes after confirmed release');
    await stop(false);
    const state = external(), count = op => [...state.audit,...replay.state.audit].filter(event => event.operation === op).length;
    assert.equal(count('create'), 1, 'no duplicate purchase');
    assert.equal(count('submit'), checkpoint === 'create' ? 0 : 1, 'no duplicate generation');
    assert.equal(count('destroy'), 1, 'no duplicate delete');
    assert.equal(count('forbidden-network'), 0);
    assert.equal(count('violation'),0,'Provider replay request contract violations');
    assert.deepEqual(replay.state.rentals, {}, 'no stranded rentals');
    results.push({ provider, checkpoint, passed: true, elapsed_ms: Date.now() - started, counts: Object.fromEntries(['create', 'submit', 'download', 'acknowledge', 'destroy'].map(op => [op, count(op)])) });
    console.log(`PASS ${provider}/${checkpoint}: recovered without duplicate rental, generation or asset`);
  } catch (error) {
    results.push({ provider, checkpoint, passed: false, error: error.message, stderr }); throw error;
  } finally {
    await stop(true);
    await replay.close();
    writeFileSync(path.join(root, 'results.json'), JSON.stringify({ root, results }, null, 2));
  }
}
console.log(`Evidence: ${path.join(root, 'results.json')}`);
