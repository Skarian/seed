# Real composer reference acceptance — September 13, 2026

The earlier headless matrix did not exercise the composer’s actual `@` picker. This run closes that specific gap using the built Seed UI, actual uploads, real picker selections, actual Send requests, and the configured real OpenRouter model.

## Result

The fresh 25-message run on the source/clip resolver completed with one successful request tool call per message and no failed tool calls. Semantic review passed 23 immediately and flagged two wording issues: camera pull-back was described as zoom, and a non-speaking dog received an inconsistent shorthand subject ID. Both cases passed targeted reruns after clarifying the prompting guide; original findings are retained. All 25 scenarios therefore have passing UI, tool and semantic results, with the two targeted semantic reruns distinguished from the original run. Eighteen messages used `@` selections, seven used ordinary source descriptions; five were follow-up edits. Every conversation supplied at least two assets. The frozen prompts and expected settings are in `scripts/agent-ui-cases.mjs`.

The browser checked composer chips, persisted message text, reference identities, clip ranges, roles, requested settings, request revision identity, review rendering, loaded fullscreen media and generation labels. A second browser audit clicked all 45 history mentions: every one loaded the expected source with its displayed label. Independent semantic reviews covered cases 01–17; root review covered 18–25. The reviewers checked actual prompts, speaker ownership, timing, scene actions, reference mappings and exclusions, rather than counting any saved card as a pass.

Both dialogue edits changed exactly the requested sentence. The framing edit left the prompt unchanged. The batch/seed edit changed only those two fields. The duplicate-video edit enabled audio on only the second clip, preserving both instances, ranges and the prompt.

## Fixes and retained failures

- Composer mentions now carry validated source and optional input-instance/channel bindings. Two clips from the same source can be selected independently.
- Stored history retains the original visible text and an immutable reference snapshot. Old mentions cannot accidentally bind to a reused current input ID.
- Agent context resolves those selections to stable tokens before asking the model. Generation labels are compiled from the actual request inputs.
- A pilot attempt used a source token after naming two clip instances; it failed and recovered. That failure remains in pilot evidence. A repeat after instruction-only clarification failed in the same way, so wording alone was insufficient. The final fix distinguishes a shared source from a specific clip; errors still list valid instance tokens. Both failed attempts remain recorded.
- Browser setup initially missed the optional upload-note dialog and used overly strict filename matching. The duplicate-clip edit was resumed after its selector was corrected; it had not sent a message before that correction. These harness failures are retained, not counted as model failures or successful sends.

Minor semantic observations remain: one unsolicited note, “lateral pan” wording for a lateral move, and a slow head turn within the requested look-at-camera interval. No incorrect source identity or required setting was found in the accepted set.

## Evidence and limits

Private local evidence is under `.local/agent-ui-accepted-v2`: 25 result records, composer/history/review mosaics, individual screenshots, semantic reviews and history audit. Original pilot and harness failures remain in `.local/agent-ui-pilot-v*` and `.local/agent-ui-browser*`. `.local/agent-ui-live-v1/joined-evidence.json` joins provider accounting to exact user messages and includes submitted tool arguments/results and multimodal payload counts.

The isolated app uses real chat/media routes and OpenRouter. GPU admission is blocked. Photographs and sampled video frames were sent as visual content; audio inputs were represented by metadata and references, not sound samples. This verifies reference use and generation-request preparation, not whether the model can hear audio or whether generated videos satisfy the scene. Twenty-five successful prompts are evidence for these cases, not a guarantee that every future prompt will succeed.

Typecheck and production build passed. The final suite had 233 passes and one worker-test timeout; all nine tests in that worker file passed when rerun in isolation. All 25 recorded real tool calls replay unchanged through the final resolver, and both previously failed duplicate-source calls now compile successfully.

The user renewed OpenRouter authorization and the fresh live rerun completed. A default-off audio comparison was corrected in the browser harness; a separate read-only audit verified the original saved request and previews without resending it. Thumbnail captures were also checked after media finished loading. Prompt migration tests (4), adapter tests (29), typecheck and production build passed after the final guide clarification.
