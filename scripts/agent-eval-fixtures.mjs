import {mkdirSync,writeFileSync,copyFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import sharp from 'sharp';

const require=createRequire(import.meta.url);
export const assetDefinitions=[
  {id:'eval-subject',kind:'image',name:'Yellow sphere',note:'The subject is a yellow sphere on a dark green background.',extension:'png'},
  {id:'eval-scene',kind:'image',name:'Blue triangle',note:'A blue triangle on a pale background. Use as the destination or scene.',extension:'png'},
  {id:'eval-motion',kind:'video',name:'Moving test pattern',note:'A synthetic motion reference with a 440 Hz soundtrack. Select the requested time range.',extension:'mp4'},
  {id:'eval-sound',kind:'audio',name:'Separate tone',note:'A separate synthetic 660 Hz reference tone.',extension:'wav'},
];

/** Real decodable fixtures; never mislabel PNG bytes as video or audio. */
export async function createFixtures(directory){
  mkdirSync(directory,{recursive:true});
  for(const [index,asset] of assetDefinitions.filter(a=>a.kind==='image').entries()){
    const shape=index?'<polygon points="128,40 216,210 40,210" fill="#2069db"/>':'<circle cx="128" cy="128" r="70" fill="#f5cb42"/>';
    await sharp({create:{width:256,height:256,channels:3,background:index?'#edf1ea':'#18442d'}})
      .composite([{input:Buffer.from(`<svg width="256" height="256">${shape}</svg>`)}]).png().toFile(path.join(directory,asset.id+'.png'));
  }
  const ffmpeg=require('ffmpeg-static');
  const common=['-hide_banner','-loglevel','error','-nostdin','-y'];
  execFileSync(ffmpeg,[...common,'-f','lavfi','-i','testsrc2=size=256x144:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=32000','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',path.join(directory,'eval-motion.mp4')],{windowsHide:true,timeout:60000,stdio:'pipe'});
  execFileSync(ffmpeg,[...common,'-f','lavfi','-i','sine=frequency=660:sample_rate=32000','-t','6','-c:a','pcm_s16le',path.join(directory,'eval-sound.wav')],{windowsHide:true,timeout:60000,stdio:'pipe'});
  const ffprobe=require('ffprobe-static').path;
  const manifest=assetDefinitions.map(asset=>{
    const file=path.join(directory,asset.id+'.'+asset.extension);
    const probe=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-show_format','-of','json',file],{windowsHide:true,timeout:30000,encoding:'utf8'}));
    if(!probe.streams.some(s=>s.codec_type===(asset.kind==='audio'?'audio':'video')))throw Error('Fixture stream missing: '+asset.id);
    return {...asset,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),probe};
  });
  writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
  return manifest;
}

export function registerFixtures(directory,paths,db,mode){
  for(const asset of assetDefinitions){
    const relative='media/originals/'+asset.id+'.'+asset.extension;
    copyFileSync(path.join(directory,asset.id+'.'+asset.extension),path.join(paths.data,relative));
    const bytes=readFileSync(path.join(paths.data,relative));
    const metadata={mode,state:'ready',mime_type:asset.kind==='image'?'image/png':asset.kind==='video'?'video/mp4':'audio/wav',
      sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,
      ...(asset.kind==='image'?{width:256,height:256}:{duration:6,has_audio:true,has_video:asset.kind==='video',...(asset.kind==='video'?{width:256,height:144}:{})})};
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(asset.id,asset.kind,asset.name,relative,JSON.stringify(metadata),'2026-01-01T00:00:00Z');
    db.prepare('INSERT INTO asset_notes(id,note,revision) VALUES (?,?,1)').run(asset.id,asset.note);
  }
}

/** Explicit opt-in public-photo fixtures. Never reads the owner's Library. */
export async function registerPhotoFixtures(fixtures,paths,db,mode){
  const evidence=[];
  for(const asset of fixtures??[]){
    if(asset.kind!=='image'||!/^[-\w]{1,100}$/.test(asset.id))throw Error('Photo fixtures require a safe id and image kind.');
    const source=path.resolve(asset.sourcePath),bytes=readFileSync(source);
    const info=await sharp(bytes).metadata();
    if(!info.width||!info.height)throw Error('Unreadable public photo fixture: '+asset.id);
    const extension=info.format==='jpeg'?'jpg':info.format==='png'?'png':undefined;
    if(!extension)throw Error('Photo fixture must be JPEG or PNG.');
    const relative='media/originals/'+asset.id+'.'+extension;
    copyFileSync(source,path.join(paths.data,relative));
    const metadata={mode,state:'ready',mime_type:extension==='jpg'?'image/jpeg':'image/png',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,width:info.width,height:info.height};
    db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(asset.id,'image',asset.name,relative,JSON.stringify(metadata),'2026-01-01T00:00:00Z');
    db.prepare('INSERT INTO asset_notes(id,note,revision) VALUES (?,?,1)').run(asset.id,asset.note??'');
    evidence.push({...asset,sourcePath:source,metadata});
  }
  if(evidence.length)writeFileSync(path.join(paths.data,'photo-fixtures.json'),JSON.stringify(evidence,null,2));
}
