import type { FastifyInstance } from 'fastify';
import type { StudioPaths } from './storage.js';
import type { Jobs } from './jobs.js';
import type { LoraImports } from './lora-imports.js';
import type { Pricing } from './pricing.js';
import {
  credential,
  credentialStatus,
  saveCredential,
  type CredentialField,
  credentialFields,
} from './credential-store.js';
import { FalError } from './fal-errors.js';
const modeQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { mode: { enum: ['sfw', 'nsfw'] } },
};
export function registerAdmin(
  app: FastifyInstance,
  paths: StudioPaths,
  jobs: Jobs,
  imports: LoraImports,
  pricing: Pricing,
  fetcher: typeof fetch = fetch,
) {
  const handle =
    (fn: (r: any) => unknown, status = 200) =>
    async (r: any, reply: any) => {
      try {
        return reply.code(status).send(await fn(r));
      } catch (e) {
        const error = e as Error;
        return reply
          .code(409)
          .send({
            error:
              e instanceof FalError
                ? e.issue
                : { code: 'admin_error', message: error.message, retryable: false },
          });
      }
    };
  app.get('/api/v1/admin', async () => ({
    credentials: credentialStatus(paths),
    storage: { config: paths.config, data: paths.data },
  }));
  app.patch(
    '/api/v1/admin/credentials/:field',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['value'],
          properties: {
            value: { anyOf: [{ type: 'string', minLength: 1, maxLength: 4096 }, { type: 'null' }] },
          },
        },
      },
    },
    handle((r) =>
      jobs.serialize(async () => {
        const field = r.params.field as CredentialField;
        if (!Object.hasOwn(credentialFields, field)) throw Error('Unknown credential.');
        if (
          field === 'falKey' &&
          (imports.busy() || jobs.all().some((j) => ['uploading', 'submitting'].includes(j.state)))
        )
          throw Error('Wait for uploads and submissions to finish before changing the fal key.');
        const before = credential(paths, field);
        saveCredential(paths, field, r.body.value);
        if (field === 'falKey' && before !== credential(paths, field)) {
          jobs.resetUploads();
          pricing.clear();
        }
        return { credentials: credentialStatus(paths) };
      }),
    ),
  );
  app.post(
    '/api/v1/admin/credentials/:field/check',
    handle(async (r) => {
      const field = r.params.field as CredentialField;
      if (!Object.hasOwn(credentialFields, field)) throw Error('Unknown credential.');
      const key = credential(paths, field);
      if (!key) throw Error('Save a key first.');
      const url =
        field === 'falKey'
          ? 'https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/krea-2/turbo'
          : field === 'openrouterApiKey'
            ? 'https://openrouter.ai/api/v1/key'
            : 'https://civitai.com/api/v1/me';
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { Authorization: (field === 'falKey' ? 'Key ' : 'Bearer ') + key },
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw Error('Could not reach the provider. Check your connection and try again.');
      }
      await response.body?.cancel();
      if (!response.ok)
        throw Error(
          response.status === 401 || response.status === 403
            ? 'The provider did not accept this key or its permissions.'
            : 'The provider could not validate the key right now. Try again later.',
        );
      return { valid: true };
    }),
  );
  app.get(
    '/api/v1/admin/loras',
    { schema: { querystring: modeQuery } },
    handle((r) => ({ items: jobs.loras.groups(r.query.mode ?? 'sfw') })),
  );
  app.patch(
    '/api/v1/admin/loras/:id',
    handle((r) => imports.edit(r.params.id, r.body), 202),
  );
  app.post(
    '/api/v1/admin/loras/inspect',
    {
      schema: {
        body: {
          type: 'object',
          required: ['url'],
          additionalProperties: false,
          properties: { url: { type: 'string', maxLength: 2048 } },
        },
      },
    },
    handle((r) => imports.inspect(r.body.url)),
  );
  app.post(
    '/api/v1/admin/loras/import',
    handle((r) => imports.add(r.body), 202),
  );
  app.get(
    '/api/v1/lora-imports',
    { schema: { querystring: modeQuery } },
    handle((r) => ({ items: imports.list(r.query.mode ?? 'sfw') })),
  );
  app.post(
    '/api/v1/lora-imports/:id/retry',
    handle((r) => imports.retry(r.params.id), 202),
  );
}
