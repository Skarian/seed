# Package and lifecycle validation

Current execution: 2026-09-11. Approved scope: packaging, operational commands,
documentation rewrite and infrastructure-focused tests. Combined paid cap $10;
one RunPod pod and one Vast VM, sequentially. No long-video/max-reference benchmarks.

| Check | Result | Evidence / limitation |
|---|---|---|
| Build and type checking | Passed | Local Node 26.8.2, Windows |
| App regression suite | Passed | 51 tests |
| Operational regression suite | Passed at packaging checkpoint | 35 tests; global payload, diagnostics and teardown safety included |
| Worker suite | Passed | 40 tests, one platform skip |
| Clean package install outside checkout | Passed | npm archive installed in temporary prefix; dependency scripts enabled |
| Installed setup/start/status/stop | Passed | Fake credentials, isolated data, localhost:4327 |
| Installed provider doctor | Passed | Resolves modules without checkout |
| Idle reinstall/data preservation | Passed | Reusable isolated package harness; distinct-version upgrade still pending |
| Windows generated startup entry | Passed in regression suite | Actual sign-in remains owner checkpoint |
| Browser regression | Passed | 18 tests |
| New RunPod lifecycle | In progress | Global RTX PRO 4000, EU-RO-1, $0.57/h; no network volume |
| New Vast lifecycle | Pending | No rental yet |
| Linux/macOS package | Not tested | No actual environment used yet |
| 10/15s maximum-reference capacity | Deferred | Explicit owner decision |

The initial launcher test failed under sandbox Windows Script Host restrictions;
it passed when executed outside that sandbox. One manual package-install check
removed the shared Windows startup entry; the existing enabled entry was restored.
The reusable package harness must isolate APPDATA as well as Seed data.

RunPod test pod cfhgxufayghb19 is under startup validation. Earlier region-bound
creation returned HTTP 400 and created nothing; its original reason was not captured.
Vast earlier attempts created no instances and were reconciled. No successful Vast
rental yet. Final spend and teardown confirmation will be recorded before handoff.
