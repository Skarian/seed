# Repository cleanup - 10 September 2026

Baseline commit: `426e9ee`. This is a file/dependency/disk audit, not a claim of a
complete semantic code review or a new live GPU test.

## Inventory and decisions

All 359 tracked files were inventoried by size, exact-content duplicates and
textual references. Legacy Python imports and file literals were inspected;
active app/worker/tests/build/skill references were checked before removing files.
Every npm dependency has a current use (including TypeScript build tooling).

| Baseline area | Files | Bytes | Decision |
|---|---:|---:|---|
| Root/config and GitHub workflows | 14 | 158444 | Keep build, package and image publication |
| deployment | 124 | 486372 | Remove obsolete experiments/captures; retain usable legacy RunPod recovery |
| research | 124 | 2064669 | Preserve, including LLM research and upstream snapshots |
| prompting | 5 | 5913 | Preserve model prompt guides |
| scripts/server/shared | 18 | 105170 | Keep active tooling/API |
| skills | 12 | 63165 | Rewrite around the art-studio product; retain tested helpers |
| studio | 13 | 178338 | Remove obsolete READINESS; correct architecture and retain durable journal/contracts |
| tests/web/worker | 49 | 257944 | Keep current runtime and verification |

89 tracked files were deleted; two focused documents (setup reference and this audit)
were added, reducing the tracked file count from **359 to 272**. They include old job histories, queue snapshots,
base64/generated installers, one-off remote acceptance probes, retired Qwen
installation hooks and the obsolete readiness review. Git history preserves them;
this cleanup does not rewrite repository history. Editable legacy graphs, pinned
lean startup, GHCR base-image mirror, model-source metadata and useful Comfy/Jupyter
recovery helpers remain. Retained RunPod support is not limited to documentation.

The complete per-file disposition is in ignored `.local/repo-file-dispositions.json`;
baseline counts/duplicates/references are in `.local/repo-audit-before.json`.
These audit captures stay out of Git to avoid replacing deleted clutter with dumps.
The cleanup commit's diff is the authoritative list of deletions.

## Local disk

93 disposable targets were removed, freeing **4,467,218,237 bytes (4.47 GB)**:
verified LoRA download-validation copies, unused Node installers/runtimes,
local npm/S3 test tooling, obsolete one-off scripts and test scratch.
LoRA source/verification receipts, generated media, credentials and benchmark
records were retained. Nothing on a cloud provider was changed.

The main remaining local item is the **21,034,434,560-byte Docker recovery backup**.
It was intentionally preserved, as were the separate backups directory, current
node_modules/build output, browser test binaries and the worker test environment.
The local-disk figure is logical file size, not allocated disk blocks.

Metadata traversal encountered protected scratch directories (25 inaccessible
paths in the normal-user pass); their contents were not fully inventoried. Seven
cleanup targets could not be fully removed: `.local/s3-deps` and pytest directories
`pytest-cleanup-review-1`, `pytest-engine-review-1`, `pytest-m4-a`, `pytest-m4-b`,
`pytest-native-metrics-20260910`, `pytest-spool-review-1`. These remain exceptions,
not hidden successes. No recursive ownership/permission change was performed.
Details: `.local/local-cleanup-results.json` and `repo-audit-local-complete.json`.

## Skill and verification

The skill now introduces Seed as an art studio that finds compute for its user,
explains the working creative features and leads with opening/using/finishing the
studio. Provider mechanics follow in references. Total skill prose decreased from
2,797 to 2,363 words despite adding an explicit product introduction/setup reference.

All 39 app tests and 17 helper tests pass after cleanup. Retained legacy Python
helpers parse; active references and links were checked. No new live GPU test or
macOS validation is claimed. No production runtime changes or app restart needed.
