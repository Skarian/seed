---
name: seed-gpu
description: Set up and open Seed, a personal AI art studio for creating images and videos. Find a suitable GPU on Vast or RunPod, connect the studio, help with generation workflows, and release paid compute when the user is finished.
---

# Seed — your personal art studio

Seed is a browser-based studio for making images and videos with open models.
It runs on the user's computer and rents a GPU when needed. The computer keeps
their uploads, creations and history; replacing the GPU does not replace their
library. Your role is to make the studio available, so the user can focus on art.

## What the user can do

- **Create an image:** describe it, choose an aspect ratio, and generate one or a batch.
- **Create a video:** describe action, camera movement, dialogue and sound; choose
  a 5, 10 or 15-second clip and portrait or landscape output.
- **Guide a video with references:** bring images, video or audio, including
  optional first/last-frame images. References can come from uploads or the Library.
- **Keep and reuse their work:** preview, download, reuse and delete creations in
  the local Library. SFW/NSFW selects configured model/LoRA presets; advanced
  controls expose seeds and supported generation options.

Image-to-image identity editing is still in development. Do not present the
preview form as a working feature. See the app's current controls for supported
inputs; don't invent capabilities or rewrite prompts unless asked.

## “Set up Seed”

Get the existing checkout working. Read [setup](references/setup.md) for the exact
commands and credentials. Install missing dependencies, build the app and help the
user enter keys privately. Remember their provider and optional Windows sign-in
preference. They shouldn't need Docker, a desktop wrapper, or local model weights.

Start the local server and give them a clickable browser URL. For phone/tablet use
on their Wi-Fi, configure the local LAN address. Their Library is available even
when the GPU is off. Setup itself does not rent compute.

## “Open the studio” / “Find me a GPU”

Check whether Seed already has a usable worker before provisioning anything.
Reuse working compute. Otherwise find suitable available hardware on the selected
provider, or compare both if requested. Balance total price, generation speed and
startup/download time; the cheapest hourly card is not always the cheapest session.
Explain the chosen offer briefly and work within the user's spending authorization.
Ask only for a missing budget/provider preference or required access.

Use [Vast](references/operations.md) or [RunPod](references/runpod.md) instructions
to acquire one GPU, prepare models and pair it automatically. Keep one active GPU
across providers. Resolve an uncertain rental response before attempting another.
The user should not have to manage template values, SSH commands or pairing codes.

Keep them informed while the studio prepares. Check the actual worker, not merely
its provider status. Deliver the URL with **Preparing** or **Ready**, the hourly
cost, and any action still needed. Leave the requested studio running for them;
finishing your reply is not the end of their creative session.

## “Help me create”

The user normally works directly in Generate and Library. Help choose a workflow,
understand reference roles or improve a prompt when asked. Read the matching guide
under the checkout's `prompting/` directory for model-specific prompting. Existing
jobs show progress and record timings/memory; use that evidence when recommending
hardware. Do not run an expensive benchmark just to open the studio.

## “I'm finished”

Confirm active work is finished and outputs are durably saved locally, then follow
the agreed stop/delete choice and verify provider state. Vast's disposable disk is
normally deleted after a session; RunPod's network volume is retained. Explain any
remaining storage charge. Closing a browser, stopping the local app or putting the
PC to sleep does not stop GPU billing.

## Where the implementation lives

The repository contains the React/Node studio, its ComfyUI worker and this skill.
The provider references contain commands and recovery details; they are not steps
for the user to perform manually. Keep credentials outside Git and browser state.
The current software/runtime pins and verification limits live in those references
and the repo's README. No provider controls or extra orchestration service belong
in the studio UI.
