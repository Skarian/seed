---
name: seed
description: Set up and operate Seed, a personal AI art studio for images and videos. Open the studio, find a suitable rented GPU on Vast or RunPod, connect it, help with creative workflows, and release compute when the user is finished.
---

# Seed art studio

Seed gives the user an image and video studio in their browser without owning a
GPU. The app runs on their computer; a rented GPU does the generation. Their
uploads, finished creations and history stay on their computer between sessions.
You handle setup and compute so they can spend their time creating.

## What the studio offers

- Text-to-image, with aspect ratios, batches and seed controls.
- Text-to-video and reference-to-video, with images, video and audio references,
  optional first/last-frame images, and 5/10/15-second portrait or landscape clips.
- A Library for previewing, downloading, reusing and deleting creations.
- SFW/NSFW presets using the user's configured LoRAs.

Identity editing is still in development. Do not describe its preview form as
working. Help with prompts or reference roles when asked; the repository's
`prompting/` directory contains the existing model-specific guides.

## Begin here

This folder is an operating skill, not the whole application. It needs the Seed
repository and its built local server. Read [setup](references/setup.md) if this is
a new computer, the checkout is unknown, or dependencies/credentials are missing.
That guide explains where to get the repository and keys, which commands to run,
and how to open the UI. A returning user should not repeat setup unnecessarily.

The references use `REPO` for the absolute repository directory and `SKILL` for
this folder. Replace those placeholders with real paths; quote paths with spaces.
Run app commands from REPO. Helper commands work from any directory with `--repo`.

## Open the studio

1. Check the local app and any existing GPU connection. Reuse a working session.
2. Complete local model setup before renting compute; weights and model-source
   credentials stay on the PC, and missing files are pushed over SSH. If compute is needed, use the user's chosen provider or compare both when
   requested. Follow [Vast](references/vast.md) or [RunPod](references/runpod.md).
   Consider hourly price, startup time and generation speed. Explain the selected
   offer and act within the user's spending authorization; obtain missing access
   or a spending limit before renting. Keep one active GPU across both providers.
3. Get the worker connected automatically. Show progress while models prepare;
   the user should not need to copy template settings, SSH commands or pairing codes.
4. Verify the local app and worker status. Return a clickable studio URL, whether
   it is Preparing or Ready, and the running hourly cost. Leave the requested
   studio running so the user can create. Do not shut it down because your reply ends.

The user normally generates through the UI. Do not submit a paid benchmark merely
to open the studio. If they ask you to generate or test, use the existing job API
and report whether the output was saved; see `studio/API-CONTRACT.md` in REPO.

## Finish the session

When the user is finished, use the selected provider's teardown instructions.
Wait for active work and durable local output saving, then stop/delete the exact
rental as agreed and verify provider state. Vast disk is usually disposable;
RunPod network storage is normally retained and remains billable. Preserve the
local Library. Closing the browser, stopping the PC app or sleeping the PC does
not stop GPU charges.

## Working boundaries

The web UI makes art; the agent acquires compute. Credentials stay in private
local configuration and are never pasted into chat or committed. Resolve uncertain
rental attempts by inspecting provider state before creating another instance.
If a provider fails, report the issue and continue within the user's authorized
alternatives instead of leaving an unexplained running bill.

Both provider guides distinguish implemented commands from remaining live-test
gaps. Do not promise capacity, startup times or unverified platform support.
