# runpod

A personal image and video studio powered by ComfyUI on Runpod. Start a GPU when you need it, open the studio in your browser, and stop compute when you're done. Models, workflows and outputs stay on a persistent network volume.

Includes MiniMax H3 video workflows, Krea 2 image generation and identity editing, and Phr00t Qwen Image Edit Rapid AIO.

## Use the studio

Follow [Start here](deployment/START-HERE.md) for the saved pod and sign-in instructions. The [operating guide](deployment/LEAN-SETUP.md) covers normal Start/Connect/Stop, unavailable GPUs, replacement deployment and future changes.

The current setup uses a pinned Hearmeman image, a small startup script and the existing 150 GB volume. A replacement uses the same private Runpod template and volume; its browser URL changes. No custom container build is required.

## Project contents

| Location | Purpose |
|---|---|
| `deployment/lean/` | Deployed startup, upstream revision pins and authentication proxy |
| `deployment/workflows/` | Saved ComfyUI workflows |
| `deployment/configuration.json` | Non-secret deployment configuration and resource IDs |
| `deployment/LEAN-SETUP.md` | Operating and maintenance instructions |
| `deployment/LEAN-ACCEPTANCE.md` | Restart/replacement validation and evidence |
| `deployment/*.py` | Setup, maintenance and acceptance utilities; many are one-off historical scripts |
| `research/` | Research notes and upstream reference snapshots |

Older planning documents remain as history. Use the lean operating guide for the implemented setup. Read maintenance scripts before running them: some modify remote resources, and older scripts refer to earlier deployments.

## Local development and credentials

This is a local Git repository. No remote hosting or publication is configured. A local repository has no hosted public/private visibility setting; privacy depends on access to this folder. If a remote is added later, create it as private.

Credentials (`*.private.*`, `.env` files), private backups, generated media, model weights and local dependencies are ignored. They remain on disk or the Runpod volume and are not part of Git history. This repository is not a backup of your generated outputs or models.

The maintenance utilities read `deployment/access.private.json` locally and use `deployment/configuration.json` to select the pod. Keep the existing credentials file private. Python utilities using the remote WebSocket helper require `websocket-client` (currently supplied in the ignored `deployment/vendor/` directory).

Edit startup releases under `deployment/lean/`, copy a new release to the persistent volume and test it before changing the template/current pod startup command. Committing a change does not deploy it.

Upstream code and model references retain their respective licenses; this repository does not grant additional model usage rights.
