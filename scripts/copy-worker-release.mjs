import {mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
const destination=path.join(process.argv[2]??'dist','worker');
await mkdir(destination,{recursive:true});
for(const name of ['models-image.json','models-video.json','releases.json','resolutions.json'])await copyFile('worker/'+name,path.join(destination,name));
