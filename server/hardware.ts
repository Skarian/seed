import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export type HardwareProfile={id:string;label:string;gpu:string;vram_gb:number;ram_gb:number;manifest:string;
  models:{video:string;text_encoder:string;video_vae:string;audio_vae:string};
  attention:{tau:number;start_percent:number;end_percent:number;dense_blocks:string;min_tokens:number;extra_tokens:number;sink_conditioning:string}};
export type EngineSpec={revision:string;packages:Record<string,string>;flags:string[]};

const worker=(name:string)=>JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../worker',name),'utf8'));
export const engineSpec=():EngineSpec=>worker('engine.json');
export const hardwareProfiles=():HardwareProfile[]=>worker('hardware.json');
/** The profile for a detected GPU name. Undefined means this GPU has no video profile. */
export const hardwareProfile=(gpu:string)=>hardwareProfiles().find(profile=>new RegExp(profile.gpu,'i').test(gpu));
