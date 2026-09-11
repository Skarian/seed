# Seed prioritized action list

Updated 2026-09-11. This is the current review backlog, not authorization to start
paid resources or a replacement for the execution journal. Discuss the installation
experience before implementing its redesign. Module restructuring is deferred.

## What the last Vast run actually proved

- [x] Normal helper commands rented one GPU, prepared models, paired the app,
  reused the worker on repeated boot, and later destroyed the instance/disk.
- [x] Direct HF downloads, real Civitai failures with cached-PC fallback, disabled
  fallback, and enabled fallback with an empty temporary PC cache were exercised.
- [x] All three implemented workflows passed in SFW and LoRA-enabled NSFW modes.
  Videos were five seconds; mixed references used a Library image and a video
  with its soundtrack. Saved-output hashes and cleanup were verified.
- [x] Production fixes committed during testing: media executable checks and
  missing saved-video/audio metadata recovery (8c609a7).
- [x] Final teardown confirmed no Vast instances. Local Library/cache retained.

This was an agent-assisted live validation, not an unattended clean-install proof.
One-off scripts in .local handled safe rental-state reconciliation after a stale
offer, startup polling/timing, API generation tests, token-file checks, and isolated
fallback tests. FFmpeg was manually restored in the installed package. The
production download/fallback/transfer/pairing logic was the shipped implementation,
not a substitute implementation in those scripts. See the
[live evidence](../research/infrastructure/VAST-DIRECT-FALLBACK-VALIDATION-2026-09-11.md).

## P0 — Agree on the product's installation and update experience

- [ ] Walk through a new user, a returning user, and a developer using Seed.
  Decide whether npm installation is the supported user path and a checkout is
  needed only for development. Keep the skill as the agent-facing entrypoint.
- [ ] Decide how the installed CLI, skill helpers and worker image stay compatible.
  Avoid independently maintained copies and manual copying of changed modules.
  Prefer one documented release/update path; do not introduce an update daemon.
- [ ] Agree on the few user decisions: credentials, optional local model cache,
  optional Windows sign-in startup, GPU selection/budget and shutdown intent.
- [ ] Define what the agent handles without owner intervention: waiting for
  startup, retryable failures, connection, dependency diagnosis and cleanup.
  Multiple internal commands are fine; writing repair scripts should not be normal.

Acceptance: the owner can explain install, update, launch and finish in a short
walkthrough, and the chosen path does not require knowing where copies of Seed live.
Owner checkpoint: discuss and agree before engineering changes.

## P0 — Rewrite the current documentation around that product

- [ ] Inventory active documents, remove contradictions, and choose one place for
  each instruction. Rewrite rather than append another overriding paragraph.
- [ ] README: product, supported installation, daily use, current capabilities.
- [ ] Skill and provider references: self-contained agent operating instructions,
  expected results, supported recovery and billing-safe finish.
- [ ] Technical docs: only maintained architecture/API/storage/workflow/release
  contracts; distinguish implemented behavior from proposals and validation gaps.
- [ ] Preserve research (including LLM research) and dated decisions. Convert old
  plans into clearly historical material rather than live operating instructions.
- [ ] Update/delete redundant documents and stale links after references are
  checked. This checklist should replace competing current task lists.
- [ ] Correct known drift: mandatory PC-first text in CURRENT-DIRECTION, README's
  unvalidated-Vast claim, old execution-plan introduction, and outdated dependency
  statements in DEVELOPMENT.

Acceptance: a reader with no conversation history can operate the supported path
without reconciling competing documents. Review rewritten product/skill docs with
owner; routine link and implementation checks run unattended.

## P1 — Make installation and updates reproducible

- [ ] Implement the agreed distribution path, including package name/publishing
  access if npm is selected. The current package remains private/unpublished.
- [ ] Verify Node, FFmpeg, FFprobe, SQLite and SSH; require the official HF client
  only for local downloads. Provide actionable missing-dependency messages.
- [ ] Test a clean Windows install outside the checkout, upgrade while idle,
  occupied/running-app handling, failed install and recovery. Do not use manual
  module copying as the release process.
- [ ] Verify upgrades preserve credentials, Library, model cache and preferences;
  confirm the skill executes the intended installed version.
