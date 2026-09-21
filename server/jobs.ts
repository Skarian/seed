import { Media, type PreparedReference } from "./media.js";
import { falRequest, loraRoute } from './fal-request.js';
import { FalError, type FalTransport, type Receipt } from './fal.js';
import {falIssue,type ProviderIssue} from './fal-errors.js';
import type {Estimate} from '../shared/pricing.js';
import { Loras, digest, type LoraSelection } from './loras.js';
import { probe, transcode } from './media.js';
import sharp from 'sharp';
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  statSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import type { StudioPaths } from "./storage.js";


import {
  imageRequest,
  seeds,
  type ImageRequest,
} from "./workflows.js";

export type Job = {
  estimate?:Estimate;
  provider_issue?:ProviderIssue;
  source?: {chat_id?:string;card_id?:string;revision?:number;job_id?:string};
  input_snapshot?: Array<{id:string;name:string;kind:string;note:string;metadata:Record<string,unknown>}>;
  deleted_outputs?: string[];
  metrics?: {
    inputs: {
      total: number;
      image: number;
      video: number;
      audio: number;
      prepared_bytes: number;
      video_soundtracks: number;
    };
    submitted_at?: string;
    saved_at?: string;
    terminal_at?: string;
    elapsed_to_terminal_seconds?: number;
    elapsed_to_saved_seconds?: number;
  };
  prepared?: PreparedReference[];
  id: string;
  state: string;
  submission_id: string;
  submission_index: number;
  request: ImageRequest;
  seed: string;
  fal: { endpoint?: string; receipt?: Receipt; input?: Record<string,unknown>; result?: any; loras: LoraSelection[]; queued_at?: string; running_at?: string; completed_at?: string; cancel_sent_at?: string; upload_seconds?: number };
  outputs: string[];
  error: string | null;
  created_at: string;
  updated_at: string;
  uncertainty_acknowledged?: boolean;
  submission_pending?: boolean;
  recovery_blocked?: boolean;
};
const terminal = ['completed', 'failed', 'cancelled'];

