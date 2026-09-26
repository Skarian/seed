import path from 'node:path';
import type {StudioPaths} from './storage.js';
import {credentialFields,credentialStatus,storedCredentials} from './credential-store.js';
// Setup is deliberately keyless. Admin owns credential entry and replacement.
export async function ensureCredentials(paths:StudioPaths,_options?:unknown) {
  storedCredentials(paths);
  return {file:path.join(paths.config,'credentials.json'),credentials:credentialStatus(paths)};
}
export function webServerEnvironment(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
  const allowed=new Set([...Object.values(credentialFields),'CIVITAI_API_TOKEN']);
  return Object.fromEntries(Object.entries(env).filter(([name])=>allowed.has(name.toUpperCase())||!(/_(KEY|TOKEN|SECRET|PASSWORD)$/i.test(name)||/^(TAILSCALE_|TS_)/i.test(name))));
}
