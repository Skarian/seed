# Local API

The running implementation is in server/http.ts, server/media.ts and the shared
request types. Routes below use `/api/v1`. Browser requests never contain provider
keys, arbitrary model paths or executable graphs. Host/Origin checks protect local
mutations; public hosting needs an owner-managed authenticated boundary.

| Route | Behavior |
|---|---|
| GET /health | Local app identity; not GPU readiness |
| GET /studio | Worker observation, queue, pending outputs and fresh termination safety |
| GET /capabilities | Current revision and enabled image/video workflows/modes |
| PUT /connection | Exchange `{connection_code}`; keep credential server-side |
| DELETE /connection | Forget pairing and pause dispatch; does not stop billing |
| POST /queue/pause, /queue/resume | Control local dispatch, not compute |
| /uploads and /uploads/{id} | Resumable tus creation, HEAD/PATCH/DELETE |
| GET /assets | Cursor-paginated Library inventory |
| GET /assets/{id} | Upload/preparation metadata |
| GET /assets/{id}/content | Saved content with Range support |
| DELETE /assets/{id} | Confirmed UI deletion; retains job history; can refuse pending cleanup |
| POST /jobs | Idempotent durable batch submission; returns 202 or submission error |
| GET /jobs, /jobs/{id} | Paginated history or one job snapshot, including metrics |
| POST /jobs/{id}/cancel | Request cancellation |
| POST /jobs/{id}/acknowledge | Explicit acknowledgment of an uncertain outcome; no automatic rerun |

## Submission

Send `Idempotency-Key` and the current `capabilities_revision`. Supported workflow
IDs: `text-to-image`, `text-to-video`, `reference-to-video`. Identity editing is
not implemented. Send prompt, mode (`sfw` or configured `nsfw`), output, optional
seed/count and video references/audio where applicable. Unknown fields fail.
Exact request validation lives in server/workflows.ts and server/video.ts.

Output: image `1mp`; video `720p`, 5/10/15 seconds; portrait 9:16 or landscape
16:9. Video audio is generated or silent. Supplied final soundtrack replacement,
arbitrary advanced model controls and native export settings are not implemented.

Count defaults to 1, maximum 16; jobs execute sequentially. Fixed seed strings may
span 0–9007199254740991, including the batch increment. Random seeds currently use
48 random bits and are distinct within a batch. Fixed child seeds increment from
the starting seed; overflow is rejected. Same idempotency key/body returns the
original submission, while a changed body conflicts.

References use saved asset IDs, stable reference IDs, kinds, roles and clip ranges.
The server validates readiness and resolves FL/Ref routing, derivatives and native
prompt labels. Never silently substitute an asset when labels become invalid.
Freeze settings, resolved seed, graph, preset and prepared inputs in each job.

## Durability and sessions

One dispatcher submits one Comfy prompt at a time. Worker/session IDs distinguish
restarts from continued execution. Session checks guard submission/cancellation.
Uncertain execution blocks further dispatch until reconciled or acknowledged;
never regenerate automatically to repair an interrupted output transfer.

Completed worker manifests identify output files. Transfer, verify and durably
save on the PC before acknowledging cleanup. Retry transfer/receipt independently
of generation. Disposable disk deletion loses unsaved worker outputs.

`safe_to_terminate` is true only with a fresh affirmative observation and no active
work or unsaved outputs. It may be null while refreshing or disconnected. Pause
then wait for the asynchronous safety observation; an immediate read can be stale.
Provider CLI deletion independently confirms that billing resources disappeared.

See [asset handling](ASSET-PREPARATION.md), [worker](POD-BOOTSTRAP.md),
[workflow integration](COMFYUI-CHANGES.md) and [job metrics](JOB-MEASUREMENTS.md).
