# Worktree baseline — 9 September 2026

Implementation has started with checkout preservation and curation only. The
application and worker described in the MVP remain planned. Access verification
and the rest of M0 in [the execution plan](EXECUTION-PLAN.md) are still pending.

A fresh local archive under `backups/before-worktree-cleanup-20260909-163105.zip`
preserves all 506 working files present before cleanup, including ignored local
configuration, plus the tracked patch and baseline commit ID. `.git` and existing
backup archives are excluded. Archive CRC and every file's SHA-256 were verified.
The archive contains private material: keep it local and do not publish it.

Versioned material includes the active studio plan, review history, curated
research decisions, prompting guides, and the existing deployment helper.
Downloaded LLM source, model metadata, HTML pages and leaderboard snapshots stay
at their existing local paths under narrow ignore rules. They are optional
research evidence, not runtime dependencies; a fresh clone does not include them.
Existing private configuration, media, dependency copies and prior backups remain
untouched and ignored. No files were deleted or moved.

The `studio/reviews` directory preserves earlier proposals as review history;
use [the MVP](../STUDIO-MVP.md), [current direction](CURRENT-DIRECTION.md), and
[execution plan](EXECUTION-PLAN.md) for current scope. The older deployment and
prompting files document the existing installation, not the future frontend.

No deployment helpers were executed. This cleanup does not provision or stop
pods, install software, publish artifacts, or push to GitHub. Local baseline
commits are made on `feat/studio-mvp`.
