// Unblinds judge scores. Usage: node scripts/eval/unblind.cjs key.json scores.json
const path=require('path'),k=require(path.resolve(process.argv[2])),s=require(path.resolve(process.argv[3]));
const name={X:path.basename(k.X,'.json'),Y:path.basename(k.Y,'.json')},tot={X:[],Y:[]};
for(const r of s){const m=k.key[r.id];const x=m.A==='X'?r.A:r.B,y=m.A==='X'?r.B:r.A;tot.X.push(x.overall);tot.Y.push(y.overall);
 console.log('#'+r.id,name.X,x.overall,'|',name.Y,y.overall);}
const avg=a=>(a.reduce((p,c)=>p+c,0)/a.length).toFixed(2);console.log('MEAN',name.X,avg(tot.X),'|',name.Y,avg(tot.Y));
