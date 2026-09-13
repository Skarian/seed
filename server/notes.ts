import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';

export function registerNotes(app: FastifyInstance, db: Database.Database) {
  const exists = (id: string) => Boolean(db.prepare('SELECT id FROM assets WHERE id=? UNION SELECT id FROM sequences WHERE id=?').get(id, id));
  const read = (id: string) => db.prepare('SELECT note,revision FROM asset_notes WHERE id=?').get(id) as {note:string;revision:number}|undefined;
  app.get('/api/v1/notes/:id', async (request, reply) => {
    const {id} = request.params as {id:string};
    if (!exists(id)) return reply.code(404).send({error:{message:'Media not found.'}});
    const own = read(id);
    const parent = db.prepare('SELECT sequence_id FROM sequence_frames WHERE asset_id=?').get(id) as {sequence_id:string}|undefined;
    return {...(own ?? {note:'',revision:0}), inherited: !own?.note && parent ? read(parent.sequence_id)?.note ?? '' : ''};
  });
  app.put('/api/v1/notes/:id', {schema:{body:{type:'object',additionalProperties:false,required:['note','revision'],properties:{note:{type:'string',maxLength:4000},revision:{type:'integer',minimum:0}}}}}, async (request, reply) => {
    const {id} = request.params as {id:string};
    const body = request.body as {note:string;revision:number};
    return db.transaction(() => {
      if (!exists(id)) return reply.code(404).send({error:{message:'Media not found.'}});
      if ((read(id)?.revision ?? 0) !== body.revision) return reply.code(409).send({error:{message:'This note changed elsewhere. Reopen it before editing.'}});
      const result = {note:body.note.trim(),revision:body.revision+1};
      db.prepare('INSERT INTO asset_notes VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET note=excluded.note,revision=excluded.revision').run(id,result.note,result.revision);
      return result;
    })();
  });
}
