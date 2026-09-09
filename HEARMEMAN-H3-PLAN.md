# MiniMax H3 on RunPod: reviewed deployment plan

**Latest allocation: 100 GB, $7/month, about 18.54 GB raw headroom after the stock bundle. See [LATEST-PLAN.md](LATEST-PLAN.md); it supersedes the historical 120 GB recommendation below.**

Research date: September 7, 2026. Planning only: no cloud resources created or changed; no model weights downloaded. Source snapshots, metadata and local workflow dry runs are in `research/hearmeman_h3`.

Latest decision: use the stock 81.46 GB Hearmeman bundle initially, with low-risk operational improvements only. [H3-TIMING-ESTIMATES.md](H3-TIMING-ESTIMATES.md) records community feedback, published measurements and approximate generation-time ranges. [H3-OPTIMIZATION-PLAN.md](H3-OPTIMIZATION-PLAN.md) remains a future experiment backlog; encoder swaps and additional accelerators are deferred.

## Recommendation

Use Hearmeman's MiniMax template v8 as the software base, one RTX PRO 6000 Blackwell Server Edition (96 GB), Secure Cloud on-demand, and a 120 GB standard network volume. Preserve the audited startup sources and installed custom-node revisions after validation. Expose ComfyUI through an authenticated HTTPS proxy. Both FL2VA and Ref2VA weights stay installed; one GPU processes jobs sequentially.

The earlier preference for a generic official template was insufficiently supported. Hearmeman already supplies H3-specific workflows, quantization choices, acceleration support, model provisioning and persistence. Its larger encoder adds only about $0.80/month of allocated storage compared with the previously selected encoder. That is not a persuasive reason to replace its integrated setup.

This is a high-confidence architecture and asset plan, not a claim of tested GPU performance. A paid acceptance run is still needed before calling the installation ready.

## Exact software baseline

| Component | Audited choice |
|---|---|
| Container | `hearmeman/comfyui-minimax-template:v8` |
| Published image digest | `sha256:5b01d3f62ce157792bd6aab4bef0b7c6b4c95b1b37ed4d9e3454f898e1bcca15` |
| Image publication | August 31, 2026 |
| Base | ComfyUI 0.34.0, PyTorch 2.11.0, CUDA 13.0.3, Python 3.12 |
| Template source snapshot | `41be57ddc95b0612a47ff2b19b2508b1fb368a57` |
| Shared runtime snapshot | `0ea1f919c5b8102e7ab9cadf322995b480fd2e4e` |
| Quantization | `minimax_quant=int8` |
| Automatic asset selection | `download_minimax_h3=true` |
| Comfy core selection | `COMFYUI_VERSION=approved` |
| Persistence | `PERSIST_MODELS_TO_VOLUME=true` |

