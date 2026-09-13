# Seed Chat feature plan

Status: implementation authorized by the owner's "Proceed" on 2026-09-12.
Implementation, local verification and installed-package checks are complete; two rounds of plan
review are incorporated below. Live paid inference/generation is not authorized.
Branch: `codex/seed-chat-openrouter`, created from clean main at
`42aedec37a6297b9c3cc19bcf1676c38e6b561ba`.

This document records the owner's decisions from the planning conversation.
It supersedes conflicting UX recommendations in the exploratory
[OpenRouter/Pi research](../research/llm/2026-09-12-openrouter-pi-proposal.md).
Open questions below are not accepted requirements.

## Product and layout

- Add Chat as a separate tab alongside Generate and Library.
- Chat has a left sidebar of conversations and the active conversation in the
  remaining space.
- New chats receive automatic titles based on the first message. Support rename
  and delete initially; search and other management features are deferred.
- The owner directs the creative process. The agent prepares image/video
  requests with simple custom tools and may propose multiple jobs in one turn.
- Each request needs separate explicit approval. Typed permission such as
  "go ahead" cannot approve a generation.
- Multiple requests proposed together form a review group. Hold all jobs locally
  until every card in that group has been approved or denied. Then submit only
  approved requests through the existing sequential queue. If all are denied,
  submit nothing. Approval of an individual card does not start it early.
- Feedback from a card targets that card by default. Preserve approvals for
  unchanged cards. Any change to prompt, settings, references, roles or attached
  note/context invalidates that card's approval. Group-wide feedback may revise
  multiple cards; every revised card becomes undecided. Never dispatch while
  review-group revision work is in progress or any decision remains outstanding.
- Show compact request cards inline. Review opens a popup resembling a small
  Generate screen with all applicable settings editable: prompt, inputs/roles,
  aspect, duration, quality, count, seed and other supported workflow settings.
- Generate inside that popup approves the exact displayed request.
- Add a Provide feedback box at the bottom of the review popup. Enter submits
  that feedback as the next user message in the conversation so the agent can
  revise the request. It does not approve generation.

## Explicit workflow activation

- The owner must explicitly call a workflow skill before the agent gets tools
  to act. This is an application concept, not a dependency on an external skill
  format or coding-agent skill loader.
- Activation exposes exactly one tool for that workflow and injects its prompting
  guide into chat context. There are no additional read/helper tools. An ordinary
  chat starts with zero tools. The agent cannot activate a workflow itself or infer activation from
  an attachment or an ordinary generation request.
- Use one named workflow entry per supported workflow, backed by known packaged
  files and the editable user copies described below. Existing guide candidates
  are `06-text-to-image.md`, `create-a-video.md` and `animate-an-image.md`.
  `07-identity-edit.md` remains outside the agreed v1 image-generation scope;
  the presence of a guide file does not enable an unsupported workflow.
- Activation grants preparation/editing capabilities only. Every generation
  still requires the existing exact-revision button approval and group review.
- Enforce activation and workflow scope server-side, as well as withholding
  tool schemas. A fabricated or historical tool call cannot bypass activation,
  chat mode, asset scope or approval rules.
- Inject the active guide automatically; the agent does not need to discover or
  fetch it. Apply its prompt-format instructions to the generation prompt field:
  existing guides saying "return only the prompt" must not suppress tool calls,
  clarification or review cards in the surrounding Chat protocol.
- Confirmed UX: composer workflow picker and matching slash commands, with a
  visible active-workflow indicator. Keep one workflow active per conversation
  until the owner changes it, so ordinary feedback
  can revise a request without repeated activation.
- Proposed lifecycle: activation changes apply to the next agent run, with the tool
  and guide snapshotted together for that run. Switching does not approve, alter
  or cancel existing cards/jobs; Stop remains the cancellation control. Historical
  guides must not remain authoritative after switching workflows. Preserve all
  request revisions and history independently of the active workflow.
- Supply workflow constraints, current request revisions, relevant job summaries
  and the scoped attachment manifest through server-assembled context, without
  capability, asset, image-inspection or status tools. Supply relevant image
  content directly as multimodal input. The workflow tool supports creating
  proposals and targeted revisions only; it is not a generic operation dispatcher.

## Requests, revisions and outputs

