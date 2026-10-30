// Compact per-scenario summary of an eval run: replies-to-first-card and prompt word counts.
const r=require(require('path').resolve(process.argv[2])).results;
for(const s of r){if(s.error){console.log('#'+s.id,'ERROR',s.error);continue;}
 console.log('#'+s.id+(s.holdout?'(H)':''),s.turns.map(t=>(t.answer?'a:':'')+(t.cards.length?t.cards.map(c=>c.prompt.split(/\s+/).length+'w').join('/'):(t.error?'ERR':'-'))).join(' '));}
