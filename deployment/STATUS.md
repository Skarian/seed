# Current status

**Stopped after successful deployment acceptance.** Current saved pod: `s1bsc8hbjh0vqx`, **neil-comfyui-replacement**, status **EXITED** on 8 September 2026 (Chicago).

Start it in [Runpod](https://console.runpod.io/pods?id=s1bsc8hbjh0vqx), then Connect to HTTP port **8080**. Sign in with the existing Jupyter token. The [ComfyUI URL](https://s1bsc8hbjh0vqx-8080.proxy.runpod.net/) works while running.

Private template: **Neil ComfyUI - H3 Krea Qwen** (`7522irqo4q`). Startup: `bash /workspace/h3-deployment/lean-v1/start.sh`.

Existing network volume **neil-h3-models** (`f7vnixgws1`), **150 GB STANDARD**, **EUR-IS-1**, remains retained. Persistent storage continues billing while compute is stopped.

Prior pods `uuwayipczbkwcd`, `zrmxmmtfr13znw` and `l9mwstucse5fmd` were also verified **EXITED**. No pods were terminated. Run only one pod against this volume.

Acceptance passed: same-pod restart and a fresh replacement; protected login and WebSocket; real H3 video, Krea edit and Qwen edit outputs. User workflows and personal custom nodes survived replacement without manual repair. See [acceptance evidence](LEAN-ACCEPTANCE.md).

Use [LEAN-SETUP.md](LEAN-SETUP.md) for daily operation, unavailable-GPU recovery, replacement deployment and later modifications. Older planning documents are historical.
