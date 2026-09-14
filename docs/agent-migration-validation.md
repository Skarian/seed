# Agent migration validation

The checkpoint before the migration is `b6d5601`. The testable release was installed after the user requested an accelerated finish for evening testing. Seed is running at the existing LAN address; chats and Library were preserved.

## What changed

The agent prepares review requests through separate create and edit tools with flat settings. Stable input-instance tokens are compiled to provider labels by the application. Repeated clips from one file keep separate identities. Edits preserve omitted settings; source replacement is explicit, and validation completes before a request is saved.

The context includes the current request, retained failed attempts, actual image/video-frame evidence, and an optional video inspection tool. The reference-video guide chooses its format from the input roles. Existing customized guides are preserved; recognized bundled defaults are backed up and upgraded.

## Evaluation rules

All live evaluation uses isolated chats, SQLite databases, and fixtures. OpenRouter calls are real; GPU generation is not run. A passing tool call proves structural acceptance, not creative correctness or generation quality. Independent reviews examine exact prompts, input ownership, settings, dialogue, timing, and explicit constraints. Repaired initial calls count against first-attempt success even when a later edit succeeds.

Test-specific requests such as no zoom or no extra people are instruction-following checks, not product restrictions.

## Exploratory findings

| Run | Structural result | Semantic findings |
| --- | --- | --- |
| v3 core plus photos, 95 trials | All eventually saved; earlier edit-only metric understated initial retries | Silent-output prompt conflicts and incomplete compaction coverage were found in manual review |
| v4 complex, 12 trials / 15 phases | All phases saved first call | 7/12 initial prompts preserved every explicit constraint; one reorder changed instance identity |
| v4 photos, 5 trials / 7 phases | All phases saved first call | Both edits preserved scope; one overly specific hair description |
| v4 edge cases, 18 trials | All eventually saved; 16/18 whole scenarios needed no repair | Four frame-guide scenarios contained source-composition conflicts; this run also spans a prompt update and is exploratory only |

The omitted constraints, input replacement ambiguity, and missing creation asset fields led to further changes. The corrected compaction fixture now verifies that summarization actually occurs. A clean, separately versioned café fixture replaces a visibly damaged published original for future photo comparisons.

## Regression checks

All 224 unit/integration tests passed with two workers after the final audio normalization. Two focused browser tests cover repeated input instances, independent clip edits, numbering, preview navigation, reordering, and removal. TypeScript and production build passed.

The v5 complex set completed 36/36 structural passes without request repair. Strict manual intent preservation was 28/36; all nine narrow edits retained their scope. This informed a checklist shared across all workflows, including camera wording, exclusions, exact edit preservation, and silent-output instructions.

The broader v5 run was stopped early at the user's request for a build to test that evening. It completed 243 successful scenarios: fresh creation54, settings54, creative revisions54, labels36, recovery36, and context9. Five of those scenarios needed an initial repair (four standalone-audio contract mistakes and one extra misspelled property). Six in-flight scenarios were interrupted by the source-freeze guard as fixes began; one additional scheduling guard entry is not a model trial. The remaining101 planned entries were not run. Do not present this as351completed tests.

Manual reviews remain separate: settings54/54 exact edits; creative/label edits80/90 clean, two timing changes and eight ambiguous/conflicting visual requirements; fresh52/54 prompt-consistent, with two silent-soundscape conflicts. Recovery36/36 preserved the corrected request. Further silent-soundscape conflicts in initial mixed requests are documented in the independent reports.

The release normalizes only unambiguous standalone-audio aliases and a redundant enabled flag; it does not discard source tracks or silently delete authored soundscape sections. A short v6 release run checks these fixes, real compaction, frame inspection, source replacement and stable reordering. Some complex prompt wording remains imperfect; no claim of rendered GPU-output quality is made.

The v6 release run completed10/10 eventual structural passes,9/10 whole-scenario first-attempt passes. The compaction case mistyped a request UUID twice before successfully editing the existing target; no duplicate card was created. Compaction genuinely summarized seven older messages and the seed-only edit preserved the exact prompt and all inputs. Video inspection correctly found a transient red square absent from overview frames. Independent reviews still flag occasional dialogue-markup and unwanted-ambience wording. Total live evaluation spend recorded by the shared ledger is approximately$1.13.