- Update a pending request's card in place, retaining accessible prior revisions.
- Approved request versions are immutable. Approval captures exact settings,
  references and note/context snapshots used for that generation.
- Restoring and submitting an older revision creates another latest revision,
  even when its contents are identical. It does not rewrite history.
- Manual edits are authoritative and available to the agent on its next turn.
- Use structured field edits or targeted prompt replacements through the active
  workflow tool's revision operation. Store complete revisions locally; return compact tool results.
  Avoid replaying all old versions into model context. Token savings depend on
  both tool output and the context assembled for subsequent calls.
- Support repeating with the actual prior seed and creating a variation with a
  new seed. Both require a new explicit generation approval.
- Results appear inline and save to Library. Clicking a result opens the existing
  Library-style viewer with a close action. Keep every generated copy.
- Generation failures offer Retry unchanged and Revise with agent. Neither
  permits automatic paid retries. The agent does not automatically critique
  outputs or failures; the user gives further direction.
- A definitive failure of one job does not stop the other approved jobs.
  Existing shared worker/transfer uncertainty rules can still block dispatch.
- No dependent-job chains in v1. Generating an image and subsequently animating
  it are separate user-directed requests, possibly in different conversations.
  To use an output in another conversation, the owner selects it from Library;
  the agent cannot read other conversations automatically.

## Execution and lifecycle

- A conversation stays busy during generation; other conversations remain usable.
- Approved jobs queue sequentially through the existing generation service.
- One contextual Stop control ends agent inference, running/queued jobs and
  pending proposals belonging to the current chat only. Other chats and
  Generate-page jobs are unaffected. The user can continue typing after stopping.
- Keep stopped proposals in history as inactive. Repeating one creates a fresh
  proposal requiring approval; never resume it using its old approval.
- Leaving the page or closing the browser does not stop server-side work.
  This requires the local Seed server to remain running.
- Sidebar status indicates background completion or failure.
- Block conversation deletion during active generation. Explain that the owner
  must stop generation and retry deletion. Deleting a chat preserves uploaded
  and generated media in Library.
- Deletion during agent-only activity remains open below.

## Attachments and notes

- Composer supports upload, Library selection, drag-and-drop and pasted images.
- Uploads from both Chat and Generate become Library assets, classified by active
  Standard/Spicy mode at upload time. Capture that mode at upload initiation so
  an unrelated later toggle does not change an in-flight upload's classification.
- Provide a per-asset modal for entering an optional Note. When attaching existing
  Library items, ask only for assets without a saved note. Save entered notes
  back to Library for subsequent use.
- Notes are exclusively authored/edited by the owner. The agent does not invent
  or update them. Notes supply descriptive context; there is no separate
  descriptive-tag requirement.
- Add an editable Note field to the existing Library media viewer, including
  when opened from Chat. Editing the Library note preserves snapshots already
  captured in approved requests.
- Generation roles (reference, first frame, last frame as supported) are proposed
  by the agent at request preparation and editable in the review popup.
- Give attached assets stable conversation references and translate those into
  each generation workflow's required reference labels.
- The agent can access only provided assets, not search or browse the whole
  Library. Provided attachments remain available throughout the conversation.
- On user direction, the agent can inspect/reuse outputs generated in that same
  conversation without requiring manual reattachment.
- Inspect provided images when preparing prompts. Video/audio attachments are
  visible in chat; the agent knows their presence, notes and metadata. Full
  video/audio content analysis is deferred.
- Images are generation inputs only for video workflows. Text-to-image accepts
  a text prompt and its settings; image-conditioned image generation/editing is
  outside this feature. The agent inspects images supplied for video prompting.
- Persist attachment identity and contextual metadata. Load image bytes when
  relevant instead of repeating all images on every call.

## Standard and Spicy separation

- Fix a chat's mode when created. Sidebar shows only chats of the active mode.
- Library and attachment pickers likewise show only the active mode.
- Standard chat tool schemas omit a generation mode field. Server-side execution
  enforces standard generation regardless of any model-supplied extra fields.
- Spicy chat has different system instructions and tools that allow standard or
  Spicy generation. It can generate either kind of output.
- Classify each output by its generation mode in Library. Retain all outputs
  visibly in their originating chat even when output mode differs from chat mode.
