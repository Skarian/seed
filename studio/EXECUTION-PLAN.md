# seed implementation plan, checkpoints and acceptance

Revision 9. Checkout preparation and the first local app foundation are implemented; worker integration, packaging and live GPU validation are pending. This is the working execution plan and milestone journal. Product scope is [STUDIO-MVP](../STUDIO-MVP.md). Technical references remain [architecture](ARCHITECTURE.md), [API](API-CONTRACT.md), [worker](POD-BOOTSTRAP.md), [sources/setup](RELEASE-AND-INFRASTRUCTURE.md) and [workflows](COMFYUI-CHANGES.md).

## 0. Owner-present kickoff: obtain all access first

Collect credentials using the service login flow or ignored local secret files, not chat, committed files or public templates. Reuse working existing access rather than asking for replacement secrets. Verify access with read-only calls before provisioning. Record checks as passed/missing without recording secret values.

| Access or input | Purpose and validation |
|---|---|
| RunPod API key entered through seed setup (or environment/local ignored .env) | Standalone setup/operator work: inspect account, templates and volumes; later create/reuse approved storage and inspect/terminate authorized test compute. Verify account and resource IDs. Never give this key to the studio web handler or GPU worker. |
| RunPod console login | Owner deployment workflow and manual recovery. Record selected volume/template and intended GPU class/data center; inspect current state rather than relying on saved snapshots. |
| Hugging Face read/fine-grained token, when needed | Check metadata/access to exact required files, including account approval for gated models. A token is not a substitute for accepting model terms. Pass download credentials privately to the worker. |
| Civitai API token and exact selected LoRA version/file IDs | Validate metadata and download entitlement. Obtain the desired mode mappings at kickoff if available; missing assets block final mode acceptance, not unrelated development. Do not purchase assets or select paid subscriptions without explicit authorization. |
| GitHub repository access and GHCR publish/pull access | Verify local Git authentication separately from app/browser login. Reuse the existing image namespace; plan public worker-image pulls without a GHCR read secret on the pod and npm for the CLI package. Publishing still requires authorized access. Establish whether pushes are authorized and target branch/review preference at kickoff; local commits do not imply push or publication permission. |
| npm account and intended package scope | Verify publishing rights for the candidate `@skarian/seed` package before release; the unscoped `seed` name is occupied. Keep the package private until publication is authorized. |
| Existing Jupyter admin credential, if accessing the old deployment | Verify the private local configuration or configure a new credential through the supported deployment path. Do not require the owner to remember an obsolete token. Keep Jupyter administration separate from worker pairing. |
| Local Windows access | Verify writes to per-user installation/app directories and execution of Node/media binaries. Check optional Docker/build tooling availability. Handle any necessary installer/admin prompt while the owner is present; no administrator requirement solely for sign-in startup. |
| Operational authorization | Record permission for test pod creation/termination and worker image/template publication, maximum one active pod and one active GPU, allowed hourly rate, session spending budget and approved storage changes. Preserve existing volumes; never stop unrelated work. |

Generate the pairing secret during setup; the owner does not need to supply it. Save/reuse it and the selected volume ID. No tunnel, router, external login, exe.dev, Terraform, S3 or model-artifact credentials are required. Browser hosting remains outside project scope.

At this checkpoint confirm the proposed Generate/Library custom frontend baseline or any result of the owner's SwarmUI evaluation. This is a product implementation choice, not a prerequisite for independent setup/transport work.

## 1. Checkout baseline — completed

Implementation branch: `feat/studio-mvp`. The initial local baseline is `332a0a0`;
subsequent curation removes obsolete plans/reviewer reports and fixed-run helpers.
Current deployment code, workflows, active specifications and LLM research are
retained. Research is organized through [the topic index](../research/README.md).

Verified backups remain in ignored local `backups/`, including private material;
never publish them. No remote push, deployment, installation or paid resource
change is part of this cleanup. Credential verification and remaining M0 contract
work are still pending. Review named-file diffs before subsequent local commits.

## 2. Milestones

Each milestone produces a demonstrable result and a short evidence record. Local commits may be smaller than a milestone but should represent coherent tested changes. Code review happens before marking the milestone complete.

