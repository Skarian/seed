# SSH-only reliability checklist

Active approved [implementation plan](SSH-RELIABILITY.md). Implementation and
unattended acceptance tests passed. The next owner checkpoint is the LAN app.

- [x] Verify RunPod pods and network volumes empty; Vast instances and standalone volumes empty.
- [x] Audit real retry gaps and pinned Comfy input publication behavior.
- [x] Independent reviewer wave, challenge wave, and synthesized-plan review.
- [x] Owner approves the implementation plan.
- [x] Add production-entry-point unattended failure tests, initially exposing current gaps.
- [x] Implement preparation retry, stream inactivity handling, immutable input publication,
  safe submission reconciliation and actionable permanent failures.
- [x] Remove Tailscale and verify saved-connection/config upgrade without losing Library/jobs.
- [x] Publish/pin one corrected candidate, package-test, then validate on both providers.
- [x] Capture evidence before deleting test VM/disks; verify inventories and record posted charges/estimates.
- [x] Update installed package/skill and reconcile the previously discarded frame job.
- [ ] Owner reviews recovery status and Library through the existing LAN address.

The previous [networking log](NETWORKING.md) and
[RunPod investigation](../research/infrastructure/2026-09-12-runpod-tailscale-throughput.md)
remain evidence. Tunnel reconnection and protocol resume tests are not substitutes
for unattended full-operation acceptance. Public frontend/Funnel/login and new
provider work remain out of scope. No paid VM is active at the start of implementation.

Implementation checkpoints: `bfeeb07` contains the SSH-only recovery changes;
`db2e9ac` fences late uploads against completed receipt cleanup. Local acceptance
evidence is in [the recovery report](../research/infrastructure/2026-09-12-ssh-recovery.md).
Seed's exact OAuth client was revoked and its three stored credential copies were
removed. The personal Tailscale client and other devices/policy remain unchanged.
Browser regressions: 22 passed; the sandboxed runner needed its test web-server
process terminated during teardown (diagnostics retained), not an application fix.

Both RunPod and Vast passed live preparation and full job-operation recovery on the
same pinned image. All rentals and disks are deleted. The first Vast host failed
initial SSH authentication; evidence is retained and its precise cause remains
unconfirmed. Posted billing can lag; the recovery report separates posted charges
from estimates. These were model-free Comfy networking fixtures, not a new video
quality/performance test. Merge to main remains pending the owner checkpoint.
