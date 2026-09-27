import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';

const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
const forbiddenPaths=[
  /^research\//,
  /^studio\/TODO\.md$/,
  /^worker\/(?:build|publication)-evidence\.json$/,
];
const forbiddenText=[
  {label:'personal email address',pattern:/\b[A-Z0-9._%+-]+@(?:gmail|outlook|icloud)\.com\b/i},
  {label:'private IPv4 address',pattern:/\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})\b/},
  {label:'local user path',pattern:/(?:[A-Z]:\\Users\\[^\\\r\n]+\\|(?:^|[\s"'=(])\/(?:Users|home)\/[^/\r\n]+\/)/im},
  {label:'temporary private endpoint',pattern:/(?:trycloudflare\.com|ngrok(?:-free)?\.(?:app|io)|\.ts\.net)\b/i},
  {label:'private uploaded-media URL',pattern:/\bfal\.media\/files\//i},
];

let issues=0;
for(const file of files){
  if(!existsSync(file))continue; // Allow verification while tracked deletions are unstaged.
  if(forbiddenPaths.some(pattern=>pattern.test(file))){console.error(`${file}: private publication path`);issues++;continue;}
  const content=readFileSync(file);
  if(content.includes(0))continue;
  const text=content.toString('utf8');
  for(const check of forbiddenText)if(check.pattern.test(text)){console.error(`${file}: ${check.label}`);issues++;}
}
console.log(`Checked ${files.length} tracked files; ${issues} publication issue${issues===1?'':'s'}.`);
process.exitCode=issues?1:0;
