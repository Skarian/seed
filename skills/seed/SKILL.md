---
name: seed
description: Set up and operate Seed, a local image and video studio powered by fal. Configure the app, import LoRAs, and inspect generation jobs and saved media.
---

# Seed

Seed runs locally and calls fal for image/video generation. Read
[setup](references/setup.md) for installation. Inspect the current CLI and user
configuration before making changes. Use the project's package archive, not the
unrelated unscoped npm package named `seed`.

Start with `seed status`; run `seed start` when needed and return its local URL.
Use `seed setup` for FAL_KEY and optional chat configuration. Keep keys on the
server and never print credentials or signed private file URLs in diagnostics.
`seed setup --chat-only` changes the optional chat connection.

There is no GPU rental, pod, tunnel, worker image, or base-model preparation.
Krea 2 Turbo handles images; standard H3 handles 768P video. Do not provision infrastructure for ordinary Seed use.

LoRAs are explicit per-request selections. Use `seed loras list` to inspect the
catalog, and `seed loras add FILE image|fl|ref NAME` to import a local master.
`seed loras upload ID` preloads a private fal copy. Keep the original file and
hash; adapter task variants must match. The existing Krea LoKR and both H3 adapters passed live tests. Supported H3
ComfyUI/Kohya names are converted on import with unchanged weights; unknown
mappings or non-unit alpha/rank scaling are rejected. Record actual test
results and never describe an untested adapter as verified.

Submit paid tests only within the user's authorization and budget. Record fal
request IDs, actual billing when available, timing and output paths. Unknown
submission outcomes must be checked before another paid POST. Generation jobs
resume from known fal IDs when the app restarts. Stopping the local app does not
cancel accepted remote work; running cancellation may still incur a charge.

Preserve the local Library, chats, notes and history during ordinary updates.
This fal branch uses a fresh database schema and `Seed` application directories.
Worktree tests should use STUDIO_DEV_ROOT so they do not alter another install.
Only clear data when the user requests it; keep keys and LoRA masters unless
the requested reset explicitly includes those files.
