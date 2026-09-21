# Job measurements

Seed stores measurements in each SQLite job snapshot, exposed through
`GET /api/v1/jobs` and `GET /api/v1/jobs/:id`. There is no telemetry service.

Each request pins the workflow, prompt, actual seed, output settings, selected
adapter IDs/hashes/strengths, reference roles/ranges and prepared-file hashes.
`metrics.inputs` records user reference counts, separate video soundtrack count,
and total prepared bytes. `fal` records the endpoint, immutable submitted input,
request receipt, result, upload duration and observed queue/run/completion times.

`created_at` is local admission. `metrics.submitted_at` precedes the paid POST;
`fal.queued_at` records its acknowledgement. `running_at` and `completed_at`
are first observations by the two-second poller, not precise GPU timestamps.
`metrics.saved_at` means media and Library records are durable locally;
`elapsed_to_saved_seconds` includes local queueing, uploads, provider latency,
download and verification. Long first adapter uploads are measured separately
when preloaded through the CLI. Repeat uploads are cached by adapter hash.

This does not measure GPU initialization or individual denoising/decode stages;
those are inside fal. It does not infer cost from wall time. Live acceptance
costs come from fal billing events matched by request ID and are documented in
VALIDATION.md. No billing/admin key is required for normal application use.
