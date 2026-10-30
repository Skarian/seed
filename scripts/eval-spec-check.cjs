// Deterministic checks of request prompts against the official Krea 2 / MiniMax H3 prompting rules.
const path=require('path');const runs=process.argv.slice(2).flatMap(f=>require(path.resolve(f)).results);
const sentences=t=>t.trim()==='N/A'?0:(t.match(/[^.!?]+[.!?]+/g)||[t]).length;
const fails={},count={};const bump=(k,ok)=>{count[k]=(count[k]||0)+1;if(!ok)fails[k]=(fails[k]||0)+1;};
for(const s of runs)for(const t of s.turns)for(const c of t.cards){const p=c.prompt,w=p.split(/\s+/).length;
 if(c.workflow==='text-to-image'){
  bump('Krea: one paragraph',!/\n\s*\n/.test(p.trim()));
  bump('Krea: starts with subject, not "image of/photo shows"',!/^(an? )?(image|picture|photo)( of| shows)|^(this|the) (image|photo)/i.test(p));
  bump('Krea: 100-230 words',w>=100&&w<=230);
  bump('Krea: no negative phrasing (no/without/avoid)',!/\b(no|without|avoid|don't|never)\b/i.test(p));
  bump('Krea: no filler (8k/masterpiece/best quality)',!/\b(8k|4k|masterpiece|best quality|highly detailed|ultra[- ]detailed)\b/i.test(p));
  bump('Krea: names lighting',/\blight|lit\b|glow|sun|lamp/i.test(p));
  bump('Krea: names camera/framing',/\b(shot|close-up|angle|lens|mm\b|framing|frame|depth of field|perspective|vantage|composition)/i.test(p));
  bump('Krea: names medium/style',/\b(photograph|photo|film|illustration|painting|render|watercolor|digital art|poster|graphic)/i.test(p));
 } else {
  const f=['integrated_multimodal_description:','overall_soundscape:','non_diegetic_music:'].map(k=>p.indexOf(k));
  bump('H3: three fields in order',f.every(i=>i>=0)&&f[0]<f[1]&&f[1]<f[2]);
  const body=p.slice(f[0],f[1]),dur=c.output?.duration_seconds??5;
  bump('H3: [Shot 1] untimed',/\[Shot 1\](?!\s*At)/.test(body));
  const times=[...body.matchAll(/\[Shot \d+\]\s*At (\d\d):(\d\d)\.(\d{3})/g)].map(m=>+m[1]*60+ +m[2]+ +m[3]/1000);
  const cuts=(body.match(/\[Shot \d+\]/g)||[]).length-1;
  bump('H3: later shots timed MM:SS.mmm, increasing, within duration',times.length===cuts&&times.every((x,i)=>x<dur&&(i===0||x>times[i-1])));
  const bw=body.split(/\s+/).length,target=dur<=5?[220,300]:dur<=10?[300,400]:[350,500];
  bump('H3: description within 80% of length target',bw>=target[0]*0.8);
  const d=[...p.matchAll(/<d>(.*?)<\/d>/g)];bump('H3: dialogue tags well formed',d.every(m=>/^\[[A-Za-z]+\] /.test(m[1]))&&(p.match(/<d>/g)||[]).length===(p.match(/<\/d>/g)||[]).length);
  const sc=p.slice(f[1]+19,f[2]),mu=p.slice(f[2]+19);
  bump('H3: soundscape 1-4 sentences',sentences(sc)>=1&&sentences(sc)<=4);
  bump('H3: music 1-3 sentences or N/A',mu.trim()==='N/A'||sentences(mu)<=3);
 }}
for(const k of Object.keys(count))console.log(`${(count[k]-(fails[k]||0))}/${count[k]}`.padEnd(7),k);
