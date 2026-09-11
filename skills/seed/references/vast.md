# Open Seed on Vast

Complete [setup](setup.md) first. REPO is the app checkout; SKILL is this skill's
folder. Replace both with absolute paths and keep the quotes. The helper reads
saved credentials privately; no Vast SDK or CLI is needed.

## Inspect before renting

```sh
node "SKILL/scripts/vast.mjs" doctor --repo "REPO"
node "SKILL/scripts/vast.mjs" status --repo "REPO"
node "SKILL/scripts/vast.mjs" offers --repo "REPO"
```

Doctor should show `built: true`, working SSH tools and configured Vast/HF keys.
Run `node "REPO/dist/server/cli.js" models` before renting if the local model cache is incomplete. Rent refuses a missing/changed cache.

Status lists account instances and local studio state. Reuse an existing usable
session; don't acquire another GPU while one is already active. If RunPod is also
configured, check it using that guide before allocation.

Offers include IDs, GPU/RAM, location, hourly total and network charges. The default
search is one RTX PRO 6000 WS/Server with approximately 96 GB VRAM, at least 96 GB
host RAM, CUDA 13+, verified/reliable host and 180 GB disk. Inspect actual power
limits and download bandwidth. `--gpu NAME` (repeatable) and `--disk-gb GB` change
the search, but the helper retains its minimum memory filters. It is not an
arbitrary-GPU optimizer. A100 was substantially slower in our video trial.

Choose an offer within the user's budget and explain the price/storage choice.
If no suitable offer exists, report that result; comparing an authorized alternative
is reasonable, but repeated allocation attempts are not evidence of availability.

## Acquire, prepare and connect

```sh
node "SKILL/scripts/vast.mjs" rent --repo "REPO" --offer-id OFFER_ID --max-hourly RATE
node "SKILL/scripts/vast.mjs" status --repo "REPO"
```

Replace OFFER_ID with a returned integer and RATE with the authorized hourly
ceiling, for example `1.50`. Rent rechecks the offer and records the instance ID.
A timeout may still have allocated compute: inspect status and the saved attempt
before retrying. The helper intentionally blocks another uncertain rental.

Wait for the instance to report running, then:

```sh
node "SKILL/scripts/vast.mjs" boot --repo "REPO"
node "SKILL/scripts/vast.mjs" connect --repo "REPO"
node "SKILL/scripts/vast.mjs" preparation --repo "REPO"
node "SKILL/scripts/vast.mjs" status --repo "REPO"
```

Boot transfers the verified local models and configured LoRAs over SSH, reusing
verified remote files and resuming partials, then starts the worker with fresh
pairing/Jupyter secrets. Provider, Hugging Face and Civitai keys stay on the PC. Connect starts the SSH tunnel and
pairs automatically; it returns the local studio URL. The local app must already
be running, as in setup.md. Pairing can complete while models are downloading.

Preparation reports downloaded bytes and verification timestamps. Status's studio
section distinguishes preparing/ready/busy/disconnected. Once ready, inspect the
jobs popover: the queue may be paused. Resume it through the UI when the user wants
generation to begin. Do not silently release older queued jobs just to test setup.
Give the user the studio URL, readiness and hourly cost; leave it open for their use.

## Finish and verify billing state

```sh
node "SKILL/scripts/vast.mjs" destroy --repo "REPO"
node "SKILL/scripts/vast.mjs" status --repo "REPO"
node "SKILL/scripts/vast.mjs" billing --repo "REPO"
```

Use destroy only when deletion is authorized. It pauses dispatch, requires fresh
output-safety confirmation, deletes the recorded instance/disk and stops the SSH
tunnel. Seed stays running with its last worker disconnected. Confirm the instance is absent. The Library stays local.

Use `stop` instead of `destroy` if the user wants to retain disk; stopped disk still
costs money. The helper does not have a resume command: start a stopped instance
through Vast first, subject to capacity, then boot/connect. After a PC restart,
start Seed and reconnect if the GPU is still running. Sleep does not stop billing.

## Recover without losing work

- **SSH/boot failure:** use status and inspect the same instance. Startup repairs
  root ownership and restrictive modes on Vast-injected authorized_keys. If logs
  show bad ownership/modes, an existing container may need an updated onstart via
  `/instances/update_template/ID/` (include the image) and authorized in-place
  recycle; reboot alone does not regenerate the startup script. Preserve work
  before any recycle. Request logs via `/instances/request_logs/ID/` including
  its trailing slash. Don't rent another
  GPU to fix an SSH problem. Retry boot after resolving readiness/access.
- **Connect failure:** local ports 18080/18888 must be free. The helper stops its
  tunnel after a failed connection attempt; a failed code exchange preserves the
  saved connection. Inspect the private tunnel log if cleanup fails. The GPU
  remains allocated until explicitly stopped or destroyed.
- **Shutdown refused:** finish/cancel jobs and let outputs save; reconnect/reconcile
  if status is unknown. A worker that never became usable requires checking that
  no jobs were submitted before emergency teardown through Vast.

Rental state is in REPO's ignored `.local/seed-vast/state.json`. Per-user config
contains credentials.json and a seed-vast directory with keys, worker secrets,
connection backup and logs. The old state-directory name is retained deliberately.
Never print raw account responses, which may contain keys. For implementation
changes, inspect scripts/vast.mjs; do not improvise credential-bearing shell commands.

## Current evidence and limits

The worker supports explicit SSH startup and loopback binding. The helper passes
configuration through SSH and starts it without modifying source. Use the image
pinned by the built application; older retained images need replacement after
outputs are saved. CPU startup checks do not establish GPU generation performance.

The manual RTX PRO 6000 trial downloaded/verified 99.62 GB in 5m15s and generated
a 15-second mixed-reference video in 13m23s. These are one-machine observations,
not guarantees. See REPO/research/infrastructure/VAST-KOREA-BENCHMARK-2026-09-10.md.
Ohio startup/pairing and direct-download preparation were live-verified. The new
PC transfer protocol has interruption/integrity tests; a full cold 100 GB transfer
and macOS execution remain separate live checks. Do not quote prior direct-download
times as PC transfer performance.

### Upgrading from the alternate app launcher

After jobs finish and outputs are saved, rebuild/reinstall Seed, then run `seed stop`
and `seed start` once. This replaces any already-running old launcher without
changing the saved connection or GPU. Reconnect to restore the SSH tunnel if needed.
Old `app_managed` state and `previous-connection.json` backups are no longer used;
they may be removed after the normal app starts successfully. Do not restore those
backups over the current connection.