| Milestone | Deliverable and checks | Owner check-in | Commit boundary |
|---|---|---|---|
| M0: access and baseline | Verified access checklist, fresh backup, reviewed plan, organized branch. Finish exact worker pairing/status/receipt/preset contracts; choose the small worker process implementation. | Kickoff while owner is present; summarize scope, spending and missing inputs. | Plan/baseline, then finalized contracts. |
| M1: local application | npm-installed Node CLI, built UI shell, standard env-paths storage, SQLite, and optional Windows sign-in startup. Use system Node. No Docker runtime requirement. Test clean global npm install, OS detection, fresh/repeated setup, startup opt-in/out, duplicate launch, stop/restart, upgrade/uninstall data preservation, local-only access and optional proxy configuration. | Show the actual setup and Generate/Library shell. Confirm usability before polishing or expanding the UI. | Local app, then npm CLI/setup. |
| M2: setup and worker connection | runpod-setup reuses volume ID/secret, shows live storage cost before creation, preflights HF/Civitai access. Pinned GHCR worker/template; port 8080 works during preparation; single-use pairing and progress work. Test blank/warm cache, interrupted downloads, expired/reused codes and lost exchange replies. | Demonstrate deploy → pair while preparing. Present any unavoidable extra user steps. | Setup/source manifest, then worker bootstrap/pairing. |
| M3: one reliable round trip | One real image job goes through native ComfyUI APIs, saves durably on PC and acknowledges cleanup. Reconnect/replacement recovers a deliberately retained completed output. Test copy interruption, duplicate receipt, cleanup-only failure, uncertain submission and safe-to-terminate state. | Show a saved result and recovery behavior. This is the first end-to-end product proof. | Image vertical slice, then recovery/receipt behavior. |
| M4: four expressive workflows | Text/image creation/edit and text/reference video, shared media handling, Library, queue, Civitai preset sync. Test mobile fixtures, reference labels/roles, first/last frames, mixed images/audio/video, legal input budgets, selected/effective ranges, exact exports and meaningful LoRA influence. | Review representative image/edit/video results and controls; owner assesses output usefulness as well as technical correctness. | Separate image, video/reference and preset changes as useful. |
| M5: acceptance and handover | Fresh setup/relaunch, worker replacement, PC restart, disk-full paths, backup/restore, update/rollback and agreed workflow matrix. Verify only the retired Qwen checkpoint/redownload hooks are removed during authorized maintenance. Document start/pair/terminate/update/recover. | Final walkthrough; identify any failed or deferred requirements explicitly. | Acceptance fixes, then release/docs with tested versions. |

M2/M3 paid work begins only after kickoff authorization. Test risky media transfer paths early, comparing native Comfy locally, worker proxy and RunPod outer endpoint. Do not build all UI/workflows around an unproven transfer path. Milestones are dependency order, not speculative calendar promises.

## 3. How we collaborate

The owner supplies product judgment; the assistant owns engineering execution and brings concrete choices back at the right time. Check in when feedback could materially change the result, before investing heavily in that direction. Milestone demos are the minimum checkpoints, not the only opportunities to collaborate. Do not turn routine implementation into a sequence of permission requests.

| Situation | Assistant action | Owner involvement |
|---|---|---|
| UI layout, controls, terminology or interaction is uncertain | Show a working preview or two small alternatives with the same example task. Explain the tradeoff and recommend one. | Ask the owner to try the task and describe what feels clearer or awkward; record preference and observed friction. This is informal A/B usability comparison, not a statistical experiment. |
| API behavior affects the user or future agent workflows | Use the visualize skill for a small HTML explanation when interaction helps, or a static diagram when sufficient. Walk through a concrete request, status changes, result and one failure/recovery case. Include sample JSON only where useful. | Review behavior and tradeoffs, rather than requiring the owner to design routes or schemas. Keep routine implementation details with the assistant. |
| A bounded engineering slice is ready | State the outcome, scope, tests, completion criteria and next demo/check-in. Implement, debug, review and make coherent local commits within existing authorization. | No response needed unless the owner wants to steer. Clearly say when the work can proceed unattended. |
| Output quality or workflow expressiveness needs judgment | Present representative image/video results with the relevant settings and, where helpful, a controlled comparison. | Owner judges usefulness, quality and control; automated checks establish technical correctness separately. |
| Access, scope, cost or a destructive action exceeds authorization | Prepare the concrete proposal and explain the blocker and consequence. | Obtain the missing decision or authorization before dependent work. |

