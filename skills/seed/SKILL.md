---
name: seed
description: Set up and operate Seed, a personal image and video art studio. Install the local app, find and connect rented GPUs on Vast or RunPod, and release compute when finished.
---

# Seed

Seed is a browser-based art studio. The app runs on the user's computer; rented
GPUs run ComfyUI. Uploads, finished creations and history remain on the computer.
The user creates in the UI; you handle installation and compute through the Seed CLI.

## First use

Read [setup](references/setup.md). Check existing installation and credentials
before repeating setup. Ask permission before installing or upgrading missing or
incompatible Node, explaining that administrator approval may be required.
The npm package is not published yet: use the project's built package archive,
never the unrelated unscoped npm package named `seed`.

## Open the studio

1. Check `seed status` and provider state. Reuse a working session.
2. If compute is needed, read [Vast](references/vast.md) or
   [RunPod](references/runpod.md). Obtain provider, spending authorization and any
   missing credentials. Keep one active GPU across both providers.
3. Find an appropriate offer, create the worker, wait, prepare models and connect.
   Use documented CLI commands, not custom repair scripts. Explain useful progress.
4. Return a clickable local/LAN URL, Preparing or Ready status and hourly cost.
   Leave the session available for the user; ending your response is not shutdown.

The app supports text-to-image, text-to-video and reference-to-video, Library
reuse and SFW/LoRA-enabled modes. Identity editing is unfinished. Do not submit
paid generation tests unless requested. Model prompting research is optional
reference material, not part of normal setup.

## Failure and finish

Inspect provider state after uncertain creation before allocating again. Another
suitable offer is allowed within the user's approved provider and spending bounds.
Use bounded waits and resume preparation. If a newly created worker cannot become
usable after bounded recovery, destroy that exact rental and confirm deletion.
Do not apply this rule to a temporary disconnect of an established session.

When the user finishes, verify all outputs are saved before teardown. Both providers use disposable disk for new workers; leave pre-existing RunPod network volumes untouched. Confirm provider
state and report any remaining billable resource. Preserve the local Library.

## Credentials and updates

Collect keys through masked setup prompts, never chat. Provider keys stay local.
HF/Civitai tokens can be sent transiently over SSH stdin for model downloads;
never put them in command arguments, templates or logs. A host administrator can
inspect runtime memory. The optional PC cache provides fallback after direct
model downloads fail.

Update only when requested. Stop the local app when idle, install the requested
package, check it and restart. Preserve data and configuration. No background
update checks. The package pins the worker image; do not substitute `latest`.
