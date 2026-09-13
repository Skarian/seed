import type { FastifyInstance } from 'fastify';
import type { Chats } from './service.js';
import type { ChatMode,ChatWorkflow } from '../../shared/chat.js';
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const version={type:'integer',minimum:0};
const text={type:'string',minLength:1,maxLength:16000};
export function registerChats(app:FastifyInstance,chats:Chats,configured:()=>boolean){
  const id=(request:any)=>String(request.params.id);
  const perform=(action:(request:any)=>unknown)=>async(request:any,reply:any)=>{try{return await action(request);}catch(e){return reply.code(409).send({error:{message:(e as Error).message}});}};
  app.get('/api/v1/chat-config',()=>({configured:configured()}));
  app.get('/api/v1/chats',{schema:{querystring:object({mode:{enum:['sfw','nsfw']}})}},perform(r=>({items:chats.list((r.query as {mode:ChatMode}).mode)})));
  app.post('/api/v1/chats',{schema:{body:object({mode:{enum:['sfw','nsfw']}})}},perform(r=>chats.create(r.body.mode)));
  app.get('/api/v1/chats/:id',perform(r=>chats.view(id(r))));
  app.patch('/api/v1/chats/:id',{schema:{body:object({version,title:{type:'string',minLength:1,maxLength:120},workflow:{enum:[null,'text-to-image','text-to-video','reference-to-video']},reasoning:{type:'boolean'}},['version'])}},perform(r=>chats.settings(id(r),r.body.version,r.body as {title?:string;workflow?:ChatWorkflow|null;reasoning?:boolean})));
  app.delete('/api/v1/chats/:id',perform(r=>{chats.delete(id(r));return {deleted:true};}));
  app.post('/api/v1/chats/:id/stop',{schema:{body:object({})}},perform(r=>chats.stop(id(r))));
  app.post('/api/v1/chats/:id/messages',{bodyLimit:256*1024,schema:{body:object({version,text,assets:{type:'array',maxItems:24,items:{type:'string'}},card_id:{type:'string'},revision:version},['version','text','assets'])}},perform(r=>chats.send(id(r),r.body)));
  app.post('/api/v1/chats/:id/cards/:card/decision',{schema:{body:object({revision:version,decision:{enum:['approved','denied']}})}},perform(r=>chats.decide(id(r),r.params.card,r.body.revision,r.body.decision)));
  app.post('/api/v1/chats/:id/cards/:card/revise',{bodyLimit:64*1024,schema:{body:object({revision:version,request:{type:'object'}})}},perform(r=>chats.revise(id(r),r.params.card,r.body.revision,r.body.request)));
  app.post('/api/v1/chats/:id/cards/:card/restore',{bodyLimit:64*1024,schema:{body:object({revision:version,request:{type:'object'}})}},perform(r=>chats.restore(id(r),r.params.card,r.body.revision,r.body.request)));
  app.post('/api/v1/chats/:id/cards/:card/repeat',{schema:{body:object({revision:version,fresh:{type:'boolean'},failed_only:{type:'boolean'}},['revision','fresh'])}},perform(r=>chats.repeat(id(r),r.params.card,r.body.revision,r.body.fresh,r.body.failed_only)));
}
