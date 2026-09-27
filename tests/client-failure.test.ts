import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import {clientFailure} from '../web/client-failure.js';
import {validClientFailure} from '../shared/client-failure.js';
import {registerClientFailures,clientFailurePath} from '../server/client-failure.js';
import {Diagnostics} from '../server/diagnostics.js';
import {openDatabase} from '../server/db.js';
import {prepareStorage,resolvePaths} from '../server/storage.js';

it('allows only first-party frame coordinates, whitelisted classes and route enums',()=>{
  const error=new TypeError('private prompt https://seed.test/assets/private-message.js:1:2');
  error.stack+='\n    at render (https://seed.test/assets/chat-abc123.js:27:91)';
  const value=clientFailure(error,'render',{origin:'https://seed.test',pathname:'/chat'},'https://seed.test/assets/index-build.js');
  expect(value).toEqual({kind:'render',error_class:'TypeError',route:'chat',build:'index-build.js',frame:{asset:'chat-abc123.js',line:27,column:91}});
  expect(validClientFailure(value)).toBe(true);
  expect(JSON.stringify(value)).not.toMatch(/private|prompt|https:/);
  const multiline=new Error('private\n    at https://seed.test/assets/PRIVATE_FIXTURE_TEXT.js:10:20');
  multiline.stack=`Error: ${multiline.message}\n    at render (https://seed.test/assets/chat-real.js:20:30)`;
  expect(clientFailure(multiline,'render',{origin:'https://seed.test',pathname:'/chat'}).frame).toEqual({asset:'chat-real.js',line:20,column:30});
  for(const frame of ['https://external.test/assets/chat-a.js:2:3','https://seed.test/assets/chat-a.js?secret:2:3','https://seed.test/private/chat.js:2:3']){
    error.stack=`TypeError: secret\n    at render (${frame})`;error.name='my-private-prompt';
    expect(clientFailure(error,'async',{origin:'https://seed.test',pathname:'/secret'})).toEqual({kind:'async',error_class:'Unknown',route:'unknown'});
  }
  expect(clientFailure('private rejection','async',{origin:'https://seed.test',pathname:'/'})).toEqual({kind:'async',error_class:'Unknown',route:'generate'});
});

it('rejects messages, IDs, arbitrary class names, invalid assets and coordinates',()=>{
  const good={kind:'render',error_class:'TypeError',route:'chat'};
  for(const extra of [{message:'secret'},{stack:'secret'},{chat_id:'123'},{build:'../secret.js'},{error_class:'private'},{route:'/chat?id=private'},{frame:{asset:'chat-a.js',line:-1,column:2}},{frame:{asset:'chat-a.js',line:2,column:1,prompt:'secret'}}])expect(validClientFailure({...good,...extra})).toBe(false);
});

it('persists only bounded evidence, deduplicates and limits events',async()=>{
  mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/client-failure-')),paths=resolvePaths(root);prepareStorage(paths);
  const db=openDatabase(paths.data),app=Fastify(),diagnostics=new Diagnostics(db,paths);
  registerClientFailures(app,diagnostics);
  const send=(payload:unknown)=>app.inject({method:'POST',url:clientFailurePath,payload:payload as any});
  const good={kind:'render',error_class:'TypeError',route:'chat'};
  try{
    expect((await send(good)).statusCode).toBe(204);
    expect((await send({route:'chat',kind:'render',error_class:'TypeError'})).statusCode).toBe(204);
    expect((await send({...good,message:'secret'})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:clientFailurePath,headers:{'content-type':'application/json'},payload:'{"private sentinel'})).statusCode).toBe(400);
    expect((await send({...good,build:'x'.repeat(1500)})).statusCode).toBe(400);
    for(let i=0;i<40;i++)await send({...good,frame:{asset:'chat-x.js',line:i+1,column:1}});
    expect((await send(good)).statusCode).toBe(429);
    const rows=db.prepare('SELECT data_json FROM diagnostic_events').all() as {data_json:string}[];
    expect(rows.length).toBeLessThanOrEqual(30);expect(rows.filter(r=>!JSON.parse(r.data_json).frame)).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/secret|sentinel|message|stack/);
  }finally{await app.close();db.close();rmSync(root,{recursive:true,force:true});}
});
