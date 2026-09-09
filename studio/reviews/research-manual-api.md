# Manual Runpod lifecycle: API and restart recovery

9 September 2026. Planning audit for the newly accepted manual startup/shutdown design. No infrastructure actions or plan edits.

## API reductions without losing generation features

Remove `/studio/start`, `/studio/cancel-start`, `/studio/stop`, `/studio/keep-running`; remove provider lifecycle operations, rate/idle promises, the Runpod control client and its runtime control credential. Keep `GET /studio` as readiness, plus assets/uploads and all job routes. Preserve local waiting jobs, exact preset snapshots, rich reference inputs and S3 output recovery. S3 credentials serve storage and are separate from a Runpod control key.

`POST /jobs` still returns202 and durably queues valid work while ComfyUI is unavailable. Freeze request, resolved seed, preset and template then. Never secretly start compute. Locally queued means **not submitted to ComfyUI**. The dispatcher sends one prompt at a time when the intended engine becomes ready. An unavailable optional preset blocks the affected job with a reason rather than substituting another preset.

Suggested studio response: `engine_state: 'unreachable'|'checking'|'ready'|'working'|'needs_attention'`, last successful check time, active job, waiting job count, and readiness issue. Do not label an unreachable endpoint “GPU off” or show a confirmed cost state: a network fault can hide a billed running pod. A static Runpod-console link can explain where to start/stop manually. Label queued work “Waiting for your pod” and explain that it runs after the connection is ready.

The local SQLite dispatcher remains necessary, but it no longer changes infrastructure. Job idempotency is a job concern, so no general lifecycle operations table is needed solely for it. Preserve whatever minimal service/session state restart reconciliation needs.

## Stable address is not stable execution session

Native ComfyUI initializes its queue, running dictionary and history as empty process memory; history can also be cleared or evicted. An empty history result does not prove a job never ran. [PromptQueue implementation](https://github.com/Comfy-Org/ComfyUI/blob/master/execution.py).

The WebSocket sid is a client connection identifier, including a supplied clientId. Native submission preserves extra_data and returns a prompt ID; current upstream also accepts caller prompt UUIDs, but that must be checked against the pinned version and is **not** deduplication. [ComfyUI server](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py).

Therefore the same Tailscale hostname/IP can reconnect to a newly booted ComfyUI whose history knows nothing about the prior job. Neither its address nor a reused WebSocket client ID is sufficient for recovery or cancellation.

### Minimal process identity and fence

Use a tiny integration extension loaded inside the ComfyUI process, not another service:

- Generate a random `engine_session_id` when that Python process imports the extension. Do not persist it as the stable identity.
- Return it with an expected persistent `workspace_id` from private `GET /studio/session`. Check expected workspace before readiness.
- Require the backend's expected session header on every studio-origin mutation: `/prompt`, `/queue`, `/interrupt`, prepared-input `/upload/image`, and `/free` if used. Reject a mismatch before touching engine state. This fences the small restart race between reading readiness and sending a mutation. Uploads rejected by a changed session are revalidated against the intended workspace; they are not blindly carried into a new attempt.
- Preserve existing manual administration using an explicitly separated maintenance/auth path; do not accidentally break the current ComfyUI UI by globally requiring a studio header from all clients.

This should be tens of lines of identity/middleware integration, not a generic proxy or durable workflow service. A startup-created file alone is insufficient if ComfyUI can restart inside a still-running wrapper. The UUID must belong to the actual engine process.

Record `(workspace_id, engine_session_id, job_id, attempt_id, prompt_id)` on each submission attempt. Put job/attempt markers in native extra_data as well as the generated output prefix. The engine session guard makes a stale call fail without executing against the replacement. Still do not automatically retry ambiguous submissions.

## Recovery decisions

| Situation | Action |
|---|---|
| exe.dev restarts, same Comfy session | Reconcile stored prompt/attempt marker with queue/history and output records; reconnect observation |
| Connection drops while generating | Keep the job unresolved, show connection lost; do not mark failed or submit another attempt |
| Same session returns, matching prompt is queued/running | Resume observing it, not generation |
| Same session returns, history reports success | Discover/copy its recorded outputs; finish only after local durable files |
| New engine session appears | Invalidate old live observation; inspect persistent output records before making any result claim |
| Prior attempt has complete validated persistent outputs | Copy via S3 or current private route; no regeneration |
| Prior attempt is missing from history and has no proven complete result | Mark interrupted/needs_attention; require explicit retry as a new attempt; do not infer nonexecution |
| Locally queued, never-submitted jobs remain | Once new session and workspace readiness pass and prior ambiguity is resolved, continue them in order automatically |
| User cancels local waiting job | Cancel in SQLite immediately, no pod needed |
| User cancels old-session or disconnected running job | Record cancel intent, do not send a global interrupt to a new engine; reconcile first |

An ambiguous old attempt should not be automatically replayed or receive a cancellation on another session. The selected conservative policy pauses FIFO dispatch while it remains needs_attention; resolve it by recovering a proven result or explicit owner disposition before resuming waiting work. Preset/model availability is checked before each dispatch because a manual replacement can have a different runtime.

## Output durability and manual shutdown

Keep the existing network-volume output prefix and recovery manifest requirement. Add job/attempt/session identifiers and expected output kinds to the manifest. Define who writes the completion record: it must happen on the pod after output files have closed, before relying on exe.dev download success. A frontend-only manifest cannot cover shutdown between generation and download. Implement this in the existing output/finish integration, or recover deterministic job-prefix files with validation while treating missing completion evidence conservatively.

Only final validated artifacts become Library results. Temporary/partial MP4s must not pass because a filename exists. Preserve originals and generated output artifacts; S3 recovery retains the actual job result and must not queue a new generation. If compute was manually stopped mid-generation, the job generally cannot resume sampling; explicit retry is a new attempt using its frozen settings.

Frontend should distinguish “generation finished; copying result” from “saved to Library”. With manual shutdown it cannot guarantee the owner waits; durable volume output and S3 recovery address that interruption. If a job is still generating, show that fact near the Runpod-console link, without inventing a programmatic Stop button.

## Duplicate-start scope

A workspace lock can prevent two processes from operating the same model/output workspace and sharing the same Tailscale identity. It cannot itself guarantee that a manually created second pod stops being billed. Do not call that lock a one-GPU cost guarantee. Actual manual one-pod discipline and the deployment/bootstrap failure behavior belong in the Runpod operating instructions; the readiness API can only report the intended service it can authenticate.

## Focused acceptance fixtures

Restart exe.dev during generation; restart ComfyUI after output write but before history observation; replace the pod at the same Tailscale endpoint; lose the submission reply; cancel while disconnected; stop manually during copying; start manually with waiting jobs; reconnect a different workspace; and attempt duplicate workspace startup. Every fixture must prove no automatic replay of uncertain work, no stale-session interrupt, correct waiting-queue behavior and preserved S3 result recovery. No extra background service is required.
