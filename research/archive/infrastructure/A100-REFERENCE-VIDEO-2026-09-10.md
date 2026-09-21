# A100 reference-video validation

Started September 10, 2026 (September 11 UTC). User supplied an existing RunPod instance and authorized a demanding reference-video test with VRAM monitoring. No additional GPU provisioned.

## Hardware and software

- RunPod `nx6k8j02cc15qa`, `urban_blue_tuna`, original model volume `f7vnixgws1`.
- NVIDIA A100-SXM4-80GB: `nvidia-smi` reports 81,920 MiB; driver 580.159.04. Provider price $1.59/hour.
- Existing published Seed worker digest `f7f4453a199ae43aacfdfcd62f089b31cd42f3967e0dc5f3f2bb3bfd4977d054`.
- ComfyUI 0.34.0, PyTorch 2.11.0+cu130. No worker or application code changes needed to begin the job.
- Paired existing PC Seed application to this instance; no existing queued/active work at pairing.

## Test 1: mixed references, maximum output duration

Job `aa873443-353a-423a-99db-7f12d3fbcad7`.

- Reference-to-video, SFW; existing benign fox/forest test assets.
- One image, one 2.5-second video with soundtrack, one separate 2.5-second audio clip. Three user assets, two audio conditioning streams.
- 15-second landscape output, UI 720p preset; actual graph 1344 × 768, 362 frames before final duration trim, 24 fps, generated audio.
- MiniMax H3 Ref INT8 ConvRot, Qwen3-VL 32B INT8 ConvRot encoder, official 8-step turbo LoRA at strength 0.8; Euler/simple, eight steps. No content LoRA.
- First generation on this engine: model files already present, model loading included in execution.
- Submitted 2026-09-11 01:22:25 UTC. Completed successfully; saved on PC at 01:45:22 UTC.

## Measurement interpretation

Seed retains native Comfy `/system_stats` samples every approximately two seconds and native execution timestamps. A temporary `nvidia-smi` collector also samples once per second for this experiment; it is not a new runtime dependency or a replacement telemetry implementation.

NVIDIA resident memory includes cache; Comfy counts reclaimable cache as available. Neither sampled peak proves a minimum GPU capacity. Native system RAM is host-wide in this container (reports roughly 1 TB total), not a per-job/process requirement. `/proc/<Comfy PID>/status` provides a separate process RSS/high-water reading; an interim reading was approximately 51 GiB RSS, no swap.

## Final result

| Measurement | Result |
| --- | ---: |
| Native engine execution | 1,374.901 seconds / 22m 54.9s |
| App elapsed to durable save | 1,381.227 seconds / 23m 1.2s |
| Sampling | 18m 57s total, about 142 seconds/step |
| NVIDIA peak resident GPU memory | 64,999 MiB / 63.48 GiB |
| Native Comfy sampled peak used GPU memory | 59,567.44 MiB / 58.17 GiB |
| Comfy process RSS high-water at completion | 60,860,672 KiB / 58.04 GiB; no swap |
| Native telemetry | 671 successful samples, 1 failed sample, complete=true |
| Compute cost for engine execution at $1.59/hour | Approximately $0.61; excludes other running time/storage |

No generation error or OOM. Final MP4 is 15.00 seconds, 1280×720, 24 fps H.264 with stereo 32 kHz AAC, 6,148,329 bytes. Full local audio/video decode via FFmpeg completed without errors. Three sampled frames show a coherent fox/forest scene and head movement; this is a basic visual check, not exhaustive temporal/audio quality review.

Output asset `aa873443-353a-423a-99db-7f12d3fbcad7-0` is in the PC library; SHA256 `48052385b64446df276d48dff44cfdd7e8b9d3aa13d96dbc3e694f577f55414f`. Job reached completed with cleanup complete, proving metrics were retained through transfer and acknowledgment. Temporary NVIDIA monitor stopped. Local raw job record and trace are in ignored `.local/a100-results.json` and `.local/a100-gpu.csv`.

**Conclusion:** A100 80 GB works for this 15-second mixed-reference job with the existing Seed image. Generation latency is substantial. This is not a matched speed comparison with the earlier RTX tests, which used different duration/reference/mode combinations. It does not establish A100 40 GB suitability, maximum-reference capacity, or warm-run speed. A 12-reference fixture was prepared but not submitted; no second long run was launched.
