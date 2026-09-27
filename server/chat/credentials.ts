import type {StudioPaths} from '../storage.js';
import {credential} from '../credential-store.js';
export function chatCredential(paths:StudioPaths,env:NodeJS.ProcessEnv=process.env){
  return credential(paths,'openrouterApiKey',env);
}
