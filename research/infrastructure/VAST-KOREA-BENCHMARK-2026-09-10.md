# Vast South Korea Seed trial

September 10, 2026 local / September 11 UTC. User authorized the South Korea offer and explicitly authorized transfer of Hugging Face/Civitai tokens and fresh worker pairing/Jupyter credentials. One GPU instance only.

## Instance and setup

- Vast instance `50544931`, machine `38632`, offer `49810152`, South Korea.
- One RTX PRO 6000 Blackwell Workstation Edition: 97,887 MiB reported by NVIDIA, 600 W, driver 595.71.05. Offer advertised approximately 193,188 MiB system RAM.
- $1.45/hour including 180 GB local disk. Disk component approximately $0.02333/hour ($16.80 per 720-hour month) while retained. Offer bandwidth rates: inbound $0.0000260417/GB, outbound $0.0000390625/GB. These are the observed offer rates, not a settled invoice.
- Existing public Seed worker image digest `f7f4453a199ae43aacfdfcd62f089b31cd42f3967e0dc5f3f2bb3bfd4977d054`, with Vast's SSH launch mode. No model weights or credentials added to the image.
- Image download, extraction and Vast SSH-layer setup took approximately seven minutes. Additional operator setup time is separate from model preparation and job execution.
- Temporary trial adaptation only: worker uses the instance's root filesystem for model storage; worker/Jupyter bind to loopback. An SSH tunnel forwards local ports 18080 and 18888. The worker uses its existing development allowance for a loopback HTTP origin; traffic across the internet is encrypted by SSH. The local app uses its existing `localTestWorkerOrigin` option through an ignored trial launcher. This is not a released Vast integration.
- Fresh pairing/Jupyter secrets are encrypted locally with Windows DPAPI. Provider tokens were transferred over SSH, never committed or included in the public image. Private trial configuration on the instance is mode 0600.

## Fresh model preparation

All 11 pinned base-model manifest files were absent at the start. Downloads came directly from Hugging Face with the saved token, sequentially through the existing worker preparation code. No source RunPod volume or home-hosted model cache was used.

| Measurement | Observed value |
| --- | ---: |
| Verified model bytes | 99,624,767,830 bytes (99.62 GB / 92.78 GiB) |
| First download staging directory timestamp | 2026-09-11 02:37:51.915 UTC |
| Final verified-model receipt timestamp | 2026-09-11 02:43:06.706 UTC |
| Download + verification + promotion | 314.79 seconds / 5m 14.8s |
| Effective preparation throughput | 316.48 MB/s / 2.53 Gbit/s |

Timing is reconstructed from the first staging directory and last successful verification receipt. It includes checksum verification, sequential per-file overhead and final file promotion; it is **not** an isolated network-only timer. Container setup and ComfyUI initialization are excluded. All 11 expected receipts and exact manifest byte totals were checked. No download/preparation error was observed. Civitai content LoRAs are not part of this base-model measurement and were not needed for the SFW benchmark.

## Video benchmark

- Job `97a20395-6080-42df-b543-4065d70ea1e5`.
- Same 15-second SFW mixed-reference job as the [A100 benchmark](A100-REFERENCE-VIDEO-2026-09-10.md): one image, one 2.5-second video with audio, one separate 2.5-second audio clip; generated audio; 720p landscape output.
- Same fixed seed `264061573093372`, model files, eight-step turbo LoRA and all graph inputs. Comparison of all 18 graph nodes found only job-specific input/output path differences.
- ComfyUI 0.34.0, PyTorch 2.11.0+cu130. First generation on this engine; loading/initialization included.
- Native Seed/Comfy telemetry plus a temporary one-second NVIDIA sampling trace. Native Comfy and NVIDIA resident-memory measurements use different definitions, as documented in the A100 report.

### Completed results

