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
access. The agent checks access before rental. For Vast, the CLI's
`setup` delegates to this flow then checks the Vast account. RunPod creation uses disposable disk and global placement; legacy `pod-setup` remains available only for existing volume/template users.

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
node --test tests/operations/vast.test.mjs tests/operations/runpod.test.mjs
npx playwright install chromium
npm run test:browser
```

Use the worker's requirements-test.txt and Python for worker development tests;
Python is needed by the official Windows HF installer when local caching is selected. Worker startup tests live with the
worker regression suite. Browser tests use isolated data
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
private worker bootstrap and a managed SSH tunnel; RunPod reuses the
global placement/disposable disk and HTTPS protocol. Both use the normal app
launcher and replace connections through the same pairing API. No provider rental
controls are added to the web UI. Never present paused/disconnected as billing off.

API, asset and workflow specifications remain in this directory; historical
implementation decisions and test evidence belong in EXECUTION-PLAN.md.

## Complete offline checks

Create `.local/worker-venv` with `python -m venv .local/worker-venv`, then use
that environment's Python to install `-r worker/requirements-test.txt`.
Run `npm run verify`: build, typecheck, app tests, operational tests, worker tests and
current-credential secret scan. It stops on failure. Set `SEED_PYTHON` to use a
different prepared Python environment. Browser tests and paid GPU validation are
separate. Pytest uses a fresh directory under `.local/tests` rather than shared
system temp state. The secret check prints file names and match types, not values.


## Packaged operations (2026-09-11)

`operations/` is copied to `dist/operations` during build and included in npm pack.
`seed gpu vast ...` and `seed gpu runpod ...` resolve their own installed package,
not the current working directory. Skill files contain instructions only.
Operational rental state is per-user configuration; the legacy checkout Vast
record is imported when encountered. Never edit state to bypass uncertainty.

Before release, install the actual npm archive in a temporary prefix outside the
checkout. Use fake credentials, isolated STUDIO_DEV_ROOT and isolated APPDATA for
setup tests. Do not copy individual compiled modules into a global installation.
Run `npm run verify` before committing. Actual platform and paid-resource results
belong in VALIDATION.md. No automatic update checker or npm publication is enabled.
