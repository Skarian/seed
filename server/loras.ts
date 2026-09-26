import type {LoraSelection} from '../shared/generation.js';
export type {LoraSelection} from '../shared/generation.js';
import {
  createReadStream,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  statSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LoraGroup, LoraGuidance, LoraSource, LoraSourceManifest, LoraRoute } from '../shared/loras.js';
import type { StudioPaths } from './storage.js';



export type Lora = {
  group_id?: string;
  filename?: string;
  staged?: boolean;
  archived?: boolean;
  id: string;
  name: string;
  version?: string;
  description?: string;
  source_url?: string;
  availability?: 'all' | 'spicy';
  enabled?: boolean;
  default_scale?: number;
  trigger_words?: string[];
  route: 'image' | 'fl' | 'ref';
  revision: string;
  file?: string;
  source?: LoraSource;
  format: 'lora' | 'lokr' | 'unknown';
  compatibility: 'untested' | 'verified';
  source_sha256?: string;
  conversion?: 'h3-kohya-v1';
  verification?: { request_id: string; endpoint: string; at: string };
  upload?: { url: string; expires_at: string };
};
export async function digest(file: string) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
export function sourceReady(source: LoraSource | undefined): source is LoraSource {
  if(!source||source.provider!=='civitai'||!['model_id','version_id','file_id'].every(key=>Number.isSafeInteger(source[key as 'model_id'])&&source[key as 'model_id']>0)||!Number.isSafeInteger(source.size_bytes)||source.size_bytes<=0||source.size_bytes>8*1024**3||!/^[a-f0-9]{64}$/.test(source.sha256))return false;
  try{const url=new URL(source.url);return url.protocol==='https:'&&url.hostname==='civitai.com'&&!url.username&&!url.password&&!url.port&&url.pathname===`/api/download/models/${source.version_id}`&&[...url.searchParams.keys()].every(key=>['type','format','size','fp'].includes(key));}catch{return false;}
}

export function loraGroupId(
  entry: Pick<Lora, 'id' | 'route' | 'source_url' | 'availability' | 'group_id'>,
) {
  if (entry.group_id) return entry.group_id;
  return entry.source_url
    ? 'lora-' +
        createHash('sha256')
          .update(
            entry.source_url +
              '|' +
              (entry.route === 'image' ? 'krea2' : 'h3') +
              '|' +
              (entry.availability ?? 'all'),
          )
          .digest('hex')
          .slice(0, 24)
    : entry.id;
}
export class Loras {
  private file: string;

