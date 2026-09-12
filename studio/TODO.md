# Networking implementation checklist

Active [design](NETWORKING.md), [review decisions](reviews/NETWORKING-REVIEW.md).

- [x] Owner approves implementation, retiring RunPod HTTPS, and low-cost networking tests on both providers.
- [x] PC Tailscale installed and signed in.
- [x] Pin official Tailscale/tusd container digests; local tusd restart/resume/hash gate passes.
- [x] Apply owner-approved restricted tailnet policy and confirm saved access tests.
- [x] Obtain scoped enrollment credential.
- [x] Prove authenticated tusd integration and containerboot enrollment/restart locally.
- [x] Singleton preparation API and stable rental identity; shared HTTP client over SSH (local validation).
- [x] Explicit SSH/Tailscale route selection on both providers; retire old preparation/proxy paths (live validation below).
- [x] Publish/pin candidate and update installed Windows app and skill; package preservation checks pass.
- [x] Both-provider SSH transfer, output hashes, receipts and forced tunnel recovery.
- [x] Vast Tailscale enrollment, transfer/resume and route restoration.
- [ ] Resolve RunPod Tailscale bulk-download slowdown (enrollment/upload passed; downloads failed).
- [ ] Reconcile the previously discarded frame job before the main-app user checkpoint.
- [ ] Reconcile posted RunPod test charges (Vast posted $0.02; RunPod records still pending).
- [ ] Full frame generation/durable delivery and user Library checkpoint if real GPU needed.

Public frontend, Funnel and login remain deferred. No test rental is currently active.
