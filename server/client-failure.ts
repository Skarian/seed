import type {FastifyInstance} from 'fastify';
import {validClientFailure} from '../shared/client-failure.js';
import type {Diagnostics} from './diagnostics.js';

export const clientFailurePath = '/api/v1/diagnostics/client-failure';
export function registerClientFailures(app: FastifyInstance, diagnostics: Diagnostics) {
  let windowStart = 0, received = 0;
  const seen = new Set<string>();
  app.post(clientFailurePath, {bodyLimit:1024,
    // Parser/validation errors must never pass their original message/body into general diagnostics.
    errorHandler: (_error,_request,reply)=>reply.code(400).send({error:{code:'invalid_diagnostic',message:'Invalid diagnostic event.'}})
  }, async (request,reply) => {
    const now = Date.now();
    if (now - windowStart >= 60_000) {windowStart=now;received=0;seen.clear();}
    if (++received > 30) return reply.code(429).send({error:{code:'diagnostic_limit',message:'Diagnostic limit reached.'}});
    if (!validClientFailure(request.body)) return reply.code(400).send({error:{code:'invalid_diagnostic',message:'Invalid diagnostic event.'}});
    const value=request.body;
    // Reconstruct in fixed order for deduplication; never retain the request object.
    const data={kind:value.kind,error_class:value.error_class,route:value.route,build:value.build,
      frame:value.frame?{asset:value.frame.asset,line:value.frame.line,column:value.frame.column}:undefined};
    const key=JSON.stringify(data);
    if (!seen.has(key)) {seen.add(key);diagnostics.event({category:'client',operation:'screen_failure',level:'error',data});}
    return reply.code(204).send();
  });
}
