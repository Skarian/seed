> Current user session: pod `uuwayipczbkwcd` (**neil-comfyui-active**), https://uuwayipczbkwcd-8080.proxy.runpod.net/ . Prior pod could not resume; the same persistent volume is attached.

> Current pod and image workflows (8 September): see [KREA2-START-HERE.md](KREA2-START-HERE.md). The active pod is `zrmxmmtfr13znw`; older pod URLs below are historical. Storage is now 120 GB ($8.40/month).

# Your MiniMax H3 setup

Stock Hearmeman v8, ComfyUI 0.34.0, PyTorch 2.11 / CUDA 13, pruned INT8 FL2VA and Ref2VA, stock INT8 Qwen encoder, stock Turbo adapters, SageAttention. RTX PRO 6000 Blackwell Server Edition 96 GB in Iceland EUR-IS-1, with 188 GB host RAM.

## Open and generate

Setup and recreation acceptance passed. Pod `l9mwstucse5fmd` is **stopped (EXITED)**, with GPU billing stopped. Open RunPod controls and **Start** the saved pod to resume, subject to hardware availability. The service links below work once it is running. If you instead create a new pod, use the saved template and volume; the new pod receives new links.

- [ComfyUI](https://l9mwstucse5fmd-8080.proxy.runpod.net/)
- [Jupyter administration and file browser](https://l9mwstucse5fmd-8888.proxy.runpod.net/lab)
- [RunPod controls](https://console.runpod.io/pods?id=l9mwstucse5fmd)

Both services use the `jupyter_token` value in the local `access.private.json` file. Paste it into **Password or token**. Keep that file private; the token grants administration access. This form login works in the Codex built-in browser. The original `password` field is unused after switching from Basic authentication.

In ComfyUI, click **Workflows → Neil H3**. Select a workflow and press Enter to open it. Edit the prompt, and click **Run**. For image/reference workflows, upload or select your image in the Load Image node. The supplied toy boat is only an acceptance sample.

Presets:

1. Text to video — Turbo 8
2. Image to video — Turbo 8
3. Reference to video — Turbo 8
4. Text to video — Standard 20 (Turbo strength zero)
5. Reference to video — Standard 20 (Turbo strength zero)

Defaults are 1344×768, 124 frames at 24 fps (5.17 seconds), with audio. Reference prompts identify the first reference as `<Picture 1>`. Reference sizing uses `match`. Start with the Turbo presets; the 20-step presets take longer. Original Hearmeman workflows remain in **MiniMax H3**; their Auto Prompt variants require an additional OpenRouter account/key and are not needed for manual generations.

## Storage and costs

The reusable network volume is **neil-h3-models**, ID `f7vnixgws1`, **100 GB STANDARD**, mounted at `/workspace`. Models occupy exactly **81,464,127,748 bytes**. All ten files passed SHA-256 verification. After sample outputs and settings, about **18.5 GB** of the purchased capacity remains. Network filesystem `df` reports the shared cluster capacity; do not mistake that for your purchased quota.

Models, uploads, outputs, workflows and settings persist under `/workspace/ComfyUI`. Videos are in `output/H3`; acceptance samples are in `output/H3_Acceptance`. Download important outputs and maintain your own backups. Recreating a pod is not a backup.

- Persistent volume: **$7/month**, including when no GPU runs.
- GPU: **$2.09/hour** while running, including idle and setup time.
- Temporary 150 GB container disk: approximately **$0.021/hour** while running.
- Total active rate: approximately **$2.11/hour**, plus storage, before applicable taxes.

Expand the existing volume in RunPod Storage when necessary. Expansion is supported; shrinking is not. It remains attached to this data center.

## Turn off and on

Closing the browser does **not** stop billing. Finish/cancel the generation queue and confirm outputs are under `/workspace`. Use **Stop** to stop GPU billing and retain the saved pod; this action succeeded on this deployment. Use **Start** to resume if hardware is available. Alternatively, terminate/release the **pod**, retaining the separate network volume, then recreate when needed. Do not delete `neil-h3-models`. The container installation is reproducible from the private template. Automatic approval review allowed Stop but declined final termination; the pod was therefore retained.

To turn on: deploy private template **Neil H3 - Hearmeman v8 secured** (`7522irqo4q`), select existing network volume **neil-h3-models** in the network-volume filter, choose **one RTX PRO 6000**, on-demand, and verify 100 GB network storage in EUR-IS-1 plus 150 GB temporary disk. The volume must be selected at deployment. Wait for the service to become ready, then open port **8080**. Each new pod has a new URL. Do not expose raw port 8188.

To change GPUs, follow the same deployment procedure with a compatible GPU in EUR-IS-1 and this volume. The models need no redownload. Another region requires copying to another volume. Availability and pricing can change; 96 GB VRAM avoids many smaller-card compromises.

## Verified measurements

Stop/start benchmark on the same saved pod (one run, Turbo 8, 1344×768, 124 frames with audio): ComfyUI ready at **41.64 seconds** after Start; job accepted at **42.45 seconds**; first sampling step completed at **191.69 seconds (3m12s)**; finished video at **249.89 seconds (4m10s)**. Sampling began a few seconds before the first completed step. Timed from issuing the Start request; service readiness polling interval was approximately 3 seconds. This was a resume of the existing stopped pod, not creation of a new pod. Model files were already downloaded. The pod was stopped again afterward. Raw timestamps are in `resume-benchmark.json`.

| Test | Video | Wall time |
|---|---|---:|
| FL2VA text + audio, Turbo 8 | 1344×768, 124 frames | 114.86 s |
| Ref2VA image reference + audio, Turbo 8 | 1344×768, 124 frames | 107.77 s |
| FL2VA standard 20, browser run after recreation | 1344×768, 124 frames | 333.20 s |

These are single measured runs, not throughput guarantees. The first includes initial model loads from local staging; reference uses one image and a partly warm process. Sampling itself took about 44 and 48 seconds. The recreated pod loaded from network storage: its first standard generation took 5 minutes 33 seconds, with 1 minute 52 seconds spent sampling. Do not compare these totals as a controlled Turbo-versus-standard benchmark. Resolution, duration, reference sizes/count, prompt length, model loading and host contention affect runtime.

## Reproducibility

The container digest is pinned. The stock template still synchronizes upstream runtime/custom-node code on startup, so a pinned image alone does not freeze every dependency. `versions.json` records tested commits; `asset-validation.json` records verified model hashes. Do not indiscriminately update nodes if a working setup is your priority.

Local scripts in this folder support administration and acceptance. `remote.py` reads the token from the private file and uses authenticated Jupyter over HTTPS. `comfy.py` uses the same token for the ComfyUI API. SSH is not configured in this image.
