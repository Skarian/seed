import sharp from 'sharp';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]??'.local/agent-ui-browser-v1');
const results=JSON.parse(readFileSync(path.join(root,'results.json'),'utf8')).sort((a,b)=>a.id.localeCompare(b.id));
for(const stage of ['composer','history','review']){
 const width=480,height=390,columns=5,tiles=[];
 for(let index=0;index<results.length;index++){
  const result=results[index],file=path.join(root,result.id,stage+'.png');if(!existsSync(file))continue;
  const title=Buffer.from(`<svg width="480" height="24"><rect width="480" height="24" fill="#20261d"/><text x="10" y="17" font-family="Arial" font-size="13" fill="#d7e4bd">${result.id}</text></svg>`);
  const thumb=await sharp(file).resize(width,height-24,{fit:'contain',background:'#151914'}).toBuffer();
  tiles.push({input:title,left:index%columns*width,top:Math.floor(index/columns)*height},{input:thumb,left:index%columns*width,top:Math.floor(index/columns)*height+24});
 }
 await sharp({create:{width:columns*width,height:Math.ceil(results.length/columns)*height,channels:3,background:'#151914'}}).composite(tiles).png().toFile(path.join(root,stage+'-mosaic.png'));
}
