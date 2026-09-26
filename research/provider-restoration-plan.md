# Restore rented GPU execution while preserving the current studio

Superseded by [the September 22 worker-pool buildout plan](worker-pool-buildout-plan.md).
The owner now wants the existing ComfyUI recipes restored into separate Image and
Video workers, Qwen Image 2.1 packaged with Image, and a sidebar GPU popup with
Vast/RunPod acquisition. Performance tuning is deferred and this build's QA must
not provision real compute. Costs now belong to rentals, with no per-generation
pricing. New workers download LoRAs directly from Civitai. Both finish-and-quit
and immediate cancellation/termination are required, and closing the UI leaves
the background server running. Earlier BF16, cost-preview and UI recommendations
below are historical.
Workers remain rented until the user explicitly quits them; no automatic idle or
empty-queue release. Launches include all enabled compatible LoRAs, with explicit
Retry preparation or Continue without that LoRA for an adapter download failure.

Reviewed September 20, 2026. This is a proposal, not an implementation or spending
authorization. No providers were provisioned during this review.

## Saved baseline and evidence

- Current application checkpoint: `1d9896f` on `codex/fal-only`.
- Main fetched from origin: `dbd388ed28974362285d4f83a117aa9a2be1bfa6`.
- Main and the fal checkpoint share the same pre-migration base. Merging main
  will not restore deleted files; selectively port its execution modules into
  the current application.
- Main already uses RunPod REST v2 in `operations/runpod.mjs`. An API-version
  migration is not the primary task.
- `codex/b200-parallel-generation` has image/video engine lanes on one worker.
  It is useful prior research, not an independent multi-worker scheduler.
- Historical RTX pool estimates are in
  `archive/infrastructure/2026-09-20-rtx6000-worker-pool.md`. Those rates and
  measurements belong to the old model recipe and are not current offers or
  BF16 performance forecasts.

## What survives

Keep the current React shell, Generate drafts/hooks, shared prompt/settings/cost
components, Quantity, Chat approvals, local Library, Pick Frame, preview, Admin
credentials, grouped LoRA file mapping, descriptions, strengths, visibility,
and import toast/Activity flow. Keep the current user directories and data.

Provider concerns belong behind these features. The UI should not regain the
old capability fields, preset names, global queue pause control, or export-images
workflow. Internal worker compatibility checks remain necessary.

The current shared job type aliases a server type containing `fal`, and pricing
and recovery messages are fal-specific. Introduce explicit shared request, job,
estimate, and error DTOs before replacing execution. Keep historical fal job
receipts readable; never replay them against a GPU worker during migration.

## What can be reused from main

| Existing code | Reuse | Required adaptation |
| --- | --- | --- |
| `operations/vast.mjs`, `runpod.mjs`, `runpod-lifecycle.mjs` | Offer discovery, quotes, create/reconcile/destroy, provider errors | Per-rental records, concurrent acquisition, ownership and aggregate budgets |
| `operations/connection.mjs`, `ssh.mjs`, `tunnel.mjs` | Private SSH transport, pairing, reconnect | Per-worker ports, credentials, tunnel supervisor and status |
| `operations/preparation*`, `worker/model_files.py`, `prepare.py` | Verified preparation and resumable assets | Prepare only a worker's assigned model profile; selected LoRA assets on demand |
| `server/worker.ts`, `worker-transfer.ts` | Identity validation and integrity-checked transfers | One connection per worker, independent failures |
| `worker/`, `worker/comfy_seed/` | Execution, job receipts, telemetry and output spool | Per-job LoRA selections; validate chosen model recipe |
| Old graph builders in `server/workflows.ts`, `server/video.ts` | Trusted graph construction and reference binding | Current request shape, 768p output, selected LoRAs, no retired UI dials |
| Worker release/build configuration and recovery tests | Pinned images and lifecycle coverage | New candidate image, tests for the worker pool |

Do not restore either old `server/jobs.ts` or old `server/db.ts` wholesale.
Reuse their receipt/reconciliation logic in the new scheduler and add a forward
database migration to the current schema 7.

## Why multiple workers require real backend work

Main saves one `worker-connection.json` and its endpoint validator only accepts
the fixed loopback tunnel on port 18080. Starting another tunnel stops the first.
The provider code refuses acquisition when an existing rental is active. Its
creation-reconciliation logic identifies newly appearing resources relative to
an account snapshot, which is ambiguous with concurrent creation.

The dispatcher owns one connection and one transfer. It waits for the worker
queue to be empty and for all relevant unresolved work to clear. The current
fal scheduler also has global recovery blocks that must become worker-scoped.
Removing the acquisition guards alone would cause collisions and misrouting.

## Proposed worker pool

Use the existing local server as the coordinator, with SQLite durability:

1. **Worker registry:** provider/resource ID, acquisition attempt ID, pairing
   reference, tunnel port, lifecycle state, model profile, cached assets,
   engine/workspace identity and quoted rates. Secrets stay in user config.
