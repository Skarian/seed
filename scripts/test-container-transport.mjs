// Uses the exact published image pins and Docker. Never creates provider rentals.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import { PoolWorkerDriver } from '../dist/server/pool-worker.js';
import { resolvePaths, prepareStorage } from '../dist/server/storage.js';
import { graphFor } from '../dist/server/worker-graphs.js';

const exec = promisify(execFile), token = randomUUID().slice(0, 8), network = `seed-qa-${token}`;
const releases = JSON.parse(readFileSync('worker/releases.json', 'utf8'));
mkdirSync('.local/tests', { recursive: true });
const root = mkdtempSync(path.resolve('.local/tests/container-transport-')), assets = path.join(root, 'assets');
mkdirSync(assets); const paths = resolvePaths(path.join(root, 'profile')); prepareStorage(paths);
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|LOCALAPPDATA|APPDATA|USERPROFILE|PROGRAMFILES|PROGRAMFILES\(X86\)|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(key)));
const docker = async (...args) => {
  const result=await exec('docker', args, { env: safeEnv, windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 ** 2 });
  return (result.stdout+(args[0]==='logs'?result.stderr:'')).trim();
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(fn, label, timeout = 30000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch (error) { last = error; } await pause(150); }
  throw Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== '127.0.0.1') throw Error('Container QA may only contact local SSH tunnels.');
  return originalFetch(input, init);
};
const png = await sharp({ create: { width: 128, height: 96, channels: 3, background: '#b58c68' } }).png().toBuffer();
writeFileSync(path.join(assets, 'image.png'), png);
await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', path.join(assets, 'image.png'), '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=32000', '-t', '1', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', path.join(assets, 'video.mp4')], { windowsHide: true, env: safeEnv });
let driver = new PoolWorkerDriver(paths);
const workers = [], results = [], containers = [], bridges = [], relays = new Set();
function pass(name, details = {}) { results.push({ name, passed: true, ...details }); console.log(`PASS ${name}`); }
function body(w, id, refs = []) {
  const workflow = w.worker_class === 'image' ? 'text-to-image' : refs.length ? 'reference-to-video' : 'text-to-video';
  const request = { workflow, prompt: 'Local protocol fixture', mode: 'sfw', output: { aspect: '16:9', size: w.worker_class === 'image' ? '1mp' : '768p', duration_seconds: 5 }, audio: { output: 'generated' } };
  return { prompt_id: id, prompt: graphFor(request, id, '42', [], refs), loras: [], route: w.worker_class === 'image' ? 'image' : refs.length ? 'ref' : 'fl', ...(w.worker_class === 'video' ? { video_profile: 'h3-high-v1' } : {}) };
}
async function completed(w, id) { return eventually(async () => { const r = await driver.receipt(w, id); return r?.manifest && r; }, 'terminal receipt'); }
async function bridgeFor(name) {
  const bridge = createServer(socket => {
    const relay = spawn('docker', ['exec', '-i', name, '/opt/venv/bin/python', '/qa-bridge.py'],
      { env: safeEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    relays.add(relay); relay.stderr.resume();
    relay.stdin.on('error', () => socket.destroy()); socket.on('error', () => relay.kill());
    socket.pipe(relay.stdin); relay.stdout.pipe(socket);
    socket.on('close', () => relay.kill());
    relay.on('exit', () => { relays.delete(relay); socket.destroy(); });
    relay.on('error', () => socket.destroy());
  });
  bridge.listen(0, '127.0.0.1'); await once(bridge, 'listening'); bridges.push(bridge);
  return { ssh: { host: '127.0.0.1', port: bridge.address().port, user: 'root' } };
}
try {
  await driver.preflight();
  for (const role of ['image', 'video']) {
    const w = { id: randomUUID(), worker_class: role, preparation_revision: 0,
      manifest: JSON.parse(readFileSync(`worker/models-${role}.json`, 'utf8')), requested_loras: [] };
    const auth = await driver.auth(w), name = `${network}-${role}`;
    const envFile = path.join(root, `${role}.env`);
    writeFileSync(envFile, `PUBLIC_KEY=${auth.public_key}\nSEED_SSH_PUBLIC_KEY=${auth.public_key}\nSEED_START_SSH=1\nSEED_TRANSPORT=ssh\nSEED_PAIRING_SECRET=${auth.pairing_secret}\nSEED_WORKER_CLASS=${role}\n`, { mode: 0o600 });
    const imageName = releases[role].image;
    assert.match(imageName, /@sha256:[a-f0-9]{64}$/);
    const image = JSON.parse(await docker('image', 'inspect', imageName))[0];
    assert.equal(image.Architecture, 'amd64'); assert.equal(image.Os, 'linux');
    assert.ok(image.RepoDigests.includes(imageName));
    // First boot the unmodified published ENTRYPOINT/CMD and pair through its
    // real SSH gateway. No preparation request means no weights or GPU needed.
    const boot = `${name}-bootstrap`, bootstrapWorker = { ...w, id: randomUUID() };
    const bootstrapAuth = await driver.auth(bootstrapWorker), bootstrapEnv = path.join(root, `${role}-bootstrap.env`);
    // Both released roles must prefer Seed's key when the provider injects a
    // different PUBLIC_KEY. Testing only Image previously let Video retain
    // the vulnerable startup implementation.
    writeFileSync(bootstrapEnv, `PUBLIC_KEY=${auth.public_key}\nSEED_SSH_PUBLIC_KEY=${bootstrapAuth.public_key}\nSEED_START_SSH=1\nSEED_TRANSPORT=ssh\nSEED_PAIRING_SECRET=${bootstrapAuth.pairing_secret}\nSEED_WORKER_CLASS=${role}\n`, { mode: 0o600 });
    await docker('run', '-d', '--name', boot, '--label', `seed.qa=${token}`, '--network', 'none', '--env-file', bootstrapEnv,
      '--mount', `type=bind,source=${path.resolve('scripts/container-ssh-bridge.py')},target=/qa-bridge.py,readonly`, imageName);
    containers.push(boot);
    await eventually(async () => (await docker('exec', boot, '/opt/venv/bin/python', '-c', "import socket; s=socket.create_connection(('127.0.0.1',8080),1); s.close(); print('ready')")) === 'ready', `${role} published startup`, 60000);
    bootstrapWorker.resource = await bridgeFor(boot);
    await eventually(async () => { assert.equal(await driver.receipt(bootstrapWorker, randomUUID()), null); return true; }, `${role} published gateway pairing`);
    {
      await docker('exec',boot,'/opt/venv/bin/python','-c',"from pathlib import Path; p=Path('/root/.ssh'); p.mkdir(exist_ok=True,mode=0o700); (p/'authorized_keys').write_text('')");
      await driver.reconnect(bootstrapWorker);
      await eventually(async () => { assert.equal(await driver.receipt(bootstrapWorker,randomUUID()),null);return true; },'SSH after provider key replacement');
      await docker('exec',boot,'ssh-keygen','-q','-t','ed25519','-N','','-f','/tmp/qa-unrelated');
      let rejection;
      try{await docker('exec',boot,'ssh','-T','-i','/tmp/qa-unrelated','-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=accept-new','-o','UserKnownHostsFile=/tmp/qa-hosts','root@127.0.0.1','true');}catch(error){rejection=error;}
      assert.equal(rejection?.code,255);
      const sshLog=await docker('logs',boot);
      assert.match(sshLog,/Failed publickey/,'Server must confirm that the unrelated key was rejected, not merely a broken connection');
      const packagedStartupHash = await docker('exec', boot, '/opt/venv/bin/python', '-c', "import hashlib,pathlib; print(hashlib.sha256(pathlib.Path('/opt/seed/worker/entrypoint.py').read_bytes()).hexdigest())");
      assert.equal(packagedStartupHash, createHash('sha256').update(readFileSync('worker/entrypoint.py')).digest('hex'), `${role}: published startup must match the reviewed shared implementation`);
      pass(`${role}: conflicting provider key and replaced provider key file cannot change Seed authorization`, { startup_sha256: packagedStartupHash });
    }
    await driver.disconnect(bootstrapWorker);
    pass(`${role}: unmodified published container startup, SSH and authenticated gateway`, { image: imageName, image_id: image.Id });
    await docker('run', '-d', '--name', name, '--label', `seed.qa=${token}`, '--network', 'none', '--env-file', envFile,
      '--mount', `type=bind,source=${path.resolve('scripts/container-worker-fixture.py')},target=/qa.py,readonly`,
      '--mount', `type=bind,source=${path.resolve('scripts/container-ssh-bridge.py')},target=/qa-bridge.py,readonly`,
      '--mount', `type=bind,source=${assets},target=/qa-assets,readonly`,
      '--entrypoint', '/opt/venv/bin/python', imageName, '/qa.py');
    containers.push(name);
    await eventually(async () => (await docker('logs', name)).includes('SEED_QA_READY'), `${role} container startup`);
    // Docker Desktop does not publish internal-network ports. A local byte
    // relay reaches sshd via docker exec while the container has NO network.
    // The production driver still runs actual OpenSSH, authenticates its key,
    // and establishes its own -L forward; the relay cannot bypass SSH auth.
    w.resource = await bridgeFor(name); w.container = name;
    const health = await eventually(async () => { const h = await driver.prepare(w); return h.ready && h; }, `${role} pairing and preparation`);
    assert.equal(health.preparation.files.every(f => f.ready), true);
    w.session_id = health.session_id; workers.push(w);
    pass(`${role}: real SSH, private pairing, pinned manifest accepted`, { image_id: image.Id });
  }
  const [image, video] = workers;
  const configs = workers.map(w => JSON.parse(readFileSync(path.join(paths.config, 'workers', w.id, 'worker-connection.json'), 'utf8')));
  assert.notEqual(configs[0].worker_credential, configs[1].worker_credential);
  assert.notEqual(configs[0].workspace_id, configs[1].workspace_id);
  assert.notEqual(configs[0].endpoint, configs[1].endpoint);
  for (const w of workers) assert.ok(existsSync(path.join(paths.config, 'workers', w.id, 'known_hosts')));
  const denied = await fetch(configs[1].endpoint + '/worker/v1/status', { headers: { Authorization: `Bearer ${configs[0].worker_credential}` } });
  assert.equal(denied.status, 401); await denied.body.cancel();
  pass('worker credentials, workspaces, known hosts and tunnel ports are isolated');

  const priorVideoTunnel = driver.sessions.get(video.id).child.pid;
  await driver.reconnect(video);
  await eventually(async () => (await driver.prepare(video)).ready, 'explicit tunnel reconnect');
  assert.notEqual(driver.sessions.get(video.id).child.pid, priorVideoTunnel);
  const reconnected = JSON.parse(readFileSync(path.join(paths.config, 'workers', video.id, 'worker-connection.json'), 'utf8'));
  for (const key of ['workspace_id','worker_instance_id','worker_credential']) assert.equal(reconnected[key], configs[1][key]);
  pass('explicit reconnect replaces a live SSH process and preserves the paired worker identity');

  const imageJob = randomUUID(), videoJob = randomUUID(), refs = [];
  for (let i = 0; i < 3; i++) {
    const filename = `ref-${i}.png`;
    await driver.upload(video, videoJob, path.join(assets, 'image.png'), filename);
    refs.push({ kind: 'image', role: 'reference', filename });
  }
  await driver.upload(video, videoJob, path.join(assets, 'image.png'), 'ref-0.png');
  const inputAudit = JSON.parse(await docker('exec', video.container, '/opt/venv/bin/python', '-c',
    `import pathlib,json,hashlib; p=pathlib.Path('/qa-workspace/.seed/spool/inputs/seed/${videoJob}'); print(json.dumps([{'name':f.name,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in p.iterdir()]))`));
  assert.equal(inputAudit.length, 3); assert.ok(inputAudit.every(f => f.sha256 === createHash('sha256').update(png).digest('hex')));
  pass('three real reference uploads verified; identical retry is idempotent');

  const videoBody = body(video, videoJob, refs);
  await Promise.all([driver.submit(image, body(image, imageJob)), driver.submit(video, videoBody)]);
  await driver.submit(video, videoBody);
  await assert.rejects(driver.submit(video, { ...videoBody, prompt: { ...videoBody.prompt, '999': { class_type: 'ChangedFixture', inputs: {} } } }));
  const session = driver.sessions.get(image.id), exited = once(session.child, 'exit');
  session.child.kill(); await exited;
  const videoRecord = await completed(video, videoJob);
  assert.equal(videoRecord.manifest.state, 'completed');
  const imageRecord = await completed(image, imageJob);
  assert.equal(imageRecord.manifest.state, 'completed');
  pass('lost image SSH tunnel reconnects; video continues; duplicate submission runs once');

  for (const [w, id, receipt, filename] of [[image, imageJob, imageRecord, 'image.png'], [video, videoJob, videoRecord, 'video.mp4']]) {
    const source = readFileSync(path.join(assets, filename)), target = path.join(root, `saved-${filename}`);
    writeFileSync(target + '.part', source.subarray(0, Math.floor(source.length / 2)));
    await driver.download(w, id, receipt.manifest.outputs[0], target);
    assert.deepEqual(readFileSync(target), source);
    pass(`${w.worker_class}: HTTP Range resume yields exact output bytes`);
  }
  await driver.close();
  driver = new PoolWorkerDriver(paths);
  for (const [w, id, receipt] of [[image, imageJob, imageRecord], [video, videoJob, videoRecord]]) {
    await eventually(async () => (await driver.prepare(w)).ready, 'reconnected saved pairing');
    assert.equal((await driver.receipt(w, id)).manifest_digest, receipt.manifest_digest);
    await assert.rejects(driver.acknowledge(w, id, '0'.repeat(64)));
    await driver.acknowledge(w, id, receipt.manifest_digest);
    await driver.acknowledge(w, id, receipt.manifest_digest);
    const record = await driver.receipt(w, id); assert.equal(record.cleanup_complete, true);
    const state = JSON.parse(await docker('exec', w.container, '/opt/venv/bin/python', '-c',
      `import pathlib,json; p=pathlib.Path('/qa-workspace'); print(json.dumps({'audit':json.loads((p/'qa-audit.json').read_text()),'inputs':(p/'.seed/spool/inputs/seed/${id}').exists(),'outputs':(p/'.seed/spool/outputs/seed/${id}').exists()}))`));
    assert.equal(state.inputs, false); assert.equal(state.outputs, false);
    assert.equal(state.audit.filter(e => e.event === 'enqueue' && e.job_id === id).length, 1);
    pass(`${w.worker_class}: persisted pairing, receipt recovery, digest guard and idempotent cleanup`);
  }
  assert.ok((await driver.prepare(image)).workflows.includes('image-to-image'));
  const editId=randomUUID(), editRequest={workflow:'image-to-image',mode:'sfw',prompt:'Make the sky pink.',output:{aspect:'source',size:'1mp'},seed:'42',count:1,references:[{id:'source',asset_id:'fixture',kind:'image',role:'source'}]};
  await driver.upload(image,editId,path.join(assets,'image.png'),'source.png');
  const editBody={prompt_id:editId,prompt:graphFor(editRequest,editId,'42',[],[{kind:'image',role:'source',filename:'source.png'}]),route:'image-edit',loras:[]};
  await driver.submit(image,editBody);await driver.submit(image,editBody);
  const edited=await completed(image,editId);assert.equal(edited.manifest.state,'completed');assert.equal(edited.manifest.outputs[0].mime_type,'image/png');
  const savedEdit=path.join(root,'saved-edit.png');await driver.download(image,editId,edited.manifest.outputs[0],savedEdit);assert.deepEqual(readFileSync(savedEdit),png);await driver.acknowledge(image,editId,edited.manifest_digest);
  pass('Qwen edit: capability, source upload, native profile admission, duplicate receipt, PNG download and cleanup');
  const cancelled = randomUUID(); await driver.submit(image, body(image, cancelled)); await driver.cancel(image, cancelled);
  const receipt = await completed(image, cancelled); assert.equal(receipt.manifest.state, 'cancelled');
  await driver.acknowledge(image, cancelled, receipt.manifest_digest);
  pass('queued cancellation produces a durable terminal receipt and cleanup');
} catch (error) {
  results.push({ passed: false, error: error.stack }); throw error;
} finally {
  await driver.close();
  for (const relay of relays) relay.kill();
  for (const bridge of bridges) await new Promise(resolve => bridge.close(resolve));
  for (const name of containers) {
    const info = JSON.parse(await docker('inspect', name))[0];
    assert.equal(info.Config.Labels['seed.qa'], token, 'Only remove this test’s containers.');
    writeFileSync(path.join(root, `${name}.log`), await docker('logs', name));
    await docker('rm', '-f', name);
  }
  globalThis.fetch = originalFetch;
  writeFileSync(path.join(root, 'results.json'), JSON.stringify({ root, scope: 'CPU-only; synthetic model preparation and inference; real SSH and worker transport', results }, null, 2));
  console.log(`Evidence: ${path.join(root, 'results.json')}`);
}
