# Development

Node 26.8.2+ in the 26.x line is required. No Python, Docker, SSH, or GPU is needed.

```powershell
npm ci --cache .local/npm-cache
npm run verify
$env:STUDIO_DEV_ROOT = 'profile:fal-only'
node --env-file=.env.fal dist/server/cli.js setup --port 4315
node dist/server/cli.js start
```

Use the existing ignored `.env.fal` for FAL_KEY. Never commit keys or upload URLs.
The normal setup optionally configures chat; `seed setup --chat-only` changes only
chat credentials. Editable chat prompts stay in the user's config directory.

Admin → Credentials manages fal, OpenRouter, and Civitai keys.
Admin → LoRAs imports from Civitai and uploads before enabling the adapter.
Local CLI adapters are imported with `seed loras add FILE image|fl|ref NAME`. Local imports
are safe to inspect without uploading or paying for a model run. The first job
that explicitly selects an adapter uploads it; `seed loras upload ID` preloads it.
All imported adapters initially display as untested on fal.

Checks:

- `npm run verify`: build, TypeScript, unit/integration tests using fake fal transport.
- `npm run test:browser`: current generation, chat, reference, and sequence UI.
  The runner creates an isolated database and replaces all provider operations with offline fixtures.
  It generates its small media fixture locally and closes the server on exit.
- `npm pack --cache .local/npm-cache`: package build.
- `npm run test:package -- PACKAGE.tgz`: isolated installation and lifecycle checks.

Keep completed spike measurements as research, not executable application code.
Do not spend model credits in automated tests. A live LoRA compatibility run must
record the actual endpoint, adapter hash, strength, seed, request ID, and result.

Historical notes under `research/archive/` describe retired implementations;
they do not define the current contract. Default data paths use `Seed`. This
branch requires a fresh schema; do not point it at another installation’s data.

The active worktree profile uses `%APPDATA%/Seed/Config/profiles/fal-only` and
`%LOCALAPPDATA%/Seed/Data/profiles/fal-only`. The prior `.local/fal-studio` copy
is an inactive backup. The installed main app's default profile is separate.
The worktree is reachable at `http://192.168.1.212:4315/`.

For manual Chrome QA with no provider charges, start `scripts/browser-server.mjs`
with a disposable `STUDIO_DEV_ROOT`; optional `SEED_QA_HOST` and `SEED_QA_PORT`
set its address. All three providers are injected fakes; they never fall back to
network calls. Generated fixture images are solid colors, not quality samples.