- [ ] Test optional sign-in startup on/off, real sign-in, and uninstall behavior.
  Ask for owner participation only for the actual sign-in/user-experience check.

Acceptance: complete installation and upgrade without ad hoc file repair; rerunning
setup is safe, and users can identify the active version.

## P1 — Close operational automation gaps

- [ ] Add a supported recovery path for a vanished Vast offer/no_such_ask. Confirm
  provider state before clearing an uncertain rental; never blindly allocate twice.
- [ ] Make startup waiting/timeouts and useful redacted diagnostics part of the
  maintained helper/skill path rather than one-off polling scripts.
- [ ] Validate existing-instance reuse, delayed image pull, registry failure, SSH
  failure, pairing failure, app restart, tunnel reconnect and teardown.
- [ ] Verify recovery preserves saved connection/media and identifies any rental
  that remains billable. No automatic GPU shopping service or UI rental controls.
- [ ] Turn the useful live-validation sequence into a small reusable opt-in test
  harness. Keep paid allocation explicit, one GPU at a time, and record timing,
  results and cleanup. Do not promote every temporary diagnostic script.

Acceptance: repeat a fresh launch through generation and teardown using documented
commands only, then repeat the meaningful failure cases without hand-editing state.

## P1 — Complete the validation matrix

Use local fixtures first. Paid GPU tests require a fresh authorized session and
should share one rental, reuse models, and stop at a clear owner checkpoint.

- [ ] Model setup: cache on/off, rerun/resume, added or changed LoRA, missing CLI,
  insufficient space, denied/expired token, corrupt file, interrupted direct
  download and interrupted PC transfer. Verify secret handling and per-file fallback.
- [ ] Job/media recovery: disconnect during generation and output retrieval,
  local app restart, interrupted upload/resume, duplicate submission, cancellation,
  cleanup retry and ambiguous outcome. Preserve outputs before teardown.
- [ ] Workflow inputs: new uploads and Library reuse; images, standalone audio,
  videos with/without audio, first/last anchors and combinations within advertised
  model limits. Test both modes, portrait/landscape, batches and fixed/random seeds.
- [ ] Video duration/capacity: 5/10/15 seconds, then largest supported mixed-reference
  input. Record VRAM, execution time, saved-file duration/audio and failures.
  The last five-second smoke run does not establish maximum capacity.
- [ ] User-facing checks: desktop and phone upload/picker/viewer, mode switching,
  loading/progress/errors, Library deletion confirmation, connection recovery.
  Owner reviews UX; automated execution and integrity checks proceed unattended.
- [ ] RunPod: validate the retained path separately, including SSH model preparation,
  private template/volume reuse, pairing, reconnect and safe teardown. Decide the
  intended SSH provisioning experience before automating it.
- [ ] macOS and Linux: clean setup, media tools, local cache, SSH, connection and
  upgrade. Use actual environments; do not infer portability from Windows tests.
- [ ] Measure a full PC-to-GPU model transfer if it still informs the supported
  fallback experience; label it separately from direct-download speed.

Acceptance: maintain a compact passed/failed/not-tested matrix with environment,
version and evidence. Owner checkpoint after the main workflow/UI pass and before
expanding costly capacity testing.

## P2 — Finish the remaining feature, after the basics are stable

- [ ] Reconfirm the intended identity/image-edit experience and model choice.
- [ ] Implement and validate it; keep its existing preview clearly unavailable until
  working. Do not silently describe four completed workflows when only three work.

## P3 — Deferred code organization review

- [ ] Return to web/main.tsx, server/jobs.ts, Vast operations and dense media/API
  modules. Split only along useful responsibilities and format dense code.
- [ ] Preserve working libraries, durable receipts and provider separation. Avoid
  file-count targets, framework replacement, or deleting retained RunPod/research.

## How to execute this backlog

Agree on P0 together. Implement one coherent change at a time, run relevant checks,
commit it, and update the current checklist plus dated execution evidence. Keep UX
and distribution decisions as owner checkpoints; handle routine engineering and
tests unattended. No GPU is currently running and no new paid test is authorized
by the act of writing this checklist.