- Toggling mode hides the other mode's chats; their ongoing work continues.

## Model, prompts and credentials

- Embed Pi's TypeScript agent runtime on the local server and use OpenRouter for
  hosted standard Gemma 4 31B inference, independent of generation GPU VRAM.
- Prefer Parasail; allow automatic fallback to other providers serving the same
  Gemma model. No routine provider selection UI is required. Keep provider
  diagnostics in server logs.
- Require tool support on tool-bearing requests and compatible image input on
  image-bearing requests. Never silently drop those capabilities on fallback.
- Enter the OpenRouter key through masked CLI setup. Keep credentials out of
  browser storage, prompts, tool results and GPU configuration.
- Load owner-authored system instructions from known repository files, including
  distinct Standard/Spicy behavior. Package these files with the application.
- Codex will draft initial system prompts and the owner will take over editing.
- Enable Gemma reasoning by default and expose an option to disable it in Chat.
- Prompt edits should apply on the next user message in existing chats. Proposed
  implementation: snapshot instructions once per agent run, retaining the same
  version across tool iterations; record the version for traceability.
- Proposed prompt layout: `prompting/chat/standard.md` and
  `prompting/chat/spicy.md`, plus the existing workflow guides. Ship the owner's
  defaults as application resources; allow users to edit their own copies.
- Implementation choice: CLI setup initializes missing files under a documented
  per-user prompt directory outside the installation and prints its path. The
  runtime reads only known filenames there, with bundled defaults for files never
  customized. Preserve existing customizations on application updates; do not
  overwrite them or silently reset invalid files. An explicit reset-to-defaults
  operation can be added later.
- Saving a prompt file takes effect at the next message, without rebuilding or
  restarting. Snapshot all resolved files for that run. Repository files author
  distribution defaults; editing those alone does not replace a user's copies.

## Implementation outline (proposal)

1. Add typed chat/request/revision contracts, SQLite migrations and asset notes.
   Reuse permanent Seed storage and existing media validation/upload handling.
2. Extend mode filtering and Library note editing, including Generate uploads.
3. Add the chat service with Pi, hosted streaming, scoped domain tools, prompt
   loading and CLI credential resolution. Resolve/pin verified published Pi
   packages; research only verified upstream source-tree metadata.
4. Add approval as a server-enforced operation referencing a specific request
   revision. Reuse Jobs validation, capabilities, serialization and stable
   submission idempotency keys; never send raw model-authored Comfy graphs.
5. Build Chat layout, composer, note modal, cards, review/feedback popup, revision
   history and existing media viewers. Share Generate controls where practical.
6. Add durable event streaming/reconnection and background job state. Do not hold
   the generation serialization lock while waiting on model inference.
7. Verify with isolated local data and fake providers: schema enforcement, mode
   separation, approvals, stale revisions, feedback, duplicate prevention,
   cancellation, browser reconnect, restart handling and preserved media.
8. After separate spending authorization, test Parasail image-plus-tool calls and
   fallback compatibility; later validate chat responsiveness during H3 work.

Persist conversations, message content, requests/revisions, attachment mappings,
agent runs, tool results, prompt versions, job links and actual usage/cost. Handle
missing final accounting after cancellation as unknown, not free. On local server
restart recover durable job state but do not automatically repeat uncertain
generation submissions or resume paid agent work without a defined policy.

## Proposed technical defaults

These resolve engineering details for build-plan review; they are not additional
owner decisions or permission to spend.

- Stage all cards from a completed proposal turn before enabling dispatch.
  Review groups have an explicit sealed state; approving an early streamed card
  cannot start jobs before later cards are known. The final approve/deny decision
  automatically releases approved jobs when no revision operation is active.
- Feedback submission identifies the exact request/revision, saves the user
  message and marks the group as revising atomically. Enter sends and closes the
  popup to focus the conversation; Shift+Enter adds a newline. Stale approvals
  from another tab fail with a request to reload the current revision.
- Apply reasoning changes on the next message, storing the choice per chat.
  Snapshot prompt contents and reasoning settings for the whole agent run.
- Block deletion during any active chat work, including agent-only work and
  queued generation. Ask the user to Stop first. Preserve completed messages and
  media during cancellation; do not delete history to implement Stop.
