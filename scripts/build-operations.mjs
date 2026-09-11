import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const target=path.resolve(root,'dist/operations');
if(!target.startsWith(path.resolve(root)+path.sep))throw Error('Build output leaves repository.');
await rm(target,{recursive:true,force:true});
await cp(path.join(root,'operations'),target,{recursive:true,filter:source=>!source.split(path.sep).includes('__pycache__') && !source.endsWith('.pyc')});
