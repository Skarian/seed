# GPU runtime bootstrap and pairing

Revision 5, planning only. [Current direction](CURRENT-DIRECTION.md) and [sources/setup](RELEASE-AND-INFRASTRUCTURE.md) define the scope.

1. Owner deploys the published template with the selected network volume and private pairing/download credentials. No provider API credential in the pod.
2. Start the small worker connection page on port 8080 immediately, before downloads. Keep raw ComfyUI private. Jupyter remains separately authenticated administration.
3. Validate mount/free space and initialize workspace metadata once. Missing model directories on an empty volume are valid. Model cache and temporary job spool have separate paths.
4. Download only missing pinned manifest files from Hugging Face (explicit content-LoRA exceptions possible). Stage/verify/promote; report progress and retryable errors. No package upgrades, local PC artifact fetches or full model hash scan on normal boot.
5. Start ComfyUI after required assets are ready; confirm nodes/models and engine health. Worker reports Preparing, Ready, Busy or Disconnected from the studio's observation, with detailed preparation errors.

## Pairing

Owner unlocks the worker page with the setup pairing secret. It issues a short-lived single-use exchange token packaged with its HTTPS address in one copyable value. The local studio contacts the worker to exchange it for a credential stored server-side. No central rendezvous service. Allow pairing before models finish. Never embed HF/RunPod credentials in that value.

Proposed small protocol: exchange tokens expire after five minutes and are atomically consumed. If exchange response is lost, mint a new code; re-pair rotates the previous worker credential without erasing job records. Limit failed unlock attempts and never log secrets. Persist the credential for the current worker lifetime; browser refresh does not require pairing. New pod start requires pairing again. Restart ComfyUI changes its engine session even if the worker credential remains valid.

The exact exchange routes and credential persistence across worker-process restarts require specification/testing before implementation readiness. All calls use authenticated HTTPS; an API auth failure returns an API error, not a Jupyter HTML redirect.

## Spool and receipt

Place complete generated outputs and terminal job manifests in a per-job spool on the network volume. The PC initiates input uploads and output retrieval. Permanently store originals/derivatives/results and database records on PC disk. Only after verified durable local files and DB commit does the PC acknowledge receipt. Worker cleanup follows that acknowledgment and is idempotent.

Replacement on the same retained volume can recover closed outputs after pairing. Interrupted generation is not resumed; partial output without terminal success is not a finished result. Never automatically regenerate ambiguous jobs. Repeated transfer/acknowledgment cannot duplicate Library entries. Cleanup failure after durable receipt is reported separately and retried; it does not invalidate the saved output.

Safe to terminate requires paused dispatch, no active work and no unsaved outputs, freshly reconciled with the worker. Disconnected is unknown, not safe/off. Retaining the volume protects pending completed output when terminated early, but the normal UI encourages waiting for saved status. Volume deletion/loss remains destructive. No automatic pod shutdown, locking or provider lifecycle controller. Implementation sessions must end with verified compute off.