- Stop first revokes the chat run's permission to dispatch further jobs, then
  aborts inference and cancels its queued/running jobs. Show Stopping until the
  existing job service confirms cancellation or reports uncertain remote state.
  Late model/tool responses cannot create proposals or dispatch jobs for that run.
- Once local inference and dispatch are stopped, permit further chat discussion
  even if remote cancellation is uncertain. Keep new generation blocked wherever
  existing recovery rules require it, with a visible explanation.
- Stop is not GPU teardown. A worker disconnection can prevent immediate remote
  cancellation; surface that uncertainty instead of claiming generation stopped.
- Library deletion retains current active-job protections. Inactive chats show
  missing-media placeholders if their assets are deleted; repeat/review requires
  replacement inputs. Notes and request snapshots remain as historical context.
- Reconnect browser event streams to server-owned work using durable run/event
  IDs. Browser closure does not cancel. Server restart marks interrupted agent
  runs and reconciles generation through existing Jobs recovery, without
  automatically repeating uncertain paid actions.
- Keep compact working context: current requests, supplied attachment metadata,
  recent complete turns and a summary of older conversation. Preserve full local
  history; do not break assistant/tool-result pairs during compaction.
- Add finite iteration/output limits and account for actual routed usage, with
  clear errors when no compatible provider is available. Choose concrete hosted
  test and spending limits with the owner before paid testing.

## Build milestones and acceptance

| Milestone | Deliverable | Acceptance evidence |
| --- | --- | --- |
| 0. Integration proof | Pin published Pi packages; isolated adapter and fake HTTP tests | Routing fields, reasoning toggle, image/tool replay, usage capture and abort verified before full UI work |
| 1. Asset groundwork | Notes in viewer/uploads; uploads saved in Library; exact mode filtering | Upload from Generate/Chat, edit notes, switch modes, retain historical snapshots |
| 2. Persistent Chat shell | Sidebar, auto titles, rename/delete, composer and shared viewer | Reload/navigation preserves chats; deletion preserves media; busy deletion is blocked |
| 3. Hosted agent | Embedded Pi, CLI key setup, prompt files, explicit workflow activation, reasoning toggle, compatible fallback | Fake-provider streaming/tools/abort tests; no secret leakage; prompt changes apply next run; inactive tools rejected; activation injects the matching guide |
| 4. Review workflow | Single workflow tool with create/revise operations, revision history, review popup and feedback | Multiple cards remain held; unchanged approvals survive; revised cards require reapproval |
| 5. Dispatch and recovery | Exact-revision approvals, queued job links, inline results, Stop/retry/repeat | Double clicks/reconnect cannot duplicate jobs; Stop affects only this chat; old outputs persist |
| 6. End-to-end acceptance | Integrated browser flow and bounded hosted verification | Owner reviews UI; authorized image-plus-tool and fallback trials; later H3 concurrency check |

Milestones 0–5 can be developed with isolated local fixtures and fake providers.
Use targeted service tests for approval races, mode enforcement and cancellation,
plus browser tests for the complete review-and-generate journey. Follow the
repository's build/typecheck/verification requirements before delivering a working
change. Runtime and worker changes are not assumed necessary by this plan.

## Independent review: required technical refinements

Three independent subagent reviews covered approval/recovery, assets/UI, and
Pi/provider integration, alongside a primary-agent code review. These are
planning findings, not results from running the proposed feature.

### Queue admission and state transitions

Existing `Jobs.submit` validates/prepares and commits one request at a time, then
unpauses the shared queue. Calling it repeatedly is not sufficient for review
groups: earlier requests could be committed while a later request fails.

- Refactor admission into preparation plus commit. Validate and prepare every
  approved card before atomically inserting all jobs, submission keys, revision
  links and the group's release state. Any preparation failure leaves all cards
  held. Recheck group/revision versions, capabilities and cancellation epoch
  after asynchronous preparation. Never await inside a SQLite transaction.
- Use one active agent run and one open review group per conversation initially.
  Serialize mutations per chat with expected-revision checks. The state flow is
  assembling -> reviewing/revising -> released -> running -> terminal; Stop can
  revoke any nonterminal group. Each revision has its own undecided/approved/
  denied decision. A denied card only becomes undecided through explicit revision
  or restoration, not automatic reconsideration by the agent.
