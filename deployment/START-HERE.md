# Your ComfyUI setup

Use [LEAN-SETUP.md](LEAN-SETUP.md) for Start/Connect/Stop, GPU-unavailable recovery, replacements and future changes. It supersedes the older deployment plans.

- Saved template: **Neil ComfyUI - H3 Krea Qwen** (`7522irqo4q`).
- Current saved pod: **marvellous_cyan_egret** (`m6k75q8bdelebh`). See [live handoff status](STATUS.md).
- Storage: **neil-h3-models**, **150 GB**, EUR-IS-1, mounted at `/workspace`.
- [Runpod controls](https://console.runpod.io/pods?id=m6k75q8bdelebh)
- [ComfyUI, when running](https://m6k75q8bdelebh-8080.proxy.runpod.net/)
- [Jupyter administration, when running](https://m6k75q8bdelebh-8888.proxy.runpod.net/lab)

Sign in using the existing Jupyter token. Use Runpod's Connect button after replacing a pod because its URL changes.

Workflow guides: [MiniMax video apps](MINIMAX-APPS.md), [Krea 2](KREA2-START-HERE.md), [Qwen Rapid](QWEN-RAPID-START-HERE.md).

For H3, open **Workflows → Neil H3** and select a Turbo 8 preset. Defaults are 1344×768, 124 frames at 24 fps with audio. For image/reference workflows, choose your image in Load Image. Reference prompts identify the first image as `<Picture 1>`. The Standard 20 presets take longer. Auto Prompt variants under the upstream MiniMax H3 folder require a separate OpenRouter key.

Models, uploads, outputs, workflows and settings live under `/workspace/ComfyUI`. Keep personal workflow variants in the Neil folders; upstream refreshes some of its example/troubleshooting files at startup.

Earlier H3 measurements and deployment history are preserved in [START-HERE-HISTORY.md](START-HERE-HISTORY.md); its old pod URLs, storage figures and operating instructions are historical.
