# Feedback can leave two approvable requests

Diagnosis only. No application behavior or live deployment was changed. No private chats, generation requests, uploads or media were read. No model API calls or GPU jobs were submitted.

## Confirmed behavior

The actual chat service was exercised with a fresh temporary database and controlled, schema-valid model replies. The UI's actual `submissionStatus` function was used to check which saved cards remained approvable. These tests establish what the app permits, not how often a live model chooses each operation or which path occurred in the user's private chat.

| Feedback path | Controlled model actions | Result |
| --- | --- | --- |
| Typed into ordinary chat | Edit existing request | One card with two revisions; original is Replaced |
| Typed into ordinary chat | Create updated request | Two cards; original is unchanged and both are approvable |
| Provide feedback | Create updated request once | Correctly converted into a revision; one approvable card |
| Provide feedback | Edit target, then create another update in the same turn | Target is revised, but an additional card is created; both latest versions are approvable |
| Provide feedback | Create update, then create another update in the same turn | First operation revises the target; second creates another card; both latest versions are approvable |

An old revision remaining in the timeline with a Replaced label is expected history. An old, unchanged card retaining Approve alongside a newly created card is the confirmed replacement failure.

## Cause

- `web/chat.tsx` sends a card ID for explicit feedback/branching. Ordinary composer messages do not identify a feedback target. The explicit feedback draft is cleared after submission, so another ordinary follow-up is also unpinned.
- `server/chat/service.ts` supplies current request context to the model but only sets its enforced target from `input.card_id`. Without that target, a valid `create_request` call adds another card even when the user meant to revise the existing one.
- `workflowTools` redirects `create_request` to the explicit target, but clears that target after the first successful change. A subsequent create in the same turn can therefore escape the replacement path.
- The UI correctly displays the saved result: it labels an earlier revision Replaced only when a newer revision belongs to the same card. It cannot infer that two separately saved cards were meant to be revisions.

The single-use target behavior is also present in the earlier implementation preceding `e78996c` and in the September 13 checkpoint `b6d5601`. This establishes an existing weakness; it does not establish a newly introduced regression or identify the user's specific occurrence.

## Lightest correction to pursue

Keep an explicit feedback target for the entire turn and ensure feedback saves revise that target. Validate the target for edit calls as well as create calls. Preserve sibling cards and require fresh approval for the new revision.

For ordinary chat, explicitly instruct the agent to edit pending requests when the user is giving corrections and create additional requests only when asked. Preserve intentional multi-request conversations: blindly treating every new message or every create as a replacement would break them. Confirm which entry path the user experienced before deciding whether ordinary composer targeting also needs a UI/API change.

Test feedback through the composer, then verify actual saved card IDs, revision counts and the absence of an extra Approve button. Include successive tool calls, a follow-up after feedback, preserved settings/inputs, and intentionally requested additional cards. Layout-only screenshots cannot catch the routing error.

## Evidence

- Five isolated diagnostic cases passed, confirming the outcomes above.
- Existing `tests/chat.test.ts` and `tests/chat-submission-status.test.ts`: 44 tests passed. Their feedback cases cover a correct edit or one redirected create, not the duplicate paths above.
- Local reproduction: `.local/chat-feedback-diagnosis.test.ts`.
- Run: `node node_modules/vitest/vitest.mjs run --config .local/chat-feedback-vitest.config.ts`.
- Small result records: `.local/chat-feedback-diagnosis/*.json`.

The diagnostic tests assert current observed behavior and remain outside the normal test suite; they are not regression tests endorsing that behavior. Application changes should add tests for the corrected behavior to the regular suite.
