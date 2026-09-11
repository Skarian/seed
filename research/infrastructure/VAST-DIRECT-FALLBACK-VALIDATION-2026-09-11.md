# Vast direct-download and fallback validation — 2026-09-11

Validated on one RTX PRO 6000 Blackwell Server Edition, 96 GB VRAM, 600 W. Vast instance 50616033, offer 40176815, machine 138918, US (no state supplied by provider). Price at rental: $1.5167/hour including 180 GB disk; inbound/outbound transfer advertised at $0.001302/GB. No active RunPod GPU; no second Vast instance. Left running for owner use after validation.

## Preparation

- Ohio offer 46296973 appeared in search but rental returned explicit no_such_ask. Reconciled an empty account before switching offers; no duplicate allocation.
- Container ready roughly four minutes after rental. This is image pull/startup time, separate from model preparation.
- All 11 base models (99,624,767,830 bytes) downloaded directly using the existing official Hugging Face library. Sum of file download/verification timers: 275.39 seconds. First staging directory to final base-model receipt: 282.48 seconds, 352.68 MB/s effective.
- All three configured Civitai direct downloads failed on this host. Automatic fallback sent the existing verified PC copies (1,855,160,376 bytes), verified them remotely and activated image/FL/ref presets.
- Full boot preparation: 408.468 seconds, including model checks, direct downloads, fallback and worker launch. Pairing succeeded and all three implemented workflows advertised both modes.
- Source tokens arrived per file through SSH stdin. Audit of 18 worker configuration/preparation files found no source-token values. Worker config contained only pairing and Jupyter keys. This bounded audit does not make the host trusted or prevent memory inspection.
- Separate isolated live test: fallback disabled caused a clear error and no PC download; enabled with an empty temporary PC cache downloaded a 137,654,280-byte LoRA locally, verified/transferred it and activated it in the isolated workspace in 14.97 seconds. Both temporary PC and VM copies were removed. Production cache and presets were untouched.
- Repeated boot returned running/reused without restarting the worker or redownloading.

## Generation and saved output validation

Non-explicit fox/forest prompts exercised SFW and LoRA-enabled NSFW modes. Images were landscape 1 MP. All videos were 5 seconds, 1280×720 with audio. Reference jobs reused a generated Library image and a three-second segment of a generated Library video with its soundtrack. These are smoke tests, not 15-second/max-reference capacity benchmarks.

| Workflow | Mode | GPU execution (s) | Saved end-to-end (s) | Peak VRAM (GiB) |
|---|---|---:|---:|---:|
| text-to-image | sfw | 19.04 | 21.05 | 17.7 |
| text-to-image | nsfw | 3.80 | 5.46 | 18.2 |
| text-to-video | sfw | 117.03 | 119.43 | 67.2 |
| text-to-video | nsfw | 81.41 | 83.89 | 69.0 |
| reference-to-video | sfw | 186.78 | 190.92 | 87.6 |
| reference-to-video | nsfw | 179.55 | 181.60 | 81.5 |

Every output was saved, retrieved through Seed's content endpoint and SHA256-checked against its metadata. All six job cleanup states were complete. All four video files probe as five-second 720p MP4s with audio. Inspected the generated image and a video frame; browser screenshots confirmed Model loading, percentage progress and Working status. Audio-track presence was verified, not subjective audio quality.

VRAM uses the existing Comfy system_stats sampler at two-second intervals; reclaimable PyTorch cache counts as available. All six telemetry records completed with zero failed samples. Cold/warm model state differs between runs, so these mode timings are not controlled LoRA performance comparisons. Host-wide RAM statistics are not used to infer per-container RAM requirements.

## Issues caught and fixed

1. The prior global install with npm scripts disabled omitted FFmpeg. Restored the matching binary and added setup/start execution checks for FFmpeg and FFprobe. Do not disable lifecycle scripts on fresh installs.
2. Saved generated videos lacked has_audio metadata for Library reuse. Media now probes and persists missing duration/audio/video metadata when described or reused. Fixed before either reference job was submitted; no failed GPU generations.

Commit 8c609a7 contains the fixes. Full regression checks passed: 51 app tests, 28 helper tests, 40 worker tests; one Windows symlink skip. Secret scan passed. The original direct-first implementation is commit 29cf69c; both pushed.

## Job records

- text-to-image / sfw: 4e62501b-73e9-4495-b82f-00079eb24680
- text-to-image / nsfw: 414d62b4-3785-4708-b4be-00d1531e055a
- text-to-video / sfw: 92406c48-62af-45d4-a615-4cd65aec8a65
- text-to-video / nsfw: 287d7954-4716-40a8-9de1-cc19d5861a98
- reference-to-video / sfw: f442b634-a782-4ab3-9e3f-1b218e6f9162
- reference-to-video / nsfw: 20f60ced-ffb2-4aba-9d35-76ab7257d497

## Remaining limits

Full 100 GB PC-to-GPU transfer timing, maximum 15-second mixed-reference VRAM, macOS operation and automated RunPod SSH provisioning are not established by this test. Standalone audio uploads and first/last anchors were not separate paid smoke cases here. Identity editing remains unfinished. Billing continues while this rental is running; historical test charges are not a final bill.
