# Seed execution checklist

Approved 2026-09-11. Current scope: simplify package/commands, rewrite operational
docs, validate installation/recovery and test RunPod/Vast. $10 combined live-test
cap; one active GPU at a time. No long-video/max-reference benchmarks. npm
publication and identity editing are deferred.

## Decisions

- One npm package contains local executable code; skill instructions live in GitHub.
- Agent asks before installing/upgrading Node. Updates occur only on request.
- Provider commands retain native capability/price/error information.
- Vast prioritizes verified hosts, high reliability and network performance.
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
- [ ] Complete documentation link/command audit and final owner walkthrough.

## Installation and recovery

- [x] Clean archive installation outside checkout, media dependencies and CLI modules.
- [x] Isolated setup/start/stop/reinstall; media and credentials preserved.
- [x] Reusable package acceptance harness with isolated APPDATA and Seed data.
- [x] Startup timeout, uncertain-creation reconciliation, unpaired failed-launch teardown.
- [x] Sanitized provider diagnostics; RunPod log and billing commands.
- [ ] Final current-archive installation and installed-skill update.
- [ ] Real Windows sign-in acceptance with owner; actual Linux/macOS coverage.
- [ ] Distinct-version upgrade/failure rollback acceptance (idle reinstall is proven).

## Validation

- [x] Full app/worker/operational suites and browser suite.
- [x] Cache on/off, direct/fallback fixtures, media integrity and recovery regressions.
- [x] Global RunPod creation with no network storage.
- [ ] RunPod startup, prepare, pair, reconnect and confirmed teardown.
- [ ] Vast verified-host acquisition, prepare, pair and confirmed teardown.
- [ ] Record final spend, provider state and passed/failed/not-tested matrix.
- [ ] Owner desktop/mobile review and actual sign-in check.

See [VALIDATION.md](VALIDATION.md) for measured evidence and limitations. Unavailable
platforms or provider failures must remain explicitly untested/failed, never inferred
from fixtures. Infrastructure tests use cheap suitable hardware; inference capacity
benchmarks and identity editing remain separate work.