- A failed/interrupted proposal turn cannot seal a group. Display any partial
  proposals as incomplete, unavailable for generation until a successful follow-up
  finalizes the group. A run producing no proposals ends as ordinary chat.
- A final decision racing with feedback is resolved by the first committed
  operation. Feedback cannot edit a released group; explain that it already
  started and offer a new proposal. Never silently apply feedback to a job in flight.
- Give each intended generation attempt a durable idempotency key. Retransmission
  reuses it; deliberate repeat/retry creates a new one. Preserve actual per-job
  seed lists: random count batches contain nonconsecutive seeds, so replaying only
  the original request's random seed/count is not a repeat of those results.
- Proposed batch retry default: retry only definitively failed jobs, retaining
  successful outputs. Whole-request repeat is a separate explicit action. Display
  total output count on each approval card; one card may represent its chosen
  count of outputs, each tracked separately after admission.
- Permit drafting without a connected GPU using known workflow definitions.
  Generation requires current validated worker capabilities. Never silently
  substitute a workflow, preset or settings after approval. Preserve held requests
  on connection failure; request fresh approval when effective settings change.

### Stop and recovery

`Jobs.cancel` currently throws for uncertain jobs, and recovery can redispatch
an unresolved submission after a same-engine 404. Therefore job state alone is
not a durable representation of the user's Stop intent.

- Persist a cancellation epoch on the chat plus per-job cancellation intent
  before awaiting inference, preparation or worker operations. All dispatch,
  callback and recovery paths check the fence. Scope jobs through durable chat
  ownership; do not use global queue pause as chat cancellation.
- Stop interrupts pending preparation/transfer where possible, cancels queued
  jobs, and requests remote cancellation for running jobs. Keep existing ownership
  checks around worker operations. Never tell the user remote cancellation is
  complete while its outcome remains unknown.
- Continue retrieving outputs already completed remotely, even after Stop.
  Distinguish stopped generation from saving completed results; media preservation
  must survive interrupted downloads and reconnects.
- A stopped group cannot revive on restart. Already-released, non-stopped jobs
  reconcile through existing recovery without creating fresh paid attempts.

### Media, notes and mode integrity

- Start upload/validation when a file is added, rather than delaying until the
  Generate button (the current Generate behavior). A successfully uploaded asset
  remains in Library even if attachment composition is abandoned. Upload bytes
  themselves still require a browser connection; server-side validation and jobs
  can continue after page closure. Incomplete uploads use resumable upload state.
- Note entry is optional; allow Skip. Adding or editing a note is a user mutation
  with concurrency protection. Do not let a stale note modal overwrite a newer
  note saved from Library. Existing approved snapshots never change implicitly.
- Add exact mode filtering in the Library query before pagination. Reset cursors
  on mode change; close incompatible viewers, pickers and request popups. Keep
  per-mode drafts/selections so hidden content cannot leak into the new mode.
- Include upload mode in tus resume identity and client completed-upload caches;
  adding the same file in the other mode must not reuse an asset of the wrong mode.
- Proposed sequence behavior: notes on sequence items, optional notes on selected
  individual frames, with sequence-note inheritance when the frame has none.
  Pass frame position/timestamp and note provenance to the agent. Sequences are
  separate database entities and need note support beyond the assets table.
- Resolve conversation asset references server-side against attachment/output
  membership, not guessed IDs. Mode-filtered browsing and explicit conversation
  access to its own mixed-mode results are separate rules. No global server mode
  variable: other browser tabs and background chats may have different modes.
- Stable conversation asset IDs must map deterministically to H3's actual
  Picture/Video/Audio prompt labels after ordering, roles and soundtrack choices.
  Validate/rewrite references when editing input order; a reordered asset must
  never silently acquire another asset's prompt description.
- Current image workflow is text-to-image; image conditioning/editing is excluded
  from this feature. Image assets are actual inputs only to video workflows.
  Video/audio references need valid clip ranges (currently 2–15 seconds, with
  aggregate/type limits); let the agent propose ranges and allow review edits.
- Protect selected assets against deletion during admission/preparation and
  active jobs. If an asset disappears while merely drafting/reviewing, invalidate
  affected cards with a missing-input message rather than substituting media.

### Agent and packaging verification

