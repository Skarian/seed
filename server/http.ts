import { Sequences } from './sequences.js';
import { pickFrame } from './frames.js';
import {registerAdmin} from './admin.js';
import {LoraImports} from './lora-imports.js';
import {WorkerPool} from './pool.js';
import {createProviders} from './pool-providers.js';
import {PoolWorkerDriver} from './pool-worker.js';
import type {PoolDependencies} from './pool-contracts.js';
import {Loras} from './loras.js';
import {acquireCoordinator} from './coordinator-lock.js';
import {PoolError,poolIssue} from './pool-errors.js';
import {Diagnostics} from './diagnostics.js';
import {clientFailurePath,registerClientFailures} from './client-failure.js';
import type {LaunchRequest,PoolAction} from '../shared/pool.js';
import {imageRequest} from './workflows.js';
import { registerNotes } from './notes.js';
import {registerAssetOrganization} from './asset-organization.js';
import { Chats } from './chat/service.js';
import { registerChats } from './chat/http.js';
import { chatCredential } from './chat/credentials.js';
import { Previews } from './previews.js';
import {removeAssetCaches,sweepMediaCaches} from './media-cache.js';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { existsSync, createReadStream, statSync, realpathSync, unlinkSync } from 'node:fs';
import { Jobs } from './jobs.js';
import {jobNeedsAttention} from '../shared/jobs.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAssets, openDatabase } from './db.js';
import { prepareStorage, type StudioPaths } from './storage.js';
import type { StudioSnapshot } from '../shared/studio.js';
import {HttpAccess} from './http-access.js';

