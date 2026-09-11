# Releases and infrastructure

The local app owns user data; the agent operates one authorized GPU. No provider
daemon, Terraform, model archives, automatic failover or UI rental controls.
Provider setup and operating steps live in [the skill](../skills/seed/SKILL.md).

`shared/worker-release.ts` is the authoritative immutable GHCR image reference for
RunPod setup and Vast rental. Rebuild the app after changing it. The worker image
contains explicit source/static files over the pinned public Comfy base; keep the
mirror workflow because that base remains required. Models download separately
from `worker/models.json`. Credentials are runtime inputs, never image contents.

Build: `docker build -t seed-worker:candidate -f worker/Dockerfile worker`.
The existing GitHub workflow publishes candidates after worker changes are pushed.
Verify the candidate digest and startup modes before changing the release pin.
CPU startup checks do not prove GPU generation; record live validation separately.
Existing pods keep their image. RunPod owners rerun `seed pod-setup` to update the
private template; future Vast rentals use the built application's pin. Recreate
old instances after saving outputs when their bootstrap contract changes.

Local distribution uses `npm pack` and local npm installation until registry
publication is enabled. Rebuild/reinstall and restart the idle app; user data stays
outside the package. Keep the installed skill synchronized and remove obsolete
helpers. See [development](DEVELOPMENT.md) for checks and [execution journal](EXECUTION-PLAN.md)
for decisions and evidence. Public hosting remains owner-managed.
