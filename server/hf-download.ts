import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir, totalmem } from 'node:os';
import path from 'node:path';

export function hfSource(url: string) {
  const source = new URL(url);
  const parts = source.pathname.slice(1).split('/');
  const [owner, repository, resolve, revision, ...rest] = parts;
  if (source.origin !== 'https://huggingface.co' || source.username || source.password || source.search || source.hash || resolve !== 'resolve' || !/^[a-f0-9]{40}$/.test(revision ?? '') || ![owner, repository].every(x => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(x ?? '')) || !rest.length || rest.some(x => !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(x) || x === '.' || x === '..')) {
    throw Error('Hugging Face models require a pinned repository, commit and safe filename.');
  }
  return { repository: `${owner}/${repository}`, revision: revision!, filename: rest.join('/') };
}
export function hfExecutable(env: NodeJS.ProcessEnv = process.env) {
  if (env.SEED_HF_CLI) return env.SEED_HF_CLI;
  const installed = path.join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'hf.exe' : 'hf');
  return existsSync(installed) ? installed : 'hf';
}
export function hfEnvironment(token: string, cache: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const hidden = /^(HF_TOKEN|HUGGING_FACE_HUB_TOKEN|HUGGINGFACE_TOKEN|CIVITAI_API_TOKEN|CIVITAI_TOKEN|RUNPOD_API_KEY|VAST_API_KEY|SEED_PAIRING_SECRET|JUPYTER_TOKEN)$/i;
  return {
    ...Object.fromEntries(Object.entries(env).filter(([name]) => !hidden.test(name))),
    HF_TOKEN: token,
    HF_HOME: cache,
    HF_ENDPOINT: 'https://huggingface.co',
    HF_HUB_DISABLE_XET: '0',
    HF_HUB_DISABLE_UPDATE_CHECK: '1',
    HF_HUB_DISABLE_PROGRESS_BARS: '1',
    HF_XET_CHUNK_CACHE_SIZE_BYTES: '0',
    // Use Xet's normal parallelism on smaller PCs rather than its large buffers.
    HF_XET_HIGH_PERFORMANCE: totalmem() >= 64 * 1024 ** 3 ? '1' : '0',
  };
}
export type HfRunner = (executable: string, args: string[], env: NodeJS.ProcessEnv) => Promise<void>;
const runHf: HfRunner = (executable, args, env) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { env, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostic = '';
  child.stderr.on('data', chunk => { if (diagnostic.length < 65536) diagnostic += chunk.toString(); });
  child.once('error', () => reject(Error('Hugging Face CLI could not start. Install hf from https://huggingface.co/docs/huggingface_hub/guides/cli or set SEED_HF_CLI to its executable.')));
  child.once('close', code => {
    if (code === 0) return resolve();
    // Upstream diagnostics may contain signed URLs. Expose only known status codes.
    const status = diagnostic.match(/\b(401|403|404|429)\b/)?.[1];
    reject(Error(`Hugging Face download failed${status ? ` (HTTP ${status})` : ''}. Its partial download is retained; rerun seed models to resume.`));
  });
});
export async function downloadHuggingFace(url: string, staging: string, token: string, cache: string, run: HfRunner = runHf) {
  const source = hfSource(url);
  await mkdir(staging, { recursive: true });
  await run(hfExecutable(), ['download', source.repository, source.filename, '--revision', source.revision, '--local-dir', staging, '--quiet'], hfEnvironment(token, cache));
  return path.join(staging, ...source.filename.split('/'));
}
