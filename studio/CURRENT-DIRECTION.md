# Current product direction

Seed is a personal browser art studio backed by rented GPU compute. The agent
installs and operates it; the user generates through the UI. One local npm package
contains all executable local code. The GitHub skill is instructions only. The GPU
worker is a separate pinned container image. npm publication is deferred.

Permanent media/history/credentials stay in per-user directories. Models download
directly to the GPU, reusing existing files; optional local caching supplies fallback.
Setup downloads the local cache immediately when selected. Tokens are transient
SSH inputs on the GPU, not template or container-image contents.

No UI rental controls, background updater, provider-shopping daemon, Terraform,
new storage service or multi-package framework. Small modules, shared operations,
explicit CLI steps and observable progress. Updates only on request. The agent starts the local app when needed; no sign-in startup.

Vast and RunPod are supported targets. New RunPod workers use global placement and disposable disk. One active
GPU across providers. Resolve uncertain creation before retrying; clean up failed
new rentals after bounded recovery. Preserve established sessions and saved media.

Current work and evidence: [TODO](TODO.md), [validation](VALIDATION.md).
Identity editing and maximum-reference performance tests are deferred.

## Spicy mode

One session-scoped setting controls all generation workflows, Library visibility,
and the reference picker. Hold the Seed logo for 800 ms (mouse, touch, or keyboard)
to toggle it; the pepper beside the logo turns it off immediately. The setting
survives reloads in the same tab and starts off in a fresh tab. Workflow changes
and form resets do not change it. Existing per-workflow mode preferences are ignored.

Mode changes show a centered pepper toast for two seconds, with entrance and exit
animations that respect reduced motion. React-hot-toast's headless API uses the
app stylesheet to preserve the existing Content Security Policy.

The UI calls the modes Standard/Spicy; stored and API values remain sfw/nsfw.
Existing assets retain their metadata, and submitted jobs retain the mode captured
when Create was clicked. This change does not reclassify historical assets.
