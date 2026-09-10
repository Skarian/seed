# Job measurements

Seed keeps measurements in the existing SQLite job snapshot, available through
`GET /api/v1/jobs` and `GET /api/v1/jobs/:id`. No external telemetry service.

## Recorded context

Existing job fields retain workflow, mode, actual seed, output size/aspect/duration,
batch position, immutable mode preset and complete submitted Comfy graph (including
model filenames, sampling settings and dimensions). References retain asset IDs,
types, roles, selected time ranges, soundtrack selection and prepared hashes/frame
counts. `metrics.inputs` adds image/video/audio counts, extracted soundtrack count
and prepared transfer bytes. Counts describe user assets; soundtracks are separate.

## New measurements

- Execution duration comes from native Comfy history's `execution_start` and
  terminal `execution_success`, `execution_error` or `execution_interrupted`
  timestamps. Missing/invalid timestamps produce null, not a guessed duration.
- A small worker-side sampler calls the private native `/system_stats` endpoint
  approximately every two seconds. It retains per-device total memory and peak
  total-minus-free MiB, host RAM peak and Comfy/PyTorch/Python versions.
- No NVIDIA subprocess collector, GPU activity percentage, or independent
  execution timer. Only sampling/aggregation and durable retention remain custom.
- PC timestamps still record first input-transfer attempt, prompt submission,
  durable save and terminal outcome. Elapsed-to-save includes queue/transfers;
  cleanup retries never change saved time.

Version 2 uses Comfy memory accounting: reclaimable PyTorch cache counts as free.
It is not interchangeable with version 1's NVIDIA device-used readings. Samples
can miss short peaks and are not the minimum hardware requirement. Failed reads
increment failed_samples; absent values remain null. Software metadata is
allowlisted; native argv and other unrelated fields are not persisted.
Failed/cancelled jobs retain metrics when native completion runs; abrupt process
termination leaves an incomplete last snapshot. Late samples after completion
are discarded. GPU sampling remains on the worker so PC disconnection does not
stop collection.
Worker measurements remain in the volume spool for recovery and copy into the PC
record before outputs are acknowledged. Old jobs/workers remain compatible but
cannot retrospectively supply measurements. Existing job details are local data,
not anonymized exports.

## Delivery and next validation

Implemented locally September 10, 2026. Unit/integration checks cover aggregation,
unavailable GPU data, execution hooks, failed jobs and statistics surviving cleanup
retries. Published worker image `ghcr.io/skarian/seed-worker@sha256:f445e5e50393d2c2845563479e73c68582fbc2f76c7fb2ee28217a6bd243993b`.
GitHub build [34510122554](https://github.com/Skarian/runpod/actions/runs/34510122554)
succeeded; anonymous registry manifest and digest verified. Private seed template
`tt0cmuwu3t` and stopped pod `q4x2jnxkt81ept` now pin this image. Pod remained EXITED;
credentials and mounts were verified unchanged. Installed local CLI/server updated
and restarted; jobs API returned HTTP 200. Live GPU measurements await the owner’s
later test; no pod started or generation submitted.
No statistics dashboard is added in this pass; existing job APIs expose the data.

Next compare the same 15-second heavy-reference job across candidate GPUs: exact
graph/model configuration, input counts/types, execution seconds, sampled VRAM,
RAM, success/failure and visual result. Keep cold and repeated runs separate;
retained graphs alone do not prove whether Comfy reused cached computation.

## Native collection revision

September 10: switched to native Comfy statistics/history after reviewing the
pinned upstream implementation. Version 1 records remain readable; new records
use version 2. Live validation still requires a user-started pod. Release pin
for this revision is recorded in EXECUTION-PLAN.md.
