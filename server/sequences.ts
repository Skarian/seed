import type Database from 'better-sqlite3';
import { existsSync, realpathSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { Jobs } from './jobs.js';
import type { FrameSequence } from '../shared/studio.js';
import {removeAssetCaches} from './media-cache.js';

export class Sequences {
  constructor(private db: Database.Database, private data: string, private cache: string, private jobs: Jobs) {}
  assetIds(id:string){
    const frames=(this.db.prepare('SELECT asset_id FROM sequence_frames WHERE sequence_id=?').all(id) as {asset_id:string}[]).map(row=>row.asset_id);
    const row=this.db.prepare('SELECT pending_json FROM sequences WHERE id=?').get(id) as {pending_json:string|null}|undefined;
    return [...new Set([...frames,...(row?.pending_json?JSON.parse(row.pending_json).remove as string[]:[])])];
  }
  get(id: string): FrameSequence | null {
    const row = this.db.prepare('SELECT * FROM sequences WHERE id=?').get(id) as any;
    if (!row) return null;
    if (row.pending_json) return {id,revision:row.revision,mode:row.mode,frames:[],cleanup_pending:true};
    const frames = this.db.prepare(`SELECT a.id,f.frame_index AS 'index',json_extract(a.metadata_json,'$.width') AS width,
      json_extract(a.metadata_json,'$.height') AS height FROM sequence_frames f JOIN assets a ON a.id=f.asset_id
      WHERE sequence_id=? ORDER BY frame_index`).all(id) as any[];
    return {id, revision:row.revision, mode:row.mode, frames:frames.map(f=>({...f,time:f.index/24}))};
  }
  private location(relative: string) {
    const root = realpathSync(this.data) + path.sep, file = path.resolve(this.data,relative);
    if (!file.startsWith(path.resolve(this.data)+path.sep) || (existsSync(file) && !realpathSync(file).startsWith(root))) throw Error('Invalid file location.');
    return file;
  }
  private check(ids: string[]) {
    for (const job of this.jobs.all()) {
      if ((!['completed','failed','cancelled'].includes(job.state)||this.jobs.isInFlight(job.id)) && [...(job.request?.references??[]),...(job.prepared??[])].some(r=>ids.includes(r.asset_id))) throw Error('A queued job still needs a selected file. Wait for it to finish.');
      if (job.outputs.some(id=>ids.includes(id)) && (job.state!=='completed')) throw Error('These frames are still being saved. Try again shortly.');
    }
    for (const id of ids) {
      const row=this.db.prepare('SELECT relative_path FROM assets WHERE id=?').get(id) as any;
      if(row) this.location(row.relative_path);
    }
  }
  prune(id: string, keep: string[], revision: number, deleting = false) {
    const row=this.db.prepare('SELECT * FROM sequences WHERE id=?').get(id) as any;
    if(!row) { if(deleting) return null; throw Error('Sequence not found.'); }
    if(!Array.isArray(keep) || (!deleting && !keep.length) || keep.length>360 || keep.some(k=>typeof k!=='string') || new Set(keep).size!==keep.length || !Number.isInteger(revision)) throw Error('Choose frames to keep.');
    if(row.pending_json) {
      const pending=JSON.parse(row.pending_json);
      if(pending.deleting!==deleting || pending.keep.length!==keep.length || !keep.every(k=>pending.keep.includes(k))) throw Error('Finish the previous frame cleanup first.');
    } else {
      const ids=(this.db.prepare('SELECT asset_id FROM sequence_frames WHERE sequence_id=? ORDER BY frame_index').all(id) as any[]).map(r=>r.asset_id);
      if(keep.some(k=>!ids.includes(k))) throw Error('A selected frame no longer belongs to this sequence.');
      if(!deleting && ids.length===keep.length) return this.get(id);
      if(row.revision!==revision) throw Error('This sequence changed. Reopen it before deleting frames.');
      const remove=ids.filter(k=>!keep.includes(k));
      this.check(remove);
      this.db.prepare('UPDATE sequences SET pending_json=? WHERE id=?').run(JSON.stringify({keep,remove,deleting}),id);
    }
    this.finish(id);
    return this.get(id);
  }
  private finish(id: string) {
    const row=this.db.prepare('SELECT pending_json FROM sequences WHERE id=?').get(id) as any;
    if(!row?.pending_json) return;
    const pending=JSON.parse(row.pending_json);
    this.check(pending.remove);
    removeAssetCaches(this.db,{data:this.data,cache:this.cache},this.jobs,pending.remove,[id]);
    for(const assetId of pending.remove) {
      const asset=this.db.prepare('SELECT relative_path FROM assets WHERE id=?').get(assetId) as any;
      if(asset) {
        try { unlinkSync(this.location(asset.relative_path)); } catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw Error('Could not remove a frame. Close apps using it and retry.'); }
      }
      this.db.transaction(()=>{
        this.db.prepare('DELETE FROM assets WHERE id=?').run(assetId);
        for(const job of this.jobs.all()) if(job.outputs.includes(assetId)) {job.outputs=job.outputs.filter(x=>x!==assetId);this.jobs.save(job);}
      })();
    }
    if(pending.deleting) this.db.prepare('DELETE FROM sequences WHERE id=?').run(id);
    else this.db.prepare('UPDATE sequences SET pending_json=NULL,revision=revision+1 WHERE id=?').run(id);
  }
  retry(id:string) { this.finish(id); return this.get(id); }
  recover(onFailure?:(failure:{code:string})=>void) {
    for(const row of this.db.prepare('SELECT id FROM sequences WHERE pending_json IS NOT NULL').all() as {id:string}[]) {
      try { this.finish(row.id); } catch(error) {
        // Keep intent for retry and report the bounded failure without file names or media content.
        onFailure?.({code:(error as NodeJS.ErrnoException).code??'SEQUENCE_CLEANUP_FAILED'});
      }
    }
  }
}
