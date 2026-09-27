import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import {openDatabase} from '../server/db.js';
import {resolvePaths,prepareStorage} from '../server/storage.js';
import {Jobs} from '../server/jobs.js';
import {Chats} from '../server/chat/service.js';
import {fakePool} from './fake-pool.js';

it('a failed stream observer cannot turn a committed request into a failed tool save',async()=>{
 mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/save-notify-')),paths=resolvePaths(root);prepareStorage(paths);
 const db=openDatabase(paths.data),pool=fakePool(db,paths).pool;
 const jobs=new Jobs(db,paths,pool),chats=new Chats(db,paths,jobs);
 try{
  let chat=chats.create('sfw');chat=chats.settings(chat.id,chat.version,{workflow:'text-to-image',title:'Save fixture'});
  const internal=chats as any,current=internal.get(chat.id);
  const tools=internal.workflowTools(chat.id,current.epoch,'text-to-image','test-run',[]);
  const unsubscribe=chats.subscribe(chat.id,()=>{throw Error('Stream consumer disconnected');});
  let result:any,error:unknown;
  try{result=await tools[0].execute('save-once',{prompt:'A red fox in a forest.'});}catch(value){error=value;}
  unsubscribe();
  expect(chats.view(chat.id).groups.flatMap(g=>g.cards)).toHaveLength(1);
  expect(error).toBeUndefined();
  expect(result.details).toMatchObject({ok:true,saved:true,revision:1});
 }finally{await chats.close();db.close();rmSync(root,{recursive:true,force:true});}
});
