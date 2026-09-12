# Package and lifecycle validation

Current execution: 2026-09-11. Approved scope: packaging, operational commands,
documentation rewrite and infrastructure-focused tests. Combined paid cap $10;
one RunPod pod and one Vast VM, sequentially. No long-video/max-reference benchmarks.

| Check | Result | Evidence / limitation |
|---|---|---|
| Build and type checking | Passed | Local Node 26.8.2, Windows |
| App regression suite | Passed | 51 tests |
| Operational regression suite | Passed | 36 tests; global payload, verified-host filtering, diagnostics and teardown safety included |
| Worker suite | Passed | 42 tests, one platform skip |
| Clean package install outside checkout | Passed | npm archive installed in temporary prefix; dependency scripts enabled |
| Installed setup/start/status/stop | Passed | Fake credentials, isolated data, localhost:4327 |
| Installed provider doctor | Passed | Resolves modules without checkout |
| Idle reinstall/data preservation | Passed | Reusable isolated package harness |
| Different-version install and rollback | Passed with synthetic releases | Next-version startup, deliberately broken server startup, reinstall original archive; credentials and media preserved |
| Windows generated startup entry | Passed in regression suite | Actual sign-in remains owner checkpoint |
| Browser regression | Passed | 18 tests |
| New RunPod lifecycle | Partially tested | Global creation and confirmed destruction passed; initial image lacked SSH; corrected image placement blocked by capacity |
| New Vast lifecycle | Blocked | No qualifying verified, reliable, fast offer within test constraints; no VM created |
| Linux package | Passed | Actual Node 26.8.2 Debian container: archive install, setup, start, status, stop |
| macOS package | Not tested | No macOS environment available |
| 10/15s maximum-reference capacity | Deferred | Explicit owner decision |

The initial launcher test failed under sandbox Windows Script Host restrictions;
it passed when executed outside that sandbox. One manual package-install check
removed the shared Windows startup entry; the existing enabled entry was restored.
The reusable package harness now isolates APPDATA as well as Seed data.

RunPod test pod `cfhgxufayghb19` was destroyed and its absence confirmed. Its
container failed because SSH was missing. The corrected image was published by
[GitHub Actions](https://github.com/Skarian/runpod/actions/runs/34652220067), pulled
by digest and its SSH startup tested locally. Subsequent global PRO 4000, A40 and
PRO 4500 requests were rejected for capacity; uncertain attempts were reconciled.
The corrected image has not completed a live GPU prepare/pair/reconnect cycle.

Final provider check: Vast has no instances; RunPod has only the three pre-existing
EXITED pods. Existing network storage remains untouched and may still incur storage
charges. No new GPU remains active. Billing for the test pod returned no records;
the final charge is pending, not proven zero. No generation jobs ran in this session.
Current package and installed skill were updated. The synthetic upgrade/rollback
test passed in isolated Windows storage (`seed-package-v0OR8O`). This proves package
replacement and rollback, not backward compatibility with future database migrations.
Actual Windows sign-in remains an owner acceptance check. Relative Markdown links
in README, skill files and studio documents were audited with no missing targets.

A subsequent verified Japan RTX PRO 6000 offer (50453760, $1.45/h, 7.8 Gbit/s
advertised download, 0.9971 reliability) disappeared at rental time. Vast returned
HTTP 410 `no_such_ask`; no VM appeared during reconciliation. No successful live
Vast lifecycle is claimed from this attempt.

## SSH failure investigation

Texas instance 50671059 was created at $1.3833/hour and reached provider running
state, but direct SSH refused connections and the provider proxy reset them. No
model download began. The instance and disk were deleted, with absence confirmed;
posted charges at cleanup were $0.05 (subject to billing updates).

The published image reproduced `sshd: no hostkeys available -- exiting` when SSH
was started without Seed's entrypoint. The image removes build-time host keys;
RunPod regenerates them through Seed's entrypoint, while Vast replaces that
entrypoint. Generating keys and restarting sshd in Vast's onstart command passed
against the actual published image locally. This is a confirmed image/bootstrap
defect and a plausible cause of the remote refusal, not a proven remote root cause.
After explicit user approval, Vast returned empty filtered logs for the deleted VM.

The wait command also incorrectly inferred SSH readiness from provider state and
port mappings. It now requires a successful authenticated SSH `true` command.
Regression tests cover refusal followed by recovery and persistent-refusal timeout.
The corrected bootstrap and readiness flow still need live validation. No new GPU
was rented for this investigation.
