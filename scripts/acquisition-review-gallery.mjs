import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const review=JSON.parse(await fs.readFile('research/acquisition-qualification-visual-review.json','utf8'));
const source=path.resolve('.local/acquisition-qualification',review.campaign,'screens');
const output=path.resolve('.local/worker-pool-atlas/acquisition-2026-09-23');
await fs.mkdir(output,{recursive:true});
const escape=s=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
for(const c of review.captures){if(!c.reviewed)throw Error('Review first: '+c.file);await fs.copyFile(path.join(source,c.file),path.join(output,c.file));}
const sheets=[];
for(const device of ['desktop','mobile']){
 const captures=review.captures.filter(c=>c.device===device),tileW=device==='desktop'?600:340,tileH=device==='desktop'?490:800;
 for(let i=0;i<captures.length;i+=4){
  const group=captures.slice(i,i+4),layers=[],width=tileW*2,height=tileH*Math.ceil(group.length/2);
  for(let j=0;j<group.length;j++){
   const c=group[j],left=j%2*tileW,top=Math.floor(j/2)*tileH;
   const title=Buffer.from(`<svg width="${tileW}" height="62"><rect width="100%" height="100%" fill="#171b15"/><text x="14" y="24" fill="#d6ed9b" font-family="Arial" font-size="17">${escape(c.file.slice(0,3)+' · '+c.result)}</text><text x="14" y="48" fill="white" font-family="Arial" font-size="14">${escape(c.title)}</text></svg>`);
   const img=await sharp(path.join(source,c.file)).resize(tileW-20,tileH-76,{fit:'contain',background:'#11150f'}).png().toBuffer();
   layers.push({input:title,left,top},{input:img,left:left+10,top:top+65});
  }
  const filename=`mosaic-${device}-${Math.floor(i/4)+1}.png`;await sharp({create:{width,height,channels:3,background:'#11150f'}}).composite(layers).png().toFile(path.join(output,filename));sheets.push(filename);
 }
}
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Seed — real acquisition review</title><style>body{margin:30px auto;max-width:1400px;padding:0 18px;background:#171b15;color:#edf0e6;font:16px/1.5 system-ui}a{color:#d6ed9b}h1{font-size:28px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}figure{margin:0;background:#22291b;padding:14px;border:1px solid #45523b;border-radius:14px}img{width:100%;height:300px;object-fit:contain;background:#11150f}figcaption{margin-top:10px}small{display:block;color:#bbc5af}.mosaics img{height:auto}</style><h1>Real acquisition review · 23 September 2026</h1><p>Every capture was reviewed individually. Click an image for its full resolution. These are actual live journeys, not simulated screenshots.</p><h2>Numbered captures</h2><div class="grid">${review.captures.map(c=>`<figure><a href="${c.file}"><img loading="lazy" src="${c.file}" alt="${escape(c.title)}"></a><figcaption><strong>${c.file.slice(0,3)} · ${escape(c.title)}</strong><small>${c.device} · ${c.result}${c.note?' · '+escape(c.note):''}</small></figcaption></figure>`).join('')}</div><h2>Mosaics for navigation</h2><div class="grid mosaics">${sheets.map(s=>`<figure><a href="${s}"><img loading="lazy" src="${s}" alt="${s}"></a></figure>`).join('')}</div></html>`;
await fs.writeFile(path.join(output,'index.html'),html);await fs.writeFile(path.join(output,'review.json'),JSON.stringify(review,null,2));
console.log(JSON.stringify({output,captures:review.captures.length,sheets:sheets.length}));
