# Current status

**Running with MiniMax H3 apps installed.** Current saved pod: `m6k75q8bdelebh`, **marvellous_cyan_egret**, on RTX PRO 6000 Blackwell Server Edition (96 GB), verified 8 September 2026 (Chicago).

Open [ComfyUI](https://m6k75q8bdelebh-8080.proxy.runpod.net/) and choose **Apps → MiniMax Apps**. Sign in with the existing Jupyter token. [Runpod controls](https://console.runpod.io/pods?id=m6k75q8bdelebh) expose HTTP port **8080**. See [MiniMax app controls and verification](MINIMAX-APPS.md).

The pod successfully booted the public GHCR studio image. Previous saved pod `s1bsc8hbjh0vqx` is stopped; do not start it against the same volume while this pod is running.

Private template: **Neil ComfyUI - H3 Krea Qwen** (`7522irqo4q`). Startup: `bash /workspace/h3-deployment/lean-v1/start.sh`.

Existing network volume **neil-h3-models** (`f7vnixgws1`), **150 GB STANDARD**, **EUR-IS-1**, remains retained. Persistent storage continues billing while compute is stopped.

Prior pods `uuwayipczbkwcd`, `zrmxmmtfr13znw` and `l9mwstucse5fmd` were also verified **EXITED**. No pods were terminated. Run only one pod against this volume.

Acceptance passed: same-pod restart and a fresh replacement; protected login and WebSocket; real H3 video, Krea edit and Qwen edit outputs. User workflows and personal custom nodes survived replacement without manual repair. See [acceptance evidence](LEAN-ACCEPTANCE.md).

Use [LEAN-SETUP.md](LEAN-SETUP.md) for daily operation, unavailable-GPU recovery, replacement deployment and later modifications. Older planning documents are historical.