Keep each check-in focused: what is ready to inspect, the decision needed, the recommendation, and what follows. Prefer one meaningful question over a broad questionnaire. If feedback is required, pause only the dependent work and continue independent tasks; silence is not approval. A previously agreed direction stays settled unless evidence or owner feedback changes it. Do not create alternatives just to fill a review ritual.

### Owner access for reviews and portal use

Owner confirmed same-Wi-Fi access on 2026-09-09. Default to a clickable home-LAN
URL for UI tests, demos and portal access; do not assume the owner is at the PC.
Start/check the appropriate portal, verify its current assigned LAN address and
HTTP response, and share that address. The working address was
`http://192.168.1.212:4310`; recheck rather than assuming DHCP never changes it.
Reuse the working LAN approach without asking permission again. Keep automated
browser tests isolated from the owner's portal data. This is a delivery preference,
not approval of the UI design or a request for internet exposure. The installed
portal still needs a persistent LAN configuration during CLI setup; the
current opt-in development preview is not that completed installation.

### Engineering review and communication

At each milestone review the diff for scope, correctness, data loss/duplication, credential handling and regressions. Use focused independent reviewers for the worker/transfer contracts and after M3/M4, as previously requested. Reviewers report concrete defects and missing evidence, not confidence percentages. Address findings before promoting the affected work. Use unit/contract tests for pure logic, browser tests for actual flows, and live GPU tests for model/transfer behavior. Do not write tests that only mirror trivial implementation.

Send concise progress updates during work and a milestone note covering what changed, what was tested, costs/compute state and remaining issues. Owner review is for visible UX/results and material scope changes; ordinary engineering choices and fixes proceed autonomously within authorization. If the owner is away, continue independent work and leave a concrete demo/check-in queued. Do not treat silence as approval for scope expansion or spending above the agreed limit. Never leave compute running while waiting for feedback.

Do not repeatedly request credentials or permission already established at kickoff. Interrupt for a real access blocker, unavoidable change to agreed behavior, destructive action outside scope or spending beyond authorization. No automatic restart of ambiguous paid generation.

### Durable notes, not conversation archaeology

Before starting or resuming a slice, read its milestone entry and the relevant technical sections. Update them after a meaningful decision, review, test result or handoff, and before ending a work session. The documents must let another session continue without reconstructing chat history.

- Keep current behavior and implementation details in the owning document: architecture for modules/libraries, API for contracts and examples, bootstrap for worker startup, and workflow documents for model/control mappings. Replace superseded specifications in place; retain a short dated decision and reason under the relevant section when that history helps.
- Keep milestone progress below: date, state, accepted decisions and rationale, code/spec links, tests and outcomes, unresolved questions, and the next action/check-in. Include commit references when available and verified compute state for paid sessions. Link to detailed evidence instead of copying logs.
- Distinguish proposed, owner-agreed, implemented and verified. Record failed tests, untested assumptions and explicit deferrals as clearly as successes. Do not mark a milestone complete merely because code was written.
- Use research buckets for exploratory material. Keep screenshots/demos that explain a decision accessible through a linked artifact; record the conclusion in text so a temporary preview is not the only record. Never put credentials, private media or raw sensitive logs in these notes.
- Keep this lean: no daily transcript, duplicate decision database or new report per review wave. Consolidate resolved notes as work progresses, leaving enough rationale to avoid reopening settled choices.

### Milestone journal

#### M0 — In progress: baseline, access and contracts

