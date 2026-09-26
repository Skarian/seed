# Worker pool: first live GPU validation

Date: 2026-09-23 UTC (September 22 local time). Budget authorized: $5.

## Scope and configuration

One RunPod RTX PRO 6000 Blackwell Server Edition, 96 GB VRAM. The real Seed application rented the worker, prepared it, submitted normal-mode jobs, saved their outputs, and requested **Finish jobs and quit**. Credentials were read from the existing Admin-backed credential store. No second rental was created.

This restored the existing inference recipe: pruned INT8 ConvRot H3 FL2VA and Ref2VA checkpoints, INT8 ConvRot Qwen conditioning, FP16 video VAE, FP32 audio VAE, 30 `res_multistep` steps, Kitchen/Sol attention with tau 1.3 and a 20% start threshold. It is not a full BF16 reference model or an SGLang benchmark. All tests used 1344 × 768 output, 24 fps, generated stereo audio, and no LoRA.

The rate was $2.09/hour compute plus $0.02514/hour estimated disk cost, or **$2.11514/hour** total. Per-job amounts below measure the allocated worker's time from engine submission through local saving; they exclude initial preparation, queueing, debugging, and idle time.

## Generation results

| Test | Engine execution | Engine submission to saved output | Worker cost for that interval |
| --- | ---: | ---: | ---: |
| 5-second text-to-video | 144.0 seconds | 145.2 seconds | $0.085 |
| 5-second reference-to-video, three real images | 177.2 seconds | 177.8 seconds | $0.104 |
| 15-second text-to-video | 593.9 seconds | 595.0 seconds | $0.350 |

Saved outputs:

