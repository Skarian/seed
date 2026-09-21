# Historical record — superseded

Current status: [Seed checklist](../../studio/TODO.md).
Entries below describe the state at their original date, not current instructions.

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
[GitHub Actions](https://github.com/Skarian/seed/actions/runs/34652220067), pulled
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

## September 11 Vast retry: diagnostic evidence

The subsequent test rented Texas RTX 5060 Ti instance `50673460` at $1.3667/hour,
with 180 GB disposable disk and download charges of $0.01042/GB. This is an
infrastructure test, not an inference benchmark.

Before recovery, saved container logs confirmed both missing SSH host keys and
`chown: cannot access '/root/.ssh/authorized_keys'`. The latter stopped the chained
startup hook before host-key generation. The durable hook now writes the public
key supplied at creation, sets permissions, generates host keys and restarts SSH.
An actual SSH login against the published image locally passed with no preexisting
authorized_keys. The operational regression suite passed all 25 tests.

This rental needed an API start and later a public-key reattachment/reboot before
authenticated SSH succeeded. Do not count it as a clean unattended cold launch of
the final hook. The hook's final change was made after this rental was created.
The subsequent model preparation used the installed CLI and direct downloads.

`seed gpu vast logs` now exports and saves redacted provider logs before cleanup;
`--daemon-logs` includes host/container-launch diagnostics. The owner explicitly
authorizes this on every failed test, including Vast's S3-backed log export.
Evidence is kept privately under the per-user seed-vast/diagnostics directory;
raw logs and credentials do not belong in Git.

Live result after recovery: Ready, pairing, replacement SSH tunnel/reconnection,
and repeated boot (`reused: true`) all passed. All 14 configured files verified;
the 11 base files (99.6248 GB) took 1,131.4 seconds (18m 51s), averaging 88.05 MB/s
including verification. The three user LoRAs (1.8552 GB) failed direct download
but transferred successfully from the optional PC cache; all three presets activated.
Base timing excludes those fallback transfers and image/container startup.

The old download receiver suppressed the exact LoRA errors, so their cause is
unconfirmed. It now returns safe exception type and HTTP status, and the CLI records
these before fallback; signed URLs and exception messages remain excluded. Six Python
and five CLI transfer tests passed, including redaction and HTTP 403 reporting.
An authenticated diagnostic probe was blocked by approval review; the user approved
it after teardown. Retain that approval for future diagnostic requests with the
source token over SSH stdin; do not recreate a rental merely to repeat this probe.

Instance `50673460` and its disk were destroyed and an empty Vast instance list
confirmed. Posted cost at cleanup was $1.705; remaining account credit $38.6349.
Billing may still update. No inference jobs ran. The final creation hook still needs
a new cold-launch acceptance check; RunPod's full lifecycle also remains pending.

## September 11 clean cold-start acceptance

Fresh Japan RTX PRO 6000 Max-Q instance `50677460`, offer `43317266`, was rented
at $1.9683/hour with 180 GB disk. The installed package's final startup hook worked
without repair, key reattachment, API start, or reboot. Authenticated readiness
passed. This supersedes the earlier outstanding Vast cold-launch check.

Local timestamps (America/Chicago): wait began 20:29:15 and completed 20:33:57
(4m 42s); boot ran 20:34:11â€“20:42:08; paired Ready was confirmed at 20:43:02.
Approximately 14 minutes from rental to confirmed Ready, including observation
and command-dispatch gaps. The 99.6248 GB base files downloaded and verified in
250.706 seconds (4m 11s), averaging 397.38 MB/s. All three Civitai LoRA requests
returned HTTP 403; saved diagnostics captured those statuses and the optional PC
cache transferred all three successfully. All 14 files verified and three presets
activated. No inference jobs were submitted.

Provider logs and local boot logs were preserved before teardown. Instance and
disk deletion was confirmed, followed by an empty Vast instance list. Posted
charges were only $0.312 at that check, with bandwidth still unposted; this is not
the final total. Account credit was $38.2943. The remaining download issue is the
reason for Civitai's HTTP 403, not SSH or automatic fallback. RunPod's complete
lifecycle remains unproven separately.

## Civitai diagnosis and concurrent preparation

Read-only Civitai identity validation accepted the configured personal API key and
confirmed model-download permission. No environment credential shadowed it. Tiny
range requests from the PC succeeded for all three configured files through the
Civitai redirect to its storage endpoint. No key replacement is needed.

A controlled local Python comparison reproduced HTTP 403 from civitai.com with
urllib's default User-Agent. Changing only that header to `Seed/0.1` produced
HTTP 307 followed by HTTP 200; a one-byte Range variation produced HTTP 206.
Responses were closed without full-file downloads, and credentials/signed URLs
were not logged. The receiver now sends that explicit User-Agent. This reproduces
and fixes the rejection locally; live GPU verification remains outstanding.

Base models and user presets now prepare in two sequential lanes concurrently.
Shared hashes force serial execution because staging is hash-addressed. Both
lanes finish before activation; failures stop new transfers and join in-flight
work. SSH input failures terminate and await the child before returning. Nine
CLI transfer tests and six Python transfer tests passed, including overlap,
failure joining, shared hashes, and authorization removal across redirects.
No GPU was rented for this implementation. No measured speedup is claimed yet.

## Live overlap and Civitai fix acceptance

The next authorized test rented Japan RTX PRO 6000 Max-Q `50682325`, same machine
142232 and $1.9683/hour offer. User message/turn start: 2026-09-12 02:12:15 UTC.
Pipeline wait started 02:13:36.326, authenticated SSH passed 02:13:39.029,
boot completed 02:17:45.864, pairing completed 02:17:50.296 and actual Ready was
confirmed 02:17:56.855: **5m 42s message-to-Ready**. Final-report and cleanup time
remain part of the primary message-to-report metric, not excluded from it.

All 14 files downloaded directly and verified, including the three Civitai LoRAs
in 12.29s, 2.89s and 6.50s respectively. Logs prove they completed concurrently
with the first base-model download. No HTTP 403, local fallback, manual repair or
reboot occurred. Base 99.6248 GB preparation measured 229.759s (3m50s), effective
433.61 MB/s. Total boot, including transfer coordination and activation, was
4m07s versus the previous 7m57s. These are live observations, not an isolated
causal benchmark: host conditions varied and the already-used host apparently
had cached container layers. Do not attribute the former 4m42s container-startup
delay disappearing to the download changes. Fresh model files were downloaded;
no network volume was used.

Saved preparation/readiness/provider logs before teardown. GPU and disk deletion
confirmed, followed by an empty Vast instance list. Posted charge was $0.177,
with bandwidth billing still incomplete; credit $37.8237. No inference jobs ran.

## Different host with corrected full-workload hardware

The user's different-host request began 2026-09-12 02:20:39 UTC. An initial
RTX 5090 rental `50683392` was an operator selection mistake: an old permission
for small script-test GPUs was incorrectly reused. It and its disk were deleted
before testing. The user clarified that 96 GB RTX PRO 6000 Server/Max-Q or WS is
the preferred hardware for infrastructure tests too; alternatives need explicit
confirmation. Repository and installed skill guidance now reflect this.

Replacement `50683866` used RTX PRO 6000 WS, 96 GB, on different Japan machine
14398 (previous machine was 142232), offer 50214231, $1.5667/hour. Startup wait
began 02:25:44.590 UTC and authenticated SSH passed at 02:32:43.478: 6m59s.
The first five-minute wait timed out; logs were collected and the documented one
additional wait succeeded without key repair/reboot. Host logs show shared layers
already existed, while remaining image layers were downloaded. Image pull ran
02:25:47â€“02:32:10 (6m23s), followed by Vast's startup-layer setup. This is a
different-host/partially cached test, not proof of a completely empty host cache.

Boot completed 02:41:22.566 (8m39s after SSH), paired at 02:41:26.630, and Ready
was confirmed at 02:41:33.241. Thus message-to-Ready was 20m54s including the
wrong rental, correction and guidance update; replacement wait-to-Ready was
15m49s. Preserve both rather than resetting the user's stopwatch.

All 14 files downloaded directly, with three presets activated; no Civitai 403
or PC fallback. The LoRAs overlapped base preparation. Base 99.6248 GB download
and verification took 502.364s (8m22s), effective 198.31 MB/s, substantially slower
than the prior host despite higher advertised networking. No inference was run.

Saved host/container/readiness/preparation evidence, then deleted GPU and disk;
an empty Vast instance list confirmed cleanup. Posted charge $0.521 and credit
$37.1976 at cleanup, subject to delayed bandwidth/final billing. Request host and
container log exports separately to avoid overlapping exports for one instance.

## RunPod full-size disposable startup test (2026-09-12 UTC)

User message/turn began 02:45:57. Rented pod o4f7fcba47cz0l in EUR-IS-2:
RTX PRO 6000 Blackwell Server Edition, 96 GB VRAM, $2.09/GPU-hour,
180 GB disposable disk, no network volume, pinned e419f657 worker image.
Provider/SSH wait began 02:47:42.424 and passed 02:47:48.812; SSH preparation
worked without repair. Image logs show layer downloads; fully uncached status
is unproven. Selection, creation and startup together took 1m52s from message.

Preparation finished 03:01:53.624 (14m05s after SSH), pairing at 03:01:56.163,
and fresh Ready at 03:02:16.971: **16m20s message-to-Ready**. All 14 files
(~101.48 GB including user presets) downloaded directly and verified. The 11
base files (99.6248 GB) took 846.873s, effective 117.64 MB/s, including verification.
All three user LoRAs overlapped base preparation; no Civitai 403 or PC fallback.
Repeat connection succeeded. No inference was run.

Cleanup exposed a real CLI defect: RunPod paused the queue then immediately
read safety status before the asynchronous fresh result. Two attempts refused
deletion despite no work or unsaved outputs. Added the same bounded status wait
used by Vast (up to 15 seconds), preserving affirmative safety and pod identity
checks. The corrected command then deleted the pod and disk successfully.
Provider listing confirmed absence and no running pods; three pre-existing
EXITED pods and existing network storage were preserved. Saved provider logs,
readiness and preparation receipts locally before deletion. Billing records had
not posted; an empty result is not a zero-cost claim. Final report elapsed time
also includes cleanup, this fix, its regression test and commit/install work.
