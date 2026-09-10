# GPU runtime bootstrap and pairing

Revision 7. Pairing/status and the container startup path are implemented and locally tested; live GPU validation, job spool/transfer routes and preset activation remain pending. [Current direction](CURRENT-DIRECTION.md) and [sources/setup](RELEASE-AND-INFRASTRUCTURE.md) define the scope.

1. Owner deploys the published template with the selected network volume and private pairing/download credentials. No provider API credential in the pod.
2. Start the small worker connection page on port 8080 immediately, before downloads. Keep raw ComfyUI private. Jupyter remains separately authenticated administration.
3. Validate mount/free space and initialize workspace metadata once. Missing model directories on an empty volume are valid. Model cache and temporary job spool have separate paths.
4. Download only missing pinned manifest files from Hugging Face (explicit content-LoRA exceptions possible). Stage/verify/promote; report progress and retryable errors. No package upgrades, local PC artifact fetches or full model hash scan on normal boot.
5. Start ComfyUI after required assets are ready; confirm nodes/models and engine health. Worker reports Preparing, Ready, Busy or Disconnected from the studio's observation, with detailed preparation errors.

## Worker implementation boundary

Use a small Python `aiohttp` application on port 8080, sharing the pinned runtime dependency already used by ComfyUI. It owns the early connection page, preparation status, authentication, a streaming allowlisted Comfy proxy and spool receipt operations. It does not implement generation or another queue. ComfyUI binds to loopback and supplies its existing routes plus the narrow session/submission-manifest hooks. Jupyter keeps its separate administrative endpoint/authentication. No extra auth service or framework.

The template entrypoint creates a fresh `worker_instance_id` UUID and private runtime directory on each container start, outside the network volume. The deployed supervisor is the container lifetime process; restarting it or replacing the container creates a new instance and requires pairing. There is no separate supported worker-process restart command. ComfyUI generates its own `engine_session_id` on every engine process start. Volume metadata holds `workspace_id`, models and spool, never reusable worker bearer credentials.

## Pairing and exact routes

All network calls below use HTTPS at the provider endpoint. `/worker/v1` is private to the PC server/operator utility; it is not the browser-facing studio API. JSON errors use the studio error envelope. Sensitive responses set `Cache-Control: no-store`. Never redirect API failures to Jupyter. Prefix the bounded, versioned connection payload with `studio1.` and encode JSON as base64url: `{version:1,endpoint,exchange_token,expires_at}`. Encoding is not encryption; treat the entire value as a secret. Validate the endpoint independently on the PC before any request.

| Route | Authentication and behavior |
|---|---|
| `GET /` | Public static unlock page only; no model names, job/media details or credentials. |
| `POST /worker/v1/unlock` | JSON `{pairing_secret}`; constant-time verification; successful response sets a Secure, HttpOnly, SameSite=Strict, path-scoped browser session cookie with a 15-minute lifetime. Same-origin check on browser mutations. Rate limit failed attempts with bounded backoff; no persistent account store. |
| `POST /worker/v1/pairing-codes` | Unlock cookie and same-origin check; `{}` produces `{connection_code,expires_at}`. Token is 32 cryptographically random bytes, expires after five minutes, and only the newest unconsumed code is usable. Minting does not revoke an existing studio credential. |
| `POST /worker/v1/exchange` | `{exchange_token}`; atomically consume valid token and rotate the single worker bearer credential. Return `{worker_credential,worker_instance_id,workspace_id,protocol_version:1}` only after persisting its verifier. Expired/used/unknown codes return `401 invalid_connection_code`. |
| `GET /worker/v1/status` | Worker bearer or unlock cookie; returns status schema below, including preparation before engine startup. |
| `GET /worker/v1/jobs?cursor=...` | Worker bearer; paginated spool manifests/receipts, including prior engine sessions on this workspace. This is recovery inventory, not another execution queue. |
| `GET /worker/v1/jobs/{job_id}` | Worker bearer; submission receipt, terminal manifest if available, and durable-receipt/cleanup state. Unknown job is 404. |
| `GET /worker/v1/jobs/{job_id}/outputs/{output_id}` | Worker bearer; stream only a closed artifact named in a successful terminal manifest; support Range, fixed length, MIME type and digest ETag. No client filesystem paths. Cleaned artifacts return 410. |
| `POST /worker/v1/jobs/{job_id}/receipt` | Worker bearer; `{manifest_digest}` acknowledges the complete output set. Validate against immutable terminal manifest, atomically persist acknowledgment before cleanup; 200 returns `{saved:true,cleanup_state}`. Repeating the same receipt also retries pending cleanup. Different digest returns 409. |
| `PUT /worker/v1/presets/{revision}` | Worker bearer; operator-only usage described below; stage an exact manifest, never execute arbitrary URLs or code. Same revision/body is idempotent; changed body is 409. |
| `POST /worker/v1/presets/{revision}/activate` | Worker bearer; activate a completely prepared revision during paused, reconciled idle operation; incomplete assets or busy engine return 409. Returns active revision. |

