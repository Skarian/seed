# Releases and infrastructure

One local Seed package ships the CLI, server, browser build and operational code.
The GitHub skill is instructions only. npm publication is deferred; build an archive
with `npm pack` and install it outside the checkout for acceptance testing.
`seed version` identifies the installed package, Node and pinned worker image.
Updates happen only when requested, with the local app stopped and user data kept.
No update daemon, Terraform or UI acquisition service.

`shared/worker-release.ts` pins the immutable GHCR worker image. Both providers use
that pin; existing workers keep their image. Pairing checks protocol compatibility.
Build candidates with `docker build -t seed-worker:candidate -f worker/Dockerfile worker`.
The GitHub workflow can publish candidates. Validate startup and change the pin
only after evidence supports it. The public image contains no user credentials.

Models are downloaded directly on rented compute. Optional local caching downloads
at setup and provides fallback. Models and private presets are not package/image
payloads. HF/Civitai tokens travel transiently via SSH stdin; provider keys stay
local. Pairing/Jupyter secrets are runtime inputs.

RunPod creates a globally placed pod with disposable disk; optional datacenter
constraints remain explicit. Vast selects a particular verified host, prioritizing
reliability and network speed. Preserve native provider prices/capacity/diagnostics.
Unknown metrics remain unknown. Resolve uncertain creation before trying again.
Delete a failed newly created rental after bounded recovery; established sessions
require safe output saving before teardown. Existing network volumes are untouched.

Checks and platform gaps: [validation](VALIDATION.md). Build/install instructions:
[development](DEVELOPMENT.md). User workflows: [skill](../skills/seed/SKILL.md).
