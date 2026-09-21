# Headless chat-agent evaluation

`scripts/agent-eval.mjs` evaluates the actual `Chats` service and its current
embedded Pi adapter. Its default action only writes a manifest. `--live` is an
explicit paid-inference opt-in; this document is not spending authorization.

## Dataset and repetitions

The core matrix contains **90 base cases**, each run three times in a fresh chat
and fresh SQLite database unless overridden:

| Category | Base cases | Coverage |
| --- | ---: | --- |
| Fresh creation | 18 | Nine image/video/reference combinations in both modes |
| Settings edits | 18 | Seed, random seed, count, aspect and combined changes across three workflows |
| Prompt revisions | 18 | Six creative edits across image, bookend guides and multimodal inputs |
| Labels and media changes | 12 | Reordering, removal, soundtrack changes and first/last-frame label rules |
| Recovery | 12 | Invalid count, seed, aspect, duration, missing attachment and invalid time range |
| Context | 12 | Returning to requests, visual/settings follow-ups and long-history compaction |

The scenario definitions contain exact instructions, expected explicit settings,
and expected media identities/roles/ranges. Edit scenarios first make a **real
fresh-create agent call**. They never seed an already valid request into the
database to bypass the failure-prone creation step. If creation fails, the edit
scenario is marked `prerequisiteFailed`; it is not quietly removed from the
denominator. Context cases insert clearly marked synthetic conversational history
after real creation, and long-history variants exercise the real summarizer.

Optional `--include-heldout` adds the independent complex set; `--heldout-only`
runs just that set. Its explicit dialogue, action, ordering and preservation
rubrics are defined with the cases. `--paraphrase` applies a small wrapper change
to repetitions two and three; it is **not** a claim of independent new scenarios.

`--include-photos` / `--photos-only` opt into separately defined public-photo
cases. Their `photoFixtures` explicitly name downloaded, visually verified public
files and source notes; they never silently replace sphere/triangle fixtures.
The parent fixture source manifest records provenance and licenses. Each isolated
trial records copied photo hashes, dimensions and paths in `data/photo-fixtures.json`.
These optional cases require those local fixture files to exist before execution.

## Running

Use the repository's Node version and build the current server first. Commands
below assume the workspace root. For an immutable baseline use a complete
separate compiled package tree with `--dist-root PATH`; its prompt resources must
remain in the expected package-relative location.

```powershell
node scripts/agent-eval.mjs --list
node scripts/agent-eval.mjs --smoke --limit 1 --repeats 1 --concurrency 1 --ledger .local/agent-eval-smoke-budget.json
# Only after the owner has authorized this paid test cycle:
node scripts/agent-eval.mjs --live --filter fresh-create --limit 3 --repeats 1 --reference-mode direct --ledger .local/agent-eval-budget.json
node scripts/agent-eval.mjs --live --reference-mode direct --ledger .local/agent-eval-budget.json
node scripts/agent-eval.mjs --live --heldout-only --reference-mode stable --ledger .local/agent-eval-budget.json
```

The offline smoke fixture emits text without tool calls. Its deterministic
`passed: false` result is expected: it verifies plumbing, valid media, isolation,
event capture and report writing; it does not measure agent quality.

Use the **same ledger path for the entire authorized cycle**, including baseline,
migration, retries and heldout tests. Do not create a new ledger to evade its
limit. Concurrent harness processes using that ledger are rejected by a lock;
one process may run up to eight trials concurrently. An interrupted process may
leave the lock for inspection; remove it only after confirming that process has
exited. Unknown paid usage stays reserved in the ledger rather than becoming zero.

## Isolation and budget controls

- Only the authorized OpenRouter credential is read from the live installation.
  The real key is injected into outbound Authorization headers; fixture config
  stores only a marker. Live Library assets, conversations and custom prompts
  are not read.
- All media is synthetic and verified with ffprobe: two actual PNGs, a six-second
  H.264/AAC MP4 and a six-second PCM WAV. Asset notes and modes are stored in each
  isolated DB. Source media hashes and ffprobe output are in the fixture manifest.
- The worker is a fixture that only answers capabilities. Job preparation and
  admission methods throw. The harness never approves cards and asserts zero
  generation jobs afterward. It cannot rent a GPU or submit Comfy work.
- The default whole-cycle ceiling is **$10**, with concurrency at most four.
  Routing adds input/output price ceilings, output tokens are bounded, and each
  outbound request reserves a conservative text/image/output allowance before
  dispatch. Completed accounting replaces the reservation; absent accounting
  retains it. Maximum calls are also bounded. Provider billing outside returned
  accounting is not independently audited by this harness; inspect OpenRouter's
  final usage if interrupted or when reconciling unknown entries.
- The actual application still prefers Parasail and falls back as configured.
  Reports record the routed provider. No fixed model pricing is used to claim
  actual charged cost. Summarizer calls and failed/repair attempts are included.

## Interpreting results

Each trial has its own directory containing outbound `payload-N.json`, captured
`response-N.sse`, complete `snapshot-create.json` / `snapshot-edit.json` (or
recovery phases), and `result.json`. These are synthetic evaluation artifacts
but may contain generated text and reasoning; keep them local. No API headers
are saved. Exact tool names/arguments, tool errors, full saved requests and
before/after revisions are preserved for review.

`passed` means **deterministic checks passed**, not that an independent reviewer
approved the semantics. Checks cover explicit settings, media identities and
roles/ranges/order, canonical label validity, preserved prompt text for
settings-only edits, unchanged settings/inputs for creative edits, and editing
the existing card instead of creating an unrelated one. `firstAttemptCorrect`
additionally requires a successful first tool result with no tool repair errors
and a correct first saved request. Tool errors, follow-up calls, accounting,
elapsed time and exact arguments remain available even when later recovery works.

Every result initially has `semanticReview: pending`. Review the scenario's
`semanticRubric` against both the model-facing tool call and saved executable
request. For label changes, verify that the **intended subject**, destination,
motion and soundtrack still map to the correct asset; a syntactically valid
`<Picture 1>` alone does not prove that. Check requested dialogue verbatim,
temporal ordering, camera changes, negative constraints, and all untouched
creative details. Also inspect image evidence in payloads and ensure the agent
does not claim to have listened to audio that was not supplied to the model.

Record independent semantic verdicts with case/repetition IDs and concrete
evidence in a separate review artifact. Report deterministic pass rate,
first-attempt rate, creation-prerequisite failures and semantic review coverage
separately. Do not count unknown usage as free, infrastructure failures as model
successes, or unreviewed semantic cases as correct. These grouped synthetic cases
are regression evidence, not an intelligence benchmark or independent sample of
all real-world prompts.
