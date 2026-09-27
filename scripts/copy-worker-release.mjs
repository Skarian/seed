import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist/worker',{recursive:true});
for(const name of ['models-image.json','models-video.json','releases.json'])await copyFile('worker/'+name,'dist/worker/'+name);
