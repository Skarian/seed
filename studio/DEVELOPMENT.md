# Developing and releasing Seed locally

Use Node 26.8.2–26.x, matching package.json and `.node-version`.

```sh
npm ci
npm run build
node dist/server/cli.js setup --provider vast
node dist/server/cli.js start
node dist/server/cli.js status
node dist/server/cli.js stop
```

Setup requires the selected provider key and Hugging Face token; Civitai and the
local model cache are optional. Use `--provider runpod` for RunPod. Setup remembers
choices and saves credentials privately outside the checkout. Stop the app before
changing configuration. No automatic sign-in startup is installed.

The default address is loopback port 4310. `setup --host LOCAL_IP` enables the
configured private LAN address for phone use. Resolve the current IP rather than
copying another user's address. Public hosting and network access configuration
are outside this repository's deployment scope.

## Isolation and checks

Set `STUDIO_DEV_ROOT` to an unused directory for test data. Also isolate APPDATA
for package tests. Never run fixtures against the owner's Library or credentials.
`npm start` runs a foreground server; CLI `start` manages a background process.
Do not use both against the same data directory/port.

```sh
npm run verify
npm run test:browser
npm run test:package -- /absolute/path/to/skarian-seed-0.1.0.tgz
```

`verify` builds/typechecks and runs app, operations, worker and secret checks.
Prepare `.local/worker-venv` from worker/requirements-test.txt, or set SEED_PYTHON.
Browser tests require Playwright Chromium. Package tests use an isolated archive
install. See scripts/verify.mjs and scripts/test-package.mjs for actual steps.
Paid provider tests require spending authorization and are separate from these.

## Package and installation

```sh
npm pack
npm install --global ./skarian-seed-0.1.0.tgz
seed version
seed start
```

Stop the installed app before replacing its package (Windows locks native modules).
The archive includes built server/shared/web/operations files. Building the checkout
alone does not update the installed app. Do not replace individual installed modules.
User media, SQLite, settings and cache remain outside the package in env-paths
locations retaining the internal name RunpodStudio. Uninstalling the package does
not remove that data. npm publication is deferred; use the archive, not npm's `seed`.

## Collaboration and durable notes

Ask the owner for UI/product choices and visual acceptance. Execute agreed coding,
regression tests, diagnostic collection and bounded recovery without redundant
check-ins. Ask before new spending outside existing authorization. Report material
findings, failures and the next checkpoint during sustained work.

Keep current decisions in the owning specification, remaining work in TODO.md,
and measured evidence in VALIDATION.md. Historical investigations belong in
research/, not appended as conflicting instructions. Commit coherent tested changes
at milestones. Preserve unrelated worktree changes. Update the installed package
when handing off a working change; publishing a worker image is needed only when
its runtime changes. Read [release rules](RELEASE-AND-INFRASTRUCTURE.md) before that.
