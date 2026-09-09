# Revision 5 fresh read-through

9 September 2026. Static review of the nine active core Markdown documents plus the LoRA example and job examples. No implementation or live acceptance performed; no numerical confidence score.

## Shape that is coherent

Local PC owns the studio and permanent media/database. RunPod owns manually deployed GPU execution, reusable model cache and an output spool retained until durable receipt. Direct Hugging Face downloads are preferred; owner-selected content LoRAs may need another source. Software ships pinned via GHCR. The early worker page provides pairing/preparation status. External browser hosting is outside project scope. Four existing workflow families remain.

## Gaps to close before implementation readiness

1. **Local install/start contract:** architecture proposes Compose but the setup instructions explain mostly RunPod. Specify prerequisite/runtime, one documented PC start command, persistent media/SQLite/config paths, local URL and update/restart behavior. Select the actual Windows storage layout and test it; do not assume every mount gives suitable SQLite semantics. The local app container must not receive the setup utility's RunPod API key.
2. **Worker API boundary:** pairing, status during download, file transfer and receipt/cleanup need one explicit worker contract. Do not put early status or pairing solely inside ComfyUI, which starts later. Keep Comfy-specific process fencing in the existing integration, without building a second general queue/controller. Decide how worker credentials survive worker restart and how a lost exchange reply is handled.
3. **Saved versus cleaned:** specify acknowledgment identity, repeated acknowledgment result, cleanup retry and the API fields that distinguish saved output from cleanup pending. Library availability and safe-to-terminate must not wait on successful removal of already-saved worker files. Record complete artifact metadata and verify receipt before deleting the spool.
4. **Local access contract:** docs require owner authentication but also defer external login and default to localhost. Define the trusted single-user loopback mode, Host/Origin/CSRF checks and explicit reverse-proxy mode. An unspecified external identity header is not an implementable authentication contract.
5. **Shutdown/queue semantics:** define the API's safe-to-terminate boolean/unknown and reason fields, and a user-facing pause action. New connections/queue resumption must not race a safe indication. Preparation/download activity, direct admin jobs and unsaved spool outputs need explicit handling.
6. **Preset management:** core model file locations are found, not yet fully pinned/tested. Content LoRAs remain unselected. Explain how the owner's local preset file reaches the worker and becomes active without rebuilding the software image. Map internal preset keys (krea-create, h3-frame-video, etc.) to the four public workflow IDs; do not leak that mapping into the user's forms.
7. **Product baseline versus implementation choice:** Generate/Library and four workflows are the current proposed product baseline. SwarmUI evaluation affects how to build it, not automatically a reason to postpone the infrastructure round trip. Full mixed-reference behavior, audio budgets, ending-frame influence and native export timing still need live tests.

## Corrections made during this review

Removed the duplicated 'Local local PC' wording and the architecture's obsolete blanket exclusion of extra auth/proxy services, which contradicted the agreed early worker page. Aligned API worker UI state names to Preparing/Ready/Busy/Disconnected; connection progress and errors remain details. Did not silently choose unresolved installation, worker protocol or auth behavior.

## Execution priority

First close local launch plus worker pairing/status/receipt contracts. Then prove one end-to-end image job and interrupted-output recovery across replacement. Next add/test video and the four user workflows. Defer unrelated infrastructure and do not reopen Terraform, tunnel hosting or model packaging. First implementation access remains owner-present; each paid test session uses at most one pod/GPU and ends with provider-off verification.

## Document usability

Use STUDIO-MVP as the user-facing overview and EXECUTION-PLAN as the implementation sequence. CURRENT-DIRECTION duplicates much of the overview and should eventually become a short decision log. Keep API/architecture/bootstrap/source/media/graph details as engineering references, not required reading for understanding the product. Avoid another broad rewrite until remaining contracts are settled.
