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

- Worker execution starts on Comfy's `execution_start` event and ends at native
  task completion, covering loading/encoding/sampling/decoding and output writing.
  Uses a monotonic clock, not timestamps from two different machines.
- Every approximately two seconds, `nvidia-smi` samples visible GPU names/UUIDs,
  driver version, total VRAM, device-wide used VRAM and GPU activity. Store sampled
  peak used MiB and arithmetic mean activity per GPU, plus sample/error counts.
- Linux system RAM peak is sampled from MemTotal minus MemAvailable. This is
  host-wide usage, not process RSS or necessarily the container RAM limit.
- PC timestamps record first input-transfer attempt, prompt submission, durable
  local save and terminal outcome. Elapsed-to-save includes queue and transfers;
  cleanup retries never change saved time. These are not pure GPU timings.

Sampling includes cached model allocations and other processes. It is NOT the
minimum VRAM required to run the model; sampling can miss short peaks. No samples
means unavailable, never zero usage. Failed/cancelled executions retain measurements
when native completion runs; abrupt termination leaves an incomplete last snapshot.
Worker measurements remain in the volume spool for recovery and copy into the PC
record before outputs are acknowledged. Old jobs/workers remain compatible but
cannot retrospectively supply measurements. Existing job details are local data,
not anonymized exports.

## Delivery and next validation

Implemented locally September 10, 2026. Unit/integration checks cover aggregation,
unavailable GPU data, execution hooks, failed jobs and statistics surviving cleanup
retries. A new worker image and a live GPU run are still required before calling
GPU collection production-verified. No running pod is changed by this code edit.
No statistics dashboard is added in this pass; existing job APIs expose the data.

Next compare the same 15-second heavy-reference job across candidate GPUs: exact
graph/model configuration, input counts/types, execution seconds, sampled VRAM,
RAM, success/failure and visual result. Keep cold and repeated runs separate;
retained graphs alone do not prove whether Comfy reused cached computation.
