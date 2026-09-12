# Seed execution checklist

Approved 2026-09-11. Current scope: simplify package/commands, rewrite operational
docs, validate installation/recovery and test RunPod/Vast. $10 combined live-test
cap; one active GPU at a time. No long-video/max-reference benchmarks. npm
publication and identity editing are deferred.

## Decisions

- Standing owner authorization: always collect failure logs before cleanup,
  including Vast's S3-backed provider log export; no repeated permission request.
- One npm package contains local executable code; skill instructions live in GitHub.
- Agent asks before installing/upgrading Node. Updates occur only on request.
- Provider commands retain native capability/price/error information.
- Vast prioritizes verified hosts, high reliability and network performance.
- Hardware correction: use 96 GB RTX PRO 6000 Server/Max-Q or Workstation for
  normal launches and infrastructure tests. Alternatives (including H200/H100,
  A100 and consumer GPUs) require fresh explicit confirmation. Prior small-GPU
  script-test exceptions are superseded; verify VRAM rather than a similar name.
- Strongly prefer compute under $2/hour; this is not a hard ceiling. Exhaust
  reasonable cheaper candidates before considering a higher-priced test rental.
- Prefer low bandwidth charges; compare expected model/image transfer, storage and
  compute costs together rather than selecting on GPU price or throughput alone.
- RunPod defaults to global placement and disposable disk; existing volumes stay untouched.
- Direct model downloads first, optional PC cache/fallback. User data stays on PC.
- Bounded recovery; verify uncertain outcomes before retrying. Clean up failed new
  rentals. Do not destroy established sessions over a temporary disconnect.

## Packaging and docs

- [x] Move executable skill helpers into the package and expose CLI commands.
- [x] Move rental state outside the installation; retain legacy state when found.
- [x] Pin worker image and retain protocol compatibility checks.
- [x] Rewrite README, skill/setup/provider instructions and current direction.
- [x] Align architecture, bootstrap, release and storage contracts with disposable disk.
- [x] Mark the old execution journal historical; maintain this single current checklist.
- [x] Audit relative documentation links and update CLI/provider command help.
- [x] Owner accepted desktop/mobile use; no repeat walkthrough required.

## Installation and recovery

- [x] Clean archive installation outside checkout, media dependencies and CLI modules.
- [x] Isolated setup/start/stop/reinstall; media and credentials preserved.
- [x] Reusable package acceptance harness with isolated APPDATA and Seed data.
- [x] Startup timeout, uncertain-creation reconciliation, unpaired failed-launch teardown.
- [x] Sanitized provider diagnostics; RunPod log and billing commands.
- [x] Final current-archive installation and installed-skill update.
- [x] Actual Linux package install/setup/start/status/stop in Node Debian container.
- [x] Owner tested Windows sign-in successfully; automatic startup removed afterward by request.
- [ ] macOS validation — deferred by owner.
- [x] Synthetic distinct-version upgrade and failed-start rollback, with credentials/media preserved.

## Validation

- [x] Full app/worker/operational suites and browser suite.
- [x] Cache on/off, direct/fallback fixtures, media integrity and recovery regressions.
- [x] Global RunPod creation with no network storage.
- [x] RunPod startup, prepare, pair, reconnect and confirmed teardown; fixed asynchronous safety-status wait found during live cleanup.
- [x] Vast verified-host acquisition, prepare, pair, reconnect and confirmed teardown (startup needed recovery; see validation).
- [x] Cold Vast launch with the final authorized_keys/host-key hook: Ready without intervention in about 14 minutes.
- [x] Reproduce Civitai HTTP 403 locally: valid personal key with download permission; urllib default User-Agent rejected, explicit Seed User-Agent succeeds. Apply header fix.
- [x] Overlap base and preset preparation with two bounded lanes; join before activation and on failure; serialize shared hashes.
- [x] Live-test overlapping preparation and the Civitai header fix: all 14 files downloaded directly; Ready 5m42s after the message on the previously used Japan host. Record cache-related comparison limits.
- [x] Record provider state and passed/failed/not-tested matrix.
- [x] Rechecked posted charges: Vast $0.558 for latest run.
- [ ] RunPod final bill — still unposted; retain ~$0.65 estimate.
- [x] Owner desktop/mobile acceptance.

See [VALIDATION.md](VALIDATION.md) for measured evidence and limitations. Unavailable
platforms or provider failures must remain explicitly untested/failed, never inferred
from fixtures. Infrastructure tests use the preferred full-workload hardware;
alternative GPU types require explicit confirmation. Inference capacity
benchmarks and identity editing remain separate work.

## Closeout decisions

- [x] Removed automatic Windows sign-in startup and this PC's old entry.
- [x] Rewrote current docs; historical journals are separate in research/development.
- No GPU rental needed for this closeout. RunPod old pods/volume were explicitly
  deleted; prior preservation notes describe historical actions only.
- npm publication, identity editing and maximum-reference capacity tests stay deferred.
