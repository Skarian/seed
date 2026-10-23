import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { defaultPreferences, isResolutionSize, type GeneratePreferences } from '../shared/resolution.js';
import type { StudioPaths } from './storage.js';

const candidatesEnabled = () => process.env.SEED_QUALIFY_RESOLUTIONS === '1';
const preferencesFile = (paths: StudioPaths) => path.join(paths.config, 'generate-preferences.json');

class PreferencesError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function readGeneratePreferences(paths: StudioPaths, candidates = candidatesEnabled()): GeneratePreferences {
  let raw: string;
  try { raw = readFileSync(preferencesFile(paths), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaultPreferences };
    throw new PreferencesError(503, 'generate_preferences_unavailable', 'Cannot read remembered resolutions. Try again.');
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    const pair = value as Record<string, unknown>;
    if (Object.keys(pair).length !== 2 || !isResolutionSize('image', pair.image, candidates) || !isResolutionSize('video', pair.video, candidates)) throw Error();
    return pair as GeneratePreferences;
  } catch {
    throw new PreferencesError(503, 'generate_preferences_unavailable', 'Repair generate-preferences.json before remembering another resolution.');
  }
}

export function saveGeneratePreferences(paths: StudioPaths, change: unknown, candidates = candidatesEnabled()): GeneratePreferences {
  if (!change || typeof change !== 'object' || Array.isArray(change))
    throw new PreferencesError(400, 'invalid_generate_preferences', 'Supply only the image or video selection that changed.');
  const keys = Object.keys(change), family = keys[0];
  if (keys.length !== 1 || (family !== 'image' && family !== 'video') || !isResolutionSize(family, (change as Record<string, unknown>)[family], candidates))
    throw new PreferencesError(400, 'invalid_generate_preferences', 'Supply one supported image or video selection.');

  // Synchronous read/merge/rename cannot interleave in the installation's single
  // server coordinator. Each commit reads the latest pair, including other-family writes.
  const preferences = { ...readGeneratePreferences(paths, candidates), ...change } as GeneratePreferences;
  const file = preferencesFile(paths), temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(preferences, null, 2) + '\n', { flag: 'wx' });
    renameSync(temporary, file);
  } catch {
    throw new PreferencesError(503, 'generate_preferences_save_failed', 'Selection not remembered. Try again.');
  } finally {
    try { unlinkSync(temporary); } catch { /* Renamed or unavailable; the saved pair is untouched on failure. */ }
  }
  return preferences;
}

export function registerGeneratePreferences(app: FastifyInstance, paths: StudioPaths) {
  const result = (reply: FastifyReply, requestId: string, action: (candidates: boolean) => GeneratePreferences) => {
    try {
      const candidates = candidatesEnabled();
      return { preferences: action(candidates), candidates };
    } catch (error) {
      if (!(error instanceof PreferencesError)) throw error;
      return reply.code(error.status).send({ error: { code: error.code, message: error.message, retryable: error.status === 503 }, request_id: requestId });
    }
  };
  app.get('/api/v1/generate-preferences', async (request, reply) => result(reply, request.id, candidates => readGeneratePreferences(paths, candidates)));
  app.patch('/api/v1/generate-preferences', async (request, reply) => result(reply, request.id, candidates => saveGeneratePreferences(paths, request.body, candidates)));
}
