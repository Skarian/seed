# Networking adversarial review — September 12, 2026

Three independent reviewers examined architecture, recovery/library integration,
and Tailscale/provider execution. The owner requested challenges and alternatives,
not another endorsement of the existing plan. Root checked current worker startup,
upload/output routes, official containerboot source and tusd documentation.

## Challenges and resolutions

| Proposal challenged | Resolution |
|---|---|
| Keep every transport and automatic fallback | Recommend two routes, fixed per session; retire RunPod HTTPS only after owner alignment and provider validation. Accept initial SSH bootstrap requirement. |
| Preparation IDs/history and resume endpoints | Singleton desired manifest/status with digest. Guard resume after cancellation with current control revision to reject delayed stale PUTs. |
| Rebuild Tailscale startup with daemon/CLI calls | Use official containerboot; thin child/process-group ownership only. |
| Add ssh2/autossh because they are libraries | Retain existing OpenSSH; neither removes application semantics and both add migration/packaging work. |
| Remove PC-cache fallback to avoid upload service | Root rejected silent loss of an opted-in recovery feature. Architecture reviewer revised recommendation: retain sequential fallback through official tusd. |
| Worker pulls cached files from PC | Reject: adds PC serving/grants, reverse tunnels and userspace outbound networking. |
| Use aiohttp tus package simply because it matches framework | No demonstrated suitable maintained drop-in. Prefer official tusd subject to bounded integration tests. |
| Replace pairing with provisioned authentication | Defer unrelated auth migration; retain current pairing and bearer checks. |
| Full Tailscale device management | PC auth_keys issuance only; authenticated SSH metadata discovery and delayed ephemeral cleanup remove read/delete scopes and cleanup service. |
| Reusable enrollment key on rented hosts | Reject as default: tag limits connectivity but not repeated enrollment abuse. Mint one-use keys on PC. |

Final reread: recovery reviewer supports design without blockers; execution reviewer
supports with process-group/environment handling; architecture reviewer supports
after fixing stale PUT versus cancellation. Root incorporated that correction.
All agree that startup/enrollment/throughput and tusd integration need tests, not
confidence-by-vote. No runtime or paid resource changed during these waves.

The [current plan](../NETWORKING.md) replaces the earlier layered draft, which is
[archived](../archive/NETWORKING-FIRST-REVIEW.md). Sources and implementation gates
are in the current plan. Reviewed operating changes remain proposals for owner
alignment, not authorization to remove features or create rentals.