- **2026-09-09, completed:** checkout backed up and curated on `feat/studio-mvp`; local commits `332a0a0` and `014db4e`. Obsolete plans and fixed-run helpers removed; LLM research retained in topic buckets. Current documentation links checked, 49 maintenance Python files parsed without execution, and credential scan passed. Two pre-existing missing assets in copied upstream research remain outside the active specifications. No pods were operated or remote changes made.
- **2026-09-09, owner-agreed:** collaborate on UX, output quality and consequential API behavior using concrete previews/comparisons; hand off bounded engineering and tests for unattended execution. Keep decisions and implementation evidence in the relevant milestone/specification sections.
- **2026-09-09, access checked:** RunPod MCP read access works; existing pod `m6k75q8bdelebh` reports `EXITED`, volume `f7vnixgws1` is 150 GB in EUR-IS-1. GitHub remote read works. Docker is installed but its daemon is off. Standalone RunPod key, HF and Civitai credentials are absent in checked environment/conventional local locations; ignored `.env` prepared from `.env.example`. Existing private Jupyter configuration is present but not tested against a running pod. No compute was started; no publication or storage change occurred.
- **2026-09-09, specified:** focused agent pass completed exact [worker protocol](POD-BOOTSTRAP.md) and [API save/cleanup semantics](API-CONTRACT.md), reusing native ComfyUI. These are design specifications, not verified worker behavior. Actual pinned-runtime streaming/hooks, restart recovery and preset activation need live proof.
- **Next:** finish missing access and establish explicit hourly/session spending limits (question pending). Model-source access, GHCR publication access and npm publication access still needs verification. Public ungated downloads may not need HF credentials. No paid tests until their access/limits are settled.

#### M1 — In progress: local application

