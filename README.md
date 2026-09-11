# Seed

Seed is a personal AI art studio in your browser. Your computer keeps uploads,
finished images/videos and history. A rented GPU runs generation. An agent handles
installation, finding compute, connecting it and releasing it when you're finished.

## Start with the skill

Install the [Seed skill](skills/seed/SKILL.md) into your agent, or give your agent:

> Read the Seed skill at https://github.com/Skarian/runpod/tree/feat/studio-mvp/skills/seed
> and help me install and open Seed. Ask before installing Node or renting compute.

The skill guides installation of the local Seed package, credentials and optional
model caching/sign-in startup. The npm package is not published yet; use a package
archive built from this repository. Do not install the unrelated npm package `seed`.
The future scoped package name will be settled before publication.

Daily use: ask the agent to open Seed within your GPU budget, create in Generate
and Library, then ask it to finish and release the GPU. Closing the browser does
not stop GPU billing. Local phone access works through your PC's LAN address.

## What's included

- Text-to-image with aspect ratios, batches and seeds.
- Text-to-video and reference-to-video with image/video/audio inputs and LoRA modes.
- Library preview, download, reuse and deletion.
- CLI-managed Vast and RunPod workers; no infrastructure controls in the web UI.

Identity editing is unfinished. Workflow capacity and platform validation are
tracked explicitly in [validation](studio/VALIDATION.md).

One local package contains the CLI, server, built React UI and operational code.
The [GPU worker image](https://github.com/Skarian/runpod/pkgs/container/seed-worker)
is separate and pinned by digest. The skill is instructions in GitHub, not another
copy of executable code. Users do not need Docker or a source checkout once installed.

## Data and credentials

Media, SQLite history, private settings and optional model cache live in standard
per-user directories outside the package. Updates preserve them. Models are fetched
directly on the GPU; the optional PC cache provides fallback. Both providers use disposable worker disk for new rentals.

Setup privately requests the selected provider key and Hugging Face token. Civitai
is optional. Keys are not put in Git or browser storage. Provider keys remain local;
source tokens can be passed through SSH stdin for downloads. GPU administrators
can inspect runtime memory. The public image contains no user credentials.

## Development

The repository holds all source; see [development](studio/DEVELOPMENT.md).

- `server/`, `web/`, `shared/`: local app and contracts.
- `operations/`: packaged provider, SSH and model-transfer operations.
- `worker/`: ComfyUI worker image and GPU-side tests.
- `skills/seed/`: installable agent instructions.
- `tests/`, `scripts/`: tests and build/release tooling.
- `studio/`: maintained technical docs and execution evidence.
- `research/`, `prompting/`: retained research and model prompting material.

Current work: [priorities](studio/TODO.md), [direction](studio/CURRENT-DIRECTION.md),
[validation](studio/VALIDATION.md), [execution journal](studio/EXECUTION-PLAN.md).
