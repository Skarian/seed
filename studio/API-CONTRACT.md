# Studio API contract

Revision 5, planning only. Private same-origin `/api/v1`. No provider credentials, model paths or raw graphs accepted from browsers.

## Routes

| Route | Contract |
|---|---|
| `GET /capabilities` | Revision, four workflow IDs, enabled models/modes, plain input rules/preparation paths/output choices and tested combinations; ETag |
| `PUT /connection` | `{connection_code}`; validate target, exchange single-use token for worker credential, store server-side, reconcile engine before dispatch; never echo secrets |
| `DELETE /connection` | Forget saved connection, pause dispatch; no provider shutdown |
| `GET /studio` | Engine state, last observation time, stale flag, active/waiting jobs, pending transfers, maintenance/pause flag and Open Runpod link; no provider status or billing claim |
| `POST /queue/pause` | `{}`; pause new dispatch, retain waiting jobs; current execution/copies continue |
| `POST /queue/resume` | `{}`; resume only after engine/session/job reconciliation; no compute action |
| `/uploads` and `/uploads/{id}` | Standard tus creation, HEAD/PATCH/DELETE; library-defined headers/status/offset behavior, not a custom transport |
| `GET /assets/{id}` | Upload/preparation/readiness metadata, derivatives, provenance and errors |
| `GET /assets/{id}/content` | Authenticated streaming with Range, correct type and download disposition |
| `POST /jobs` | Request below + Idempotency-Key; 202 durable job; 409 when engine unavailable, reconciliation blocked or maintenance active |
| `GET /jobs` | Cursor pagination, workflow/state filters; Library and queue |
| `GET /jobs/{id}` | Latest progress, frozen settings, effective inputs, outputs/error |
| `POST /jobs/{id}/cancel` | `{}`; 202 cancellation request; terminal job returns unchanged snapshot |

Connection strings are credentials: exclude them from URLs, analytics, logs and browser persistence after submission. Restrict connection targets to configured provider host patterns or explicit operator-approved hosts; reject redirects/private metadata targets to avoid turning connection setup into arbitrary server-side requests. The exchange/worker credential contract follows [pairing](POD-BOOTSTRAP.md); final route details remain a proof gate. Disconnect/replacement must not erase uncertain jobs.

All mutation routes including tus require owner authentication and same-origin/CSRF protection. External browser login/hosting is owner-managed, outside this project. Default local binding is loopback; require an authenticated boundary for public exposure, explicitly configure trusted proxies/origins and never trust arbitrary identity headers. No public operation, event or draft API. Poll snapshots every two seconds while active; slower idle/focus refresh. Library/uploads work with compute off; submitting a job never secretly starts compute.

Tus creation metadata includes generated client selection ID, workflow/capability revision, declared name/type and local probe summary; the completion handler treats those as untrusted metadata. Use the same server-generated opaque ID for the tus upload and asset row; derive it from the standard Location/resume URL, including after HEAD/reconnect. Persist the asset row before exposing successful creation. The browser polls that asset after tus completes. The tus completion hook only persists `verifying` and returns promptly; the job/media dispatcher later performs integrity/preparation work, producing `ready` or a precise error. Do not run long FFmpeg work inside the final PATCH response. On restart, reconcile completed tus files and asset rows so a crash between those writes cannot strand an asset. No separate `/complete` endpoint. Partial uploads expire after 24 hours of inactivity; completed assets do not expire. Reserve remaining unwritten bytes against real available disk including other outstanding reservations; do not double-count partial bytes already occupying disk; streaming failures retain resumable state.

## Request fields

Required: `workflow`, `capabilities_revision`, `prompt`, `output`. Four IDs: `text-to-image`, `image-to-image`, `text-to-video`, `reference-to-video`.

Optional `model` must be enabled; `mode:'sfw'|'nsfw'` is required where selectable and omitted for identity edit without a mode distinction. Resolve internal FL2VA/Ref2VA routing from roles, never from a client model path. Freeze the route and exact preset before queueing.

`seed` is `random` or a decimal string **0–9007199254740991**. This intentionally uses the exactly representable JSON integer range in JavaScript, not full uint64. Advertise that range, persist the string and convert only after validation. Random seeds use the same range and resolve before dispatch. Full uint64 serialization adds no useful MVP behavior.