Protect the allowlisted `/comfy/*` proxy with the worker bearer credential. Strip this outer credential before forwarding internally. Forward native schemas, streaming bodies and WebSocket messages without buffering complete media. Only the PC server uses this path; browser access goes through the local studio. Reject unsupported routes/methods instead of proxying arbitrary Comfy administration. The session probe is `/comfy/studio/session`, forwarded unchanged to `/studio/session`. Studio mutations additionally carry the expected engine session enforced **inside ComfyUI**; worker authentication alone does not close engine restart races.

Credentials survive browser refresh and PC app restart while the current worker process remains alive. Store only the bearer verifier in the private runtime directory; store the issued bearer on the PC in its protected config directory. Pairing codes/browser unlock sessions are in memory and expire on worker-process restart. A new successful exchange revokes the previous bearer. A lost exchange response requires minting/pasting a new code; do not retry a consumed token or offer a credential retrieval endpoint. The PC leaves dispatch paused until exchange and reconciliation succeed. Neither failed pairing nor rotation deletes jobs. Configuration permissions and secret-redacted logs are implementation requirements, not a new secret-management service.

## Status and spool

Status response: `{protocol_version,worker_instance_id,workspace_id,engine_session_id,state,observed_at,preparation,active_prompt_id,pending_output_count,unresolved_job_count,active_preset_revision,preset_preparation}`. `state` is `preparing|ready|busy`; the PC computes `disconnected` and `stale`. Preparation has `phase`, optional byte progress and a structured error; download failure remains preparing with an actionable error. Engine identity is null before startup. Unknown spool/engine reconciliation must not report zero pending work. Cookie status is enough to see progress before pairing; detailed job routes require bearer authentication.

Place complete generated outputs and terminal job manifests in a per-job spool on the network volume. A successful manifest contains job/workspace/engine IDs, prompt ID, output IDs, byte counts, SHA-256 digests and MIME types; compute digests on newly closed outputs, not a full model-cache scan. Publish it atomically only after expected output artifacts are closed and verified. `manifest_digest` is SHA-256 of the exact immutable manifest bytes, returned alongside the manifest rather than embedded in its own digest input; the PC verifies those bytes before acknowledging. An `executed` WebSocket event alone is not proof all graph outputs are complete. Receipts and manifests are small files; no worker database or queue service.

The PC initiates input uploads and retrieves outputs into temporary local files. Verify length/digest, durably promote all outputs and commit the unique job/output records in SQLite, then send the manifest receipt. Local save and remote acknowledgment are separate recoverable writes. If receipt response is lost, repeat the same receipt. Only after persisting acknowledgment may the worker remove job input/output copies. Keep the small acknowledged manifest/tombstone on the volume so duplicate receipts and replacement recovery remain idempotent. Cleanup only removes job-owned paths, never models or another job's files.

Replacement on the same volume recovers closed outputs after pairing. Interrupted generation is not resumed; partial files without terminal success are not finished results. Unknown submission becomes needs_attention, never an automatic rerun. Cleanup failure after durable local save is reported separately and retried; it does not invalidate the saved result.

## Preset activation

