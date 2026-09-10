# seed

**seed** is a local browser app for image and video generation with ComfyUI on disposable RunPod GPUs. Models live on a reusable network volume; permanent media belongs on your PC. Image generation and the first video workflows save verified results locally; identity editing remains in development.

The MVP targets text-to-image, identity editing, text-to-video and reference-to-video using Krea 2 and MiniMax H3. The older direct-Comfy deployment is documented separately below.

Next-stage planning: [media studio MVP](STUDIO-MVP.md) — a local Windows studio,
manual RunPod deployment and pairing, expressive workflows, and permanent media
on your PC. See the [implementation plan](studio/EXECUTION-PLAN.md) for access,
milestones, reviews and commit policy. A local frontend foundation is implemented.
Pairing/status work locally and the worker candidate is published; prepared-volume GPU startup and pairing are verified; cold-download reliability and generation remain pending. Local npm package installation and CLI lifecycle work. See [local development](studio/DEVELOPMENT.md). [LLM choices](research/llm/README.md)
are saved for a later phase.

## Existing RunPod deployment

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
| `deployment/*.py` | Existing setup, maintenance and acceptance utilities |
| [Research index](research/README.md) | LLM, model, workflow, UI and deployment research |

Use the lean operating guide for the implemented setup and the MVP documents for upcoming work. Superseded plans and obsolete one-off scripts have been removed; Git history retains them. Read maintenance scripts before running them: some modify remote resources, and acceptance utilities may rely on saved test evidence.

## Local development and credentials

The GitHub remote is [Skarian/runpod](https://github.com/Skarian/runpod), a private repository. Local maintenance uses the checkout at `C:\projects\runpod`. Git pushes require GitHub authentication on the machine running Git; the connected GitHub app has separate credentials.

Credentials (`*.private.*`, `.env` files), private backups, generated media, model weights and local dependencies are ignored. They remain on disk or the Runpod volume and are not part of Git history. This repository is not a backup of your generated outputs or models.

The maintenance utilities read `deployment/access.private.json` locally and use `deployment/configuration.json` to select the pod. Keep the existing credentials file private. Python utilities using the remote WebSocket helper require `websocket-client` (currently supplied in the ignored `deployment/vendor/` directory).

Edit startup releases under `deployment/lean/`, copy a new release to the persistent volume and test it before changing the template/current pod startup command. Committing a change does not deploy it.

Upstream code and model references retain their respective licenses; this repository does not grant additional model usage rights.

## seed CLI direction

The local app can be installed from a locally packed npm artifact and serve this browser UI. No desktop
wrapper or bundled Node runtime. Commands: `seed setup`, `seed start`,
`seed status`, `seed stop`. Setup detects Windows and asks whether to start seed
automatically at sign-in; it is optional and can be changed by rerunning setup.
The package is not published yet; see the development guide for local installation.

The unscoped npm name `seed` already exists. `@skarian/seed` is the candidate
package name in this private package; scope ownership and publishing access still
need validation. Do not install the unrelated `seed` package expecting this app.
See [development](studio/DEVELOPMENT.md) for the current source launch path.

`seed setup` reuses saved credentials and uses masked prompts for missing ones:
RunPod and Hugging Face are required; Civitai is optional (Enter skips). All tokens
save to the per-user config/credentials.json path printed by setup. Environment variables
RUNPOD_API_KEY, HF_TOKEN and CIVITAI_API_TOKEN are also accepted. No tokens are
sent to the browser, and the RunPod key never goes to the GPU worker.

For unattended/container setup, environment variables are supported, with an optional
.env file as a fallback import. No .env or example is shipped, and setup never writes one.

## Video worker candidate

The new worker is a separate candidate from the existing lean deployment above.
It has an early connection page, single-use pairing, authenticated status and
model preparation with integrity checks. Local and live prepared-volume startup/pairing checks passed, including replacement.
Earlier cold-download tests encountered Hugging Face CDN HTTP 429; they were not repeated for this video milestone,
so empty-volume bootstrap and interrupted-download recovery remain unverified.
The reusable `seed pod-setup` command is implemented. Text-to-image generation,
batching and durable local Library saving are available. SFW uses the base model;
NSFW requires the verified content adapter on the pod. Text-to-video and reference-to-video
support 5/10/15-second 720p output, first/last images, general image/video/audio references,
and generated or silent audio. Identity editing remains a preview. Owner video quality
review is the next checkpoint.

Package: [seed-worker](https://github.com/Skarian/runpod/pkgs/container/seed-worker).

Candidate: `ghcr.io/skarian/seed-worker@sha256:50c326db76108e4619131c180ec29bdea29fdc2a85c2f8db8f57d34c72148674`.
[Build and publication](https://github.com/Skarian/runpod/actions/runs/34436686831)
succeeded; anonymous registry access was verified. The shared template pins
this candidate; the older lean deployment template is unchanged. See [bootstrap](studio/POD-BOOTSTRAP.md) for required
private variables and [milestone journal](studio/EXECUTION-PLAN.md) for test evidence.

Run `seed pod-setup` to verify model access and reuse network storage. Use
`seed pod-setup --show-secrets` in a private terminal for deployment values.
[Setup and deployment instructions](studio/RELEASE-AND-INFRASTRUCTURE.md#operator-setup-commands-m2)
include first-time storage creation and returning with a replacement pod.
