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
- [ ] Both-provider live networking and transfer recovery tests within approved budget.
- [ ] Full frame generation/durable delivery and user Library checkpoint if real GPU needed.

Public frontend, Funnel and login remain deferred. No test rental is currently active.