- Prove the published Pi adapter APIs in milestone 0. A source README or bundled
  catalog does not establish successful support for our exact routing/reasoning
  settings. Use a fake OpenRouter HTTP server to inspect outbound payloads.
- Capture actual routed provider identity, generation ID and usage through the
  transport or OpenRouter generation lookup. Pi's static model-price calculation
  must not be shown as actual charged cost after provider fallback.
- Pin model ID to standard Gemma. Require compatible tools/images and cap
  supported request/output sizes across fallback routes. A reasoning toggle must
  actually change the outgoing request, not merely hide reasoning text.
- No default coding-agent shell tools, user extensions or arbitrary resource
  discovery. Define one active workflow tool for proposals/revisions and enforce all
  approval, asset access and mode rules in trusted server code.
- V1 exposes zero tools without activation and exactly one workflow-specific
  tool after activation. That tool supports proposal creation and revision;
  trusted server context assembly replaces the previously proposed separate
  `get_capabilities`, `get_asset`, `inspect_images`, `get_job` and
  `get_prompt_guide` tools. Separate preparation/edit tools are also superseded.
  No `list_library` tool from the historical research. No agent approval,
  submission, cancellation, note-writing, shell or general network/file tools.
  UI approval and Stop call trusted application operations directly.
- Route the fixed model with Parasail preferred, fallback enabled and
  `require_parameters: true`. Preserve tool schemas through tool-capable turns.
  Validate provider compatibility in the adapter spike, and bound retry behavior
  explicitly; provider fallback is distinct from retrying a Seed generation.
- Extend CLI setup with optional Chat configuration without breaking existing
  GPU-only installs. Resolve only the chat credential in the local server;
  maintain environment filtering for GPU/source keys. A missing key disables
  chat sends with setup guidance rather than preventing Generate/Library startup.
- Package and test known prompt files. Store content hashes plus the actual run
  snapshot for reproducibility. Prompt-loading failure is explicit; do not
  silently fall back to a generic system prompt or apply half-written files.
- Snapshot the active workflow guide along with system prompts, activation state
  and tool schemas at run start; do not reread changed files midway through a run
  or inject inactive workflows' guides.
  Keep current request revisions and asset manifests outside lossy conversation
  summaries. Only database approval state can authorize dispatch.
