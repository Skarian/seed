import type Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID,createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import type { StudioPaths } from './storage.js';
import { credentialFields, storedCredentials } from './credential-store.js';
import type { RentalRecord } from './pool-contracts.js';

type Context = { worker_id?: string; provider?: string; request_id?: string; job_id?:string };
type Event = Context & { category: string; operation: string; level?: 'info'|'warn'|'error'; data?: unknown };
const secretField = /authorization|cookie|password|secret|token|credential|api.?key|private.?key|public.?key|ssh.?key|(?:^|_)env$|environment|prompt|references|^input$|^body$/i;

/** Sanitize before persistence, not just when displaying/exporting. Never retain request headers. */
export function sanitize(value: unknown, secrets: string[] = [], depth = 0): any {
  if (depth > 8) return '[depth limit]';
  if (value instanceof Error) return sanitize({name:value.name,message:value.message,code:(value as any).code,stack:value.stack,cause:value.cause}, secrets, depth+1);
  if (typeof value === 'string') {
    // Vast's SSH attachment response nests a JSON object inside a string.
    // Apply the same structural redaction to that object before persisting it.
    if(value.trimStart().startsWith('{')||value.trimStart().startsWith('[')) {
      try {return JSON.stringify(sanitize(JSON.parse(value),secrets,depth+1));}catch{}
    }
    let text = value;
    for (const secret of secrets.filter(s=>s.length>=4).sort((a,b)=>b.length-a.length))
      for (const form of new Set([secret,encodeURIComponent(secret)])) text=text.split(form).join('[REDACTED]');
    return text.replace(/-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?-----END[^\n]*PRIVATE KEY-----/g,'[REDACTED KEY]')
      .replace(/\bBearer\s+[^\s"',;]+/gi,'Bearer [REDACTED]')
      .replace(/\b(?:hf_|sk-|rpa_)[A-Za-z0-9_-]{8,}/g,'[REDACTED]')
      .replace(/(https?:\/\/[^\s"'<>?#]+)[?#][^\s"'<>]*/g,'$1?[REDACTED]')
      .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)(["'])(.*?)\2/gi,'$1$2[REDACTED]$2')
      .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)[^\s,;"']+/gi,'$1[REDACTED]')
      .slice(0,8192);
  }
  if (Array.isArray(value)) {
    const result = value.slice(0,50).map(v=>sanitize(v,secrets,depth+1));
    if(value.length>50)result.push({truncated_items:value.length-50});
    return result;
  }
  if (value && typeof value==='object') {
    const entries=Object.entries(value);
    const result=Object.fromEntries(entries.slice(0,256).map(([k,v])=>[
      k,secretField.test(k)?'[REDACTED]':sanitize(v,secrets,depth+1)
    ]));
    if(entries.length>256)result.truncated_fields=entries.length-256;
    return result;
  }
  return value;
}

export class Diagnostics {
  private context = new AsyncLocalStorage<Context>();
  private extraSecrets = new Set<string>();
  private nextPrune = 0;
  private failed = false;
  constructor(private db: Database.Database, private paths:StudioPaths, readonly now=Date.now) {}
  registerSecret(value:string) {if(value) this.extraSecrets.add(value);}
  private writeFailed() {
    if(this.failed)return;
    this.failed=true;
    const message=JSON.stringify({at:new Date(this.now()).toISOString(),level:'error',operation:'diagnostics_write_failed',message:'Acquisition diagnostics could not be saved. Check local storage.'})+'\n';
    process.stderr.write(message);
    try {appendFileSync(path.join(this.paths.log,'diagnostics-errors.jsonl'),message,{mode:0o600});}catch{}
  }
  clean(value:unknown) {
    let saved:unknown[]=[];
    try {saved=Object.values(storedCredentials(this.paths));} catch { /* No secrets read: still apply structural/pattern filtering. */ }
    return sanitize(value,[...saved,...Object.values(credentialFields).map(k=>process.env[k]),...this.extraSecrets].filter((s):s is string=>typeof s==='string'&&!!s));
  }
  within<T>(context:Context, fn:()=>T):T {return this.context.run({...this.context.getStore(),...context},fn);}
  event(event:Event) {
    const e={...this.context.getStore(),...event}, at=new Date(this.now()).toISOString();
    try {
      const cleaned=this.clean({...e.data as object,...(e.job_id?{job_id:e.job_id}:{})}),serialized=JSON.stringify(cleaned);
      const data=Buffer.byteLength(serialized)<=65536?serialized:JSON.stringify({truncated:true,preview:serialized.slice(0,24000)});
      this.db.prepare('INSERT INTO diagnostic_events(at,category,level,worker_id,provider,request_id,operation,data_json) VALUES (?,?,?,?,?,?,?,?)')
        .run(at,e.category,e.level??'info',e.worker_id??null,e.provider??null,e.request_id??null,e.operation,data);
      if (e.category === 'job' && e.operation === 'state_changed' && e.worker_id)
        this.milestone(e.worker_id, 'job.state_changed', cleaned);
      if(e.worker_id&&(e.level==='error'||e.level==='warn')&&!(e.category==='provider'&&e.operation.startsWith('GET ')&&cleaned.status===404)) {
        const evidence={status:cleaned.status,response:cleaned.response,error:cleaned.error,message:cleaned.message,
          files:cleaned.files,capabilities:cleaned.capabilities};
        // Timings/request IDs vary on each retry; fingerprint the actual failure instead.
        const failure=JSON.stringify(evidence),signature=createHash('sha256').update(e.operation+failure).digest('hex');
        this.db.prepare(`INSERT INTO acquisition_failures VALUES (?,?,?,?,1,?,?) ON CONFLICT(worker_id,signature)
          DO UPDATE SET last_at=excluded.last_at,occurrences=occurrences+1`).run(e.worker_id,signature,at,at,e.operation,
            failure.length<=65536?failure:JSON.stringify({truncated:true,preview:failure.slice(0,24000)}));
      }
      if(this.now()>=this.nextPrune) {
        this.nextPrune=this.now()+3600000;
        this.db.prepare('DELETE FROM diagnostic_events WHERE at < ? OR id <= (SELECT COALESCE(MAX(id),0)-10000 FROM diagnostic_events)')
          .run(new Date(this.now()-90*86400000).toISOString());
      }
    } catch {
      // Diagnostics must never prevent shutdown. Signal failure without leaking the original payload.
      this.writeFailed();
    }
  }
  error(operation:string,error:unknown,context:Context={}) {this.event({...context,category:'server',level:'error',operation,data:{error}});}
  acquisition(w:RentalRecord, previous?:RentalRecord|null, legacy=false) {
    try {this.writeAcquisition(w,previous,legacy);}catch{this.writeFailed();}
  }
  private writeAcquisition(w:RentalRecord, previous?:RentalRecord|null, legacy=false) {
    const old=this.db.prepare('SELECT snapshot_json FROM acquisition_history WHERE worker_id=?').get(w.id) as {snapshot_json:string}|undefined;
    const history=old?JSON.parse(old.snapshot_json):{};
    const issue=this.clean(w.issue), phase=w.preparation?.stage??w.preparation?.phase;
    const errors=history.errors??[];
    if(issue&&!errors.some((e:any)=>e.code===issue.code&&e.message===issue.message)) errors.push({...issue,first_at:new Date(this.now()).toISOString()});
    const snapshot={...history,worker_id:w.id,launch_id:w.launch_id,provider:w.provider,worker_class:w.worker_class,
      gpu:w.gpu,region:w.region,image:w.offer.image,host_id:w.resource?.host_id??history.host_id,
      provider_id:w.provider_id??history.provider_id,created_at:w.created_at,allocated_at:w.allocated_at,
      ready_at:w.ready_at,released_at:w.released_at,state:w.state,phase,create_sent:w.create_sent,
      create_rejected:w.create_rejected,hourly:w.hourly,compute_hourly:w.compute_hourly,storage_hourly:w.storage_hourly,
      disk_gb:w.offer.disk_gb,transfer_per_gb:w.offer.transfer_per_gb,
      issue,errors:errors.slice(0,100),observed_since:history.observed_since??new Date(this.now()).toISOString(),
      coverage:history.coverage??(legacy?'legacy_snapshot':'full'),
      ready_without_recovery:history.ready_without_recovery??(w.ready_at?!(history.recovery_actions>0):undefined),
      updated_at:new Date(this.now()).toISOString()};
    this.db.prepare('INSERT INTO acquisition_history VALUES (?,?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET snapshot_json=excluded.snapshot_json')
      .run(w.id,w.created_at,w.provider,w.worker_class,JSON.stringify(snapshot));
    const state=(v:RentalRecord)=>JSON.stringify([v.state,v.preparation?.stage??v.preparation?.phase,v.issue,v.provider_id,v.ready_at,v.released_at]);
    if(!previous||state(previous)!==state(w)) this.milestone(w.id,legacy?'legacy_import':'state_changed',{
      state:w.state,phase,issue,provider_id:w.provider_id,bytes_done:w.preparation?.bytes_done,bytes_total:w.preparation?.bytes_total,
      failed_files:w.preparation?.files.filter(f=>f.error).map(f=>({name:f.name,error:f.error})),
      ready_at:w.ready_at,released_at:w.released_at
    });
  }
  milestone(worker_id:string,operation:string,data:unknown) {
    try {this.db.prepare('INSERT INTO acquisition_events(worker_id,at,operation,data_json) VALUES (?,?,?,?)')
      .run(worker_id,new Date(this.now()).toISOString(),operation,JSON.stringify(this.clean(data)));}catch{this.writeFailed();}
  }
  action(worker_id:string,action:string) {
    this.milestone(worker_id,'user_action',{action});
    try {if(['reconnect','retry_preparation','omit_loras','local_fallback'].includes(action))
      this.db.prepare("UPDATE acquisition_history SET snapshot_json=json_set(snapshot_json,'$.recovery_actions',COALESCE(json_extract(snapshot_json,'$.recovery_actions'),0)+1) WHERE worker_id=?").run(worker_id);}catch{this.writeFailed();}
  }
  annotate(worker_id:string,values:{campaign?:string;manual_intervention?:boolean;note?:string}) {
    const row=this.db.prepare('SELECT snapshot_json FROM acquisition_history WHERE worker_id=?').get(worker_id) as {snapshot_json:string}|undefined;
    if(!row)throw Error('Worker history not found.');
    const clean=this.clean(values),record=JSON.parse(row.snapshot_json);
    if(clean.manual_intervention===false&&record.manual_intervention===true)throw Error('A recorded intervention cannot be erased.');
    this.db.prepare('UPDATE acquisition_history SET snapshot_json=? WHERE worker_id=?').run(JSON.stringify({...record,...clean}),worker_id);
    this.milestone(worker_id,'annotation',clean);
  }
  history(filters:{from?:string;to?:string;provider?:string;worker_class?:string}={}) {
    const rows=this.db.prepare(`SELECT snapshot_json FROM acquisition_history WHERE (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<?)
      AND (? IS NULL OR provider=?) AND (? IS NULL OR worker_class=?) ORDER BY created_at DESC`).all(filters.from??null,filters.from??null,filters.to??null,filters.to??null,filters.provider??null,filters.provider??null,filters.worker_class??null,filters.worker_class??null) as {snapshot_json:string}[];
    const items=rows.map(row=>{const w=JSON.parse(row.snapshot_json);return {...w,
      acquisition_seconds:w.ready_at?Math.max(0,(Date.parse(w.ready_at)-Date.parse(w.created_at))/1000):null,
      estimated_spend:w.create_sent&&!w.create_rejected?Math.max(0,((Date.parse(w.released_at??new Date(this.now()).toISOString())-Date.parse(w.allocated_at??w.created_at))/3600000)*w.hourly):0,
      outcome:w.create_rejected?'rejected':w.ready_at?'ready':w.released_at?(w.coverage==='legacy_snapshot'?'legacy_unknown':'released_before_ready'):'unresolved'
    };});
    const summarize=(list:any[])=>{const durations=list.filter(w=>w.ready_at).map(w=>w.acquisition_seconds).sort((a,b)=>a-b);return {
      attempts:list.length,ready:list.filter(w=>w.ready_at).length,rejected:list.filter(w=>w.create_rejected).length,
      released_before_ready:list.filter(w=>w.outcome==='released_before_ready').length,unresolved:list.filter(w=>w.outcome==='unresolved').length,
      ready_without_recovery:list.filter(w=>w.coverage==='full'&&w.ready_at&&w.ready_without_recovery&&!w.manual_intervention).length,
      manually_assisted:list.filter(w=>w.manual_intervention).length,legacy:list.filter(w=>w.coverage!=='full').length,
      legacy_unknown:list.filter(w=>w.outcome==='legacy_unknown').length,
      median_ready_seconds:durations.length?(durations[Math.floor((durations.length-1)/2)]+durations[Math.floor(durations.length/2)])/2:null,
      estimated_spend:list.reduce((n,w)=>n+w.estimated_spend,0)};};
    return {generated_at:new Date(this.now()).toISOString(),filters,summary:summarize(items),groups:['vast','runpod'].flatMap(provider=>['image','video'].map(worker_class=>({provider,worker_class,...summarize(items.filter(w=>w.provider===provider&&w.worker_class===worker_class))}))),items,
      retention:{acquisitions:'Retained until explicitly removed with application data.',details:'90 days, up to 10,000 events; lifecycle milestones retained separately.'},diagnostics_write_failed:this.failed};
  }
  details(worker_id:string,after=0) {
    const history=this.db.prepare('SELECT snapshot_json FROM acquisition_history WHERE worker_id=?').get(worker_id) as {snapshot_json:string}|undefined;
    const parse=(rows:any[])=>rows.map(({data_json,...r})=>({...r,data:JSON.parse(data_json)}));
    const events=parse(this.db.prepare('SELECT * FROM diagnostic_events WHERE worker_id=? AND id>? ORDER BY id LIMIT 500').all(worker_id,after));
    return {worker:history?JSON.parse(history.snapshot_json):null,milestones:parse(this.db.prepare('SELECT * FROM acquisition_events WHERE worker_id=? ORDER BY id').all(worker_id)),
      failures:parse(this.db.prepare('SELECT * FROM acquisition_failures WHERE worker_id=? ORDER BY first_at').all(worker_id)),events,next_cursor:events.length===500?events.at(-1).id:null};
  }
  events(after=0,level?:string) {
    const rows=this.db.prepare('SELECT * FROM diagnostic_events WHERE id>? AND (? IS NULL OR level=?) ORDER BY id LIMIT 500').all(after,level??null,level??null) as any[];
    return {items:rows.map(({data_json,...r})=>({...r,data:JSON.parse(data_json)})),next_cursor:rows.length===500?rows.at(-1).id:null,diagnostics_write_failed:this.failed};
  }
}

/** Bound memory before decoding, including errors and malformed bodies. */
export async function boundedText(response:Response,limit=4*1024*1024) {
  if(!response.body)return '';
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Provider response exceeds diagnostic/processing limit.');chunks.push(value);}}
  finally{await reader.cancel();}
  return Buffer.concat(chunks).toString('utf8');
}

export const diagnosticId=()=>randomUUID();
