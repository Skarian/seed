import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const require=createRequire(import.meta.url);
export const inspectionCases=[{
 id:'inspection-transient-later-clip-v1',category:'inspection',lane:'transient-frame',workflow:'reference-to-video',mode:'sfw',fixtureVersion:'transient-square-v1',assets:['eval-transient'],
 create:'The supplied six-second reference clip contains a brief event that its overview frames may miss. Use read_input to inspect source seconds 1–2 before preparing the request; do not guess from the overview. Use the visible object and its actual color as the subject of an eight-second stop-motion scene on a white tabletop. During0–3 seconds it moves slowly toward camera right, during3–5 it pauses, during5–8 it returns left. Preserve its shape and color. No people, text, extra objects, sound or camera motion. Attach the supplied video as a general reference using source0–3 seconds, source audio OFF. Output length8seconds, fast quality, native size,16:9, batch size1, seed617, output format video, output audio silent. Prepare one request for review; do not generate.',
 expected:{workflow:'reference-to-video',mode:'sfw',seed:'617',count:1,quality:'fast',output:{aspect:'16:9',size:'native',duration_seconds:8,format:'video'},audio:{output:'silent'},references:[{asset_id:'eval-transient',kind:'video',role:'reference',include_audio:false,range:{start_seconds:0,duration_seconds:3}}]},
 expectedInspection:{asset_id:'eval-transient',start_seconds:1,duration_seconds:1,timestamps:[1,1.5,1.85]},
 requiresSemanticReview:true,semanticRubric:['Inspection reveals a RED SQUARE on grey, absent in overview0/3/5.85. Prompt must describe the square and red color based on read_input evidence, not guess sphere/triangle from other fixtures.','One square moves right0–3, pauses3–5, returnsleft5–8 without changing shape/color.','Fixed camera, white tabletop, silent output; no people/text/extraobjects.','Generation reference0–3 remains distinct from inspected1–2 interval.']
}];

export async function registerInspectionFixture(scenario,paths,db){
 if(scenario.fixtureVersion!=='transient-square-v1')return;
 const relative='media/originals/eval-transient.mp4',file=path.join(paths.data,relative);
 execFileSync(require('ffmpeg-static'),['-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-i','color=c=gray:s=256x144:r=20:d=6','-vf',"drawbox=x=98:y=42:w=60:h=60:color=red:t=fill:enable='gte(t,1)*lt(t,2)'",'-c:v','libx264','-pix_fmt','yuv420p',file],{windowsHide:true,timeout:30000,stdio:'pipe'});
 const bytes=readFileSync(file),metadata={mode:scenario.mode,state:'ready',mime_type:'video/mp4',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,width:256,height:144,duration:6,has_audio:false,has_video:true};
 db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run('eval-transient','video','Brief visual event',relative,JSON.stringify(metadata),'2026-01-01');
 db.prepare('INSERT INTO asset_notes(id,note,revision) VALUES (?,?,1)').run('eval-transient','A synthetic six-second source for visual inspection.');
 writeFileSync(path.join(paths.data,'inspection-fixture.json'),JSON.stringify({version:scenario.fixtureVersion,metadata,oracle:{shape:'square',color:'red',start:1,end:2}},null,2));
}
