# Seed product scope

Seed is a personal image and video art studio. A local browser app keeps uploads,
finished media and history on the user's PC. An agent installs/starts the app and
finds, connects and releases a rented GPU through the CLI.

## Delivered experience

Generate and Library work on desktop and mobile. Generate provides a workflow
selector, SFW/NSFW mode where configured, a resizable prompt, aspect choices,
video duration, batch count, seed controls and reusable media previews. References
can come from uploads or Library. Preview overlays provide information, download,
removal and supported reference roles. Library has confirmed deletion and an
opt-in NSFW filter. Job progress and connection details live in header popovers.

Implemented generation: text-to-image, text-to-video and reference-to-video.
Identity editing remains unfinished. Advanced controls are shown only when they
have a supported effect. Model labels and reference roles must remain consistent;
never silently rewrite a reference to point at another asset.

Amber means action is needed, blue means activity, green means Ready, red means
failure. Color is accompanied by text. Model loading is distinct from generation
percentage. Disconnected does not mean GPU billing has stopped.

## Operating model

One installable Node package contains the app and CLI. The agent skill lives in
GitHub. A separate digest-pinned worker container runs ComfyUI on Vast or RunPod.
The agent starts Seed on demand; no Windows automatic-start option is included.
New workers use disposable disk and global provider selection. One active GPU
at a time, with hardware and budget rules in the skill. There are no rental controls
in the web UI and no automatic provider-shopping service.

Models download directly to the GPU. Optional PC caching downloads at setup and
provides fallback. Source tokens may travel over SSH stdin; provider keys stay
local. Permanent media/history stay on the PC. Outputs must reach durable local
storage before the worker disk is destroyed. Public hosting is owner-managed.

## Remaining scope

Next feature: [H3 export as images](studio/H3-IMAGE-EDIT.md), selected before
generation on existing video workflows, with whole-second durations from 5–15.
Frames save automatically as one Library item per generation, with a frame-count
badge, a scrubbable frame viewer and optional Keep only pruning.
Feature branch: `feat/h3-image-edit`; local implementation is ready for UI review.
Worker publication, live GPU proof and owner acceptance remain pending.

npm publication, identity editing, maximum-reference capacity benchmarks, macOS
validation, LLM integration and timeline editing are deferred. Desktop/mobile
acceptance is complete. Current work: [checklist](studio/TODO.md). Current evidence:
[validation](studio/VALIDATION.md). Build and module map: [architecture](studio/ARCHITECTURE.md).