| Measurement | Vast RTX PRO 6000 WS | Previous A100 80 GB |
| --- | ---: | ---: |
| Engine execution, including model initialization | 803.237 s / 13m 23.2s | 1,374.901 s / 22m 54.9s |
| App elapsed to durable save | 816.371 s / 13m 36.4s | 1,381.227 s / 23m 1.2s |
| Eight sampling steps | 12m 11s | 18m 57s |
| NVIDIA peak resident GPU memory | 64,852 MiB / 63.33 GiB | 64,999 MiB / 63.48 GiB |
| Native Comfy sampled peak used GPU memory | 53,966.81 MiB / 52.70 GiB | 59,567.44 MiB / 58.17 GiB |
| Comfy process RSS high-water | 61,355,648 KiB / 58.51 GiB | 60,860,672 KiB / 58.04 GiB |
| Native telemetry samples / failures | 399 / 0 | 671 / 1 |
| Execution-only cost at quoted instance rate | $0.324 | $0.607 |

Vast completed this job in **41.6% less engine time (1.71x throughput)**. This is one matched first-generation test on each machine, not a general provider/GPU performance claim. Later Vast sampling steps were around 93.4 seconds; the first included initialization. The GPU ran near 600 W and 100% utilization; one observation showed 70 C, PCIe Gen 5 x16, 1,980 MHz SM and 13,365 MHz memory clocks. No OOM or generation error; no process swap observed.

The output is a 15.00-second, 1280x720, 24 fps H.264 MP4 with stereo 32 kHz AAC, 6,086,074 bytes. Full local FFmpeg audio/video decode passed. Three sampled frames show a consistent fox/forest scene and head movement; this is a basic visual inspection, not exhaustive audiovisual quality scoring. SHA256: `9ee44536b6c2b8216ba62e914885b7a2fea65b969902ba852563160e01bd7aa9`.

Job completed with output saved and worker cleanup complete. Output asset: `97a20395-6080-42df-b543-4065d70ea1e5-0`. Native metrics remain in the Seed job history. Ignored raw evidence: `.local/vast-results.json`, `.local/vast-video-gpu.csv`, `.local/vast-video-hardware-summary.txt`, `.local/vast-preparation-final.txt`, `.local/vast-graph-comparison.json`.

## Image check

Job `0185531c-41a0-4bf2-920b-34f758ecdb76`: SFW text-to-image, Krea 2, 1 MP landscape fox/forest image, no content LoRA. Ran after the video on the same engine.

- Engine execution: **12.284 seconds**; app elapsed to save: **16.786 seconds**.
- Native telemetry complete: seven samples, zero failed samples. Generation, local save and worker cleanup succeeded. The saved image was visually inspected.
- Native sampled GPU use peaked at 70,049.80 MiB / 68.41 GiB. **This includes the previously loaded video models retained in the same engine; it is not an isolated image-model VRAM requirement.** No separate cold image-only memory benchmark was run.
- Output asset: `0185531c-41a0-4bf2-920b-34f758ecdb76-0`.

## Shutdown and follow-up

The queue was paused after both jobs completed. Seed confirmed no active work or unsaved outputs and safe shutdown. Vast accepted the stop request; a subsequent API check returned `actual_status=exited`, `cur_state=stopped`, `next_state=stopped`. No second GPU was rented. The model disk is retained and continues to cost approximately $0.02333/hour; deleting the instance would remove that disk and its model cache.

The temporary NVIDIA monitor and SSH tunnel were stopped. The PC app was returned to its normal launcher and previous connection configuration, and its health endpoint was verified. Both generated outputs remain in the normal PC library. No private configuration or trial scripts were committed.

Restarting this retained trial instance still requires reconnecting the tunnel, starting the worker from its private saved configuration, and pairing through the trial launcher. It is not yet a one-click Vast deployment supported by the released Seed CLI. The existing image worked; the portability changes were confined to ignored trial helpers and the rented container.

**Conclusion:** Direct Hugging Face preparation is viable on this observed host: roughly 100 GB ready in five minutes, approximately $0.13 of running time for preparation. Vast delivered available hardware and materially faster generation than the tested A100, but this demanding 15-second reference-video job still takes about 13 minutes. These observations support a practical Vast trial, not an availability guarantee or proof that the current video latency meets the user's needs.
