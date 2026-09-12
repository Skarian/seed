import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Jobs } from '../server/jobs.js';
import { WorkerHttpError } from '../server/worker-transfer.js';
import { openDatabase } from '../server/db.js';
import { resolvePaths, prepareStorage } from '../server/storage.js';
import type { WorkerConnection } from '../server/worker.js';

async function fixture(run: (f: any) => Promise<void>) {
  mkdirSync('.local/tests', { recursive: true }); const root = mkdtempSync(path.resolve('.local/tests/jobs-'));
  const paths = resolvePaths(root); prepareStorage(paths); const db = openDatabase(paths.data);
  const image = Buffer.from('test-image-bytes'); const sha = createHash('sha256').update(image).digest('hex');
  const state = { modelsReady: true, session: 'engine-one', running: [] as any[], records: {} as Record<string, any>, submits: 0, attempts: 0, losePrompt: '', acknowledgments: 0, failReceipt: false, failTransfer: false, orphan: false, transferStatus: 0, corrupt: false };
  const cap = () => ({ video:{ready:true,image_export:true,duration_step:1,nsfw:{}}, revision: 'test-v1', ready: state.modelsReady, workspace_id: 'volume-one', engine_session_id: state.session, nsfw: { filename: 'seed-' + 'a'.repeat(64) + '.safetensors', sha256: 'a'.repeat(64), strength_model: 1, revision: 'test' } });
  const fake = {
    connected: true, identity: { workspace_id: 'volume-one', worker_instance_id: 'worker-one' },
    async json(route: string, options: any = {}) {
      if (route === '/comfy/capabilities' || route === '/comfy/session') return cap();
      if (route === '/comfy/queue') return { queue_running: state.running, queue_pending: [] };
      if (route === '/worker/v1/jobs') return { items: state.orphan ? [{ job_id: 'foreign', acknowledged: false }] : [], next_cursor: null };
      if (route.endsWith('/receipt')) { if (state.failReceipt) throw new Error('lost receipt'); state.acknowledgments++; return { cleanup_complete: true }; }
      return state.records[route.split('/')[4]!];
    },
    async request(route: string, options: any = {}) {
      if (route === '/comfy/prompt') {
        state.attempts++;
        if (state.losePrompt === 'before') { state.losePrompt = ''; throw new Error('lost request'); }
        state.submits++; const id = options.body.prompt_id; state.running = [[0, id]];
        state.records[id] = { submission: { job_id: id, workspace_id: 'volume-one', engine_session_id: state.session } };
        if (state.losePrompt === 'after') { state.losePrompt = ''; throw new Error('lost response'); }
        return Response.json({ prompt_id: id });
      }
      if (route.includes('/outputs/')) {
        if (state.transferStatus) return new Response(null, {status: state.transferStatus});
        if (state.failTransfer) throw new Error('disconnected');
        const offset = options.range ?? 0;
        return new Response(state.corrupt ? Buffer.alloc(image.length-offset) : image.subarray(offset), { status: offset ? 206 : 200, headers: offset ? { 'Content-Range': `bytes ${offset}-${image.length - 1}/${image.length}` } : {} });
      }
      return state.records[route.split('/')[4]!] ? Response.json({}) : new Response(null, { status: 404 });
    },
  };
  const jobs = new Jobs(db, paths, fake as unknown as WorkerConnection);
  const request = { workflow: 'text-to-image', capabilities_revision: 'test-v1', prompt: 'A mountain', mode: 'sfw', seed: '42', count: 1, output: { aspect: '16:9', size: '1mp' } };
  function finish(id: string) {
    state.running = [];
    const manifest = { job_id: id, workspace_id: 'volume-one', engine_session_id: 'engine-one', state: 'completed', outputs: [{ id: '0', size: image.length, sha256: sha, mime_type: 'image/png' }], error: null };
    const raw = JSON.stringify(manifest);
    state.records[id] = { ...state.records[id], manifest, manifest_bytes: raw, manifest_digest: createHash('sha256').update(raw).digest('hex') };
  }
  try { await run({ jobs, state, request, finish, paths, db, image, fake }); }
  finally { await jobs.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
}

it.each(['failed', 'cancelled'])('retries cleanup after terminal %s without regenerating', async terminalState => fixture(async ({ jobs, state, request }: any) => {
  const { jobs: [job] } = await jobs.submit(request, 'terminal-cleanup-key');
  await jobs.reconcile();
  state.running = [];
  const manifest = { job_id: job.id, workspace_id: 'volume-one', engine_session_id: 'engine-one', state: terminalState, outputs: [], error: 'Stopped' };
  const raw = JSON.stringify(manifest);
  state.records[job.id] = { ...state.records[job.id], manifest, manifest_bytes: raw, manifest_digest: createHash('sha256').update(raw).digest('hex') };
  state.failReceipt = true;
  await jobs.reconcile();
  expect(jobs.get(job.id).state).toBe(terminalState);
  expect(jobs.get(job.id).output_save_state).toBe('not_applicable');
  expect(jobs.get(job.id).cleanup_state).toBe('pending');
  state.failReceipt = false;
  await jobs.reconcile();
  expect(jobs.get(job.id).cleanup_state).toBe('complete');
  expect(state.submits).toBe(1);
}));

it('freezes both modes, expands seeds atomically, and replays one submission without duplicates', async () => fixture(async ({ jobs, request, state }: any) => {
  const first = await jobs.submit({ ...request, count: 2 }, 'submission-key-0001');
  const again = await jobs.submit({ ...request, count: 2 }, 'submission-key-0001');
  expect(again.jobs.map((j: any) => j.id)).toEqual(first.jobs.map((j: any) => j.id));
  expect(first.jobs.map((j: any) => j.seed)).toEqual(['42', '43']);
  expect(first.jobs[0].graph['10']).toBeUndefined();
  const nsfw = await jobs.submit({ ...request, mode: 'nsfw' }, 'submission-key-0002');
  expect(nsfw.jobs[0].graph['10'].inputs.lora_name).toBe(nsfw.jobs[0].preset.filename);
  await expect(jobs.submit({ ...request, prompt: 'Changed' }, 'submission-key-0001')).rejects.toThrow('different settings');
  expect(state.submits).toBe(0);
}));

it('accepts random-seed batches and preserves their concrete seeds on retry', async () => fixture(async ({ jobs, request }: any) => {
  const randomRequest = { ...request, seed: 'random', count: 16 };
  const first = await jobs.submit(randomRequest, 'random-seed-regression');
  const generated = first.jobs.map((job: any) => job.seed);
  expect(new Set(generated).size).toBe(16);
  for (const job of first.jobs) {
    expect(Number.isSafeInteger(Number(job.seed))).toBe(true);
    expect(Number(job.seed)).toBeGreaterThanOrEqual(0);
    expect(Number(job.seed)).toBeLessThan(2 ** 48);
    expect(job.graph['7'].inputs.seed).toBe(Number(job.seed));
  }
  const retry = await jobs.submit(randomRequest, 'random-seed-regression');
  expect(retry.jobs.map((job: any) => job.seed)).toEqual(generated);
  expect(retry.jobs.map((job: any) => job.id)).toEqual(first.jobs.map((job: any) => job.id));
}));

it('freezes the HQ profile and verified preset separately and replays without changing quality', async () => fixture(async ({ jobs, request, fake, state, db }: any) => {
  const json=fake.json.bind(fake), send=fake.request.bind(fake);
  let submitted:any;
  fake.json=async(route:string,options:any)=>{
    const result=await json(route,options);
    if(route==='/comfy/capabilities'||route==='/comfy/session') result.video={...result.video,native_export:true,quality:{fast:true,high:true},profile_revision:'h3-quality-v1',nsfw:{fl:result.nsfw}};
    return result;
  };
  fake.request=async(route:string,options:any)=>{if(route==='/comfy/prompt')submitted=options.body;return send(route,options);};
  const high={...request,workflow:'text-to-video',mode:'nsfw',quality:'high',output:{aspect:'16:9',size:'native',duration_seconds:5}};
  const first=await jobs.submit(high,'hq-frozen-profile-key');
  const job=first.jobs[0];
  expect(job.video_profile).toBe('h3-high-v1');
  expect(job.preset.strength_model).toBe(1);
  expect(job.graph['18'].inputs.strength_model).toBe(0.8);
  const stored=JSON.parse(db.prepare('SELECT snapshot_json FROM jobs WHERE id=?').get(job.id).snapshot_json);
  expect(stored.video_profile).toBe('h3-high-v1');
  expect(stored.graph).toEqual(job.graph);
  const replay=await jobs.submit(high,'hq-frozen-profile-key');
  expect(replay.jobs[0].id).toBe(job.id);
  await expect(jobs.submit({...high,quality:'fast'},'hq-frozen-profile-key')).rejects.toThrow('different settings');
  await jobs.reconcile();
  expect(submitted).toMatchObject({video_profile:'h3-high-v1',preset:{strength_model:1},prompt:{'18':{inputs:{strength_model:0.8}}}});
  expect(state.submits).toBe(1);
}));

it('rejects unavailable native and HQ profiles instead of silently producing Fast', async () => fixture(async ({ jobs, request, fake }: any) => {
  const high={...request,workflow:'text-to-video',quality:'high',output:{aspect:'16:9',size:'native',duration_seconds:5}};
  await expect(jobs.submit(high,'hq-unsupported-key1')).rejects.toThrow('native');
  const json=fake.json.bind(fake);
  let revision='unknown';
  fake.json=async(route:string,options:any)=>{
    const result=await json(route,options);
    if(route==='/comfy/capabilities')result.video={...result.video,native_export:true,quality:{fast:false,high:true},profile_revision:revision};
    return result;
  };
  await expect(jobs.submit(high,'hq-unsupported-key2')).rejects.toThrow('High Quality');
  revision='h3-quality-v1';
  await expect(jobs.submit({...high,quality:'fast'},'fast-unsupported-key')).rejects.toThrow('Fast video');
  expect((await jobs.submit(high,'hq-supported-key-3')).jobs[0].video_profile).toBe('h3-high-v1');
}));

it('recovers transfer and acknowledgment independently without regeneration or duplicate Library rows', async () => fixture(async ({ jobs, request, state, finish, paths, db, image }: any) => {
  const { jobs: [job] } = await jobs.submit(request, 'submission-key-0001');
  await jobs.reconcile(); expect(state.submits).toBe(1);
  finish(job.id); state.failTransfer = true;
  await jobs.reconcile(); expect(jobs.get(job.id).state).toBe('copy_pending'); expect(state.acknowledgments).toBe(0);
  state.failTransfer = false; state.failReceipt = true;
  await jobs.reconcile(); expect(jobs.get(job.id).state).toBe('completed'); expect(jobs.get(job.id).cleanup_state).toBe('pending');
  const file = path.join(paths.data, 'media/outputs', job.id + '-0.png');
  expect(readFileSync(file)).toEqual(image);
  state.failReceipt = false; await jobs.reconcile();
  expect(jobs.get(job.id).cleanup_state).toBe('complete'); expect(state.submits).toBe(1);
  expect(db.prepare('SELECT COUNT(*) AS n FROM assets').get()).toEqual({ n: 1 });
  expect(existsSync(file)).toBe(true);
}));

it('blocks unknown spool work and never repeats an interrupted execution in a new session', async () => fixture(async ({ jobs, request, state }: any) => {
  const { jobs: [job] } = await jobs.submit(request, 'submission-key-0001');
  state.orphan = true; await jobs.reconcile(); expect(state.submits).toBe(0); expect(jobs.safe).toBe(false);
  state.orphan = false; await jobs.reconcile(); expect(state.submits).toBe(1);
  state.session = 'engine-two'; state.running = [];
  await jobs.reconcile(); expect(jobs.get(job.id).state).toBe('needs_attention');
  await jobs.reconcile(); expect(state.submits).toBe(1);
  jobs.acknowledge(job.id);
  expect(jobs.get(job.id).uncertainty_acknowledged).toBe(true);
  const next = await jobs.submit(request, 'submission-key-0002');
  await jobs.reconcile(); expect(state.submits).toBe(2);
  expect(next.jobs[0].id).not.toBe(job.id);
}));


it('retains worker measurements and freezes saved time across cleanup retries', async () => fixture(async ({ jobs, request, state, finish }: any) => {
  const { jobs: [job] } = await jobs.submit(request, 'metrics-retention-0001');
  expect(job.metrics.inputs).toMatchObject({ total: 0, image: 0, video: 0, audio: 0 });
  await jobs.reconcile();
  finish(job.id);
  state.records[job.id].telemetry = { version: 2, complete: true, execution_seconds: 12.5, sample_count: 6, gpus: [{ name: 'Test GPU', peak_used_mib: 30000 }] };
  state.failReceipt = true;
  await jobs.reconcile();
  const saved = jobs.get(job.id);
  expect(saved.metrics.worker.execution_seconds).toBe(12.5);
  expect(saved.metrics.submitted_at).toBeTruthy();
  expect(saved.metrics.elapsed_to_saved_seconds).toBeGreaterThanOrEqual(0);
  state.failReceipt = false;
  await jobs.reconcile();
  expect(jobs.get(job.id).metrics.saved_at).toBe(saved.metrics.saved_at);
  expect(jobs.get(job.id).cleanup_state).toBe('complete');
}));

it('retrieves complete frame sets as one Library sequence and resumes after interruption', async()=>fixture(async({jobs,state,request,finish,paths,db,image}:any)=>{
  const {jobs:[job]}=await jobs.submit({...request,workflow:'text-to-video',output:{aspect:'16:9',size:'720p',duration_seconds:5,format:'images'}},'frame-export-test');
  await jobs.reconcile();finish(job.id);
  const manifest=state.records[job.id].manifest;
  manifest.outputs=Array.from({length:120},(_,index)=>({...manifest.outputs[0],id:String(index),path:`seed/${job.id}/frames_${index}.png`}));
  function refresh(){const raw=JSON.stringify(manifest);state.records[job.id]={...state.records[job.id],manifest_bytes:raw,manifest_digest:createHash('sha256').update(raw).digest('hex')};}
  // Duplicate IDs cannot be accepted or acknowledged.
  manifest.outputs[1].id='0';refresh();await expect(jobs.reconcile()).rejects.toThrow('manifest');expect(state.acknowledgments).toBe(0);
  manifest.outputs[1].id='1';refresh();state.failTransfer=true;await jobs.reconcile();
  expect(jobs.get(job.id).state).toBe('copy_pending');expect(db.prepare('SELECT COUNT(*) AS n FROM sequences').get().n).toBe(0);
  state.failTransfer=false;await jobs.reconcile();expect(jobs.get(job.id).state).toBe('completed');
  expect(db.prepare('SELECT COUNT(*) AS n FROM sequence_frames').get().n).toBe(120);
  expect(db.prepare('SELECT COUNT(*) AS n FROM sequences').get().n).toBe(1);
  await jobs.reconcile();expect(state.submits).toBe(1);
}));


it('missing models block generation but allow verified idle shutdown', async () => fixture(async ({jobs,state,request}: any) => {
  const {jobs:[queued]} = await jobs.submit(request, 'model-readiness-test');
  state.modelsReady = false;
  await jobs.reconcile();
  expect(state.submits).toBe(0);
  expect(jobs.get(queued.id).state).toBe('queued');
  await expect(jobs.submit(request, 'missing-models-test')).rejects.toThrow('not ready');
  jobs.pause(true);
  await jobs.reconcile();
  expect(jobs.safe).toBe(true);
  state.orphan = true;
  await jobs.reconcile();
  expect(jobs.safe).toBe(false);
}));


it.each(['before', 'after'])('recovers a lost prompt %s acceptance using the original job', async loss => fixture(async ({jobs,state,request}:any) => {
  state.losePrompt = loss;
  const {jobs:[job]} = await jobs.submit(request, 'lost-prompt-recovery');
  await jobs.reconcile();
  expect(jobs.get(job.id).submission_pending).toBe(true);
  await jobs.reconcile();
  expect(jobs.get(job.id).state).toBe('running');
  expect(state.submits).toBe(1);
  expect(state.attempts).toBe(loss === 'before' ? 2 : 1);
  expect(Object.keys(state.records)).toEqual([job.id]);
}));

it('does not replay an absent submission after the engine changes', async () => fixture(async ({jobs,state,request}:any) => {
  state.losePrompt = 'before';
  const {jobs:[job]} = await jobs.submit(request, 'lost-prompt-new-engine');
  await jobs.reconcile(); state.session = 'engine-two'; await jobs.reconcile();
  expect(state.attempts).toBe(1); expect(jobs.get(job.id).state).toBe('needs_attention');
}));

it.each([403,409,507])('pauses permanent output HTTP %s until explicit queue resume', async code => fixture(async ({jobs,state,request,finish}:any) => {
  const {jobs:[job]} = await jobs.submit(request,'permanent-output-fault');
  await jobs.reconcile(); finish(job.id); state.transferStatus=code;
  await jobs.reconcile(); expect(jobs.get(job.id).recovery_blocked).toBe(true); expect(jobs.paused).toBe(true);
  state.transferStatus=0; await jobs.reconcile(); expect(state.acknowledgments).toBe(0);
  jobs.resumeRecovery(); jobs.pause(false); await jobs.reconcile();
  expect(jobs.get(job.id).state).toBe('completed'); expect(state.submits).toBe(1);
}));

it('retries one corrupt output then pauses without acknowledging it', async()=>fixture(async({jobs,state,request,finish}:any)=>{
  const {jobs:[job]}=await jobs.submit(request,'corrupt-output-fault');
  await jobs.reconcile(); finish(job.id); state.corrupt=true;
  await jobs.reconcile(); expect(jobs.get(job.id).recovery_blocked).not.toBe(true);
  await jobs.reconcile(); expect(jobs.get(job.id).recovery_blocked).toBe(true);
  expect(state.acknowledgments).toBe(0); expect(jobs.get(job.id).error).toContain('integrity');
}));

it('keeps a blocked reference upload paused when another generation is requested', async()=>fixture(async({jobs,state,request,db,fake}:any)=>{
  const {jobs:[job]}=await jobs.submit(request,'blocked-input-fault');
  job.prepared=[{file:'fixture.png',filename:'fixture.png'}];
  db.prepare('UPDATE jobs SET snapshot_json=? WHERE id=?').run(JSON.stringify(job),job.id);
  let uploads=0;
  fake.upload=async()=>{uploads++;throw new WorkerHttpError(507);};
  await jobs.reconcile(); expect(jobs.get(job.id).recovery_blocked).toBe(true);
  await expect(jobs.submit(request,'new-input-fault')).rejects.toThrow('resume');
  await jobs.reconcile(); expect(uploads).toBe(1);expect(state.submits).toBe(0);
  fake.upload=async()=>{uploads++;};jobs.resumeRecovery();jobs.pause(false);await jobs.reconcile();
  expect(uploads).toBe(2);expect(state.submits).toBe(1);
}));