`references` is an ordered list of `{id,asset_id,kind,role,...}` with stable unique reference IDs. Image roles: `source`, `subject`, `reference`, `first_frame`, `last_frame`. Anchors/source/subject accept `framing:'fit'|'fill'` (default fit). Audio/video initially use `reference`. Clips require `range:{start_seconds,duration_seconds}`; video requires `include_audio:boolean`. No duplicate first/last/source/subject roles. Optional future guides additionally need `target_seconds`; do not accept that field until the native guide capability is enabled.

`output:{aspect,size,duration_seconds?}` accepts only advertised choices. Images start at `size:'1mp'`; video starts at `size:'720p'`, 9:16 or16:9 and 5/10/15 seconds. Explicit canvas maps live in shared capability data. Video `audio` defaults to `{output:'generated'}`; alternatives are `{output:'silent'}` or `{output:'source',asset_id,start_seconds}`. Source audio must contain a segment exactly as long as the output starting there; validate before upload/generation, no automatic loop/stretch/pad. Output-only soundtrack is not a model reference and does not consume conditioning slots. A video asset may supply its audio stream if present.

`advanced` accepts only advertised fields: initially tested identity reference strengths and supported LoRA strength overrides with configured bounds. Add native ratios/duration/export and engine settings after meaningful-effect tests. No ignored negative prompt/CFG controls. Unknown fields fail explicitly. One plain prompt only; no `prompt_fields` alternative.

Text-to-image and text-to-video accept no conditioning references. Image-to-image needs one source and optionally one subject. Reference-to-video needs at least one image/audio/video reference or anchor. Asset readiness, role combinations, effective clip ranges and complete budgets must pass before submission.

## Prompt labels and snapshots

Textarea insertion buttons insert actual native labels. A small helper holds stable reference-ID-to-label mapping, remaps exact recognized labels when ordering changes, and marks deleted/orphaned labels for correction. Preview the final prompt. The server independently derives/checks the same mapping; freeze it with the job. Soundtracks paired with videos consume audio numbering before standalone clips. Do not silently make an existing mention point at another file.

Store request, resolved seed, prompt/label map, route/template revision, exact model/LoRA files/strengths, preparation recipe, derivative IDs, output timing/dimensions and full graph JSON on the job. Queued jobs do not change when a preset changes. Reuse settings creates a local draft; missing retired assets are explained instead of substituted.

## Durability and ownership

`POST /jobs` uses Idempotency-Key: persist key and canonical body before any external call; same key/body returns the same job, different body409. No Start/Stop/cancel-start/keep-running or public lifecycle-operation endpoints exist. The backend never calls Runpod create/start/stop/terminate. Readiness is derived from the configured engine, not account inventory.

Worker UI states: `preparing`, `ready`, `busy`, `disconnected`. Pairing/connection progress and preparation failures are separate detail fields, not conflicting state names. Include `observed_at` and `stale`; old Ready observations cannot permit a new dispatch without a fresh session check. Expose friendly error reasons, not private engine addresses/keys. A failed probe is not proof that compute is stopped. Polling is read-only and never starts a pod.

Job states: `queued`, `preparing`, `submitting`, `running`, `copying`, `copy_pending`, `completed`, `cancel_requested`, `cancelled`, `failed`, `needs_attention`. Keep the waiting queue, with one submitted ComfyUI prompt at a time. Pause/Resume is a small dispatcher flag, not a pod lifecycle feature. This allows waiting jobs to remain intentionally parked across manual shutdown.

### Engine process identity

The private pod integration adds `GET /studio/session` **on ComfyUI, not the public /api/v1 namespace**, returning `{workspace_id, engine_session_id, protocol_version}`. `workspace_id` is initialized once in cache metadata and may change with a fresh cache/provider; it is not a portable service identity; `engine_session_id` is a fresh random UUID generated inside each actual ComfyUI process. It is not the Tailscale node, pod ID, wrapper PID or WebSocket client ID.

Before using an engine, verify protocol and explicitly connect its workspace/session, node/model requirements and current queue. Persist the session on each submitted job. Studio-originated `/prompt`, queue deletion, `/interrupt`, input uploads and `/free` if used carry `X-Studio-Engine-Session`; in-process middleware rejects missing/mismatched session on the protected studio integration path before mutations. Implementation must preserve a clearly separate authenticated admin maintenance path; do not silently bypass the guard or make a header-free retry after409. Use narrow namespaced proxy handlers in the same Comfy process if global middleware cannot distinguish legacy admin requests safely. No new network service.

A preflight GET followed by an unguarded POST is insufficient: the process can restart between them. The server-side expected-session check closes that race. Disconnect clears Ready and triggers reconciliation. A session mismatch never triggers automatic retransmission of a possibly submitted job.

