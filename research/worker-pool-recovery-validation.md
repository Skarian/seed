# Worker recovery and container transport validation

September 22, 2026 · branch `codex/fal-only` · no GPU rentals or publication.

## Model delivery confirmed in code

Normal preparation sends a pinned manifest and the relevant Admin credentials
over the worker's authenticated SSH connection. The worker downloads base models
from Hugging Face and adapters directly from Civitai, then verifies size and
SHA-256 before activation. LoRA import in the app acquires metadata and records
the selected files/mappings; it does not relay the adapter weights.

- `server/pool-worker.ts`: `prepare()` sends manifest entries and credentials.
- `worker/preparation.py`: validates the role manifest and starts the isolated
  download process; credentials go over stdin, not into the preparation journal.
- `worker/download_process.py` and `worker/model_files.py`: worker-side fetching,
  hash checking and activation.
- `server/lora-imports.ts`: Civitai metadata and source selection.

Qwen Image 2.1 is the deliberate exception: its assets are already baked into
the Image container. The app's PC is not its runtime weight source. The explicit
base-model transfer fallback remains available for a failed direct download;
it is not invoked automatically and does not relay LoRAs.

## Six abrupt coordinator shutdown checks passed

The harness runs the built, real HTTP application in a child process with its
own SQLite profile. Provider and worker boundaries use persistent local fixture
state. It kills the process without graceful cleanup, then restarts against
the same profile. It does not substitute the scheduler, coordinator lock,
database, asset saving or job recovery.

| Crash point | Verified after restart |
| --- | --- |
| Rental created, response not returned | Rental rediscovered; exactly one purchase despite replaying the launch key |
| Generation accepted, response not returned | Durable receipt recovered; exactly one generation |
| Output file partially saved | File recovered and validated; one Library asset |
| Full output file saved, asset transaction not committed | Existing verified file imported once |
| Output saved, worker acknowledgement response lost | Asset retained; acknowledgement retried safely |
| Rental deleted, response not returned | Deletion reconciled; exactly one delete and no remaining rental |

Every scenario checks that the allocation timestamp and accrued spend survive
restart, Quit remains available at the interruption boundary, and spend stops
growing after confirmed release. The final fake rental count is zero. External
network attempts are rejected; none occurred.

Evidence: [six-case results](../.local/tests/process-recovery-LmJkjT/results.json).

## Ten real container transport checks passed

Both existing Linux/amd64 images were used:

- Image: `sha256:ecec7d4984f0453e374417a58fe0c76d1e768edf8f9b02aa113ef199310423b8`
- Video: `sha256:7bf54d23d330141beee374f429e5165a77d629a99f4e8104a0690af35beff7ee`

The production TypeScript driver ran actual OpenSSH against each container's
real sshd and worker gateway. Containers used `--network none`; a test-only
loopback byte relay through `docker exec` connected the SSH client to sshd.
This relay does not replace SSH authentication or the driver's port forwarding.

1. Image: SSH, pairing and pinned preparation manifest acceptance.
2. Video: SSH, pairing and pinned preparation manifest acceptance.
3. Separate credentials, workspaces, host trust files and tunnel ports; one
   worker's credential rejected by the other.
4. Three actual PNG reference uploads with matching hashes; repeated upload
   leaves exactly three files.
5. Simultaneous image and reference-video submissions; duplicate video request
   enqueued once, changed duplicate rejected. Killing the image SSH connection
   does not stop video completion, and image receipt recovery reconnects.
6. Image output resumed from a half-written `.part` file with exact final bytes.
7. Video output resumed the same way.
8. Image pairing/receipts survive driver reconstruction; wrong acknowledgement
   digest rejected; repeated correct acknowledgement cleans inputs/outputs once.
9. The same receipt recovery and cleanup on Video.
10. Queued cancellation produces a durable cancelled receipt and cleanup.

The packaged preparation manifest validator, admission/profile/adapter
validation, spool persistence, reference upload, output serving and receipt
cleanup are real. Large weight acquisition, CUDA readiness, native graph
validation and inference are explicitly substituted with CPU fixtures. A tiny
locally produced PNG and MP4 are used; these are not generated model outputs.

Evidence: [transport results](../.local/tests/container-transport-uSnjbn/results.json).
All test-owned containers and networks were removed; unrelated containers were
not changed.

## Defect found and fixed

`UserKnownHostsFile` was passed to OpenSSH without quotes inside its `-o`
configuration value. On this PC's Windows profile path, the space in the user
name meant SSH connected but did not save its trust file. Shell-free process
arguments do not remove OpenSSH's own configuration parsing.

The driver now quotes the path and uses forward slashes. The container test
checks that both trust files exist and reconnects using saved credentials.
This is an application-side fix; no worker image rebuild is necessary for it.

## Reproduction and remaining limits

```text
npm run test:recovery
npm run test:transport
```

Run these sequentially: each builds `dist`, so a concurrent build can delete
files while a recovery child is starting. The transport check requires the two
local image tags and Docker. Test helpers live under `scripts/`, outside the
published package and worker image copy lists. They introduce no production
QA routes or runtime flags. Isolated evidence and fixture keys remain under
ignored `.local/tests/`.

Also passed: application typecheck, production build, 49 targeted pool/job/
transfer regression tests, and repository secret scan (zero matches).

These checks do not establish provider placement, real hosting-provider download
throughput/authentication, CUDA memory fit, inference latency, audio/LoRA quality
or actual billing. Images remain unpublished and acquisition still requires
pinned registry releases. Mixed-queue stress and upgrade/rollback with unresolved
rentals remain separate follow-up checks; no completion is claimed for them here.
