# Developing Seed

## Build and run

Use Node 26.8.2–26.x (see `.node-version` and package.json):

```sh
npm ci
npm run build
node dist/server/cli.js setup --provider vast
node dist/server/cli.js start
node dist/server/cli.js status
node dist/server/cli.js stop
```

Use `--provider runpod` for that deployment path. Setup remembers the provider,
requires only its key plus HF, and offers optional Civitai. Windows asks about
sign-in startup; `--startup`/`--no-startup` changes it. No service starts a GPU.
Setup must run with the local app stopped. Keys are masked, saved incrementally,
and retained when switching providers. See the README for environment variables.

Setup is local credential/configuration setup, not proof of provider or model
access. The agent checks access before rental. For Vast, the skill helper's
`setup` delegates to this flow then checks the Vast account. RunPod `pod-setup`
preflights models and creates/updates the private template and selected volume.

By default the app listens on http://127.0.0.1:4310. `setup --host LOCAL_IP` saves a
private LAN address for phone access; verify the actual address and firewall.
The user's development portal was configured at http://192.168.1.212:4310;
DHCP may change it. Never hard-code this into another user's setup.

For isolated development/tests, set `STUDIO_DEV_ROOT` to an unused directory
before starting commands. Set environment variables using your shell or a parent
Node process; no PowerShell is required. `npm start` runs a foreground server;
CLI `start` manages a background server. Don't mix them on the same port/data root.

## Storage and lifecycle

`server/storage.ts` uses env-paths with the retained internal name RunpodStudio.
The display name is Seed; retaining directory names preserves existing libraries.
On Windows durable data is under `%LOCALAPPDATA%/RunpodStudio/Data`.
Media and SQLite live outside the checkout/package; rebuilding keeps them.
Logs and credentials follow the platform's per-user directories. Credentials use
private file permissions, not application-level encryption. Web-server environment
filtering strips both providers' keys and source tokens.

Sign-in setup currently supports Windows only and writes one per-user seed.vbs
entry invoking Node hidden. No desktop wrapper or bundled runtime. Startup itself
has isolated tests; actual sign-in acceptance is still a user checkpoint.

## Tests

```sh
npm run typecheck
npm run build
npm test
node --test skills/seed/tests/vast.test.mjs skills/seed/tests/runpod.test.mjs
npx playwright install chromium
npm run test:browser
```

Use the worker's requirements-test.txt and Python for worker development tests;
Python is not a local end-user dependency. The Vast worker adapter has separate
`skills/seed/tests/test_worker.py` coverage. Browser tests use isolated data
and an alternate port. Tests do not establish that a paid GPU lifecycle works.

## Local package installation

```sh
npm pack
npm install -g ./skarian-seed-0.1.0.tgz
seed setup --provider vast
seed start
```

The package is private/unpublished. Stop Seed before replacing the installed
package. To uninstall a Windows sign-in installation, run `seed setup --no-startup`
first. Uninstalling does not remove media/config. A changed global Node/npm path
may require rerunning setup to repair the shortcut. Source and installed app
builds are distinct: building this checkout does not update a global installation.

## Provider operations

Read [seed](../skills/seed/SKILL.md). Vast uses the published image with a
remote worker compatibility adapter and a managed SSH tunnel; RunPod reuses the
private template/network volume and HTTPS protocol. Both use the normal app
launcher and replace connections through the same pairing API. No provider rental
controls are added to the web UI. Never present paused/disconnected as billing off.

API, asset and workflow specifications remain in this directory; historical
implementation decisions and test evidence belong in EXECUTION-PLAN.md.
