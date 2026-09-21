# Seed architecture audit — 10 September 2026

## Conclusion

The earlier cleanup removed experiments but left competing operational paths. The target is one local art studio, one normal app launcher, and a skill that rents, connects and releases a GPU on Vast or RunPod. Simplify those paths before adding features. Do not turn the whole application into skill scripts.

This audit changes no runtime code, credentials, installed application or cloud resources. Findings below are proposed changes, not completed fixes.

## Scope and evidence

Inventoried every one of the 272 tracked files (3,025,824 bytes), searched active source/build references, checked exact-content duplicates, mapped application dependencies and entrypoints, and inspected startup, pairing, provider teardown, preparation, storage, job and documentation boundaries. This is an architectural scan, not a claim that every function has been behaviorally verified. The per-file size/hash/reference inventory is local at `.local/repo-architecture-inventory.json`; textual references are candidates, not a complete dynamic import graph.

| Area | Files | Bytes | Disposition |
|---|---:|---:|---|
| `server/` | 16 | 102,451 | Keep app, CLI and durable job/data handling; simplify provider boundary |
| `web/` | 9 | 77,605 | Keep; make dense code readable, no UI rewrite |
| `shared/` | 1 | 867 | Keep existing types |
| `worker/` | 25 | 97,816 | Keep engine/protocol; replace bootstrap source patching with supported configuration |
| `skills/` | 13 | 62,425 | Keep product instructions and provider operations; remove alternate app lifecycle |
| `deployment/` | 36 | 198,474 | Retired direct-Comfy deployment path; remove after resolving documentation references |
| `research/` | 125 | 2,068,875 | Keep research, including LLM notes, per owner preference |
| `studio/` | 12 | 168,416 | Consolidate current operational instructions; preserve decisions/history |
| `tests/` | 15 | 82,523 | Keep regression coverage; add lifecycle coverage during refactor |
| Remaining root/build/prompt files | 20 | 166,372 | Keep build/package configuration and useful prompts; deduplicate identical prompt |

Research accounts for about 68% of tracked bytes. Byte count is not the main problem. All 13 runtime npm dependencies have active imports; there is no evidence for removing a library simply to reduce the dependency list. Ignored dependencies/media/backups were covered by the preceding cleanup inventory, not reclassified for deletion here. The unrelated untracked region research note remains untouched.

## Prioritized changes

### 1. Remove the second app launcher and connection restoration

`skills/seed/scripts/studio.mjs` duplicates `server/main.ts` to enable `http://127.0.0.1:18080` through an option named `localTestWorkerOrigin`. `vast.mjs` consequently stops the app, backs up its previous connection, launches this alternate app, and later restores the old connection and restarts again.

This is unnecessary coupling. The normal `WorkerConnection.pair()` already validates and exchanges a code before atomically saving the new connection. Support the exact SSH tunnel origin through the ordinary app, retaining endpoint restrictions and bearer/identity checks. Then delete `studio.mjs`, `restoreApp`, `app_managed`, the connection-backup path, and app restart logic from Vast connection/teardown. Keep tunnel supervision. A failed exchange must preserve the old connection; teardown leaves the app running with the last worker disconnected.

Verify successful pairing, failed pairing retaining the previous connection, restart with a saved Vast endpoint, blocked arbitrary endpoints, reconnect, and teardown without app restart. Handle any existing managed-launcher state once during upgrade; do not silently discard an active user's state.

### 2. Replace remote source rewriting with worker configuration

`skills/seed/scripts/worker.py` edits three exact strings in `/opt/seed/worker/run.py`: HTTP pairing support and worker/Jupyter bind addresses. It also uses the filesystem root as its workspace to satisfy `Path(workspace).is_mount()`.

Give the worker explicit supported SSH-local and public-HTTPS startup configuration. Validate the allowed transport/bind combination and a writable workspace; a reusable RunPod mount and a disposable Vast disk are both legitimate. Keep the current adapter until a new image is built and verified, then remove its string-replacement implementation/tests. A small remote bootstrap that supplies credentials and starts the process may remain useful. Do not build a provider plugin framework for two configurations.

The current image digest is pinned in both `server/pod-setup.ts` and `vast.mjs`; make one release value authoritative when changing the image. Preserve digest pinning.

### 3. Retire the old direct-Comfy deployment tree

