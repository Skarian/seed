import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc does not remove emitted modules when their source files are deleted.
// Only clear this repository's generated build directory, never runtime data.
const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const output = path.resolve(root, 'dist');
if (path.dirname(output) !== root || path.basename(output) !== 'dist') throw Error('Invalid build directory.');
if (existsSync(output)) {
  if (lstatSync(output).isSymbolicLink() || realpathSync(output) !== output) throw Error('Refusing to clean a redirected build directory.');
  rmSync(output, { recursive: true, force: true });
}