- Milestone-zero source references:
  [Pi core API](https://raw.githubusercontent.com/earendil-works/pi/main/packages/agent/README.md),
  [Pi completions adapter](https://raw.githubusercontent.com/earendil-works/pi/main/packages/ai/src/api/openai-completions.ts),
  [OpenRouter routing](https://openrouter.ai/docs/guides/routing/provider-selection).
- Automatic titles should initially derive from the first message locally;
  no extra hosted-model call is necessary. Keep prompt/tool/image payloads out
  of routine logs; log sanitized timing, IDs, provider and failure categories.

### Product clarifications after review

The owner confirmed: images are generation inputs only for video; remaining
approved jobs continue after an individual failure; dependent image/video jobs
are never proposed together; each subsequent step requires direction and may use
a different conversation. Prompts ship with application defaults that users can
modify. The per-user editable-copy mechanism above implements that requirement
without needing rebuilds or losing changes on updates.

### Additional acceptance cases from review

- Final approval versus feedback, Stop or another tab editing the same revision.
- A later card fails preparation: zero jobs from that group enter the runnable queue.
- Stop during preparation, lost submit response, uncertain state, restart and
  output download: no redispatch; completed results are retained.
- Batch with successes and failures: no accidental repeat of successful outputs;
  same-seed repeat uses each original actual seed.
- Mode toggle with open popup, pending upload and paginated Library; same file
  uploaded in both modes; mixed-mode result retained inside its original chat.
- Note edited elsewhere during review; approved snapshots unchanged; missing
  attachment/sequence frame cannot be replaced silently.
- Provider returns HTTP 200 with a stream error, malformed tool calls, unsupported
  reasoning or missing final usage. No false success or zero-cost claim.
- No workflow active: zero tools and fabricated calls rejected. Activate
  a workflow: exactly one tool and its guide appear; mode restrictions still apply.
  Switch workflows: old guide instructions cannot authorize old tools. Activation
  alone never releases a generation, and updating guide files applies next run.

## Second independent review: single-tool workflow refinements

Two reviewers assessed the revised tool contract, context supply and workflow
lifecycle. The following are engineering defaults, not additional owner decisions.

- Define one named tool per supported workflow, exposing only the selected one.
  Its schema supports `create` and `revise` with bounded lists of proposals or
  edits. Multiple calls in one successful turn belong to the same review group.
  A revision specifies `request_id` and `expected_revision`; exact prompt-text
  replacements fail without mutation if missing or ambiguous. Return compact
  revision IDs and validation errors. No read/status/inspection operations are
  hidden inside this tool.
- Each review group belongs to one workflow. Switching preserves existing cards
  and decisions but cannot append another workflow's cards or bypass the single
  open-group rule. Discussion remains possible; creating another proposal group
  requires resolving or stopping the existing group. Show the outstanding group
  when that rule blocks a new proposal.
- Manual review and approval remain available for old-workflow cards. Agent
  feedback or Revise with agent on such a card explicitly offers "Switch to
  [workflow] and send"; never reactivate a workflow implicitly. Reject tool edits
  to requests belonging to a different workflow. The combined UI action obeys
  the same busy-state and workflow-version checks as the picker.
- Repeat/retry are trusted UI operations creating fresh approval cards using the
  recorded workflow and revisions. They do not implicitly switch the active
  tool and cannot bypass the single open-group rule. Agent-assisted changes
  require the corresponding workflow to be selected.
- Persist a versioned workflow selection per chat. Disable activation changes
  during inference or generation, consistent with the busy-chat rule. Stop ends
  work but preserves the selection, as do reload and navigation. Check the
  expected workflow version on send/change; a stale browser tab refreshes and
  asks the owner to resend instead of using an unexpected workflow. Snapshot the
  selected workflow, its sole schema and guide atomically for each run.
- Record activation as a visible chat event. Inject guide contents as a
  replaceable active-context segment, not ordinary history repeatedly replayed
  into later runs. Store previous snapshots for history/debugging; exclude old
  guide bodies from active instructions and conversation summaries.
- Assemble image context deterministically: newly supplied images, images used
  by the card receiving feedback, and older conversation images explicitly
  selected for the current message. Allow selecting earlier attachments or own
  outputs directly in chat without uploading again or browsing other chats.
  Include the scoped asset manifest and current request state independently of
  images. If the user refers ambiguously to an older image, ask for selection;
  do not guess or claim to have inspected bytes that were not supplied.
- Establish provider-compatible image/context limits in the integration proof.
  If selected images exceed them, explain and request a smaller selection rather
  than silently omitting inputs. Ordinary turns do not resend every historical
  image. Workflow context supplies supported settings and relevant job state
  without exposing additional tools.
- Additional acceptance: assert exactly zero/one outbound tool schemas; reject
  old-workflow calls; revise with an ambiguous text replacement; switch with a
  partly approved group; send feedback to an old card; repeat an old workflow;
  stale workflow selection in another tab; Stop then send without reactivation;
  select older images and exceed the image budget; switch guides without replaying
  old instructions. All can first be checked using fake providers and local data.

The owner's subsequent Proceed authorizes implementation and local verification.
GPU rental and paid inference remain separate acceptance steps.

## Implementation notes

- Pi packages are pinned to published version 0.85.1. The agent uses the Pi
  OpenAI-compatible adapter with explicit OpenRouter routing and fake transport
  tests; no coding-agent extensions or helper tools are loaded.
- Chats, guide/run snapshots, revisions and cancellation intent persist in SQLite.
  Browser reconnection currently uses periodic durable state snapshots, including
  incrementally saved assistant text, rather than an SSE event-log endpoint.
- Context assembly summarizes older dialogue once its budget is reached, retaining
  recent turns and canonical current request/asset state separately. Summarization
  uses a bounded, accounted, tool-free model call and participates in Stop.
  All original history remains stored. Selected images are capped at nine per turn
  and downscaled to a 1536-pixel bounding box for hosted inspection.
- CLI setup supports `--chat-only`; optional OpenRouter setup does not require GPU
  credentials. The packaged prompt directory initializes editable user copies.
- Generation review supports settings, role/range/framing edits, provided-asset
  selection, revision restoration, feedback, repeat and failed-job retries.
- Local verification and release evidence are recorded in VALIDATION.md.
