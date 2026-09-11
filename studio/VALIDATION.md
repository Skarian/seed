# Package and lifecycle validation

Current execution: 2026-09-11. Approved scope: packaging, operational commands,
documentation rewrite and infrastructure-focused tests. Combined paid cap $10;
one RunPod pod and one Vast VM, sequentially. No long-video/max-reference benchmarks.

| Check | Result | Evidence / limitation |
|---|---|---|
| Build and type checking | Passed | Local Node 26.8.2, Windows |
| App regression suite | Passed | 51 tests |
| Operational regression suite | Passed at packaging checkpoint | 31 tests; more RunPod lifecycle checks pending |
| Worker suite | Passed | 40 tests, one platform skip |
| Clean package install outside checkout | Passed | npm archive installed in temporary prefix; dependency scripts enabled |
| Installed setup/start/status/stop | Passed | Fake credentials, isolated data, localhost:4327 |
| Installed provider doctor | Passed | Resolves modules without checkout |
| Upgrade/data preservation | Pending | |
| Windows generated startup entry | Passed in regression suite | Actual sign-in remains owner checkpoint |
| Browser regression | Pending | |
| New RunPod lifecycle | Pending | No rental yet |
| New Vast lifecycle | Pending | No rental yet |
| Linux/macOS package | Not tested | No actual environment used yet |
| 10/15s maximum-reference capacity | Deferred | Explicit owner decision |

The initial launcher test failed under sandbox Windows Script Host restrictions;
it passed when executed outside that sandbox. One manual package-install check
removed the shared Windows startup entry; the existing enabled entry was restored.
The reusable package harness must isolate APPDATA as well as Seed data.

No paid resources created or charges incurred by this execution yet.
