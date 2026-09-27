import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import path from 'node:path';
import envPaths from 'env-paths';
const files=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
const known=[];
// Include the retired filename so an old local credential can never leak.
for(const file of ['.env','.env.fal'])if(existsSync(file))for(const [name,value] of Object.entries(parseEnv(readFileSync(file,'utf8'))))if(/key|token|secret/i.test(name)&&value.length>=16)known.push(value);
const config=process.env.STUDIO_DEV_ROOT?path.resolve(process.env.STUDIO_DEV_ROOT,'config'):envPaths('Seed',{suffix:''}).config;
const credentials=path.join(config,'credentials.json');
if(existsSync(credentials))for(const [name,value] of Object.entries(JSON.parse(readFileSync(credentials,'utf8'))))if(/key|token|secret/i.test(name)&&typeof value==='string'&&value.length>=16)known.push(value);
const variants=known.flatMap(v=>[v,Buffer.from(v).toString('base64'),encodeURIComponent(v)]);
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,/\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{30,}\b/];
let issues=0,checked=0;
for(const file of files){if(!existsSync(file))continue;const text=readFileSync(file,'utf8');checked++;if(variants.some(v=>text.includes(v))||patterns.some(p=>p.test(text))){console.error(file+': potential credential match (value withheld)');issues++;}}
console.log(`Checked ${checked} files; ${issues} potential credential matches.`);process.exitCode=issues?1:0;