export class Jobs {
  private chain: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopped = false;
  private inFlight = new Map<string, Promise<void>>();
  private inputUploads = new Map<string, Promise<string>>();
  private uploaded = new Map<string, {url: string; expires: number}>();
  public media: Media;
  public loras: Loras;
  constructor(
    private db: Database.Database,
    private paths: StudioPaths,
    private fal: FalTransport,
  ) {
    this.media = new Media(db, paths); this.loras = new Loras(paths);
  }
  serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn);
    this.chain = next.catch(() => {});
    return next;
  }
  resetUploads(){this.uploaded.clear();this.loras.clearUploads();}
  start() {
    this.timer = setInterval(() => {
      void this.tick();
    }, 2000);
    void this.tick();
  }
  async close() {
    this.stopped = true;
    this.fal.close?.();
    clearInterval(this.timer);
    await this.chain;
    await Promise.allSettled(this.inFlight.values());
  }
  interrupt(id: string) { this.stopJobs([id]); }
  retrySave(id:string) {
    const job=this.get(id);
    if(!job?.recovery_blocked||!job.fal?.receipt)throw Error('This output does not need saving again.');
    job.recovery_blocked=false;job.error=null;this.save(job);
    return job;
  }
  continueRequest(id:string) {
    this.ensureConfigured();
    this.ensureResolved();
    const job=this.get(id);
    if(!job||job.state!=='blocked')throw Error('This request is not waiting for action.');
    const waiting=this.all().filter(j=>j.submission_id===job.submission_id&&j.state==='blocked');
    this.db.transaction(()=>{for(const item of waiting){item.state='queued';item.error=null;delete item.provider_issue;this.save(item);}})();
    return {jobs:waiting};
  }
  private ensureResolved() {
    if(this.all().some(j=>j.recovery_blocked))throw Error('Retry saving the output that needs attention in Activity before generating.');
    if(this.all().some(j=>j.state==='needs_attention'&&!j.uncertainty_acknowledged))throw Error('Resolve the previous interrupted request in Activity before generating.');
  }
  private holdWaiting(issue?:ProviderIssue,message='Review the interrupted request in Activity before continuing.') {
    for(const job of this.all().filter(j=>j.state==='queued')){
      job.state='blocked';job.provider_issue=issue;job.error=issue?issue.message+' '+issue.action:message;this.save(job);
    }
  }
  private holdForIssue(issue?:ProviderIssue){
    if(issue&&['insufficient_funds','invalid_credentials','access_denied','rate_limited'].includes(issue.code))this.holdWaiting(issue);
  }
  private blockRecovery(job: Job, error: unknown) {
    job.recovery_blocked = true;
    job.error = `${error instanceof Error ? error.message : 'Transfer failed.'} Fix the problem, then retry saving this output. No new generation is needed.`;
    this.save(job);
    this.holdWaiting(undefined,'Retry saving the output that needs attention in Activity before continuing.');
  }
  list(limit = 50, cursor = ""): Job[] {
    return (
      this.db
        .prepare(
          "SELECT snapshot_json FROM jobs WHERE (? = '' OR (created_at,id) < (SELECT created_at,id FROM jobs WHERE id=?)) ORDER BY created_at DESC,id DESC LIMIT ?",
        )
        .all(cursor, cursor, limit) as { snapshot_json: string }[]
    ).map((r) => JSON.parse(r.snapshot_json));
  }
  all(): Job[] {
    return (
      this.db
        .prepare(
          "SELECT snapshot_json FROM jobs ORDER BY created_at, submission_index",
        )
        .all() as { snapshot_json: string }[]
    ).map((r) => JSON.parse(r.snapshot_json));
  }
  get(id: string): Job | null {
    const row = this.db
      .prepare("SELECT snapshot_json FROM jobs WHERE id = ?")
      .get(id) as { snapshot_json: string } | undefined;
    return row ? JSON.parse(row.snapshot_json) : null;
  }
  save(job: Job) {
    if(this.cancelled(job.id)) {
      if(['queued','blocked'].includes(job.state)){job.state='cancelled';}
      else if(['uploading','submitting','running'].includes(job.state))job.state='cancel_requested';
    }
    if (
      job.metrics &&
      terminal.includes(job.state) &&
      !job.metrics.terminal_at
    ) {
      job.metrics.terminal_at = new Date().toISOString();
      job.metrics.elapsed_to_terminal_seconds =
        (Date.parse(job.metrics.terminal_at) - Date.parse(job.created_at)) /
        1000;
    }
    job.updated_at = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE jobs SET state=?, snapshot_json=?, updated_at=? WHERE id=?",
      )
      .run(job.state, JSON.stringify(job), job.updated_at, job.id);
  }
  async submit(raw: unknown, key: string, estimate?:Estimate) {
    const prepared = await this.prepareSubmission(raw, key,undefined,estimate);
    const result = this.db.transaction(prepared.commit)();
    return result;
  }
  async prepareSubmission(raw: unknown, key: string, source?:Job['source'], estimate?:Estimate) {
    this.ensureResolved();
    const request = imageRequest(raw);
    if (!/^[\w-]{16,128}$/.test(key))
      throw new Error("A submission key is required.");
    const body = JSON.stringify(request);
    const previous = this.db
      .prepare("SELECT id,body_json FROM submissions WHERE idempotency_key=?")
      .get(key) as { id: string; body_json: string } | undefined;
    if (previous) {
      if (previous.body_json !== body)
        throw new Error("This submission key belongs to different settings.");
      return {commit: () => ({
        submission_id: previous.id,
        jobs: this.all().filter((j) => j.submission_id === previous.id),
      })};
    }
    this.ensureConfigured();
    const selected = this.loras.resolve(request.loras, loraRoute(request), request.mode);
    const prepared: PreparedReference[] = [];
    for (const ref of request.references ?? [])
      prepared.push(
        await this.media.prepare(
          ref,
          request.output.aspect,
          request.output.duration_seconds!,
        ),
      );
    const submission_id = randomUUID(),
      now = new Date().toISOString();
    const jobs = seeds(request).map((seed, index): Job => {
      const id = randomUUID();
      return {
        estimate,
        source,
        input_snapshot: (request.references??[]).map(ref=>{const asset=this.media.get(ref.asset_id)!;const note=this.db.prepare('SELECT note FROM asset_notes WHERE id=?').get(ref.asset_id) as {note:string}|undefined;return {id:ref.asset_id,name:asset.name,kind:asset.kind,note:note?.note??'',metadata:asset.metadata};}),
        metrics: {
          inputs: {
            total: prepared.length,
            image: prepared.filter((r) => r.kind === "image").length,
            video: prepared.filter((r) => r.kind === "video").length,
            audio: prepared.filter((r) => r.kind === "audio").length,
            video_soundtracks: prepared.filter((r) => r.audio_file).length,
            prepared_bytes: prepared.reduce(
              (n, r) =>
                n +
                statSync(r.file).size +
                (r.audio_file ? statSync(r.audio_file).size : 0),
              0,
            ),
          },
        },
        id,
        state: "queued",
        submission_id,
        submission_index: index,
        request,
        seed,
        fal: { loras: selected.map(({id,revision,scale}) => ({id,revision,scale})) },
        ...(prepared.length ? { prepared } : {}),
        outputs: [],
        error: null,
        created_at: now,
        updated_at: now,
      };
    });
    return {commit: () => {
      this.db
        .prepare("INSERT INTO submissions VALUES (?,?,?)")
        .run(submission_id, key, body);
      const insert = this.db.prepare(
        "INSERT INTO jobs(id,workflow,state,snapshot_json,created_at,updated_at,submission_id,submission_index) VALUES (?,?,?,?,?,?,?,?)",
      );
      for (const job of jobs)
        insert.run(
          job.id,
          request.workflow,
          job.state,
          JSON.stringify(job),
          now,
          now,
          submission_id,
          job.submission_index,
        );
      return { submission_id, jobs };
    }};
  }
  ensureConfigured() {
    if (!this.fal.configured) throw Error("Set FAL_KEY or run seed setup.");
  }
  async cancel(id: string) {
    const job = this.get(id);
    if (!job) throw new Error("Job not found.");
    if (terminal.includes(job.state)) return job;
    if (["queued","blocked"].includes(job.state)) {
      job.state = "cancelled";
    } else if (job.state === "needs_attention")
      throw new Error(
        "Check the request in your fal dashboard before acknowledging an uncertain submission.",
      );
    else job.state = "cancel_requested";
    this.save(job);
    return job;
  }
  /** Durable user intent is independent of remote job state and recovery. */
  stopJobs(ids: string[]) {
    this.db.transaction(()=>{
      for(const id of ids) {
        const job=this.get(id);if(!job||terminal.includes(job.state))continue;
        this.db.prepare('INSERT OR IGNORE INTO job_cancel_intents(id) VALUES (?)').run(id);
        if(['queued','blocked'].includes(job.state)){job.state='cancelled';}
        else if(job.state!=='needs_attention')job.state='cancel_requested';
        this.save(job);
      }
    })();
  }
  private cancelled(id:string) {return Boolean(this.db.prepare('SELECT id FROM job_cancel_intents WHERE id=?').get(id));}
  acknowledge(id: string) {
    const job = this.get(id);
    if (!job || job.state !== "needs_attention")
      throw new Error("Only an uncertain job can be acknowledged.");
    job.uncertainty_acknowledged = true;
    this.save(job);
    return job;
  }
  async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try { await this.serialize(() => this.reconcile(true)); }
    catch { /* Reconcile durable state on the next tick; never repeat an uncertain POST. */ }
    finally { this.ticking = false; }
  }
  async reconcile(background = false) {
    if (!this.fal.configured) return;
    for (const job of this.all().filter(j => j.fal && !terminal.includes(j.state) && j.state !== 'queued' && j.state !== 'blocked' && j.state !== 'needs_attention' && !j.recovery_blocked)) {
      if(this.inFlight.has(job.id))continue;
      if(!job.fal!.receipt) {
        if(job.state==='uploading' || (this.cancelled(job.id)&&!job.submission_pending)){job.state=this.cancelled(job.id)?'cancelled':'queued';this.save(job);continue;}
        job.state='needs_attention';job.error='Submission was interrupted before its fal request ID was saved. Check fal history before trying again.';this.save(job);this.holdWaiting();continue;
      }
      const task=this.track(job.id,()=>this.advance(job));
      if(!background)await task;
    }
    if (this.all().some(j => j.recovery_blocked || j.state === 'needs_attention' && !j.uncertainty_acknowledged)) return;
    // Bound concurrent paid requests; fal handles actual GPU scheduling and batching.
    let slots = 2 - this.all().filter(j => !terminal.includes(j.state) && !['queued','blocked','needs_attention'].includes(j.state)).length;
    for (const job of this.all().filter(j => j.state === 'queued' && j.fal)) {
      if (slots-- <= 0 || this.stopped) break;
      if(this.inFlight.has(job.id)||this.get(job.id)?.state!=='queued')continue;
      const task=this.track(job.id,async()=>{
      try { await this.dispatch(job); }
      catch (error) {
        if(job.submission_pending||job.fal?.receipt){job.state='needs_attention';job.error='Could not persist the fal submission. Check the fal dashboard before retrying.';this.holdWaiting();}
        else if(!this.stopped){job.state='failed';job.provider_issue=error instanceof FalError?error.issue:undefined;job.error=error instanceof FalError?error.message:'Could not prepare inputs or adapters for fal. Check local files and fal access, then retry.';this.holdForIssue(job.provider_issue);}
        this.save(job);
      }
      });
      if(!background)await task;
      if(this.all().some(j=>j.recovery_blocked||j.state==='needs_attention'&&!j.uncertainty_acknowledged))break;
    }
  }
  private track(id: string, action: () => Promise<void>) {
    const task=action().catch(()=>{/* Durable state is reconciled on the next tick. */}).finally(()=>{this.inFlight.delete(id);});
    this.inFlight.set(id,task);return task;
  }
  private async advance(job: Job) {
      if (!job.fal?.receipt) throw Error('Missing fal request ID.');
      try {
        if (job.state === 'cancel_requested' && !job.fal!.cancel_sent_at) {
          const reply = await this.fal.cancel(job.fal!.receipt);
          if (reply.status === 'CANCELLED') { job.state = 'cancelled'; this.save(job); return; }
          job.fal!.cancel_sent_at = new Date().toISOString(); this.save(job);
          // A running request may finish and incur its normal charge despite cancellation.
        }
        if (job.fal!.result) { await this.retrieve(job); return; }
        const status = await this.fal.status(job.fal!.receipt);
        delete job.provider_issue;
        job.error=null;
        if (status.status === 'CANCELLED') { job.state = 'cancelled'; this.save(job); }
        else if (status.status === 'COMPLETED') {
          job.fal!.completed_at ??= new Date().toISOString();
          if(status.error||status.error_type){job.state='failed';job.provider_issue=falIssue(500,status);job.error=job.provider_issue.message+' '+job.provider_issue.action;this.save(job);return;}
          const result = await this.fal.result(job.fal!.receipt);
          if (result.error || result.detail || (!result.video && !Array.isArray(result.images))) { job.state = 'failed';job.provider_issue=falIssue(422,result);job.error=job.provider_issue.message+' '+job.provider_issue.action;this.save(job); return; }
          job.fal!.result = result; job.state = 'copying'; this.save(job); await this.retrieve(job);
        } else if (status.status === 'IN_PROGRESS') {
          job.fal!.running_at ??= new Date().toISOString(); if (job.state !== 'cancel_requested') job.state = 'running'; this.save(job);
        } else if (status.status === 'IN_QUEUE') this.save(job);
        else throw Error('Unrecognized fal status.');
      } catch (error) {
        if (error instanceof FalError && (error.status === 422||job.fal!.completed_at&&error.status>=500)) { job.state = 'failed'; job.provider_issue=error.issue;job.error = error.message; this.save(job); }
        else if (job.fal!.result) this.blockRecovery(job, Error('The generated output could not be saved locally.'));
        else if (error instanceof FalError && error.status === 404) { job.state='needs_attention'; job.error='fal cannot find this request. Check its saved request ID in fal history before retrying.'; this.save(job); this.holdWaiting(); }
        else {job.provider_issue=error instanceof FalError?error.issue:undefined;job.error=(error instanceof FalError?error.message+' ':'')+'Cannot check fal yet. This request will be checked again without resubmitting.';this.holdForIssue(job.provider_issue);this.save(job); }
      }
  }
  private async dispatch(job: Job) {
    const started = Date.now();
    job.state='uploading';this.save(job);
    const urls = [];
    for (const ref of job.prepared ?? []) {
      const url = await this.referenceUrl(ref.file);
      const audio_url = ref.audio_file ? await this.referenceUrl(ref.audio_file) : undefined;
      urls.push({kind: ref.kind, role: ref.role, url, audio_url});
    }
    this.loras.resolve(job.fal.loras, loraRoute(job.request), job.request.mode);
    const loras = [];
    for (const selected of job.fal!.loras) loras.push({...selected, path:await this.loras.url(selected.id,selected.revision,this.fal)});
    if (this.cancelled(job.id) || this.stopped) { if (this.cancelled(job.id)) { job.state='cancelled'; this.save(job); } return; }
    const mapped = falRequest(job.request,job.seed,urls,loras);
    job.fal!.endpoint=mapped.endpoint; job.fal!.input=mapped.input; job.fal!.upload_seconds=(Date.now()-started)/1000;
    job.state='submitting'; job.submission_pending=true; job.metrics!.submitted_at=new Date().toISOString(); this.save(job);
    try {
      const receipt = await this.fal.submit(mapped.endpoint,mapped.input);
      job.fal!.receipt=receipt; job.fal!.queued_at=new Date().toISOString(); job.submission_pending=false; job.state='running'; this.save(job);
    } catch (error) {
      const rejected=error instanceof FalError && [400,401,402,403,404,405,413,422,429].includes(error.status);
      job.state=rejected?'failed':'needs_attention';
      job.provider_issue=error instanceof FalError?error.issue:undefined;
      job.error=rejected?error.message:'fal may have accepted this request. Check your fal request history before generating again; Seed will not retry this submission.';
      if(rejected)job.submission_pending=false;
      if(!rejected)this.holdWaiting();else this.holdForIssue(job.provider_issue);
      this.save(job);
    }
  }
  private async referenceUrl(file: string) {
    let uploaded=this.uploaded.get(file);
    if(!uploaded || uploaded.expires<Date.now()) {
      let pending=this.inputUploads.get(file);
      if(!pending){pending=this.fal.upload(file).finally(()=>this.inputUploads.delete(file));this.inputUploads.set(file,pending);}
      uploaded={url:await pending,expires:Date.now()+6*86400000};this.uploaded.set(file,uploaded);
    }
    return this.fal.sign(uploaded.url);
  }
  private async retrieve(job: Job) {
    job.state='copying'; this.save(job);
    const image=job.request.workflow==='text-to-image', result=job.fal!.result;
    const output=image?result.images?.[0]:result.video;
    if(!output?.url || typeof output.url!=='string')throw Error('Missing output URL.');
    const filename=job.id+'-0'+(image?'.png':'.mp4'), file=path.join(this.paths.data,'media/outputs',filename);
    await this.fal.download(output.url,file);
    let info: Record<string,unknown>;
    if(image){const m=await sharp(file).metadata();if(!m.width||!m.height||m.format!=='png')throw Error('Invalid image output.');await sharp(file).stats();info={width:m.width,height:m.height};}
    else {const m=await probe(file);if(!m.has_video||!m.duration)throw Error('Invalid video output.');info=m;
      if(job.request.audio?.output==='silent'){const silent=file+'.silent.mp4';await transcode(['-i',file,'-map','0:v:0','-an','-c:v','copy',silent]);renameSync(silent,file);info={...info,has_audio:false};}
    }
    const outputs=[{id:job.id+'-0',file,metadata:info}];
    for(const output of outputs)Object.assign(output.metadata,{job_id:job.id,mode:job.request.mode,mime_type:image?'image/png':'video/mp4',size:statSync(output.file).size,sha256:await digest(output.file)});
    this.db.transaction(()=>{
      outputs.forEach((output,i)=>{
        this.db.prepare('INSERT OR IGNORE INTO assets VALUES (?,?,?,?,?,?)').run(output.id,image?'image':'video',image?'Generated image':'Generated video',path.relative(this.paths.data,output.file).split(path.sep).join('/'),JSON.stringify(output.metadata),job.created_at);
          if(job.request.note)this.db.prepare('INSERT OR IGNORE INTO asset_notes VALUES (?,?,0)').run(output.id,job.request.note);
      });
      job.outputs=outputs.map(o=>o.id);job.state='completed';job.error=null;job.recovery_blocked=false;delete job.provider_issue;
      job.metrics!.saved_at=new Date().toISOString();job.metrics!.elapsed_to_saved_seconds=(Date.now()-Date.parse(job.created_at))/1000;this.save(job);
    })();
    // Compatibility evidence is useful but must not invalidate an already saved output.
    try { this.loras.markVerified(job.fal!.loras, job.fal!.receipt!.request_id, job.fal!.endpoint!); } catch { /* The next successful request can record it. */ }
  }
}
