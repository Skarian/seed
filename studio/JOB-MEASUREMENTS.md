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
Worker measurements remain in the worker spool for recovery and copy into the PC
record before outputs are acknowledged. Old jobs/workers remain compatible but
cannot retrospectively supply measurements. Existing job details are local data,
not anonymized exports.

## Interpretation and next work

The worker image pin is owned by shared/worker-release.ts; do not copy historical
image digests or private pod/template IDs into this specification. Current release
and live evidence are in [validation](VALIDATION.md).

A fair hardware comparison holds model, graph, input count/types, seed and output
settings fixed and separates cold from repeated runs. Compare runtime, sampled
memory, success and visual/audio quality. The maximum-reference 15-second matrix
is deferred. No additional telemetry dashboard or external collector is planned.
