# seed

Seed is a local browser app for image and video generation on a disposable GPU.
Your computer keeps uploads, results and history. An agent operates the GPU through
the [seed skill](skills/seed/SKILL.md); the web UI does not rent or stop hardware.

## Start from a checkout

Open this repository with your coding agent and ask:

> Read skills/seed/SKILL.md and set up Seed for Vast.

Or choose RunPod. The agent checks dependencies, builds the app, helps you enter
credentials privately, and starts the local UI. It needs Node **26.8.2–26.x** and,
for Vast, OpenSSH. No local Docker or Python is required to use the published worker.

The equivalent source commands, from the repository root:

```sh
npm ci
npm run build
node dist/server/cli.js setup --provider vast
node dist/server/cli.js start
```

Use `--provider runpod` for RunPod. Setup saves the choice and reuses it on later
runs; fresh setup defaults to Vast. The selected provider key and Hugging Face token
are required; Civitai is optional. Accept any gated model terms on the source site.
Setup stores credentials in the per-user configuration directory it prints, never
in Git or browser storage. Environment overrides: VAST_API_KEY, RUNPOD_API_KEY,
HF_TOKEN and CIVITAI_API_TOKEN. Optional .env import is supported, but no file is
shipped or written. Switching providers preserves earlier credentials.

Windows setup asks whether to start the **local app** at sign-in. It does not rent
a GPU. Use `setup --host LOCAL_IP` for access from another device on your Wi-Fi.
Stop the local app before changing setup. `status` and `stop` manage the local app,
not cloud billing. Public hosting/router/tunnel configuration is outside this project.

The npm package is not published. Do not install the unrelated package named `seed`.
[Development instructions](studio/DEVELOPMENT.md) cover local packaging and tests.

## A normal session

1. Ask the agent to start Seed with a provider and spending limit. It checks current
   offers, existing rentals and model access before allocating one GPU.
2. The agent launches the worker and connects it to Seed. Preparation appears in
   the UI; automatic pairing avoids copying a connection code.
3. Use Generate and Library. Keep the PC awake and app running so transfers complete.
4. Ask the agent to finish. It checks that outputs are saved, then stops or destroys
   the exact rental according to your instructions and verifies provider state.

| Provider | Models | Connection | After use |
|---|---|---|---|
| Vast | Download to disposable instance disk | Private SSH tunnel | Normally destroy instance/disk after saving outputs |
| RunPod | Reuse your network volume | Authenticated HTTPS worker proxy | Stop/terminate pod; retain separately billed network volume |

The software image is public on [GHCR](https://github.com/Skarian/runpod/pkgs/container/seed-worker).
Credentials stay in private configuration/template values, outside that image.
The skill pins a tested release; users do not need to build a container.

## What works, and what still needs checking

Text-to-image, text-to-video and reference-to-video save results locally. Video
supports 5/10/15-second 720p exports, image/video/audio references and first/last
image roles. Identity editing remains in development. Owner LoRA choices live in
private local configuration; see [workflow changes](studio/COMFYUI-CHANGES.md).

The manual Vast trial verified approximately 100 GB of model preparation in
5m15s, a 15-second mixed-reference video and an image generation; see the
[measured results](research/infrastructure/VAST-KOREA-BENCHMARK-2026-09-10.md).
Those times are not a startup guarantee. Existing RunPod generation is also tested.
The portable skill helpers have offline tests and read-only API checks; their
new complete paid lifecycles still need validation. macOS has not been executed.

## Repository map

- [Current direction](studio/CURRENT-DIRECTION.md): current decisions and remaining checkpoints.
- [MVP](STUDIO-MVP.md), [execution journal](studio/EXECUTION-PLAN.md): product scope and implementation evidence.
- `web/`, `server/`, `shared/`: local UI, API, media/database and contracts.
- `worker/`: authenticated ComfyUI worker, model preparation and job spool.
- `skills/seed/`: agent entrypoint, provider instructions and Node helpers.
- `studio/`: API, workflow, asset and release specifications.
- RunPod setup is retained in `server/pod-setup.ts` and the Seed skill. The retired
  direct-Comfy deployment path is available in Git history.
- [Research](research/README.md): model/LLM research and infrastructure measurements.
- `prompting/`: model prompting guides.

Generated media, model weights, tokens, local state and dependencies are ignored.
Removing the checkout does not back up or delete your separate media library.
Upstream software and model licenses still apply. Committing code does not deploy it.
