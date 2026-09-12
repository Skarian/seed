import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

// Retain the configuration filename so existing disposable rentals can reconnect.
// Old volume/template fields are ignored; they no longer authorize any operation.
export function podEnvironment(paths) {
  const file = path.join(paths.config, 'pod-deployment.json');
  try {
    writeFileSync(file, JSON.stringify({version:1,
      pairingSecret:randomBytes(32).toString('base64url'),
      jupyterToken:randomBytes(32).toString('base64url')}, null, 2),
    {flag:'wx', mode:0o600});
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if(value.version !== 1 || !/^[\w-]{43}$/.test(value.pairingSecret) || !/^[\w-]{43}$/.test(value.jupyterToken))
    throw Error('Invalid pod-deployment.json; repair it before continuing.');
  return {SEED_PAIRING_SECRET:value.pairingSecret, JUPYTER_TOKEN:value.jupyterToken};
}