### Reconnect and cancellation

On reconnect to the SAME session, reconcile job marker/prompt ID against queue/history and available records. On a NEW session, do not treat empty history as proof a previous request never ran. Recover closed outputs using the matching terminal manifest/receipts in the retained network-volume spool after pairing. Volume loss cannot be recovered this way. Old submitted/running/submitting jobs without a definitive result become needs_attention; no automatic rerun. A recorded terminal failure remains failed. Process restart cannot resume partially sampled generation.

Persist a job marker before `/prompt`; the pod integration records a receipt containing job ID/session before accepting studio work and writes a terminal output manifest after successful graph artifacts are closed. These are small JSON files in the network-volume job spool, retained with complete outputs until durable PC acknowledgment. A receipt alone does not prove completion or exactly-once execution. Match job/workspace/session and expected output set; partial files without a success manifest are not a completed result. The final manifest covers raw generated artifacts; retained source-audio mux or other local finishing can resume on local PC after those files are copied.

New never-submitted queued jobs may continue after reconciliation when the queue is not explicitly paused. An unresolved earlier job blocks FIFO dispatch until its outcome is resolved or the owner acknowledges/clears it. Do not automatically skip ambiguity. Document that queued jobs can resume when the owner restarts the pod; Pause queue preserves deliberate inactivity.

Cancel local waiting jobs in SQLite. Cancel submitted queued work by prompt ID in its matching session. Running cancel uses the pinned runtime's tested interrupt behavior under exclusive studio queue ownership. If it only provides global interrupt, no concurrent direct/manual dispatch is allowed. Keep cancel_requested durable across disconnect; reconcile it before any new work. Never send an old job's interrupt/delete to a new engine session. Direct manual generation requires maintenance with studio dispatch paused; foreign work blocks mutation/dispatch for attention.

### Manual shutdown and output recovery

The app cannot prevent manual Runpod shutdown. If the owner stops during generation, report interruption/uncertainty based on evidence; do not claim cancellation succeeded just because the connection died. After a confirmed output manifest, interrupted copy becomes copy_pending. Retry through this worker or a paired replacement on the same volume. Retain files until durable local receipt; no S3 access is needed. Volume loss before transfer can lose results. Never regenerate to repair a download.

Copy to local PC before completed. Display waiting/running jobs and pending transfers so the owner can wait or cancel/pause before stopping in Runpod. No idle timer, shutdown call, cost estimate or provider-off assertion. Output persistence, job cancellation and queue pause operate independently of compute lifecycle.

## Errors and storage

Error: `{error:{code,message,field?,retryable},request_id}`. Use400 malformed,401/403 auth,404 unknown resource,409 revision/state/idempotency conflict,422 defensive semantic error,507 disk exhaustion,503 dependency unavailable. Tus retains its standard protocol statuses/headers.

Normal input requirements are checked client-side before bytes transfer. Server checks auth, integrity, manipulated requests, stale capabilities and actual resource failure. Preflight is not proof that all bytes are uncorrupted. Stream originals; generated names only, no user paths. Cache derivatives by asset+recipe. Atomically publish files and reconcile incomplete promotions after restart. Local copy completion includes durable files plus SQLite commit. Acquisition is owner CLI/config, never a browser arbitrary-download or shell endpoint.

[Examples](job-examples.json) and [preparation rules](ASSET-PREPARATION.md).


## Revision 5 pending contract work

Specify the worker token exchange and idempotent durable-receipt/cleanup routes before implementation. Keep saved-output state separate from cleanup state. Safe-to-terminate must require paused dispatch, no active generation and no unsaved outputs with fresh worker reconciliation; disconnected reports unknown. Main job-state enums may map to friendlier progress labels; do not infer billing state.

## Existing ComfyUI API first

Use documented [routes](https://docs.comfy.org/development/comfyui-server/comms_routes) and [messages](https://docs.comfy.org/development/comfyui-server/comms_messages): prompt submission, queue/history inspection, WebSocket execution progress, upload/view and interruption. Check the pinned server's actual schemas before implementing adapters. Do not recreate ComfyUI's execution queue/progress tracking. The local durable waiting list only dispatches one job at a time and reconciles native state.

ComfyUI execution state cannot establish that the PC saved a file. Combine native generation status with PC transfer/receipt state for the shutdown indicator. Pairing/preparation status exists before ComfyUI starts, so it remains in the small early worker component; durable receipt/cleanup is the other narrow integration boundary. No generic orchestration framework is needed.
