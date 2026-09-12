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

1. Check `seed status` and provider state. Run `seed start` if the app is stopped.
   Reuse a working session; a local Library visit does not require renting compute.
2. If compute is needed, read [Vast](references/vast.md) or
   [RunPod](references/runpod.md). Obtain provider, spending authorization and any
   missing credentials. Keep one active GPU across both providers.
3. Find an appropriate offer, create the worker, wait, prepare models and connect.
   Use documented CLI commands, not custom repair scripts. Explain useful progress.
4. Return a clickable local/LAN URL, Preparing or Ready status and hourly cost.
   Leave the session available for the user; ending your response is not shutdown.

Choose hardware for the full configured image/video workload, including launch
and infrastructure tests. Strongly prefer one 96 GB RTX PRO 6000 (including
Server/Max-Q) or RTX PRO 6000 Workstation. Verify actual VRAM; older RTX 6000 and
RTX A6000 cards with similar names are not equivalent. H200, H100, A100, consumer
RTX cards and other alternatives require explicit user confirmation before rental.
Do not infer an exception from a test being "only scripts" or reuse an old smaller-
GPU test authorization. If preferred hardware is unavailable, present alternatives
with price/VRAM tradeoffs and wait for the user's choice.

Strongly prefer GPU compute under $2/hour on either provider; this is a preference,
not a hard ceiling. Search reasonable cheaper alternatives before considering a
higher price, while retaining suitable hardware, host reliability and network speed.
Explain the tradeoff when selecting a more expensive offer within the user's
authorization. Include disk, transfers and expected runtime in the total budget;
a generous total budget is not a reason to disregard the hourly preference.
Prefer low bandwidth charges too. Estimate model-download cost from the expected
GB and the provider's per-GB rate, include image pulls where billed, and compare
total startup/session cost. A cheap GPU with expensive transfers may be poor value;
fast networking alone does not justify high transfer fees. This is a preference,
not an invented fixed per-GB ceiling.

The app supports text-to-image, text-to-video and reference-to-video, Library
reuse and SFW/LoRA-enabled modes. Identity editing is unfinished. Do not submit
paid generation tests unless requested. Model prompting research is optional
reference material, not part of normal setup.

## Failure and finish

On any test failure, collect and save the relevant local, worker and provider logs
before destroying the rental. The owner gives standing permission for diagnostic
log collection, including Vast's export to its S3-backed log service. Do not ask
again for that transfer. Keep saved logs private and redact credentials in reports.
If collection fails, preserve the collection error and available evidence before
cleanup; do not describe missing logs as a completed investigation.

Inspect provider state after uncertain creation before allocating again. Another
suitable offer is allowed within the user's approved provider and spending bounds.
One vanished offer or empty search is not enough to conclude capacity is unavailable:
refresh and try suitable GPU alternatives before reporting a blocker.
Startup has no elapsed-time cutoff. Keep reporting progress while the provider
prepares the container; an eight-minute startup is not itself a failure. Diagnose
reported errors or lack of progress, and stay within the approved spending budget.
If a newly created worker cannot become usable after recovery, destroy that exact rental and confirm deletion.
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