The local operator command `studio presets sync --file <local-manifest>` uses the saved worker connection, resolves exact owner-selected Civitai/HF IDs, and sends a normalized manifest to `PUT /worker/v1/presets/{revision}`. This is a CLI command, not a browser acquisition endpoint. Tokens remain in private worker configuration; no credentials in the manifest. The worker resolves approved provider download locations, downloads only missing files, verifies compatibility and stages the revision. Status reports pending/ready/error for that revision. No auto-latest update or deletion of older assets.

When staging is ready, the command uses the local studio pause API and waits for native engine/transfer reconciliation, then activates with the worker route. Activation changes one small current-preset manifest atomically. It must not modify files referenced by queued snapshots; retain old revisions/assets. On activation success the PC refreshes capabilities, invalidates stale drafts by revision, and leaves dispatch paused for an explicit Resume. Lost activation response is resolved by reading active revision, not downloading again. Preset sync does not start compute. Detailed provider entitlement and node compatibility checks remain live proof gates.

## Safe to terminate

The PC's existing serialized dispatcher owns both dispatch decisions and the termination assessment. Pause persists before any subsequent dispatch and waits for already-started submission reconciliation; it does not cancel generation. In that same serialized reconciliation pass, inspect native queue/history, pending submission receipts and worker spool; combine with committed local saves. Return `safe_to_terminate: true|false|null`, `checked_at` and plain `reasons`. True requires paused dispatch, no active/possibly submitted or foreign work and no unsaved outputs. Parked never-submitted jobs are allowed. Cleanup-only failures after a matching durable PC receipt are allowed.

Any Resume, new submission/cancel transition, connection/session change or unsuccessful probe invalidates the assessment immediately. A successful observation expires after five seconds without refresh; null means unknown, including disconnection, restart, unfinished reconciliation or ambiguous work. The serialized pass prevents the local dispatcher racing its own assessment; it is not a distributed pod lock or a guarantee against manual admin activity. Direct Comfy generation requires maintenance with studio dispatch paused and invalidates the indicator. No termination API, drain token, provider lock or lifecycle controller is added. Manual shutdown can interrupt preparation; the indicator concerns work/media safety, not that preparation is finished or billing stopped.

## M0 decision and proof record — 2026-09-09

Specified the Python/aiohttp early worker boundary, exact custom routes, container-scoped credentials, lost-response behavior, durable receipts, explicit preset activation and serialized termination assessment. These are design decisions, not tested runtime behavior. Reuse documented [ComfyUI routes](https://docs.comfy.org/development/comfyui-server/comms_routes) and [execution messages](https://docs.comfy.org/development/comfyui-server/comms_messages); pin and inspect the actual runtime implementation before writing session/submission hooks.

M2/M3 must prove cold/warm preparation; pairing before engine startup; code expiry/reuse/concurrent exchange/lost response; worker-versus-engine/container restart; streaming and Range through the actual outer proxy; manifest closure and disk-full/crash paths; repeated receipt after restart; replacement recovery; pause-versus-submit and foreign-work detection; staged preset activation and queued snapshot preservation. Normal upload/multi-media support must be proven against the pinned Comfy API before adding any fallback route. Implementation paid sessions end with verified compute off; no live tests were run for this specification.


## M2 runtime implementation

`worker/Dockerfile` extends the already-published digest and asserts the inspected
ComfyUI/dependency versions. It copies seed code and overrides CMD; it performs no
package installation. `worker/run.py` is the container lifetime supervisor. It
starts 8080 before preparation, refuses an unmounted workspace, checks separately
authenticated Jupyter, prepares pinned models in a child process, and launches
Comfy with only `comfy_seed` enabled for the first text-to-image milestone. Later
identity/video node allowlists are not enabled yet. Do not use this initial
candidate as a claim that all four workflows are delivered.

Required private deployment variables: `SEED_PAIRING_SECRET`, `HF_TOKEN`, and
`JUPYTER_TOKEN`. RunPod supplies `RUNPOD_POD_ID`; `SEED_PUBLIC_URL` can explicitly
supply the public HTTPS origin. Workspace defaults to `/workspace`. Secrets do
not belong in shared templates or the image. This configuration still needs the
local setup utility and a live deployment walkthrough.