Sources: [template Dockerfile](https://github.com/Hearmeman24/comfyui-minimax/blob/41be57ddc95b0612a47ff2b19b2508b1fb368a57/Dockerfile), [pins](https://github.com/Hearmeman24/comfyui-minimax/blob/41be57ddc95b0612a47ff2b19b2508b1fb368a57/pins.json), [Docker tags](https://hub.docker.com/r/hearmeman/comfyui-minimax-template/tags). Public registry configuration was also retrieved locally, without pulling image layers.

The image contains core node packages including KJNodes, rgthree, VideoHelperSuite, Spectrum MiniMax H3 and MiniMaxRefPack. The template adds a pinned latent-upscaler node. The shared runtime adds further Hearmeman utility nodes. Its SageAttention setup probes an actual GPU kernel and can fall back if acceleration is unavailable. Preserve that fallback; do not make a speed optimization a prerequisite for basic generation.

The default `--disable-dynamic-vram` is intentional. Keep it initially because the template includes it to work around H3 int8 memory problems. The `nvfp4` profile name currently selects FP8 diffusion weights, so it should not be described as an end-to-end native NVFP4 configuration. [Template configuration](https://github.com/Hearmeman24/comfyui-minimax/blob/41be57ddc95b0612a47ff2b19b2508b1fb368a57/template.json)

## Assets and storage

I ran the provisioner locally with downloads disabled by execution scope: it generated the planned manifest and workflow copies, without running the downloader. It selected exactly ten assets. I queried Hugging Face metadata for exact bytes, repository revisions and SHA-256 values; all ten are currently ungated. The complete manifest is `research/hearmeman_h3/verified-assets.json`.

| Asset | Decimal GB |
|---|---:|
| FL2VA pruned INT8 diffusion model | 20.9704 |
| Ref2VA pruned INT8 diffusion model | 20.9704 |
| Qwen3-VL 32B INT8 text encoder | 27.1413 |
| Video VAE FP16 | 5.2078 |
| Audio VAE FP32 | 0.6053 |
| FL2V Turbo 4-step v1.2 adapter | 1.9562 |
| FL2V Turbo 8-step v1.0 adapter | 1.9562 |
| Ref2V Turbo 8-step v1.0 adapter | 1.9562 |
| Latent upscaler | 0.6906 |
| Tiny preview decoder | 0.0098 |
| **Total: 81,464,127,748 bytes** | **81.4641** |

Sources: [Comfy-Org weights](https://huggingface.co/Comfy-Org/MiniMax-H3/tree/main), [Turbo adapters](https://huggingface.co/lightx2v/Minimax-h3-Turbo/tree/main), [latent upscaler](https://huggingface.co/LBH-123-AI/Minimax_h3_latent_Upscaler/tree/main), [preview decoder](https://huggingface.co/Hearmeman/comfyui-template-assets/tree/main/vae_approx).

The shared core assets for both model modes total about 74.90 GB. The adapters, upscaler and preview decoder add about 6.57 GB. Keep the complete bundle for compatibility with the supplied workflows. A disabled `Your_Character_LoRA_Here.safetensors` placeholder triggers a provisioner warning; it is not an additional required download. Remove that unused entry from the clean handoff workflows.

My earlier 67.35 GB estimate used a different encoder and fewer optional assets. It is not the size of Hearmeman's current default bundle.

| Standard network volume | Raw room beyond the model bundle | Monthly storage |
|---|---:|---:|
| 110 GB | 28.54 GB | $7.70 |
| **120 GB recommended** | **38.54 GB** | **$8.40** |
| 140 GB | 58.54 GB | $9.80 |

Subtract workflows, inputs, user nodes, caches and filesystem overhead from that raw headroom. The container's system packages and Python environment live separately, so they should not be counted again as a full persistent application installation. A 110 GB volume is reasonable if minimizing the starting allocation matters most; 120 GB gives more useful working room for $0.70/month extra. Volumes can grow, not shrink. Another 20 GB costs $1.40/month; another 50 GB costs $3.50/month. Billing follows allocated capacity, not how many files you generated. [RunPod network volumes](https://docs.runpod.io/storage/network-volumes)

Plan a separate 150 GB temporary container disk for installation/staging headroom, then verify actual free space. This is an engineering allowance, not a measured extracted-image requirement. The v8 compressed image layers total 8.85 GB; compressed size does not establish installed size. Runtime local staging reserves space and can fall back to direct volume downloads.

## Hardware, region and cost

Choose the full 96 GB RTX PRO 6000 Blackwell Server Edition, not an older RTX 6000, RTX 6000 Ada, or a partial GPU allocation. Require a CUDA 13-compatible host, at least 128 GB host RAM as a conservative planning target, and one GPU. The two diffusion models do not need to remain GPU-resident simultaneously. Queue jobs sequentially and let ComfyUI manage loading/offloading.

RunPod's catalog check showed $2.09/hour Secure pricing and limited availability in several data centers. EUR-IS-1 (Iceland) is the leading geographic candidate because it offered standard network storage and appeared in the GPU availability results. Recheck the exact GPU/RAM/driver/volume combination immediately before creating the volume; catalog entries do not reserve capacity. The volume remains tied to its data center, so changing regions later requires copying data. [GPU pricing](https://www.runpod.io/gpu-models/rtx-pro-6000)

The license excludes the EU, UK, South Korea and US, and explicitly addresses remote hosted use. Iceland hosting alone does not establish permission for a user in an excluded territory. Licensing eligibility remains separate from choosing a technically available region; no location is inferred from your computer timezone. Any separate license cost is not included below. [Actual MiniMax license](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)

| Cost item | Budget |
|---|---:|
| 120 GB persistent storage, even with no pod running | $8.40/month |
| GPU while pod is running, including downloads or idle time | $2.09/hour |
| 150 GB temporary container disk while running | approximately $0.021/hour |
| 10 running hours/month plus storage | approximately $29.51 |
| 30 running hours/month plus storage | approximately $71.73 |

Examples use the observed GPU price and a 720-hour conversion for container storage. They exclude tax, optional external prompt APIs and any separate model license. Recheck deployment quotes. RunPod states no ingress/egress fees for Pods. There is no intrinsic per-video fee for these self-hosted workflows: GPU time, storage allocation and optional external services drive cost. At this rate, 5 minutes of occupied GPU time is about $0.174 in GPU cost; that is a cost example, not a generation-speed prediction. [Pod billing](https://docs.runpod.io/pods/pricing)

## What the browser will provide

Deliver clean workflows for text-to-video, image-to-video and reference-to-video/audio. Keep FL2VA and Ref2VA explicitly labeled. Supply an initial Turbo preset and a standard sampling preset for each model family, with a four-step FL2V option for faster drafts after comparison. Standard sampling does not require downloading a second unquantized model: it means using the same INT8 model without the Turbo adapter and with the appropriate standard sampler settings.

Five refreshed upstream workflows default to eight-step Turbo. Three auto-prompt variants call OpenRouter and need an API key; manual prompt workflows avoid that dependency. The reference workflow should have a clear manual-prompt version too. No OpenRouter account is required for the base generation setup. Do not imply that optional prompt rewriting is part of local H3 inference. [Workflow sources](https://github.com/Hearmeman24/comfyui-minimax/tree/41be57ddc95b0612a47ff2b19b2508b1fb368a57/workflows)

Internet access design: RunPod HTTPS proxy to an authenticated reverse proxy, forwarding ComfyUI HTTP and WebSocket traffic internally. Expose only the protected service port. Protect both the UI and API; a successful login page alone does not prove uploads and generation endpoints are protected. Test from an unauthenticated session and a logged-in session.

The runtime defaults Jupyter to no token unless `JUPYTER_TOKEN` is provided. Set a strong token from first boot for administration and omit public Jupyter exposure unless needed. The published image configuration and audited startup do not establish a working SSH server, so do not promise SSH merely because port 22 can be listed. Use authenticated Jupyter administration initially; install and validate key-only SSH if needed. [Runtime startup](https://github.com/Hearmeman24/comfyui-runtime/blob/0ea1f919c5b8102e7ab9cadf322995b480fd2e4e/src/start.sh)

## Persistence and switching off

Persist models, workflows/user settings, input uploads, outputs, deployment manifest and source snapshots under the mounted network volume. Verify `/workspace` is actually the volume mount before installation. A directory with that name is insufficient evidence.

Stock startup fetches template `master` and runtime `stable` at every boot. Image digest pinning alone therefore does not freeze the environment. Use a small startup wrapper with the recorded template/runtime commits and preserve boot-time node revisions; retain the published image and its baked packages. This wrapper is planned work, not yet implemented or validated. [Entrypoint source](https://github.com/Hearmeman24/comfyui-minimax/blob/41be57ddc95b0612a47ff2b19b2508b1fb368a57/src/start_script.sh)

Runtime may initially serve models through symlinks to temporary local staging while copying them to the network volume. Before shutdown, verify all required files are complete, persistent regular files with the expected hashes. A running ComfyUI page or a completed provisioning process is not enough. [Download manager](https://github.com/Hearmeman24/comfyui-runtime/blob/0ea1f919c5b8102e7ab9cadf322995b480fd2e4e/src/hf_download_manager.py), [volume copier](https://github.com/Hearmeman24/comfyui-runtime/blob/0ea1f919c5b8102e7ab9cadf322995b480fd2e4e/src/volume_sync.py)

For the dependable off/on procedure: finish or cancel the queue, verify saved data, terminate only the disposable pod, and retain the network volume. Recreate from the saved configuration with that volume to resume. The browser URL may change. Current RunPod documentation also describes stop/start with network-volume data preserved; earlier guidance that these pods can never be stopped was too categorical. Recreate remains the recovery path if stop/start is unavailable or capacity has moved. Closing a browser or stopping ComfyUI does not release the GPU. [Pod lifecycle](https://docs.runpod.io/pods/manage-pods)

A controller outside the GPU container should monitor setup and release a failed deployment rather than leave it billing indefinitely. Avoid storing a broad account-management credential inside ComfyUI. An optional idle cutoff should inspect queue state and never terminate a running generation just because the browser is disconnected. Important outputs should also be downloaded as backups.

## Verification and remaining uncertainty

Completed: inspected template, shared runtime, Docker build and published image configuration; reviewed release changes and relevant issues; resolved current asset sizes/hashes; dry-ran provisioning; checked all six graph link structures and all nine quantization/profile cases. The upstream test harness initially failed on Windows path separators. A local harness adaptation to use `pathlib` basenames passed every case; upstream source was not changed. This validates configuration consistency, not Linux boot or GPU inference.

Relevant open reports include [missing Qwen encoder](https://github.com/Hearmeman24/comfyui-minimax/issues/24), [masking regression on ComfyUI 0.34](https://github.com/Comfy-Org/ComfyUI/issues/15978), and [reference prompt override](https://github.com/Comfy-Org/ComfyUI/issues/15320). The mask fix [PR 15988](https://github.com/Comfy-Org/ComfyUI/pull/15988) remains open and discussion says it does not resolve every reported mask problem. Avoid advertising masked editing or long-form chaining as validated base capabilities. Test prompt changes explicitly in Ref2VA. Do not automatically downgrade the entire supported stack based on an advanced-workflow bug.

Deployment acceptance sequence:

1. Verify the chosen offer, volume mount, RAM, GPU and CUDA compatibility. Create the protected access configuration before exposing services.
2. Install the pinned startup configuration and ten revision-pinned assets; validate hashes and persistent destinations. Treat missing or invalid required assets as a failed setup.
3. Check every required node and model in ComfyUI. Remove disabled placeholders and prepare manual workflows with known inputs.
4. Run short FL2VA text and image generations, and Ref2VA reference generation; cover standard and Turbo presets. Change a reference prompt and confirm it actually takes effect.
5. Decode each output, inspect frames, duration/resolution and generated audio; record wall time, peak VRAM/RAM and errors. Test an intended 768p workload before promising its performance.
6. Test authenticated browser upload, queue, progress WebSockets, preview and download. Confirm unauthenticated API access is blocked.
7. Terminate/recreate against the same volume. Confirm assets are reused, user settings and outputs survive, and another generation succeeds.
8. Hand over the browser link, credentials through an appropriate private channel, labeled workflows, measured cost/speed examples and exact on/off/recovery instructions. Leave the pod off after validation unless an active generation session is requested.

No live acceptance steps have been performed. Authenticated RunPod read access works; provisioning permissions and remote administration remain to be proven during deployment. The recommendation can now be made with substantially stronger evidence, but claiming guaranteed unattended success before that acceptance sequence would overstate what research can establish.
