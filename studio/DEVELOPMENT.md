# Local development

The first implementation slice is a disconnected studio shell: Generate/Library,
four workflow forms, browser workflow drafts, standard storage directories, SQLite,
and a loopback HTTP server. Pairing, transfers and generation are not implemented.
Windows packaging/startup is still M1 work; this is the developer launch path.

## Run and verify

Use **Node 22.23.2**, pinned in [`.node-version`](../.node-version), and the committed
lockfile. The system's older Node 22.13 crashed when opening better-sqlite3 on this
PC. Node 22.23.2 passed native SQLite and application tests. Software versions are
pinned in [package.json](../package.json); no global tool upgrade is required.

```powershell
# On this checkout, the verified portable runtime is already available here.
$env:PATH = (Resolve-Path .local/tools/node-v22.23.2-win-x64).Path + ';' + $env:PATH
npm ci
npm run typecheck
npm run build
npm test

# Use isolated development data rather than your permanent user library.
$env:STUDIO_DEV_ROOT = "$PWD/.local/preview"
npm start
```

For another checkout, install the pinned runtime from the
[official Node distribution](https://nodejs.org/dist/v22.23.2/), checking the ZIP
against its published `SHASUMS256.txt`. The eventual Windows release will bundle
the tested runtime and dependencies.

Open `http://127.0.0.1:4310`. Stop the foreground process with Ctrl+C. A second
server cannot bind the same port; it exits instead of starting a second listener.
Shortcut-based reuse of the existing instance is still to be implemented.
`STUDIO_PORT` is an optional developer override. Without `STUDIO_DEV_ROOT`, storage
uses `env-paths('RunpodStudio', {suffix:''})`; on Windows, durable data is under
`%LOCALAPPDATA%\RunpodStudio\Data`. Rebuilding does not delete these directories.

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.local/browsers"
npx playwright install chromium
npm run test:browser
```

Browser tests start their own server on port 4311 with `.local/browser-tests`
data, and capture desktop/mobile screenshots under ignored `test-results/`.
Run in a normal Windows shell: restricted process permissions blocked Playwright's
server teardown during the first run; the normal-permission run exits cleanly.

## Current boundaries

For an explicitly requested home-network preview, set `STUDIO_PREVIEW_ADDRESS`
to an assigned private IPv4 address and set `STUDIO_DEV_ROOT` to a separate
preview directory before starting. The default stays loopback. Host/Origin checks
match the selected address exactly; this does not enable general public hosting.
On 9 September the preview was started at `http://192.168.1.212:4310` using
`.local/lan-preview`. The local HTTP check passed. Creating a subnet-restricted
Windows Firewall rule failed with access denied; the owner subsequently confirmed
that the LAN link is accessible. Use this approach for future UI reviews and
portal access, verifying the current LAN IP each time. Keep test data isolated;
persistent LAN launch configuration remains Windows packaging work.

- `server/storage.ts`: standard paths and directory creation, no media deletion.
- `server/db.ts`: transactional migrations, WAL, FULL synchronous durability and
  initial asset/job/dispatcher tables. Setup/reopen preserves existing data.
- `server/http.ts`: health, disconnected status, first-page asset listing and
  queue pause; resume rejects until worker integration exists. Only `dist/web`
  is served. Host, Origin and browser fetch-site checks protect loopback access;
  this slice does not yet support an external reverse proxy.
- `web/`: responsive forms/navigation and versioned browser workflow drafts.
  Output controls are a UI preview; they do not submit requests or claim a
  validated capability. SFW/NSFW can be selected in the UI draft for review; generation stays disabled
  and mode selection does not activate a LoRA. Real submission must validate presets.
- `tests/`: storage preservation/cache separation, host/origin rejection,
  disconnected safety, private-file denial, drafts/navigation and mobile layout.

The app never loads `.env` or calls RunPod's control plane. `.env.example` is for
the future standalone setup utility; fill real values only in the ignored `.env`.
Public model access may not need HF credentials; exact asset access still needs
preflight. Do not put secrets into browser drafts, screenshots or Git.

The worker routes in [POD-BOOTSTRAP](POD-BOOTSTRAP.md) are specified but not deployed.
Initial API additions `GET /api/v1/health` and `GET /api/v1/assets` support this
slice; asset listing currently returns at most 50 rows without cursor support.
Pagination and media content routes must be implemented before real libraries are
accepted. Queue and pending-output counts are empty-foundation values, not a live
GPU observation. Termination safety remains unknown.

## First UI review decisions

Display name: **Studio** (internal app identifier/storage locations unchanged).
Use a compact prompt-first form, shape-based frame choices and a reset-current-form
button. Draft schema v2 saves prompt, mode, aspect and duration per workflow;
existing v1 prompts are migrated when loading. Reset restores that workflow's
fields and prompt height, without touching other workflows or Library data.
A bottom-right handle resizes the prompt with pointer/touch or arrow keys.

Pod and job icons in the top-right open native light-dismiss/Escape popovers.
Only show an output panel once a real job is submitted; there is none in the
current disconnected shell. Loading output should use the simple frame logo,
without tagline/placeholder paragraphs. No new jobs page or backend operation is
introduced by these UI changes.

## Batch and Advanced controls

Each workflow draft includes generation count (1–16, default 1), random seed
(default), and a fixed starting seed. Advanced is collapsed initially. Controls
persist across reloads; Reset restores one generation/random seed and collapses
Advanced. Fixed seed validation accounts for the full batch range. Only add
additional Advanced controls when the model actually supports them.

These controls currently edit drafts; they do not execute jobs. Future execution
expands a submission into individually tracked, sequential generations as defined
in [the API contract](API-CONTRACT.md). No simultaneous model batch or new queue
system is introduced.