export async function createApp(options: { paths: StudioPaths; port: number; webRoot?: string; host?: string; poolDependencies?: PoolDependencies; providerFetch?:typeof fetch; chatFetch?:typeof fetch }) {
  const access = new HttpAccess(options.paths, options.host ?? '127.0.0.1', options.port);
  prepareStorage(options.paths);
  const releaseCoordinator=acquireCoordinator(options.paths);
  let db:ReturnType<typeof openDatabase>;
  try {db=openDatabase(options.paths.data);}catch(error){releaseCoordinator();throw error;}
  const diagnostics=new Diagnostics(db,options.paths,options.poolDependencies?.now);
  try {
  const dependencies=options.poolDependencies??{providers:createProviders(options.paths,options.providerFetch,diagnostics),worker:new PoolWorkerDriver(options.paths,diagnostics)};
  const pool=new WorkerPool(db,options.paths,new Loras(options.paths),dependencies,diagnostics);
  const jobs=new Jobs(db,options.paths,pool);
  const imports=new LoraImports(options.paths,jobs.loras,options.providerFetch);
  const chats=new Chats(db,options.paths,jobs,options.chatFetch);
  const sequences = new Sequences(db, options.paths.data, options.paths.cache, jobs);
  const previews = new Previews(options.paths.data, options.paths.cache);
  sequences.recover(failure=>diagnostics.event({category:'server',operation:'media.sequence_cleanup',level:'warn',data:failure}));
  const sweepCaches=()=>sweepMediaCaches(db,options.paths,jobs,failure=>diagnostics.event({category:'server',operation:'media.cache_cleanup',level:'warn',data:failure}));
  await jobs.serialize(async()=>sweepCaches());
  const app = Fastify({ logger: false, genReqId:()=>randomUUID(), bodyLimit: 16 * 1024, trustProxy: false, ajv: { customOptions: { removeAdditional: false } } });
  app.decorate('seedPool',pool);
  const instanceId = randomUUID();
  const fail = (reply: import('fastify').FastifyReply, status: number, code: string, message: string, requestId: string) =>
    reply.code(status).send({ error: { code, message, retryable: false }, request_id: requestId });

  app.addHook('onRequest', async (request, reply) => {
    // A loopback bind alone does not protect against DNS rebinding or hostile websites.
    const origin = access.originFor(request.headers.host);
    if (!origin) return fail(reply, 403, 'untrusted_host', 'Open Seed using its local address or configured remote URL.', request.id);
    const site = request.headers['sec-fetch-site'];
    // Identity-provider redirects retain cross-site metadata on the return navigation.
    // Allow only the HTML entry pages; API/media reads and all writes remain isolated.
    const pageNavigation = ['GET', 'HEAD'].includes(request.method)
      && ['/', '/index.html', '/library', '/chat', '/admin'].includes(request.url.split('?')[0]!)
      && request.headers['sec-fetch-mode'] === 'navigate'
      && request.headers['sec-fetch-dest'] === 'document';
    if (site && site !== 'same-origin' && site !== 'none' && !pageNavigation) return fail(reply, 403, 'untrusted_origin', 'Cross-site access is not allowed.', request.id);
    if (request.headers.origin && request.headers.origin !== origin) return fail(reply, 403, 'untrusted_origin', 'Cross-site access is not allowed.', request.id);
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.origin !== origin) {
      return fail(reply, 403, 'origin_required', 'A same-origin request is required.', request.id);
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if(reply.statusCode>=400 && request.routeOptions.url !== clientFailurePath) {
      let detail:unknown;
      if(typeof payload==='string')try{detail=JSON.parse(payload).error;}catch{}
      diagnostics.event({category:'server',operation:'http.response',level:reply.statusCode>=500?'error':'warn',request_id:request.id,
        data:{method:request.method,path:request.routeOptions.url,status:reply.statusCode,error:detail}});
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    diagnostics.error('http.exception',error,{request_id:request.id});
    const statusCode = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    return fail(reply, status, status === 500 ? 'internal_error' : 'invalid_request', status === 500 ? 'seed could not complete this request.' : 'Check the request and try again.', request.id);
  });
  await jobs.media.register(app);
  registerClientFailures(app,diagnostics);
  registerNotes(app, db);
  registerAssetOrganization(app, db);
  registerAdmin(app,options.paths,jobs.loras,imports,{access,fetcher:options.providerFetch,changeCredential:(field,next,previous,commit)=>pool.withCredentialChange(field,next,previous,commit)});
  registerChats(app,chats,()=>Boolean(chatCredential(options.paths)));
  app.addHook('onReady', async () => { diagnostics.event({category:'server',operation:'started',data:{instance_id:instanceId}});pool.start();jobs.start(); });
  app.addHook('preClose', async () => { await imports.close();await chats.close(); await pool.close();await jobs.close(); });
  app.addHook('onClose', async () => { await jobs.media.close();diagnostics.event({category:'server',operation:'stopped'}); db.close();releaseCoordinator(); });
  const poolResult=(fn:(r:any)=>Promise<unknown>|unknown)=>async(request:any,reply:any)=>diagnostics.within({request_id:request.id},async()=>{try{return await fn(request);}catch(error){diagnostics.error('pool.request',error);return reply.code(409).send({error:error instanceof PoolError?error.issue:{code:'pool_request_failed',message:error instanceof Error?error.message:'Cannot complete this worker action.',retryable:false}});}});
  app.get('/api/v1/pool/history',{schema:{querystring:{type:'object',additionalProperties:false,properties:{from:{type:'string',format:'date-time'},to:{type:'string',format:'date-time'},provider:{enum:['vast','runpod']},worker_class:{enum:['image','video']}}}}},async request=>diagnostics.history(request.query as any));
  app.get('/api/v1/pool/workers/:id/history',{schema:{querystring:{type:'object',additionalProperties:false,properties:{after:{type:'integer',minimum:0}}}}},async request=>diagnostics.details((request.params as any).id,(request.query as any).after));
  app.get('/api/v1/pool/workers/:id/startup-logs',async (request,reply)=>{
    const record=pool.startupLogs.read((request.params as {id:string}).id);
    return record??reply.code(404).send({error:{message:'Worker startup logs were not found.'}});
  });
  app.post('/api/v1/pool/workers/:id/history',{schema:{body:{type:'object',additionalProperties:false,properties:{campaign:{type:'string',maxLength:100},manual_intervention:{type:'boolean'},note:{type:'string',maxLength:2000}}}}},poolResult(r=>{diagnostics.annotate(r.params.id,r.body);return {saved:true};}));
  app.get('/api/v1/pool',async()=>pool.snapshot());
  app.get('/api/v1/diagnostics',{schema:{querystring:{type:'object',additionalProperties:false,properties:{after:{type:'integer',minimum:0},level:{enum:['info','warn','error']}}}}},async request=>diagnostics.events((request.query as any).after,(request.query as any).level));
  app.get('/api/v1/pool/offers',{schema:{querystring:{type:'object',additionalProperties:false,required:['worker_class'],properties:{worker_class:{enum:['image','video']}}}}},poolResult(r=>pool.offers(r.query.worker_class)));
  app.post('/api/v1/pool/launch',{schema:{body:{type:'object',additionalProperties:false,required:['selections','max_hourly'],properties:{max_hourly:{type:'number',minimum:0},selections:{type:'array',minItems:1,maxItems:16,items:{type:'object',additionalProperties:false,required:['offer_id','quantity'],properties:{offer_id:{type:'string'},quantity:{type:'integer',minimum:1,maximum:16}}}}}}}},poolResult(r=>pool.launch(r.body as LaunchRequest,String(r.headers['idempotency-key']??''))));
  app.post('/api/v1/pool/workers/:id/actions',{schema:{body:{type:'object',additionalProperties:false,required:['action'],properties:{action:{enum:['reconnect','retry_preparation','omit_loras','local_fallback','finish','quit','dismiss_launch_failure']},paths:{type:'array',maxItems:256,items:{type:'string'}}}}}},poolResult(r=>pool.action(r.params.id,r.body.action as PoolAction,r.body.paths)));
  app.post('/api/v1/pool/actions',{schema:{body:{type:'object',additionalProperties:false,required:['action'],properties:{action:{enum:['finish','quit']}}}}},poolResult(r=>pool.actionAll(r.body.action)));
  app.get('/api/v1/health', async () => ({ application: 'seed', version: '0.1.0', instance_id: instanceId }));
  app.get('/api/v1/studio', async (): Promise<StudioSnapshot> => {
    const importJobs=imports.list('nsfw');
    return {
      loras_revision: jobs.loras.revision(),
      pool: pool.snapshot().summary,
      activity: { waiting: importJobs.filter(j=>j.state==='queued').length + jobs.all().filter(j => j.state === 'queued').length, active: importJobs.filter(j=>['downloading','validating','uploading'].includes(j.state)).length + jobs.all().filter(j => ['uploading','submitting','running','copying','cancel_requested'].includes(j.state)&&!j.recovery_blocked).length, needs_attention: importJobs.filter(j=>j.state==='failed').length + jobs.all().filter(j=>jobNeedsAttention(j)).length },
      outputs: { pending: jobs.all().filter(j => j.state === 'copying').length },
    };
  });
  app.get('/api/v1/loras', {schema:{querystring:{type:'object',additionalProperties:false,properties:{mode:{enum:['sfw','nsfw']}}}}}, async request => ({ items: jobs.loras.list((request.query as {mode?:'sfw'|'nsfw'}).mode ?? 'sfw') }));
  app.patch('/api/v1/loras/:id', {schema:{body:{type:'object',additionalProperties:false,required:['availability'],properties:{availability:{enum:['all','spicy']}}}}}, async (request,reply) => {
    try {jobs.loras.setAvailability((request.params as {id:string}).id,(request.body as {availability:string}).availability);return {saved:true};}
    catch(error){return fail(reply,409,'lora_update_failed',(error as Error).message,request.id);}
  });
  app.get('/api/v1/assets', {schema:{querystring:{type:'object',properties:{cursor:{type:'string'},kind:{enum:['image','video','audio']},mode:{enum:['sfw','nsfw']},favorites:{type:'boolean'},collection_id:{type:'string',minLength:1}}}}}, async request => { const query = request.query as {cursor?:string;mode?:'sfw'|'nsfw';kind?:string;favorites?:boolean;collection_id?:string}; const items = listAssets(db, query.cursor ?? '', 51, query.mode, query.kind, query); return { items: items.slice(0, 50), next_cursor: items.length > 50 ? items[49]!.id : null }; });
  app.get('/api/v1/sequences/:id', async (request,reply)=> {
    try {return sequences.get((request.params as any).id) ?? fail(reply,404,'not_found','Sequence not found.',request.id);}
    catch(e){return fail(reply,409,'sequence_busy',(e as Error).message,request.id);}
  });
  app.get('/api/v1/sequences/:id/preview/:page',async(request,reply)=>{
    const {id,page:raw} = request.params as {id:string;page:string};
    const page=Number(raw), revision=Number((request.query as any).revision);
    const sequence=sequences.get(id);
    if(!sequence||sequence.cleanup_pending||revision!==sequence.revision||!Number.isInteger(page)||page<0||page*24>=sequence.frames.length)
      return fail(reply,409,'sequence_changed','Reload the sequence preview.',request.id);
    const first=sequence.frames[0]!;
    const frames=sequence.frames.slice(page*24,page*24+24).map(f=>db.prepare('SELECT relative_path FROM assets WHERE id=?').get(f.id) as {relative_path:string});
    try {const file=await previews.sheet(id,revision,page,frames,first.width,first.height);return reply.type('image/webp').send(createReadStream(file));}
    catch{return fail(reply,409,'preview_failed','Could not load sequence preview.',request.id);}
  });
  app.post('/api/v1/sequences/:id/keep-only',async(request,reply)=>jobs.serialize(async()=>{
    try {const body=request.body as any,id=(request.params as any).id;
      const result=await previews.withDeletion(sequences.assetIds(id),[id],()=>sequences.prune(id,body?.asset_ids,body?.revision));sweepCaches();return result;}
    catch(e){return fail(reply,409,'sequence_changed',(e as Error).message,request.id);}
  }));
  app.post('/api/v1/sequences/:id/retry-cleanup',async(request,reply)=>jobs.serialize(async()=>{
    try{const id=(request.params as any).id;const sequence=await previews.withDeletion(sequences.assetIds(id),[id],()=>sequences.retry(id));sweepCaches();return {sequence};}
    catch(e){return fail(reply,409,'cleanup_pending',(e as Error).message,request.id);}
  }));
  app.delete('/api/v1/sequences/:id',async(request,reply)=>jobs.serialize(async()=>{
    try {const id=(request.params as any).id;const sequence=db.prepare('SELECT revision FROM sequences WHERE id=?').get(id) as any;
      await previews.withDeletion(sequences.assetIds(id),[id],()=>sequences.prune(id,[],sequence?.revision??0,true));sweepCaches();return reply.code(204).send();}
    catch(e){return fail(reply,409,'delete_failed',(e as Error).message,request.id);}
  }));
  app.get('/api/v1/assets/:id/preview',async(request,reply)=>{
    const id=(request.params as any).id;
    const asset=db.prepare("SELECT relative_path FROM assets WHERE id=? AND kind='image' AND COALESCE(json_extract(metadata_json,'$.state'),'ready')='ready'").get(id) as any;
    if(!asset)return fail(reply,404,'not_found','Image not found.',request.id);
    try {const file=await previews.get(id,asset.relative_path,(request.query as any).size==='1280'?1280:384);return reply.type('image/webp').send(createReadStream(file));}
    catch{return fail(reply,409,'preview_failed','Could not load preview.',request.id);}
  });
  app.post('/api/v1/assets/:id/frames', {schema:{body:{type:'object',additionalProperties:false,required:['time_seconds'],properties:{time_seconds:{type:'number',minimum:0}}}}}, async (request,reply)=>jobs.serialize(async()=>{
    try {return await pickFrame(db,options.paths,(request.params as {id:string}).id,(request.body as {time_seconds:number}).time_seconds);}
    catch(error){return fail(reply,409,'frame_save_failed',(error as Error).message,request.id);}
  }));
  app.delete('/api/v1/assets/:id', async (request, reply) => jobs.serialize(async () => {
    const id = (request.params as { id: string }).id;
    const asset = db.prepare('SELECT relative_path, metadata_json FROM assets WHERE id=?').get(id) as { relative_path: string; metadata_json: string } | undefined;
    if (!asset) return reply.code(204).send();
    const membership=db.prepare('SELECT sequence_id FROM sequence_frames WHERE asset_id=?').get(id) as {sequence_id:string}|undefined;
    if(membership){
      try{
        const sequence=sequences.get(membership.sequence_id)!;
        if(sequence.cleanup_pending)throw Error('This image is still being removed. Try again shortly.');
        const keep=sequence.frames.filter(frame=>frame.id!==id).map(frame=>frame.id);
        await previews.withDeletion(sequences.assetIds(sequence.id),[sequence.id],()=>sequences.prune(sequence.id,keep,sequence.revision,!keep.length));
        sweepCaches();
        return reply.code(204).send();
      }catch(error){return fail(reply,409,'delete_failed',(error as Error).message,request.id);}
    }
    if(jobs.usesAsset(id)) return fail(reply,409,'asset_busy','A job still needs this file. Wait for it to finish.',request.id);
    const owners = jobs.all().filter(job => job.outputs.includes(id));
    if (owners.some(job => job.state !== 'completed')) return fail(reply, 409, 'asset_busy', 'This file is still being saved. Try again shortly.', request.id);
    const root = realpathSync(options.paths.data) + path.sep;
    const file = path.resolve(options.paths.data, asset.relative_path);
    if (!file.startsWith(path.resolve(options.paths.data) + path.sep) || (existsSync(file) && !realpathSync(file).startsWith(root))) return fail(reply, 409, 'invalid_asset', 'Cannot delete this file location.', request.id);
    return previews.withDeletion([id],[],async()=>{
    try {removeAssetCaches(db,options.paths,jobs,[id]);}
    catch {return fail(reply,409,'delete_failed','Could not remove a cached copy. Close apps using it and retry deletion.',request.id);}
    // Keep the record on file errors so deletion can be retried. A missing file is already deleted.
    try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return fail(reply, 409, 'delete_failed', 'Could not delete the file. Close any apps using it and try again.', request.id); }
    db.transaction(() => {
      db.prepare('DELETE FROM assets WHERE id=?').run(id);
      for (const job of owners) { job.deleted_outputs = [...(job.deleted_outputs??[]),id]; job.outputs = job.outputs.filter(output => output !== id); jobs.save(job); }
    })();
    sweepCaches();
    return reply.code(204).send();
    });
  }));
  app.post('/api/v1/jobs', async (request, reply) => {
    try { const result = await jobs.serialize(() => jobs.submit(request.body, String(request.headers['idempotency-key'] ?? ''))); return reply.code(202).send(result); }
    catch (error) { return fail(reply, 409, 'submission_failed', (error as Error).message, request.id); }
  });
  app.get('/api/v1/jobs', async request => { const query=request.query as {cursor?:string;mode?:string};if(query.mode){const items=jobs.all().filter(j=>j.request.mode===query.mode).reverse().map(j=>jobs.publicJob(j));return {items,next_cursor:null};}const cursor = String(query.cursor ?? ''); const items = jobs.list(51, cursor); return { items: items.slice(0, 50).map(j=>jobs.publicJob(j)), next_cursor: items.length > 50 ? items[49]!.id : null }; });
  app.get('/api/v1/jobs/:id', async (request, reply) => { const job=jobs.get((request.params as { id: string }).id); return job ? jobs.publicJob(job) : fail(reply, 404, 'not_found', 'Job not found.', request.id); });
  app.post('/api/v1/jobs/:id/recover', {schema:{body:{type:'object',additionalProperties:false,maxProperties:0}}}, async(request,reply)=>{
    try { return reply.code(202).send(jobs.recover((request.params as {id:string}).id)); }
    catch(error) { return fail(reply,409,'recovery_failed',(error as Error).message,request.id); }
  });
  app.post('/api/v1/jobs/:id/branch-chat', {schema:{body:{type:'object',additionalProperties:false,required:['fresh'],properties:{draft:{type:'boolean'},fresh:{type:'boolean'},job_ids:{type:'array',minItems:1,maxItems:16,items:{type:'string'}}}}}}, async(request,reply)=>{
    try{const id=(request.params as {id:string}).id,body=request.body as {fresh:boolean;draft?:boolean;job_ids?:string[]};if(body.job_ids&&!body.job_ids.includes(id))throw Error('Source output must be included.');return chats.branch(body.job_ids??[id],body.fresh,body.draft);}catch(e){return fail(reply,409,'branch_failed',(e as Error).message,request.id);}
  });
  app.post('/api/v1/jobs/:id/repeat', async(request,reply)=>{
    try{return await jobs.serialize(async()=>{
      const original=jobs.get((request.params as {id:string}).id);if(!original)throw Error('Job not found.');
      const body=request.body as {request:unknown};
      const staged=await jobs.prepareSubmission(body.request,String(request.headers['idempotency-key']??''),{...original.source,job_id:original.id});
      return db.transaction(staged.commit)();
    });}catch(e){return fail(reply,409,'repeat_failed',(e as Error).message,request.id);}
  });
  app.post('/api/v1/jobs/:id/cancel', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    jobs.interrupt(id);
    try { return await jobs.serialize(() => jobs.cancel(id)); }
    catch (error) { return fail(reply, 409, 'cancel_failed', (error as Error).message, request.id); }
  });
  for(const action of ['continue','retry-save'] as const){
    app.post('/api/v1/jobs/:id/'+action,{schema:{body:{type:'object',additionalProperties:false,maxProperties:0}}},async(request,reply)=>{
      try{return await jobs.serialize(async()=>action==='continue'?jobs.continueRequest((request.params as {id:string}).id):jobs.retrySave((request.params as {id:string}).id));}
      catch(error){return fail(reply,409,'recovery_failed',(error as Error).message,request.id);}
    });
  }
  app.post('/api/v1/jobs/:id/acknowledge', async (request, reply) => {
    try { return await jobs.serialize(async () => jobs.acknowledge((request.params as { id: string }).id)); }
    catch (error) { return fail(reply, 409, 'acknowledge_failed', (error as Error).message, request.id); }
  });
  app.get('/api/v1/assets/:id/content', async (request, reply) => {
    const asset = db.prepare('SELECT relative_path, metadata_json FROM assets WHERE id=?').get((request.params as { id: string }).id) as { relative_path: string; metadata_json: string } | undefined;
    if (!asset) return fail(reply, 404, 'not_found', 'Image not found.', request.id);
    const metadata=JSON.parse(asset.metadata_json);
    if(metadata.state && metadata.state!=='ready')return fail(reply,409,'asset_not_ready','This file has not finished validation.',request.id);
    const file = path.resolve(options.paths.data, asset.relative_path);
    if (!file.startsWith(path.resolve(options.paths.data) + path.sep) || !existsSync(file)) return fail(reply, 404, 'not_found', 'Image not found.', request.id);
    const size = statSync(file).size;
    const mime=metadata.mime_type??'image/png';
    const inline=/^(image\/(png|jpeg|webp|gif|avif|heic|tiff)|video\/(mp4|webm)|audio\/(mp4|webm|wav|mpeg|flac|ogg))$/.test(mime);
    reply.type(inline?mime:'application/octet-stream').header('Accept-Ranges', 'bytes').header('Content-Disposition', `${inline?'inline':'attachment'}; filename="${path.basename(file)}"`);
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range); const start = Number(match?.[1]), end = match?.[2] ? Number(match[2]) : size - 1;
      if (!match || start > end || end >= size) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).send(createReadStream(file, { start, end }));
    }
    return reply.header('Content-Length', size).send(createReadStream(file));
  });

  const webRoot = options.webRoot ?? fileURLToPath(new URL('../web', import.meta.url));
  if (existsSync(path.join(webRoot, 'index.html'))) {
    await app.register(fastifyStatic, { root: webRoot, dotfiles: 'deny', index: ['index.html'], preCompressed: true, cacheControl: false, setHeaders(response,file) {
      response.header('Cache-Control',path.relative(webRoot,file).startsWith('assets'+path.sep)?'public, max-age=31536000, immutable':'no-cache');
    } });
    app.get('/library', async (_request, reply) => reply.sendFile('index.html'));
    app.get('/chat', async (_request, reply) => reply.sendFile('index.html'));
    app.get('/admin', async (_request, reply) => reply.sendFile('index.html'));
  }
  app.setNotFoundHandler((request, reply) => fail(reply, 404, 'not_found', 'This page or operation is not available.', request.id));
  return app;
  } catch(error){diagnostics.error('server.initialize',error);db.close();releaseCoordinator();throw error;}
}