- [5-second text-to-video](http://192.168.1.212:4310/api/v1/assets/29664e2c-b099-4dfc-840f-34d8fb482149-0/content)
- [5-second reference-to-video](http://192.168.1.212:4310/api/v1/assets/f78c7e26-5fc7-4349-bb0f-a5441e1e97af-0/content)
- [15-second text-to-video](http://192.168.1.212:4310/api/v1/assets/95b58763-9d97-496d-a990-ad56bed8960c-0/content)

The reference request used two existing dog photographs and a full-resolution frame extracted from the first new video through the app's Pick Frame operation. Each reference was inspected; these were populated image files, not placeholders.

The reference job's full request-to-save latency was 395.0 seconds. About 217 seconds preceded engine submission because an SSH upload stalled and was repaired during the test. The table separates that failure from actual inference performance. The first text job also waited during initial setup debugging, so its full request-to-save time is not representative of a ready worker.

## Direct model downloads and startup

The container downloaded five public model files directly from Hugging Face and verified their hashes. The app did not relay model bytes.

| Component | Downloaded bytes | Transfer time |
| --- | ---: | ---: |
| FL2VA DiT | 20,970,379,616 | 169.79 seconds |
| Ref2VA DiT | 20,970,379,616 | 175.27 seconds |
| Qwen conditioner | 27,141,342,152 | 242.40 seconds |
| Audio VAE | 605,254,808 | 6.76 seconds |
| Video VAE | 5,207,808,496 | 88.16 seconds |
| Total | 74,895,164,688 | 682.38 seconds |

The successful transfer stage took **11 minutes 22 seconds**, costing approximately **$0.40** at this worker's rate. Engine startup then took roughly 16 seconds. The container entrypoint began about nine seconds after allocation. These are one-host observations; network speed and image caching will vary. The initial preparation failures consumed additional paid debugging time and are included in total rental spend, not hidden in the successful transfer numbers.

## Problems found and repaired

1. **Civitai manifest mismatch.** The app emitted version-only download URLs, while the worker required an exact file identity. Manifest generation now uses the saved version ID and file ID. A real seven-file manifest validated against the worker's Python parser without downloading the optional LoRAs.
2. **Anonymous Hugging Face downloads.** An empty token produced an invalid empty Bearer header. Public downloads now explicitly disable token authentication. This fix was applied to the live test container's download helper and included in both republished images.
3. **Preparation error reporting.** Rejected manifests are now preparation failures rather than misleading connection failures. Retries clear stale errors for files not yet ready. The period between downloaded models and engine readiness is shown as engine startup.
4. **Reconnect with a stalled SSH tunnel.** Reconnect now closes the old transport and starts a new connection while retaining worker identity and pairing. The repaired action was exercised while the 15-second job was running. This fixes the ineffective reconnect action; it does not establish the underlying cause of the original network stall or prove automatic recovery from every live-but-hung tunnel.

The coordinator was restarted during testing without losing the remote generation or its saved result. The final job was accepted before requesting Finish jobs and quit. The final file was saved at 04:51:48.445 UTC, and the worker was recorded as released at 04:51:49.677 UTC. The application persisted output acknowledgements for all three jobs. RunPod absence was independently confirmed, and the budget watchdog exited after that confirmation.

## Release provenance

The GPU rental initially ran:

`ghcr.io/skarian/seed-worker-video@sha256:ebd851ffdd8fabd59a116457a57e2360f7a2c08c3006d5c61b3e056e72e36a3d`

Only its public download helper was patched in place. Its inference code was unchanged.

Corrected images were built, checked, publicly published, and selected for future launches:

- Video: `ghcr.io/skarian/seed-worker-video@sha256:39b9519637452c2de73484291ca6d17d88b48426f64fdc30b6c3de418c993b96`
- Image: `ghcr.io/skarian/seed-worker-image@sha256:40f5f844449083d3f8ad85bba4424132ce757803106262bfc584caa0312b0953`

Both corrected images passed source fingerprint checks and offline container startup/authentication checks. Their registry manifests, configuration digests, and layers are anonymously accessible. A fresh GPU boot of these exact new digests has not been performed. The image worker, Qwen editing, LoRA inference, and Vast were not GPU-tested in this run.

## Verification and remaining limits

- TypeScript checks passed; 265 application tests and 83 Linux worker tests passed.
- Eleven container SSH/transport checks passed, including replacing an existing tunnel while preserving identity and pairing.
- Chrome review covered worker status, hourly/accrued costs, Activity results, and the real media preview.
- All three videos fully decoded without errors and contain stereo AAC audio. Their durations are exactly 5, 5, and 15 seconds. Early, middle, and late frames were reviewed individually. The sampled frames showed coherent dog appearance and anatomy, with a consistent red collar in the reference result. The long clip still depicts walking near its end, so the requested pause/bark is not established by the sampled visuals.
- Audio was technically validated, not listening-rated. Mean/max levels were -40.1/-15.4 dB for five-second text-to-video, -24.2/-0.4 dB for reference-to-video, and -36.7/-7.6 dB for the long clip. The text clips are substantially quieter. Frame sampling does not establish complete temporal quality or lip/audio synchronization.
- Peak used GPU memory reported by the engine was approximately 50.2 GiB, 75.6 GiB, and 83.1 GiB respectively. These are observed peaks with sequential jobs and retained model/cache state, not isolated minimum VRAM requirements.

The 15-second workload produced 109,137 tokens versus 37,785 for the five-second text case. Its early dense-attention steps took about 34 seconds each; subsequent Sol-attention steps took about 14 seconds each. Duration therefore does not scale linearly in this configuration. This helps explain why short-clip speed claims do not transfer directly to 15-second generation on one GPU.

Local evidence is under `.local/gpu-smoke/run-2026-09-23T04-09-59-085Z/`, with sanitized lifecycle events, model transfer logs, job receipts, media probes, QA frames, and provider verification. Container verification and publication evidence are under `.local/gpu-smoke/` and `worker/`.

## Final accounting and shutdown

**Estimated total: $1.4733 of the authorized $5.** Allocation lasted 41 minutes 47.5 seconds, from 04:10:02.179 to 04:51:49.677 UTC. This includes model transfers, setup debugging, inference, and idle time. Generation-to-save intervals account for approximately $0.5394, successful model transfers $0.4009, and all remaining setup/debugging/idle time approximately $0.5330.

The app's released state and RunPod's empty result for this owned rental were checked at 04:52:54 UTC. Both test observer and budget watchdog processes exited. There are no remaining test rentals.

The provider's billing endpoint had not yet posted this pod's record at the final check. The $1.47 figure is an elapsed-time/rate estimate including estimated storage, not a settled invoice.
