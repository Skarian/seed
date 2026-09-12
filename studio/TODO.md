# SSH-only reliability checklist

Active proposed [implementation plan](SSH-RELIABILITY.md). Owner approval is the
next checkpoint; this pass changes planning documents, not runtime behavior.

- [x] Verify RunPod pods and network volumes empty; Vast instances and standalone volumes empty.
- [x] Audit real retry gaps and pinned Comfy input publication behavior.
- [x] Independent reviewer wave, challenge wave, and synthesized-plan review.
- [ ] Owner approves the implementation plan.
- [ ] Add production-entry-point unattended failure tests, initially exposing current gaps.
- [ ] Implement preparation retry, stream inactivity handling, immutable input publication,
  safe submission reconciliation and actionable permanent failures.
- [ ] Remove Tailscale and verify saved-connection/config upgrade without losing Library/jobs.
- [ ] Publish/pin one corrected candidate, package-test, then validate on both providers.
- [ ] Capture evidence before deleting test VM/disks; verify inventories and reconcile charges.
- [ ] Update installed package/skill and reconcile the previously discarded frame job.
- [ ] Owner reviews recovery status and Library through the existing LAN address.

The previous [networking log](NETWORKING.md) and
[RunPod investigation](../research/infrastructure/2026-09-12-runpod-tailscale-throughput.md)
remain evidence. Tunnel reconnection and protocol resume tests are not substitutes
for unattended full-operation acceptance. Public frontend/Funnel/login and new
provider work remain out of scope. No VM is active for planning.
