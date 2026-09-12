# Worker startup and storage

Seed uses one pinned worker image on disposable RunPod or Vast disk. Both start
with authenticated OpenSSH forwarding to the loopback worker API on port 8080.
The same tunnel carries preparation, jobs and file transfers. RunPod HTTPS
proxies, volume/template provisioning and the separate SSH preparation helper
are retired.

The provider launches `worker.entrypoint`, which starts key-only SSH and then the
worker supervisor. `SEED_PAIRING_SECRET` is required; `JUPYTER_TOKEN` enables
optional administration. Worker and Jupyter bind only to loopback. The CLI owns
local forwards on ports 18080 and 18888. Source-provider tokens are sent in the
authenticated preparation request and held in memory, never stored in templates,
state records or download logs. GPU provider keys stay on the PC.

The early API accepts one immutable preparation manifest. It starts two bounded
direct-download lanes and verifies all assets before activating presets and
starting ComfyUI. Cancelling stops and joins writers; a stale request cannot undo
cancellation. Restart rechecks receipts and requests fresh source credentials for
missing files. Optional PC fallback uses authenticated resumable tusd uploads.
Uploaded bytes become usable only after full verification and atomic promotion.

`/workspace` holds models and temporary job media. `/var/lib/seed` holds private
rental identity, bearer verifier and preparation intent.
Both survive process/container restart on the same rental's disk. New rentals get
new identities. Engine identity changes on Comfy restart; generation itself does
not resume after an engine restart.

The PC permanently owns originals, results and SQLite history. Worker output is
retained until durable receipt. Destroying a rental deletes its disk and any
unsaved output. A disconnected worker is never evidence that teardown is safe.
See [SSH recovery plan](SSH-RELIABILITY.md) and [API contract](API-CONTRACT.md).