- **2026-09-09, implemented:** React/Vite Generate/Library shell and four workflow selectors, per-workflow browser prompt drafts, loopback Fastify server, standard env-paths layout and SQLite migration. Pairing/uploads/generation intentionally unavailable. Preview runs on port 4310 using isolated `.local/preview` data. [Development guide](DEVELOPMENT.md) records code boundaries and commands.
- **Verified:** TypeScript check and production build; six storage/API tests; two browser tests covering draft reload, workflow controls, navigation and 390 px mobile layout. Desktop/mobile screenshots inspected. Dependency audit reported zero vulnerabilities. Node 22.13 crashed in SQLite; official Node 22.23.2 ZIP was checksum-verified and native SQLite works. Runtime minimum and `.node-version` now match tested version. Independent code review found no further blocking issues for this disconnected foundation. Browser-test teardown required normal Windows process permissions; rerun passed and exited cleanly.
- **Owner checkpoint pending:** try Generate/Library and the workflow selector; assess layout/wording before UI expansion. Question sent with preview URL. No approval or preference inferred yet.
- **2026-09-09, owner-requested LAN preview:** separate isolated preview listens on the PC's assigned address `192.168.1.212:4310`; Host/Origin protections remain enabled and normal startup remains loopback. Local health request returned 200. A firewall rule restricted to the home subnet could not be created because Windows denied access; the owner subsequently confirmed access from the same Wi-Fi. No firewall modification was needed to establish that successful access. No router or public exposure changes.
- **2026-09-09, first owner UI review:** working name is Studio with a simple frame logo. Remove introductory/tagline copy and fixed megapixel labels; prompt first, visible resize handle, shape-based frame controls, reset current form, and no output panel before submission. Pod and jobs controls belong at the top-right with popovers and a job-count badge. Apply the same approach to all workflows. These decisions are owner-agreed; the revised layout still awaits their next review.
- **Implemented and checked:** Studio branding/title/footer, compact forms, working SFW/NSFW draft toggle (identity edit has no toggle), visual frame and duration choices, current-workflow reset, and native dismissible popovers. Prompt resize supports pointer/touch and keyboard. Version-2 browser drafts preserve prompt/mode/frame/duration per workflow and migrate earlier prompts. Reset leaves other workflows' drafts intact. Blank output preview removed; future submitted/loading output should use the logo without placeholder prose. Generation remains disabled, so changing mode does not load or claim any LoRA. Typecheck/build and two updated browser tests passed; desktop/mobile screenshots inspected and LAN page confirmed serving the new build.
- **2026-09-09, owner-requested batch/Advanced controls:** all workflows need multiple generations per submission and an Advanced disclosure for seeds and later supported controls. Implemented UI defaults to one generation and random seed; count 1–16, fixed starting seed, per-workflow persistence and reset. Proposed execution semantics: one atomic submission creates independent sequential jobs, random seeds differ, fixed seed increments per child, no graph-level GPU batching or extra queue service. Backend batch expansion remains M3/M4 work; see the API contract. Typecheck/build and all three browser tests pass, including four-workflow persistence, reset, seed-range overflow and mobile layout. The first test exposed an ambiguous batch selector label (fixed); the next corrected its expectation that Advanced stays open across a workflow change.
- **2026-09-09, owner-agreed and implemented where noted:** app display name is now **seed**. Title/header/footer and server identification updated; existing storage paths and API identifiers retained, with old browser drafts read into the new seed draft key. Distribution is an npm-installed CLI using system Node, not a desktop wrapper or bundled runtime. Candidate local package name is `@skarian/seed`; unscoped `seed` is occupied, scope publication rights remain unverified, and the package is still private/unpublished. Planned `seed setup` detects Windows and asks "Would you like seed to start automatically when you sign in?" Yes creates/updates one per-user startup entry; No removes it; other OSes skip the Windows step. These CLI commands and startup behavior are not implemented yet.
- **System runtime verified:** owner-authorized upgrade to official Node 26.8.2 Current succeeded after the MSI required Windows administrator approval. Download checksums and MSI signature verified. Existing better-sqlite3 13.0.3 works with SQLite 3.53.4; no library replacement needed. Typecheck, production build and six storage/API tests pass on the upgraded system runtime. All four browser tests pass, including legacy draft preservation, mobile layout and batch/seed controls. Refreshed LAN health and HTML return seed branding at `http://192.168.1.212:4310`. Credential scan found zero matches. No remote publication or GPU operation.
- **2026-09-09, owner-requested next UI checkpoint:** after CLI commands, optional Windows sign-in setup, npm installation/lifecycle tests and the setup/launch demonstration, do another upload UI pass before advancing to worker integration. Provide the usual Wi-Fi preview for phone testing: file selection, image/audio/video previews where applicable, removal/replacement, multiple-reference layout, and clear client-side validation feedback based on confirmed workflow requirements. Let the owner assess the controls and layout; explicitly distinguish browser-local previews from implemented durable upload, preparation or GPU transfer. This checkpoint does not require a running GPU or claim model acceptance. Record feedback here and update the relevant workflow/media specifications.
- **2026-09-09, CLI lifecycle implemented and tested:** `seed setup/start/status/stop`, detached process reuse, authenticated local graceful stop, standard config/log paths, explicit LAN host setting and optional per-user Windows startup. Seven storage/API/CLI tests pass, including concurrent launch and execution of the generated startup entry in an isolated Windows profile. Typecheck/build and clean global tarball installation pass; reinstall/uninstall preserve test originals and SQLite. No npm publication or owner startup opt-in. An actual Windows sign-in and owner setup demo remain acceptance checks. Main portal will be moved from manual development launch to the CLI before the next UI handoff. Official references: [Node detached processes](https://nodejs.org/api/child_process.html#optionsdetached), [npm bin packaging](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#bin).
- **2026-09-09, upload UI review ready:** source/subject image inputs and mixed video references now support browser-local previews, roles, replacement/removal, per-workflow retention, reset and client feedback. Long video/audio sources show editable ranges. Model-side preparation, audio budget accounting and durable uploads remain integration work; the UI labels this preview-only. All six browser tests pass, including generated audio/video playback and mobile interaction; seven server/CLI tests pass. Mobile screenshots inspected. CLI implementation is committed as `44ece29`; current upload changes form the next local commit.
- **Installed owner portal:** local tarball installed into normal npm prefix; CLI setup stores LAN address `192.168.1.212` with startup disabled. Replaced only verified manual preview PID 9560 with the CLI-managed installed app, using standard app data. Fresh status/HTTP checks pass after the launching command exits. Old isolated preview files preserved. No GPU, remote publication or external hosting change.
- **2026-09-09, owner upload redesign:** collapsible drop box with thumbnails, file count and Add; click a thumbnail for a reusable full-screen viewer with dark backdrop, top-right delete/info/download, reference roles and video/audio playback/ranges. Metadata moves into Info; Replace and on-page preview notice removed; frame buttons centered. Browser-local data behavior unchanged. Six browser tests pass, mobile screenshots inspected. Installed package refreshed through seed stop/install/start; LAN health verified. Owner review of this revision remains pending.
- **2026-09-09, owner mobile review accepted viewer direction:** two-image selection and the full-screen viewer work well on the owner's phone. Add visible max: 2 (identity) and max: 12 (reference video), with video category ceilings of 9 images/3 videos/3 audio. Owner then requested removing the collapse/expand dropdown: thumbnails stay visible; reference-type selection remains in the full-screen viewer. Owner reported native camera/camcorder/gallery picker choices and a confusing gray Select button that still accepted an image. No capture attribute is set; the native chooser is browser/OS controlled. Keep this usability issue open for real-device investigation, without claiming a fix or redesigning the accepted viewer.
- **2026-09-09, upload polish:** owner moved file counts and limits behind an Info icon beside the box title, renamed image-edit inputs to "Input Images" (video remains "References"), and requested centered Create button text. Keep the add button and thumbnails visible; no on-form count/limit copy.
- **2026-09-09, desktop UI review:** owner is happy with the overall layout after mobile and desktop review. Requested final refinements: rename Frame to Aspect ratio across all workflows and center Length options on video forms. Applied consistently to both video workflows. This accepts the present UI direction, not unimplemented upload/generation functionality or real Windows sign-in behavior.
- **2026-09-09, requested setup credential detection implemented:** seed setup checks environment/saved credentials/local .env, prompts with masked input only when missing, and saves in standard per-user config. Reruns reuse it; unattended missing credentials fail with instructions. No key on command line, logs, browser or GPU; web process environment excludes it. Eleven server/CLI/credential tests pass with isolated fixtures. Saved does not mean provider-verified; no live key requested or RunPod call made in this slice.
- **Current owner checkpoint:** refresh the Wi-Fi portal and review upload controls on image-to-image/reference-to-video. Try adding, replacing, removing, roles and clip ranges. Desktop CLI demo: `seed status`, `seed stop`, `seed start`; interactive `seed setup` after stopping offers sign-in startup. Owner's real sign-in and mobile acceptance remain pending. Do not mark M1 accepted before this feedback.
- **Next engineering slice after review:** address UX feedback, finish worker access/spending gates and begin pairing plus one durable image round trip. No expansion to paid model testing until its access/limits are settled. Public proxy support, actual uploads/preparation and richer Library contracts remain unimplemented.


#### M2 — Not started: setup and worker connection

Next owner checkpoint: demonstrate manual deploy → pair during preparation. Record startup/pairing contracts, actual test evidence and any unavoidable extra steps.

#### M3 — Not started: durable image round trip

Next owner checkpoint: inspect a saved generation and interrupted-transfer/replacement recovery. Record receipt/recovery behavior and the evidence behind the termination indicator.

#### M4 — Not started: expressive workflows

Next owner checkpoint: try image/video controls and compare representative outputs. Record chosen defaults, reference handling and quality feedback separately from technical test results.

#### M5 — Not started: acceptance and handover

Next owner checkpoint: perform the daily start/pair/generate/save/terminate flow and review remaining limitations. Record acceptance evidence, release/rollback references and verified final compute state.

## 4. Commit and publication policy

Use named-file staging and review the staged diff, including generated code/config. Before each commit run checks appropriate to the change and check for leaked credentials/private data. Commit coherent pieces as they pass; do not wait until final delivery for a giant commit. Record validation in the commit/milestone notes and clearly distinguish tests not run. Pin runtime/model/dependency revisions and keep generated binaries, models, media and secrets outside Git.

Push according to the kickoff agreement; never force-push or rewrite unrelated history. Publishing a worker image or changing the deployment template is a separate release action, not a consequence of committing. Publish authorized candidate versions, test them and retain the prior working image/template for rollback before promoting the new default. A code rollback cannot substitute for database compatibility/restore checks.

## 5. Paid sessions and completion

Before each paid session verify no other authorized test GPU is active, inspect intended resources and respect the recorded ceiling/budget. Use one pod/one GPU at a time, including replacement tests. After each session, stop/terminate the authorized compute through the supported operator path and verify the provider state, even when tests fail. Record pod ID/final state/time. If shutdown cannot be verified, report it immediately with manual recovery instructions; never claim compute is off from a disconnected UI. Retained volume storage continues billing.

Completion requires live validation across setup, pairing, downloads, transfers, updates and all four workflows, plus a final owner walkthrough and known-limitations record. The app should keep unique media safe, avoid duplicate paid work and accurately distinguish generation/transfer/cleanup outcomes. End with relevant commits recorded, no unexplained authored changes, preserved local-only assets and verified compute off. No numerical confidence claim replaces acceptance evidence.