  constructor(private paths: StudioPaths) {
    this.file = path.join(paths.config, 'loras.json');
  }
  all(): Lora[] {
    try {
      const entries = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!Array.isArray(entries)) throw Error();
      // Older imports already persisted pinned metadata. Recover that metadata
      // without reading, converting, downloading or deleting their local files.
      let changed=false;
      let imports:any[]=[];
      try{const saved=JSON.parse(readFileSync(path.join(this.paths.config,'lora-imports.json'),'utf8'));if(Array.isArray(saved))imports=saved;}catch{}
      for(const entry of entries as Lora[]){
        if(entry.source)continue;
        for(const job of imports){
          const file=job.files?.find((f:any)=>f.lora_id===entry.id&&f.sha256===entry.revision);
          const modelId=Number(String(job.source_url??'').match(/\/models\/(\d+)/)?.[1]);
          const source:LoraSource={provider:'civitai',model_id:modelId,version_id:job.version_id,file_id:file?.file_id,url:file?.download_url,sha256:file?.sha256,size_bytes:file?.total};
          if(sourceReady(source)){entry.source=source;changed=true;break;}
        }
      }
      if(changed)this.save(entries);
      return entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw Error('Cannot read loras.json.');
    }
  }
  private save(entries: Lora[]) {
    const tmp = this.file + '.' + randomUUID() + '.tmp';
    writeFileSync(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  list(mode?: 'sfw' | 'nsfw', admin = false) {
    return this.all()
      .filter(
        (entry) =>
          !entry.staged &&
          !entry.archived &&
          (admin || entry.enabled !== false) &&
          (mode !== 'sfw' || entry.availability !== 'spicy'),
      )
      .map(({ file, upload, ...entry }) => ({
        ...entry,
        source_status: sourceReady(entry.source) ? 'ready' as const : 'needs_source' as const,
        enabled: entry.enabled !== false,
        availability: entry.availability ?? 'all',
        compatibility: entry.verification?.endpoint.startsWith('worker:') ? entry.compatibility : 'untested',
        min_scale: 0,
        max_scale: 4,
        default_scale: entry.default_scale ?? 1,
      }));
  }
  update(
    id: string,
    patch: Partial<
      Pick<
        Lora,
        | 'name'
        | 'description'
        | 'availability'
        | 'default_scale'
        | 'trigger_words'
        | 'enabled'
        | 'version'
        | 'source_url'
      >
    >,
  ) {
    const entries = this.all();
    if (!entries.some((e) => e.id === id)) throw Error('LoRA not found.');
    if (patch.name !== undefined && (!patch.name.trim() || patch.name.length > 150))
      throw Error('Enter a name under 150 characters.');
    if (patch.description !== undefined && patch.description.length > 4000)
      throw Error('Keep the description under 4000 characters.');
    if (
      patch.default_scale !== undefined &&
      (!Number.isFinite(patch.default_scale) || patch.default_scale < 0 || patch.default_scale > 4)
    )
      throw Error('Strength must be between 0 and 4.');
    if (patch.availability !== undefined && !['all', 'spicy'].includes(patch.availability))
      throw Error('Choose a supported availability setting.');
    if (
      patch.trigger_words !== undefined &&
      (!Array.isArray(patch.trigger_words) ||
        patch.trigger_words.length > 30 ||
        patch.trigger_words.some((w) => typeof w !== 'string' || w.length > 200))
    )
      throw Error('Check the trigger words.');
    this.save(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }
  revision() {
    return existsSync(this.file) ? statSync(this.file).mtimeMs : 0;
  }
  groups(mode: 'sfw' | 'nsfw'): LoraGroup[] {
    const grouped = new Map<string, Lora[]>();
    for (const entry of this.all()) {
      if (entry.staged || entry.archived || (mode === 'sfw' && entry.availability === 'spicy'))
        continue;
      const id = loraGroupId(entry);
      grouped.set(id, [...(grouped.get(id) ?? []), entry]);
    }
    return [...grouped].map(([id, entries]) => {
      const first = entries[0]!;
      return {
        id,
        name: first.name,
        version: first.version,
        description: first.description ?? '',
        family: first.route === 'image' ? 'krea2' : 'h3',
        availability: first.availability ?? 'all',
        enabled: entries.some((e) => e.enabled !== false),
        default_scale: first.default_scale ?? 1,
        trigger_words: first.trigger_words ?? [],
        source_url: first.source_url,
        files: entries.map((e) => ({
          id: e.id,
          name: e.filename ?? 'Imported adapter',
          route: e.route,
          compatibility: e.verification?.endpoint.startsWith('worker:') ? e.compatibility : 'untested',
          source_status: sourceReady(e.source) ? 'ready' : 'needs_source',
        })),
      };
    });
  }
  manifestSources(role: 'image' | 'video'): LoraSourceManifest[] {
    return this.all().filter(entry=>!entry.archived&&!entry.staged&&entry.enabled!==false&&(role==='image'?entry.route==='image':entry.route!=='image')&&sourceReady(entry.source)).map(entry=>{
      const source=entry.source!;
      // The worker protocol pins one exact file, not Civitai's default file for
      // a version. Legacy catalog URLs may omit selectors or name another file.
      const url=`https://civitai.com/api/download/models/${source.version_id}?fileId=${source.file_id}`;
      return {id:entry.id,name:entry.name,revision:entry.revision,route:entry.route,path:`loras/seed-${source.sha256}.safetensors`,url,sha256:source.sha256,size_bytes:source.size_bytes,source:{...source}};
    });
  }
  applySources(groupId:string,files:Array<{name:string;route:LoraRoute;source:LoraSource}>,details:LoraGuidance&{availability:'all'|'spicy';enabled:boolean;version?:string;source_url?:string}) {
    if(!files.length||new Set(files.map(f=>f.route)).size!==files.length||files.some(f=>!sourceReady(f.source)))throw Error('Choose pinned adapter sources and map one file per workflow.');
    const selected=files.map(file=>({
      ...details,group_id:groupId,id:`${file.route}-${file.source.sha256.slice(0,16)}-${groupId}`,
      filename:file.name,route:file.route,revision:file.source.sha256,format:'unknown' as const,
      compatibility:'untested' as const,source:{...file.source},staged:false,archived:false,
    }));
    const entries=this.all();
    for(const entry of selected){
      const previous=entries.find(e=>e.id===entry.id);
      if(previous)Object.assign(entry,{...previous,...entry,compatibility:previous.compatibility??'untested'});
    }
    this.save([...entries.filter(e=>!selected.some(s=>s.id===e.id)).map(e=>loraGroupId(e)===groupId?{...e,archived:true,enabled:false}:e),...selected]);
  }
  remapGroup(groupId:string,files:Array<{id:string;route:LoraRoute}>,details:LoraGuidance&{availability:'all'|'spicy';enabled:boolean;version?:string;source_url?:string}) {
    const entries=this.all(),selected=files.map(file=>{
      const old=entries.find(e=>e.id===file.id&&loraGroupId(e)===groupId&&!e.archived&&!e.staged);
      if(!old)throw Error('A selected file is not part of this LoRA.');
      return {...old,...details,route:file.route,id:file.route===old.route?old.id:`${file.route}-${old.revision.slice(0,16)}-${groupId}`,staged:false,archived:false,...(file.route===old.route?{}:{compatibility:'untested' as const,verification:undefined})};
    });
    this.save([...entries.filter(e=>!selected.some(s=>s.id===e.id)).map(e=>loraGroupId(e)===groupId?{...e,archived:true,enabled:false}:e),...selected]);
  }
  setAvailability(id: string, availability: unknown) {
    if (availability !== 'all' && availability !== 'spicy')
      throw Error('Choose a supported availability setting.');
    const entries = this.all();
    if (!entries.some((entry) => entry.id === id)) throw Error('LoRA not found.');
    this.save(entries.map((entry) => (entry.id === id ? { ...entry, availability } : entry)));
  }
  markVerified(selected: LoraSelection[], request_id: string, endpoint: string) {
    if (!selected.length) return;
    this.save(
      this.all().map((entry) =>
        selected.some((s) => s.id === entry.id && s.revision === entry.revision)
          ? {
              ...entry,
              compatibility: 'verified',
              verification: { request_id, endpoint, at: new Date().toISOString() },
            }
          : entry,
      ),
    );
  }
  resolve(selected: LoraSelection[] = [], route: Lora['route'], mode: 'sfw' | 'nsfw' = 'sfw') {
    if (selected.length > 3 || new Set(selected.map((e) => e.id)).size !== selected.length)
      throw Error('Select at most three distinct LoRAs.');
    return selected.map((selection) => {
      const entry = this.all().find(
        (e) => e.id === selection.id && e.revision === selection.revision,
      );
      if (!entry || entry.enabled === false || entry.route !== route)
        throw Error(
          'LoRA version or model variant does not match this request, or the adapter is disabled.',
        );
      if (mode === 'sfw' && entry.availability === 'spicy')
        throw Error('This LoRA is unavailable for this request.');
      if (!Number.isFinite(selection.scale) || selection.scale < 0 || selection.scale > 4)
        throw Error('LoRA strength must be between 0 and 4.');
      return { ...entry, scale: selection.scale };
    });
  }
}
