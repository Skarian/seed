import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Operational helpers are shipped with the app, never resolved from a skill or cwd.
export async function gpuCommand(args: string[]): Promise<void> {
  const [provider, ...options] = args;
  if (!['vast', 'runpod'].includes(provider ?? '')) {
    throw new Error('Use seed gpu vast|runpod <command>.');
  }
  if (options.includes('--repo')) throw new Error('The installed Seed package selects its own runtime; --repo is not supported.');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const script = fileURLToPath(new URL(`../operations/${provider}.mjs`, import.meta.url));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...options, '--repo', root], {
      stdio: 'inherit', windowsHide: true, shell: false,
    });
    child.once('error', reject);
    child.once('exit', code => { if(code!==0)process.exitCode=code??1; resolve(); });
  });
}