2. **Acquisition:** request a worker count and per-worker/aggregate hourly
   limits. Reserve the budget before concurrent create calls. Persist each
   attempt before sending it; reconcile ambiguous results before replacement.
   Match only owned resources using supported provider identifiers and labels.
3. **Scheduling:** turn Quantity into independent outputs, as today. Atomically
   assign each output to one compatible ready worker. Start with one generation
   slot per worker, prefer warm matching models, and permit a mixed provider
   pool. Preparation must not block already-ready workers.
4. **Attempts and recovery:** persist assignment and submission identity before
   dispatch. A disconnected worker retains its unresolved jobs; never send an
   uncertain job to another worker automatically. Other workers continue.
   Cancellation and output acknowledgement target the assigned worker only.
5. **Retirement:** stop assigning work, finish/recover assigned outputs, verify
   the local save and remote acknowledgement, then release that rental. Confirm
   provider deletion; a disconnected tunnel does not establish stopped billing.

Four workers process four independent videos concurrently. Their memory is not
combined and this does not accelerate a single video. A multi-GPU inference
worker could be supported later as one worker with one generation slot and a
separate measured execution profile.

Start validation with two independent workers, then four. Pool capacity should
be capped by queued work, budget and compatible models. Automatic expansion
should use an explicit configured spending policy rather than interpreting a
normal generation approval as unlimited permission to acquire GPUs.

Keep acquisition visible in Activity. Add a small Compute area under Admin for
provider credentials, target capacity, hourly cap, and finish-and-release.
Generate and Chat retain their current request-oriented layout. Agent/CLI
acquisition can use the same service; no separate orchestration daemon is needed
for the initial small pool.

## LoRAs and models

Keep Civitai family detection, explicit file mapping, grouped entries, local
masters, descriptions and Chat selection. Import completion means downloaded
and validated locally, so importing does not require a running GPU. When a job
is assigned, copy missing assets to its worker, verify hashes, and cache them.
Track synchronization in Activity. No fal upload is needed for rented execution.

The current importer retains original files as well as H3 conversions. Preserve
both and make conversion/verification specific to the target runtime. A fal
compatibility receipt is not proof of compatibility with the restored worker.
Main's single mutable preset per route must become immutable per-job file/strength
selections, usable in every permitted workflow and visibility context.

**Model quality is a separate decision.** Main loads Krea turbo INT8 ConvRot,
H3 INT8 ConvRot and an INT8 H3 text encoder. Its H3 high profile uses 30 steps
and Sol attention; it is not the native BF16 reference previously discussed.
Do not silently restore that recipe as equivalent quality or bring back Fast.
Preserve the earlier BF16 preference pending an explicit change. Validate the
chosen checkpoint, runtime, VRAM and LoRA loading before selecting worker GPUs
or quoting costs. Nothing in this review proves why the earlier audio was poor.

## Cost previews

Keep the dotted Cost Estimate footer in Generate and Chat approvals. Replace
fal endpoint rates with fresh rental quotes and measured timing distributions
for the selected GPU/model/precision/workflow/duration/reference combination.

Show a range when runtime is uncertain; an uncalibrated configuration must say
so rather than inventing precision. Include billed preparation/model transfer
and amortize shared startup once across the planned batch. Keep observed
generation, preparation, transfers and idle time separately measurable.

Per-request execution estimates and total rental spend are different quantities.
Compute/Activity should show the pool's hourly rate, elapsed estimated spend,
and retained storage costs. Reconcile with provider billing when available.
Only quotes within the approved hardware/profile/budget bounds may be used;
re-quote when those material bounds change. Avoid invalidating approvals for
ordinary queue progress or in-bounds worker selection.

RunPod documents per-second compute/storage and persistent storage charges when
stopped; Vast documents compute, storage and bandwidth components. Neither is
a fixed price per generated output. Sources checked during this review:

- https://docs.runpod.io/pods/pricing
- https://docs.vast.ai/guides/instances/pricing

## Delivery sequence and acceptance

1. **Preserve the app and establish the execution boundary:** forward database
   migration, neutral DTOs, runtime-specific receipt/history handling, current
   UI contract tests. Selectively restore worker transport and graph building.
2. **Build the pool with offline workers:** per-worker lifecycle and acquisition,
   explicit job assignments, scoped recovery, LoRA synchronization, cost model,
   and minimal Compute controls. Test 1/2/4 workers and partial failures.
3. **Validate real execution under a new budget:** one worker on each provider,
   then two together, then a four-output batch. Exercise Generate and Chat,
   mapped LoRAs, cancellation, restart, interrupted transfers, and retirement.
   Measure full costs and timing before asserting latency or savings.

Critical offline cases: concurrent acquisition without duplicated rentals or
budget overshoot; four outputs accepted exactly once; one worker disappearing
without stalling others; lost submit response without duplicate execution;
server restart; one changed LoRA; and release refusing unsaved outputs.

This is a contained backend rearchitecture with substantial reusable code, not
a frontend rewrite or a small provider toggle. The largest risks are concurrent
creation reconciliation, uncertain submissions, and reliable output recovery.
The BF16 runtime is an additional validation track, separate from pool plumbing.
