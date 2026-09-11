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
explicit CLI steps and observable progress. Updates only on request.

Vast and RunPod are supported targets. RunPod reuses its network volume. One active
GPU across providers. Resolve uncertain creation before retrying; clean up failed
new rentals after bounded recovery. Preserve established sessions and saved media.

Current work and evidence: [TODO](TODO.md), [validation](VALIDATION.md).
Identity editing and maximum-reference performance tests are deferred.
