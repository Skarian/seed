# Vast sessions

Use the shared [setup](setup.md), then the bundled Node helper. Seed must already
be built. Local prerequisites are Node and OpenSSH; the published GPU image
supplies Python/ComfyUI. The helper uses Vast's API directly, so no SDK is needed.

## Session commands

All helpers use `node <skill>/scripts/seed-vast.mjs COMMAND --repo CHECKOUT`.
Start the local app before `connect`; changing setup requires it stopped.

| Command | Use |
|---|---|
| `doctor` | Check local tools, build and saved credential presence |
| `setup` | Shared Vast/HF/Civitai setup, then read-only Vast authentication |
| `offers` | Find one-GPU offers; inspect total price, bandwidth charges, RAM and location |
| `rent --offer-id ID --max-hourly RATE` | Recheck and acquire the selected approved offer; journal the instance ID |
| `status` | Inspect provider and local studio readiness |
| `boot` | Once running, configure fresh worker secrets and source credentials over SSH |
| `connect` | Start tunnel, preserve old connection, pair and print the local app URL |
| `preparation` | Model byte counts and download/verification timestamps |
| `billing` | Remaining credit and charges for the recorded rental |
| `stop` | Pause/check output safety, stop compute, retain billable disk |
| `destroy` | Same safety check, remove instance/disk, restore normal local app |

Default search: RTX PRO 6000 WS/Server, 96 GB VRAM, at least 96 GB host RAM,
CUDA 13+, verified/reliable host and 180 GB disk. Inspect actual GPU power limits.
`--gpu` (repeatable) and `--disk-gb` adjust the search; the helper still enforces its
minimum VRAM/RAM profile. A100 was substantially slower in the recorded video test.
The helper does not implement arbitrary smaller-card optimization.

After rent, poll status; after the container runs, boot then connect. Pair during
model preparation if available. Never repeat an uncertain rent blindly: inspect
account instances and the saved attempt first. For boot/connection failure, inspect
private logs on the same instance instead of renting another. The worker may still
be billing after local connection failure.

Teardown refuses a different paired worker or unresolved work. Reconnect/reconcile
when safety is unknown. If a newly rented worker never became usable, inspect the
provider/worker state and establish that no jobs were submitted before emergency
provider teardown. On completion verify the provider and the local saved outputs.

## Private state and recovery

The helper records its rental in ignored `.local/seed-vast/state.json` in the
checkout. Credentials live in Seed's per-user credentials.json; SSH keys, fresh
worker secrets, connection backup and logs live in its `seed-vast/` subdirectory.
These retained path names are intentional despite the skill rename. Config files
use private filesystem permissions, not application-level encryption.

Do not print raw account responses (they may contain keys). The helper's `billing`
and `status` select safe fields. It passes source tokens over SSH, never the Vast
account key. API requests preserve trailing slashes to avoid auth-dropping redirects.

`connect` needs local ports 18080 and 18888 free. A Node supervisor owns the SSH
tunnel; do not kill unrelated processes to free ports. If pairing fails, the helper
attempts to restore the prior app connection; inspect private app/tunnel logs if it
reports rollback failure. The instance can still be billing.

After PC restart, start Seed and reconnect to the retained running instance.
The helper has no resume command: start a stopped instance through Vast first,
subject to available capacity, then boot/connect. Deleting an instance also deletes
its local model cache; saved PC media remains.

## Worker compatibility and measured evidence

The helper pins the image used in the successful manual trial. Vast SSH mode
replaces its command, so `boot` installs a small checked adapter: use disposable
disk as workspace, bind worker/Jupyter to loopback, and start the existing worker.
`connect` uses Seed's managed development transport option for the SSH endpoint.
This bridge is not yet a general production transport configuration. Incompatible
entrypoints fail instead of being patched speculatively.

The manual South Korea RTX PRO 6000 trial prepared 99.62 GB in 5m15s; a 15-second
mixed-reference video took 13m23s, and a subsequent image 12.3s. See the checkout's
`research/infrastructure/VAST-KOREA-BENCHMARK-2026-09-10.md` for costs and memory
semantics. These are observations from one machine, not guaranteed startup times.

Portable helper tests and live read-only API checks pass. A complete paid lifecycle
of the rewritten helper and macOS execution remain unverified. Run a generation
only when the user requests a test or a creation; report any failures honestly.