No active application, worker, skill or GitHub build code references `deployment/`. Its Python operators, nginx/startup scripts, configuration, app builders and exported workflows form an older product path. They are not what retains RunPod support: `server/pod-setup.ts`, the RunPod skill helper and current worker do that.

Remove the old deployment scripts/configuration/instructions and direct-Comfy app exports. Resolve the few current documentation links first. Keep any genuinely useful workflow provenance under existing research rather than another runnable deployment path; several Krea workflow copies are already byte-identical in research. Do not preserve the whole tree solely because the user asked to retain RunPod.

Keep `.github/workflows/mirror-image.yml`: the current worker Dockerfile directly depends on its mirrored GHCR base. The legacy startup scripts are not the base image build recipe. Removing the base image or replacing it with a fresh CUDA/Comfy build is a separate, higher-risk task.

### 4. Make the provider operations boundary clearer without relocating everything

Keep `seed setup/start/status/stop` as the local application interface. Keep provider rental/release in the skill. `seed pod-setup` remains useful RunPod compatibility; deleting it would remove a working feature, not simplify implementation.

`runpod.mjs` imports general JSON/HTTP/idle helpers from `vast.mjs`. Extract only those shared helpers into one small operations utility if touched by the lifecycle work. Do not introduce a provider registry, base class or orchestration service. RunPod compute creation/stop still requires native tools; the helper does not implement those operations. Preserve that disclosure until tested support exists.

### 5. Consolidate current documentation, not the decision record

The 78,566-byte execution journal is historical evidence and can stay. The problem is overlapping operational guidance in MVP, bootstrap, release, development and skill references. `STUDIO-MVP.md` still names `seed-gpu`; bootstrap/transfer descriptions assume network storage even though Vast disk is disposable. Development describes restoring the alternate launcher.

Use README for product/entrypoint, the skill and provider references for operating steps, architecture/API docs for maintained contracts, and the execution journal for history. Remove duplicated runbooks and update links. Explicitly say that unsaved Vast outputs do not survive instance destruction; RunPod volume survival is provider-specific. Keep owner-approved product requirements and research.

### 6. Improve readability, not file-count metrics

`web/main.tsx` is 29 KB with lines up to 1,033 characters; `server/jobs.ts` is 21 KB with lines up to 814 characters. Compressed JSX and multiple statements per line make these look smaller than they are. Reformat touched modules, then extract components only where a distinct responsibility helps. Do not replace React, Fastify, SQLite, tus or the existing media components.

The identically named job modules are not redundant: PC dispatch/receipt (`server/jobs.ts`), authenticated worker transport (`worker/jobs.py`), and Comfy execution/session integration (`worker/comfy_seed/jobs.py`) operate on separate process boundaries. Keep them. Keep native-statistics sampling, durable receipts, queue pause and output verification; those implement requested behavior.

### 7. Bring checks into alignment with what ships

The secret scan only loads known values from old `deployment/access.private.json`, while current credentials live in the standard per-user config. Update its known-secret inputs without printing secrets; patterns alone do not cover arbitrary Vast keys. This is a coverage gap, not evidence of a leaked credential.

`npm test` does not include skill Node tests or Python worker tests. Add a documented top-level validation command using existing runners, rather than another test framework. The current 17 provider-helper tests primarily cover pieces of the protocol; they do not prove the complete rent/boot/connect/teardown lifecycle.

## Recommended implementation sequence

1. One normal app launcher: supported exact SSH endpoint, delete alternate app lifecycle, focused pairing/restart/teardown tests.
2. Supported worker startup: build candidate image, verify both transport configurations, update one release pin, remove compatibility source patching. Paid lifecycle validation requires a current authorized GPU session.
3. Delete retired deployment path and duplicate instructions; keep RunPod implementation and research. Update secret scanning/check entrypoint.
4. Readability pass on touched modules and user fresh-start/LAN check. Avoid unrelated UI redesign or schema migrations.

Commit each verified unit separately. Do not combine worker image changes, old deployment removal and UI restructuring in one commit. No GPU was rented or stopped for this audit.

## Baseline validation

- `npm run typecheck`: passed.
- `node --test skills/seed/tests/vast.test.mjs skills/seed/tests/runpod.test.mjs`: 17 passed.
- Full generation, paid provisioning, new image behavior and cross-platform lifecycle were not exercised by this audit.
