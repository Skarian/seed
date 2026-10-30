// Builds a compact, blind A/B judging packet from two eval runs. Usage: node scripts/eval/judge-packet.cjs runA.json runB.json out.md key.json
const fs=require('fs'),path=require('path');
const [a,b,out,keyFile]=process.argv.slice(2);
const load=f=>Object.fromEntries(require(path.resolve(f)).results.map(s=>[s.id,s]));
const runs={X:load(a),Y:load(b)},key={},lines=['# Judge packet (blind). For each scenario score A and B independently with the rubric.\n'];
const fmt=s=>s.turns.map(t=>{
  const cards=t.cards.map(c=>`  CARD(${c.workflow}; count ${c.count}; ${c.output?.aspect??''}${c.output?.duration_seconds?'; '+c.output.duration_seconds+'s':''}${c.audio?'; audio '+JSON.stringify(c.audio):''}):\n  ${c.prompt.replace(/\n/g,'\n  ')}`).join('\n');
  return `- USER${t.answer?' (answer)':''}: ${t.user}\n  AGENT: ${(t.reply||'(empty)').replace(/\n+/g,' ')}${cards?'\n'+cards:''}${t.error?'\n  ERROR: '+t.error:''}`;}).join('\n');
for(const id of Object.keys(runs.X).map(Number).sort((x,y)=>x-y)){
  if(!runs.Y[id]||runs.X[id].error||runs.Y[id].error)continue;
  const flip=Math.random()<0.5;key[id]=flip?{A:'Y',B:'X'}:{A:'X',B:'Y'};
  const A=runs[key[id].A][id],B=runs[key[id].B][id];
  lines.push(`## Scenario ${id} (${A.workflow})\n### A\n${fmt(A)}\n### B\n${fmt(B)}\n`);
}
fs.writeFileSync(out,lines.join('\n'));fs.writeFileSync(keyFile,JSON.stringify({X:a,Y:b,key},null,1));
console.log('packet',out,fs.statSync(out).size,'bytes');
