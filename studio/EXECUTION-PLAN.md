# seed implementation plan, checkpoints and acceptance

## Infrastructure research checkpoint — 10 September 2026

Owner requested a provider-neutral review of dstack and SkyPilot rather than committing to each suggested provider in turn. [Research and proposed proof sequence](../research/infrastructure/multi-provider-orchestration.md) is complete at the documentation/code-inspection level. dstack is the first experimental candidate, not an adopted dependency. Key findings: provider-local volumes stay geographically constrained; HTTP autoscaling does not understand Seed's asynchronous generation/receipt lifecycle; dstack's container-backend idle exceptions require explicit session shutdown; task port forwarding may avoid an extra gateway. Seed currently hardcodes RunPod endpoint validation and a mounted workspace, so migration is not a configuration-only change.

No orchestrator installed, GPU started, credentials changed, or workflow code modified. Next checkpoint is local control/transport proof followed by one image generation on two owner-enabled providers, sequentially, then video/recovery proof. Confirm missing provider access and numerical experiment budget before paid testing. Preserve existing M4 work and the operational deployment while this decision is evaluated; do not duplicate the job queue or replace the frontend.

Revision 12. The local npm CLI/UI, worker packaging, operator setup, prepared-volume startup/pairing and durable text-to-image generation are implemented and live-tested. M4 is in progress with text-to-video and reference-to-video ahead of image-to-image. Video uploads, FL/Ref routing, playback and both content presets are implemented; live acceptance is running. Cold-download and pending-output pod-replacement proof remain separate outstanding gates. This document is the working execution plan and milestone journal. Product scope is [STUDIO-MVP](../STUDIO-MVP.md); technical references are [architecture](ARCHITECTURE.md), [API](API-CONTRACT.md), [worker](POD-BOOTSTRAP.md), [setup](RELEASE-AND-INFRASTRUCTURE.md) and [workflows](COMFYUI-CHANGES.md).

## 0. Owner-present kickoff: obtain all access first

Collect credentials using the service login flow or ignored local secret files, not chat, committed files or public templates. Reuse working existing access rather than asking for replacement secrets. Verify access with read-only calls before provisioning. Record checks as passed/missing without recording secret values.

| Access or input | Purpose and validation |
|---|---|
| RunPod API key entered through seed setup (or environment) | Standalone setup/operator work: inspect account, templates and volumes; later create/reuse approved storage and inspect/terminate authorized test compute. Verify account and resource IDs. Never give this key to the studio web handler or GPU worker. |
| RunPod console login | Owner deployment workflow and manual recovery. Record selected volume/template and intended GPU class/data center; inspect current state rather than relying on saved snapshots. |
| Hugging Face read/fine-grained token (required by setup) | Check metadata/access to exact required files, including account approval for gated models. A token is not a substitute for accepting model terms. Pass download credentials privately to the worker. |
| Optional Civitai API token and exact selected LoRA version/file IDs | Validate metadata and download entitlement. Obtain the desired mode mappings at kickoff if available; missing assets block final mode acceptance, not unrelated development. Do not purchase assets or select paid subscriptions without explicit authorization. |
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
not approval of the UI design or a request for internet exposure. The installed portal now uses the saved LAN address through the CLI; the original
isolated development preview has been replaced. Recheck availability before reviews.

### Engineering review and communication

At each milestone review the diff for scope, correctness, data loss/duplication, credential handling and regressions. Use focused independent reviewers for the worker/transfer contracts and after M3/M4, as previously requested. Reviewers report concrete defects and missing evidence, not confidence percentages. Address findings before promoting the affected work. Use unit/contract tests for pure logic, browser tests for actual flows, and live GPU tests for model/transfer behavior. Do not write tests that only mirror trivial implementation.

Send concise progress updates during work and a milestone note covering what changed, what was tested, costs/compute state and remaining issues. Owner review is for visible UX/results and material scope changes; ordinary engineering choices and fixes proceed autonomously within authorization. If the owner is away, continue independent work and leave a concrete demo/check-in queued. Do not treat silence as approval for scope expansion or spending above the agreed limit. Keep compute off while awaiting unrelated feedback; retain it for a specifically needed owner handoff test under the current authorization, reporting live cost/state.

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
- **2026-09-09, credential/access clarification:** owner reports entering RunPod key via CLI, signed into RunPod console in Chrome, and expects existing GitHub/GHCR access to be reused. Presence/access still requires verification without exposing values. Setup now requires HF for base models and other assets, with Civitai optional. All three save to per-user credentials.json; .env is optional import only, never an output/synchronized copy. Existing RunPod key is preserved. Setup prints the storage path and skipped/available status. Twelve server/CLI/credential tests pass, including old configuration migration and cancellation. No authenticated provider validation, publication or paid-resource authorization is implied by the login report.
- **2026-09-09, credential simplification (owner clarified):** delete only the repository .env and .env.example, retaining environment-variable and optional .env import support for unattended/container setup. Verified local .env contained no nonempty values before deleting it. No template is shipped and setup never writes an .env; credentials.json remains the one persisted credential store. Existing saved keys untouched. This supersedes the brief proposal to remove import support. Twelve server/CLI/credential tests pass.
- **2026-09-09, current operational authorization:** owner authorizes exactly one active GPU/pod at a time from RTX 6000, RTX 6000 WS, H100 or H200, preferring the cheapest compatible available option. Resolve exact provider SKU/VRAM before selection; do not assume similarly named RTX variants are equivalent. Reuse existing network volume; owner explicitly permits wiping its contents for this implementation, with important material already saved elsewhere. This permits cleanup when needed, not automatic volume deletion/recreation. No numerical spending ceiling supplied; prior requests for one are not an additional gate to this explicit authorization. Record selected rate and resource state for paid work. Shutdown rule revised: retain the pod when an immediate owner handoff test needs it, clearly report that it remains billable and why; otherwise shut down after work. This supersedes unconditional pre-handoff shutdown wording below.
- **2026-09-09, access recheck:** all three credentials are present in the single per-user store; HF identity endpoint returned HTTP 200. RunPod MCP lists the existing 150 GB neil-h3-models volume f7vnixgws1 in EUR-IS-1. GitHub connector authenticates as Skarian. Exact RunPod saved-key validation, GHCR push access and selected model/LoRA download entitlements still need targeted preflight. No GPU started or volume wiped during this check.
- **2026-09-09, owner LoRA download access verified:** read the three owner links from ignored loras.private.json and used the saved Civitai token against the canonical API. Fully downloaded and SHA256-verified four selected files: text-to-image version 3290120/file 3174557 (1,562,410,296 bytes); MiniMax version 3266628 FL file 3150341 (155,095,800 bytes) and Ref file 3156453 (137,654,280 bytes); identity v1.2 version 3139172/primary file 3019297 (1,828,256,432 bytes). The unversioned identity URL resolved to that exact version for this check. Local ignored cache and detailed receipts are under .local/lora-validation/. No token printed or GPU used. Owner requested explicit FL versus Ref support; workflow plan now binds content LoRAs by resolved engine route without a separate user model selector. Download/hash success is not runtime compatibility or output-quality validation.
- **Current owner checkpoint:** refresh the Wi-Fi portal and review upload controls on image-to-image/reference-to-video. Try adding, replacing, removing, roles and clip ranges. Desktop CLI demo: `seed status`, `seed stop`, `seed start`; interactive `seed setup` after stopping offers sign-in startup. Owner's real sign-in and mobile acceptance remain pending. Do not mark M1 accepted before this feedback.
- **Next engineering slice after review:** address UX feedback, finish worker access/spending gates and begin pairing plus one durable image round trip. No expansion to paid model testing until its access/limits are settled. Public proxy support, actual uploads/preparation and richer Library contracts remain unimplemented.


#### M2 - In progress: setup and worker connection

- **2026-09-09, Ready actions simplified:** removed replacement pairing action from Ready/Working/Error. Only an unreachable saved connection offers Connect a pod; unpaired state shows the form directly. Ready retains the quiet Forget connection action. Updated product contract, verified browser screenshots and two connection browser tests (including real DELETE), built and refreshed the installed app. No GPU changes.

- **2026-09-09, Forget connection regression fixed:** browser DELETE incorrectly declared application/json with no body, so Fastify rejected it before the forget handler and showed the generic request error. Send body/content-type only for pairing PUT. Added browser coverage that clicks Forget and forwards the actual DELETE to the real isolated test API, verifies HTTP 200, pairing form, and unpaired status after reload. Previously the API test covered valid DELETE but the UI state test never clicked Forget. Two targeted browser tests, three worker/API tests and production build passed. Updated the installed local app; existing owner pairing is preserved until they choose Forget. Forget removes only the local connection; it does not stop or terminate paid compute.

- **2026-09-09, owner connection UI feedback implemented:** owner reports pairing works well. Simplified the badge to four states documented in STUDIO-MVP: amber Not connected (action needed), blue Working (activity detail plus spinner), bright green Ready, red Error (confirmed failure). Stale readiness cannot stay green; preparation failures surface as errors. Ready hides stale startup text and the code form; Connect another pod reveals it, with Forget connection secondary. No worker API expansion. Visually inspected desktop Ready and mobile activity/error/unpaired screenshots, then the real paired LAN portal in the in-app browser. Production build/typecheck passed; eight browser tests passed with normal process permissions (the sandbox run completed assertions but stalled during teardown and was interrupted). Installed npm artifact updated and existing connection preserved. GPU was not restarted or changed; the retained test pod remains reachable for owner review. Cold-download rate-limit work and M3 generation remain open.

- **2026-09-09, first connection slice implemented:** early aiohttp worker page on 8080; origin-checked unlock, expiring single-use pairing codes, credential rotation and private verifier persistence. PC worker client validates RunPod endpoints, bounds responses, refuses redirects, persists credentials server-side and checks worker identity. Portal connection form clears pasted codes and displays authenticated status. Generation and termination-safety claims remain unavailable until job/output reconciliation exists.
- **Verified locally:** TypeScript and production build, 14 server/CLI tests, three Python worker tests and seven browser tests. Coverage includes expired/replaced/reused codes, concurrent exchange, credential rotation/restart, endpoint rejection, identity mismatch, engine restart during status probing and browser code clearing. Independent review identified expired-cookie recovery and mixed engine-session probes; both corrected. Windows shortcut testing required normal process permissions; rerun passed. No GPU started or image published in this slice.
- **2026-09-09, model preparation slice:** pinned 11 HF files (99.62 decimal GB) from the existing verified inventory. Authenticated HEAD preflight matched expected size and SHA256 metadata for all 11; this is not a cold download test. Added HF-client staging, integrity verification before promotion, completed-cache receipts, interrupted-stage recovery and workspace containment checks. Eight Python tests pass; one real symlink test is skipped on this Windows account because symlink creation requires permission. Review corrected full-file free-space requirements that prevented partial-download resume. Content-LoRA acquisition/activation is still separate unfinished work.
- **Local release:** connection commit `47cb82b`; installed npm package refreshed and LAN portal restarted at http://192.168.1.212:4310. Added a third PC worker test checking browser credential redaction and paused dispatch. No image built/published, GPU started, volume wiped or models transferred to the pod. Existing RunPod pod m6k75q8bdelebh was observed EXITED. Docker Desktop launch failed with access denied opening its backend pipe; owner asked to try opening it normally. GitHub Actions remains an alternative build path, not yet configured for the new worker.
- **2026-09-09, Docker repaired and candidate built:** owner authorized repair/reinstall and computer use. Backed up the stopped 21,034,434,560-byte Docker disk under ignored .local/docker-repair-backup; upgraded WSL to 2.7.13 and Docker Desktop from 4.25.0 to 4.90.0. Engine 29.7.2 pulled and ran the official hello-world container. Existing Docker images/volumes were retained; two existing Hasura containers resumed through their restart policies. Base GHCR digest pulled successfully; actual Comfy commit and torch/aiohttp/HF/Jupyter versions match the planned runtime. Thin local image seed-worker:0.1.0-m2 built without package installation. No RunPod GPU used.
- **Supervisor and hook local evidence:** early page stays available while preparation runs in a child process; missing mount blocks downloads; Jupyter uses its own private credential and health probe; Comfy receives sanitized environment and only the session custom node. Container tests passed real unlock/exchange/replay rejection, missing-volume guard, mounted-volume Jupyter auth, preparation subprocess and expected no-GPU engine failure reporting. Nine Python tests pass, one Windows symlink test skipped; 15 Node tests pass. Full model download and GPU engine startup remain unverified in this candidate. The supervisor is the container lifetime process; do not add an in-container restart loop that silently changes its instance identity.
- **2026-09-09, candidate published:** commits `47cb82b`, `e24b5c7` and `a13e962` are pushed on `feat/studio-mvp`. [GitHub Actions run 34424605550](https://github.com/Skarian/runpod/actions/runs/34424605550) succeeded. Anonymous GHCR manifest retrieval and digest verification passed for `ghcr.io/skarian/runpod-studio@sha256:f98b36acf39888fb6dab4491f5945abc6173c3899d2bb8e180010497bd98e306` (tag `seed-m2-a13e96299d84d954684c34eee8741875e93e9b1a`). Existing template and default image were not changed. Final repair check: Docker Engine 29.7.2 responds, existing Hasura containers report running, and seed status reports http://192.168.1.212:4310. Provider audit still reports pod `m6k75q8bdelebh` EXITED; no GPU started for this work. Preserve the local Docker disk backup until later cleanup is agreed.
- **2026-09-09, owner-requested naming correction:** new worker releases move to `ghcr.io/skarian/seed-worker`. The GitHub source repo stays `Skarian/runpod`; preserve the previous package for the existing template, pinned base and rollback. [Publication run 34425333917](https://github.com/Skarian/runpod/actions/runs/34425333917) succeeded for naming commit `3221545`. Set only the new package public under the existing artifact-publication authorization; source repository visibility remains private. Anonymous manifest retrieval and SHA256 verification passed for `ghcr.io/skarian/seed-worker@sha256:1d53771a426601861e4e395cceca75a0c33b994d5ce9f591759d755ccb1f1370`. README now names this candidate. No runtime-code change or GPU operation.
- **2026-09-09, operator setup implemented:** `seed pod-setup` verifies HF metadata before any storage mutation, saves/reuses volume and pairing/Jupyter secrets, prints the shared candidate template and private-value instructions. `--create` requires an interactive live pricing quote/confirmation; uncertain results retain an intent and reconcile without another POST. Review found unrelated volume selection could erase that intent; corrected and regression-tested. Actual saved-volume setup ran twice successfully for f7vnixgws1 with all 11 HF checks passing, no new storage or compute. Public candidate template tt0cmuwu3t created with no embedded credentials. Supervisor restart documentation now accurately requires fresh pairing. Live GPU proof is next.
- **2026-09-09, live session started:** pod jgglmujwbteb9v, one RTX PRO 6000 Blackwell Server Edition 96 GB in EUR-IS-1, $2.09/hour, existing volume f7vnixgws1. Image pull/start and both HTTPS ports succeeded. All 11 expected files exist under /workspace/ComfyUI/models; used storage about 123 GiB. NFS filesystem free-space reporting describes the shared backend, not this volume's 150 GB quota; do not interpret it as allocatable account capacity. Early pairing to the installed PC portal succeeded while model verification was running; unauthenticated status and consumed-code replay returned 401. Jupyter requires its separate token. Isolated real HF cold download hit CDN HTTP 429 despite the valid token, so cold/resume proof remains open. Added safe, actionable failure classification (including nested HF exceptions) and a private diagnostics record without raw exception URLs/tokens. No unique media modified.
- **2026-09-09, prepared-volume live proof passed:** all 11 model files passed full integrity verification on first startup; Comfy reached Ready on the approved GPU, with required T2I node classes and loader options present. Strict warm preparation with both download and hash functions blocked completed in 0.068 seconds. Linux symlink containment test passed (the Windows equivalent remains skipped for account permission). Live mint-without-revocation, concurrent one-winner exchange, old-credential revocation and lost-response recovery with a fresh code passed. No generation submitted. The first pod jgglmujwbteb9v was terminated; provider list confirmed it absent and the pre-existing pod EXITED.
- **2026-09-09, replacement passed:** nuhyo7bawg960s uses the same volume and published diagnostics image `ghcr.io/skarian/seed-worker@sha256:61e7a3fe301672390b5a8760415de5c99342e3a570f831f7d0b9e0f6d4da780c`. Workspace UUID stayed `12068726-f7ca-40e2-8018-842bc1981599`; worker and engine UUIDs changed. Old credential rejected, fresh code paired the installed portal, Ready observed about 28 seconds after creation; strict warm reuse passed again in 0.062 seconds. The shared candidate template now pins this tested image and exposes three REPLACE_ME fields for required private values. Image build/public pull passed. Node suite: 21 passed. Browser suite: seven passed using the documented .local/browsers cache; the first invocation lacked that environment setting and could not launch its browser. Python suite: 11 passed/one Windows symlink skip; a shared Windows temp-permission failure was resolved by rerunning with an isolated workspace temp directory. The generation-button tooltip now accurately says generation is unavailable.
- **Cold-source failure remains:** isolated actual HF download failed with CDN HTTP 429 on the first pod, again after a five-minute window, and a single resolver probe on the replacement also returned 429. No Retry-After or HF RateLimit headers were supplied. PC metadata preflight works, so it cannot be used as proof of pod download readiness. Do not erase working models or claim blank-volume/resume acceptance. Temporary cold-test metadata is under /workspace/.seed/m2-cold-proof; no complete duplicate model was downloaded. Stop repeated paid retries; resolve source reachability before accepting cold bootstrap.
- **2026-09-09, rate-limit follow-up:** preparation downloads manifest files sequentially; the cold test selected one file. PC preflight checks 11 file headers with concurrency three per invocation, and was rerun during setup verification. The HF client retried the failed request with short backoff (1, 2, 4, 8, 8 seconds); these retries were unnecessary load once throttled. We do not have a complete wire-level request count or evidence identifying the cause/account versus IP scope of the 429. [HF documents five-minute fixed windows](https://huggingface.co/docs/hub/rate-limits). Before repeating cold verification, review SDK retry behavior: honor supplied reset/Retry-After timing, use a cooldown of at least five minutes plus jitter when 429 lacks timing headers, avoid layered retries/repeated preflights, and retain sequential model preparation and resumable staging. This is an outstanding implementation/verification requirement, not a claim that the current image already enforces that fallback cooldown. Do not rotate pods/IPs or credentials to bypass throttling.
- **Current handoff:** replacement nuhyo7bawg960s is retained at $2.09/hour for the immediate owner connection/status walkthrough, under the owner's keep-running-for-testing authorization. Portal http://192.168.1.212:4310 is paired. Generation remains disabled; safe-to-terminate remains unknown until M3 reconciliation. Existing models, inputs and outputs preserved. Commits: operator setup 8927c58, diagnostics e0e552d; final documentation/pin/UI adjustment follows.
- **Remaining M2:** cold model download and interrupted-download recovery on the actual provider path, plus owner deploy/pair walkthrough. Prepared-volume startup, node/model availability, pairing, credential behavior, warm reuse and replacement are verified. New paid-volume creation was tested with a fake provider; this session reused the owner's existing volume and did not allocate more storage.
- **Next owner checkpoint:** demonstrate manual deploy and pairing during preparation after live validation.

#### M3 — In progress: durable image round trip

- **2026-09-09, owner direction:** proceed with text-to-image generation and saved-result UI review, without making rate-limit changes a prerequisite. SFW is the base model; NSFW adds the owner-selected content adapter only. Research official workflows and model/adapter author guidance rather than preserving the old graph by default. Owner stopped the pod; provider audit confirmed both existing pods EXITED before further engineering.
- **Workflow choice:** official Comfy INT8 Turbo baseline, eight Euler/simple steps, CFG1, EmptyLatentImage and ConditioningZeroOut; optional model-only content adapter. No hidden prompt enhancement. Author identifies selected SNOFS v1.4 as LoKR: load/key coverage and useful visible influence require GPU evidence. Strength1.0 is a trial default, not an author recommendation. [Research](../research/workflows/krea2-m3.md) preserves official and author sources plus a two-stage quality challenger for later comparison if needed.
- **Implemented locally:** SQLite v2 migration preserving v1 data; durable idempotent batch submissions, frozen seeds/mode/graph/preset; one serialized dispatcher using native Comfy queue; session-guarded receipt-before-submit, native terminal-history manifests, authenticated output Range streams, PC hash/length verification and SQLite save before worker receipt/cleanup. Missing NSFW preset fails closed. Images appear in results/Library with a full-screen download viewer. Jobs expose generation/save/cancel status and queue pause. Existing video/edit selectors remain disabled for generation.
- **Verification:** 24 Node tests passed; nine existing browser tests plus the new both-mode generation UI test passed. Worker suite:22 passed/one Windows symlink skip. New tests cover duplicate batch keys, seed expansion, base/adapter graph separation, transfer and acknowledgment retries without re-generation/duplicate Library rows, unknown spool work, session replacement, exact receipt, Range, path containment, native enqueue/cancel/terminal hooks. Local Docker image built. Actual pinned Comfy ran in a CPU-only isolated container: built-in EmptyImage→SaveImage produced a terminal manifest and verified digest. Container stopped/removed. This is protocol evidence, not Krea quality/LoRA compatibility evidence.
- **Review corrections:** block unknown unacknowledged spool work before safety/dispatch; distinguish explicit pre-acceptance rejection from uncertain transport failure; fsync output before publishing success; immutable content-addressed preset filenames plus prepared-file receipts checked at submission. A receipt without a terminal manifest now returns409 without acknowledging anything. Pending ambiguities never rerun automatically. Live replacement/transfer and owner-facing acceptance remain open.
- **Preset operation boundary:** M3 includes worker-side operator utility `python -m worker.preset --version ... --file-id ... --sha256 ... --strength 1`, using optional pod CIVITAI_API_TOKEN and exact file verification. SFW remains base-only. The full local `seed presets sync` interface, broad preset editing and remaining video/identity modes remain M4 work; do not imply those are shipped.
- **Local release follow-up:** added explicit acknowledgment of uncertain outcomes so they do not permanently block future work; they are never automatically rerun and late complete manifests remain recoverable. Library cursor pagination/Load more and chronological job pagination implemented. LAN submission keys use getRandomValues (randomUUID is unavailable on ordinary LAN HTTP); retry retains the key on server/network failure. Current local validation:24 Node tests and10 browser tests pass;22 Python tests pass/one platform skip. M3 candidate publication is building from81901f3; no GPU restarted yet.

- **2026-09-09, live M3 proof:** candidate `64813a94f9532657530858c4914b2d24fc476cce3eb546710155128d7aa8db9e` published from81901f3 ([build34431589536](https://github.com/Skarian/runpod/actions/runs/34431589536)); anonymous manifest access verified. Reused nuhyo7bawg960s and f7vnixgws1, one RTX PRO6000 Blackwell96GB at $2.09/hour. Prepared-volume start and fresh pairing passed. Browser-created SFW job01fb5057 and NSFW job4f96d0ed completed with verified local saves and worker cleanup. Fixed seed424242, same fox prompt: adapter attached256 patches, visibly changed the output, and returning to SFW (c160078e) reproduced the original image data exactly. Two-image batch used424242/424243 and saved both. First generation41.73seconds; warm adapter generation2.67seconds. Observed resident GPU memory18,325MiB after generation; not a measured peak or universal model requirement. Actual full-screen results inspected in the browser.
- **Live recovery proof:** isolated local test database used the production dispatcher and real authenticated worker. Native generation8ed50e1b completed into a durable manifest. Injected truncation retained65,536bytes locally without acknowledging the worker; reopened database resumed the actual HTTP Range at65,536. A deliberately lost receipt response left the local image saved; retry completed cleanup. Exactly one engine submission and one Library row; paused idle safety check returnedtrue. This proves process/database reopening and actual transfer/receipt recovery, not an M3 pod-replacement-with-pending-output test. Existing M2 pairing/replacement evidence remains separate. Test fixture/media and detailed evidence stay ignored under `.local/m3-live-recovery*`.
- **Download limitation:** direct Civitai acquisition from this pod returned403 without and with the owner's configured token. A single authenticated resolver request from the PC succeeded; its signed CDN URL downloaded successfully on the pod, and the exact1,562,410,296-byte SHA256-pinned adapter was verified before activation. No token was forwarded to the CDN. Worker-only preset acquisition therefore remains provider-path-dependent; do not claim that the standalone operator utility fully passed. M4's PC preset-sync interface should resolve authorized downloads locally and stage them to the worker, retaining normal verification. No HF rate-limit code changed or new HF download test attempted.
- **Release and handoff:** shared template tt0cmuwu3t now pins the tested M3 candidate; previous M2 digest61e7a3 remains rollback. Commits81901f3/f7f26e1 contain implementation and follow-up. Provider stop returned EXITED for nuhyo7bawg960s after all test outputs were saved/acknowledged; compute is off, retained storage still bills. Four comparison images remain in the normal PC Library at http://192.168.1.212:4310. No image/video/edit workflow beyond T2I was enabled. Approval review rejected the proposed interruption of the owner's running PC server; safer isolated recovery validation above completed instead.

- **Owner test correction, 2026-09-09:** default random seeds failed before submission because `crypto.randomInt(0, 2 ** 48)` exceeds Node's permitted range. Earlier live tests used fixed seeds and missed this default path. Replaced it with six cryptographically random bytes decoded as an exact 48-bit integer. Added a regression exercising actual batch submission, distinct valid seeds, graph propagation and idempotent retry; it reproduced the owner's exact error before the fix and passed afterward. All four job tests and production build passed. Installed PC app updated; worker image and running pod unchanged.

- **Library deletion, 2026-09-09:** owner requested a floating × at the top-right of every Library thumbnail, with confirmation. Implemented native confirmation, same-origin DELETE for any asset kind, on-disk deletion and Library removal, retained job history with removed output references, and retry/error handling. Files still awaiting worker cleanup cannot be deleted. Tests cover confirmation cancel/accept/failure, actual file/record removal, idempotent retry and outside-storage rejection. Nine focused server tests and the mobile browser test passed; production build passed. Desktop Library visually checked with the owner's existing images; none were deleted during verification. Installed app updated; pod unchanged.

- **Generate deletion follow-up:** the same floating red × and confirmation now appear on saved results beneath Create. Deletion updates both views, removes the result card, and keeps failures visible. Both generation and Library browser tests passed; mobile result layout visually checked. Updated the installed PC app without modifying the pod.

- **Library NSFW opt-in:** added Show NSFW, off by default and reset on reload. Uses saved generation mode (including existing job metadata); hidden items do not render thumbnails. Nine focused server tests and two Library browser tests passed. Installed app updated; graceful shutdown stalled after jobs were saved, requiring termination of the verified seed process only. Investigate shutdown latency separately; no GPU change.

- **Media loading / React structure:** extracted reusable MediaCard and LoadingIndicator components for Generate and Library. Lazy images, per-image spinners, fade-in, retry and reduced-motion support. Library loads independently of pod status and distinguishes loading from empty. Staged loading, not low-resolution progressive thumbnails. Four browser tests, typecheck and build passed; mobile loading screenshot reviewed. Applied static web update without restarting server or touching jobs. Continue extracting cohesive React components; select additional libraries for concrete needs.

Next owner checkpoint: inspect the saved SFW/NSFW images and Library viewer on mobile/desktop. Agree on quality/defaults before M4. Remaining M3 acceptance: pod replacement with a pending output, additional quality prompts and owner review; do not convert successful protocol checks into a blanket quality claim.

#### M4 — In progress: video workflows first

Owner priority update: text-to-video and reference-to-video precede image-to-image. Close the Krea variety concern at the owner's request. Implement the shared upload/video output path, FL and Ref graphs, required technical adapters and route-specific content presets; validate live and commit coherent slices. Next owner checkpoint: test video controls/uploads, play and download saved clips, and compare representative results. Image-to-image follows this checkpoint. Record chosen defaults, reference handling and quality feedback separately from technical test results.

### M4 first video slice — owner review ready, 2026-09-09

- Implemented PC originals/prepared-media storage with tus resumable uploads, sharp orientation/normalization, pinned FFmpeg/ffprobe, native FL/Ref graph routing, first/last anchors, generated/silent audio, video playback/download and durable MP4 retrieval/receipt cleanup. The owner-provided FL and Ref content adapters are verified and selected only in the other mode; required turbo adapters remain in both modes.
- Independent review corrected untrusted inline MIME, rotated-photo distortion, stale upload reservations, terminal failure/cancel cleanup and native first-frame conditioning. A second UI review corrected native prompt tags silently changing targets after deletion or role changes; tags now follow stable IDs and missing references block submission. Client raster-format checks reject known unsupported images before upload; server validation remains defensive.
- Local verification: 33 Node tests, 16 browser tests and 24 Python tests pass (one Windows symlink test skipped). Browser coverage includes real tus upload and verified asset bytes, reuse without a duplicate upload, both video modes/audio options, batch/seed/settings, and stable tag remapping. The Windows browser suite needs normal process permissions for clean teardown. Graceful installed-app stop/start passed during both idle upgrades without terminating its process manually.
- Worker candidates were published in coherent commits. Reviewed runtime is `1e56ce0e6c42273d143fc3df16ac7bc854d5971c63add805900bd2f893855fdc` from821b356 ([build34436686831](https://github.com/Skarian/runpod/actions/runs/34436686831)). Anonymous manifest pull and digest verification passed. Initial video proof used candidate dfa92e10; subsequent mixed/long/anchor proof uses the reviewed runtime. M3 digest64813a94 remains rollback.
- Live tests reuse nuhyo7bawg960s with f7vnixgws1, one RTX PRO6000 Blackwell96GB in EUR-IS-1 at $2.09/hour. All base models reused the completed cache. Only the two selected MiniMax content adapters were acquired: exact FL155,095,800bytes and Ref137,654,280bytes, resolved once each through the PC's authorized Civitai session and SHA256-verified on the volume. No HF cold-download/rate-limit retest.
- Completed live evidence: text-only SFW a6ea3a29 (5s landscape, H.264/AAC,120frames); image-reference SFW991600f5 (5s landscape); mixed-reference NSFW252024e5 (image, video with paired audio, standalone audio;5s landscape); text-only NSFW3b695135 (15s portrait,720×1280,360frames, no audio stream). Each completed with verified PC output and acknowledged worker cleanup. Text-only and image-reference playback were inspected in the app; portrait playback scales correctly. First text-only run183.70s including model load; mixed-reference run265.82s;15s portrait476.51s. These are observed runs, not latency guarantees or quality benchmarks.
- Final live check passed: first/last-frame SFW f880ce95,10s landscape,240frames with AAC audio,251.53s native runtime. Browser playback starts with the resting-fox source and ends closely matching the distinct standing-fox last-frame reference. All five jobs have persisted receipts and zero remaining worker input/output files. Paused idle reconciliation returned safe_to_terminate=true with no pending outputs. This proves the exercised anchors, not every possible image combination.
- Scope deliberately remains a first owner-review slice: source-soundtrack replacement/raw native AV retention, full local preset-sync CLI, maximum-count/large-input stress tests, and image-to-image remain follow-up. Inputs from a never-submitted cancellation or definite rejection can remain on the worker without a terminal manifest. Cold-download proof and pending-output pod replacement remain separate M2/M3 gates. Do not claim the entire MVP or all model combinations are accepted.

- Release: shared template tt0cmuwu3t is now named seed worker and pins the reviewed video digest. The CLI uses the same digest. Pod nuhyo7bawg960s remains running for the authorized owner review at $2.09/hour; no second GPU was active. Test clips and inputs remain in the PC Library. Next owner check: upload references, choose modes/durations, play/download clips and review quality before image-to-image. Permanent storage still bills independently of compute.

#### M5 — Not started: acceptance and handover

Next owner checkpoint: perform the daily start/pair/generate/save/terminate flow and review remaining limitations. Record acceptance evidence, release/rollback references and verified final compute state.

## 4. Commit and publication policy

Use named-file staging and review the staged diff, including generated code/config. Before each commit run checks appropriate to the change and check for leaked credentials/private data. Commit coherent pieces as they pass; do not wait until final delivery for a giant commit. Record validation in the commit/milestone notes and clearly distinguish tests not run. Pin runtime/model/dependency revisions and keep generated binaries, models, media and secrets outside Git.

Push according to the kickoff agreement; never force-push or rewrite unrelated history. Publishing a worker image or changing the deployment template is a separate release action, not a consequence of committing. Publish authorized candidate versions, test them and retain the prior working image/template for rollback before promoting the new default. A code rollback cannot substitute for database compatibility/restore checks.

## 5. Paid sessions and completion

Before each paid session verify no other authorized test GPU is active, inspect intended resources and respect the recorded ceiling/budget. Use one pod/one GPU at a time, including replacement tests. After each session, stop/terminate the authorized compute and verify provider state, except when retained for an owner handoff test under the authorization recorded above. Report retained pod/rate explicitly. Record pod ID/final state/time. If shutdown cannot be verified, report it immediately with manual recovery instructions; never claim compute is off from a disconnected UI. Retained volume storage continues billing.

Completion requires live validation across setup, pairing, downloads, transfers, updates and all four workflows, plus a final owner walkthrough and known-limitations record. The app should keep unique media safe, avoid duplicate paid work and accurately distinguish generation/transfer/cleanup outcomes. End with relevant commits recorded, no unexplained authored changes, preserved local-only assets and verified compute off. No numerical confidence claim replaces acceptance evidence.

### M4 owner iteration — Gallery references (2026-09-09)

Added a shared Gallery overlay to every current input/reference field (image-to-image and reference-to-video). It shows selectable thumbnails, selected/existing counts and the maximum, with explicit Select/Cancel actions. Existing inputs consume slots; image editing permits two images, video references permit nine images/three videos/three audio assets and twelve combined. NSFW stays opt-in, and pagination makes older media available. Saved assets are reused by ID rather than reuploaded. Browser decoding still checks whether selected media is usable; regular role/range controls apply after selection.

Saved generation records predate upload-state/duration metadata. Preparation now accepts those durable records and probes video duration when needed. No worker image or GPU changes are required. Verified build, six focused unit tests and two browser tests covering mobile selection limits, opt-in, population and duplicate-free submission. Visually checked the mobile overlay. Image-to-image generation remains deferred as before; its input picker is available for UI review.

M4 gallery follow-up (2026-09-10): owner hit the old upload-state rejection. Installed files contained the fix, but the live server process had started at 23:49 before the gallery release; localhost checks were misleading because Seed binds the LAN address. Verified idle/paused queue and no pending outputs via the configured LAN address, stopped/started Seed, and successfully prepared an existing generated gallery image without a GPU job. Future local upgrades must check the configured bind address and explicitly stop/start the idle server; replacing npm files alone updates static UI but leaves old backend modules in memory.

M4 prompt ownership correction (2026-09-10): removed automatic reference-tag remapping and insertion of `[removed reference]`. Adding, deleting or changing an asset role now leaves the owner's prompt unchanged. Existing validation can flag tags outside the current available references, without editing text. Updated regression expectations; TypeScript check passes. Owner has an active generation and asked to handle live verification themselves: no server restart, installed-app replacement, or GPU work performed. This source change is pending the next safe app update; existing placeholder text cannot be reliably reconstructed automatically.

### Generation progress (2026-09-10)

The jobs popup shows a numeric percentage only while a job is generating and its current engine reports sampling steps. ComfyUI's native `progress` event is forwarded unchanged and sampled by the small engine hook; `/comfy/session` carries the most recent prompt ID, sampler node and integer percentage. The PC checks the engine session, prompt ID, expected sampler node and numeric range before attaching `generation_percent` to the job response. Current samplers are node 7 for images and node 11 for video. Older workers omit this optional field and continue showing the status alone. These are actual sampling steps, not an elapsed-time or whole-job estimate: decoding can continue after sampling reaches 100%. Upload and saving states remain text-only. No new endpoint, websocket connection, or progress database table.

Owner requested live validation be left to them. Release includes a successful TypeScript/application build; no additional paid generation was submitted. Worker rollout and final release references are recorded below after deployment.

Progress release deployed: commit 8c61603, GitHub Actions run 34442245918, worker digest `50c326db76108e4619131c180ec29bdea29fdc2a85c2f8db8f57d34c72148674`. Updated existing pod nuhyo7bawg960s and shared template tt0cmuwu3t; CLI pin updated too. Queue was empty and safe before restart. Restored pairing, observed Ready, then restored the originally unpaused queue. Kept the same pod/volume running for owner use ($2.09/hour last recorded rate). No generation submitted. Prior digest `1e56ce0e6c42273d143fc3df16ac7bc854d5971c63add805900bd2f893855fdc` is the rollback.

Progress visibility follow-up: owner reported no percentage during generation. Latest completed job had received 37%, confirming telemetry reached the PC, but UI suppressed the percentage before the first sampling event. Running jobs now show 0% until sampling reports a value. Frontend-only files updated without restarting services; refresh required. This is a sampling indicator, so model loading/prompt preparation remain at 0%. No new generation run.

Owner wording refinement: jobs show "Model loading…" before a positive sampling update, then "Generating N%". This initial label covers model loading and prompt preparation; it is not a separately measured model-loading phase. Frontend-only update applied without restarting the app or pod.

### Private RunPod templates (2026-09-10; supersedes public-template deployment)

`seed pod-setup` creates or updates an account-private template named seed, populated from locally saved worker credentials. The GHCR image remains public. Setup persists templateId beside volumeId, reuses it, updates the image and credentials on rerun, and reconciles uncertain template creation before issuing another create. Template list results omit visibility, so individual GETs confirm privacy. The RunPod API key is never included in worker environment.

Terminated failed pod swyoff3etls55g per owner request; network volume f7vnixgws1 retained. Converted template tt0cmuwu3t to private and renamed it seed before adding saved credentials. No replacement pod started. Eight setup tests pass, including private credential population and lost-response reconciliation. Next launch: select seed, attach the existing volume, choose one GPU, deploy, then pair through port 8080.


### September 10 — per-job hardware measurements

User requested actual usage evidence for GPU selection. Added lightweight worker
execution timing and sampled GPU/host-RAM summaries, persisted in the spool and
PC job snapshots alongside reference counts/bytes and existing exact job settings.
See [measurement semantics and validation](JOB-MEASUREMENTS.md). Local build,
typecheck, seven job tests and fifteen engine/spool tests passed. New worker image
deployment and live GPU sampling remain the next checkpoint; no pod started or
restarted and no claim of retroactive metrics for existing generations.


### September 10 � measurement release published

Owner authorized publication but no pod startup. GHCR build 34510122554 succeeded;
public manifest digest f445e5e50393d2c2845563479e73c68582fbc2f76c7fb2ee28217a6bd243993b
verified anonymously. Private seed template and existing EXITED pod now pin it;
credentials and network-volume mounts preserved. Installed CLI updated and local
server restarted at http://192.168.1.212:4310; jobs API HTTP 200. Eight setup tests
and final build passed. Owner will start the pod and validate actual GPU samples
later; no live measurement claim yet. See JOB-MEASUREMENTS.md.


### September 10 � simplify measurements using native Comfy APIs

Replaced NVIDIA subprocess sampling and custom execution clock with private
Comfy /system_stats snapshots and native history timestamps. Retain only bounded
sampling/aggregation and durable job storage; version 2 explicitly labels Comfy's
reclaimable-cache accounting. Removed GPU activity percentage. Native versions
allowlisted; raw argv not retained. Fifteen engine/spool tests, seven local job
tests and typecheck passed. Publish update without starting compute.


Native metrics release: worker commit 07d68f0, GitHub build 34539333848,
image ghcr.io/skarian/seed-worker@sha256:f7f4453a199ae43aacfdfcd62f089b31cd42f3967e0dc5f3f2bb3bfd4977d054.
Anonymous manifest digest verified; private seed template and existing stopped pod
updated with credentials/mounts preserved. No pod started. Native API submissions
now carry client_id so Comfy emits execution_start even without a browser socket.
Local app accepts both metric versions. 22 targeted tests passed; GPU validation
remains deferred to the owner's next run.

### September 10 — live metrics validation blocked by capacity; temporary migration probe

Owner authorized one GPU and a temporary S3 key, with no application integration.
Existing pod start and replacement allocation in EUR-IS-1 failed. Additional
single-GPU allocation attempts failed for RTX PRO 6000 (CUDA 13.2) in EU-RO-1
and US-NC-2, and H100 SXM (CUDA >=13.0) in EU-NL-1, despite catalog availability.
No new pod was created; no text-to-image or reference-to-video test ran.

S3 access to the existing EUR-IS-1 volume was partially verified: a one-entry
listing and HEAD requests for several pinned models succeeded. Larger listings
and other model HEAD requests hit 15-second read timeouts, including outside the
local sandbox. Full data transfer and throughput were NOT validated. S3 remains
a possible transfer mechanism, not a proven migration solution for this setup.

All three temporary 150GB destination volumes were deleted and list readback
confirmed only original f7vnixgws1 remains. Temporary S3 key revoked in console,
empty key list verified, local secret copy deleted. Original pod q4x2jnxkt81ept
remains EXITED. Existing storage is unchanged; no GPU compute started. Native
Comfy metrics still need the two live generation tests when capacity is available.


### September 10 � shared onboarding and Seed GPU skill

Owner requested a fresh-checkout experience and expanded the skill to both Vast
and RunPod. Replaced separate Vast credential prompting with shared app setup:
`seed setup --provider vast|runpod`; fresh setup defaults to Vast, saves selection,
and preserves keys for the other provider. HF remains required, Civitai optional.
Vast credentials are now also stripped from normal web-server child environments.
RunPod pod-setup explicitly requests its own credentials regardless of selection.

Renamed the skill source from seed-vast to seed-gpu; retained provider-specific
Vast state paths to avoid breaking existing saved state. RunPod instructions reuse
native provider tools for compute and existing private-template/volume setup.
Added a small Node helper for sanitized RunPod status/catalog, automatic pairing
and fresh pre-teardown safety checks. No new provider orchestrator or UI controls.

Cleanup replaced stale README/development instructions and condensed current
infrastructure direction. Retained RunPod code/deployment guides and all research;
removed duplicate old skill source via rename rather than keeping two competing
entrypoints. No user media or private state was deleted.

Validation: build/typecheck, all 39 app tests and 17 Node helper tests passed.
The initial 16 helper tests also passed in a local Linux container with networking off;
an additional successful pairing-exchange fixture passed on Windows.
The Windows shortcut integration needed normal user permissions outside sandbox.
Live read-only RunPod status passed; existing pods were EXITED, no jobs pending.
Portable helpers still require a new full paid lifecycle; no GPU was rented here.
Next user checkpoint: approve a current offer/budget for the live test, then review
fresh-start and LAN access. Earlier manual Vast benchmark remains valid historical
evidence, not validation of the rewritten helper lifecycle.

Installed CLI refreshed from the local npm artifact and normal app restarted at
http://192.168.1.212:4310. Combined seed-gpu installed and validated; superseded
installed seed-vast removed. User data/credentials retained. No paid resources
created or altered. Unrelated regional research note left untouched/uncommitted.


### September 10 - exhaustive repository cleanup and product skill rewrite

Inventoried all 359 tracked files (3,320,015 bytes), imports/literal file references,
exact duplicates, npm dependency uses and local disk categories. Removed 89 retired
files: obsolete installers/acceptance probes, captured job histories/queues, Qwen
deployment hooks and the superseded READINESS review. Current Seed/RunPod support,
legacy pinned startup/editable graphs, useful recovery tools and research retained.
Added ignore rules for future job-capture artifacts; updated legacy documentation
to distinguish current Seed operation from historical deployment evidence.

Deleted 4,467,218,237 bytes of verified local download/test/tool scratch. LoRA
validation receipts remain; their disposable model copies were removed. Docker
recovery backup, user media, credentials, benchmark evidence and cloud storage
were untouched. Seven protected scratch targets could not be fully removed and
are listed in the audit; no permission/ownership takeover was attempted.

Owner clarified the skill must explain the product. Rewrote its entrypoint around
Seed as a personal art studio: what to create, setup, opening the studio, GPU
selection, creative help and ending a session. Provider mechanics live in linked
references. It leaves the studio running for the user's creative session, rather
than treating an assistant reply as a reason to terminate compute.

Validation: all 39 app tests and 17 helper tests pass after deletions; retained
legacy Python helpers parse; no new broken local Markdown links to deleted files.
No production code changed or GPU resources touched. See research/maintenance/
REPO-CLEANUP-2026-09-10.md for inventory, exceptions and scope.


### September 10 - self-contained Seed skill structure

Owner approved skills/seed with SKILL.md, provider/setup references, scripts and
a separate tests directory. Renamed vast helper/reference and updated imports,
current documentation links and test commands; retained per-user/private state
paths to preserve existing sessions. Rewrote instructions for an operator new to
the repo: clone/access, prerequisites, masked setup, local startup, acquisition,
expected status, pairing, queue readiness, teardown and recovery. RunPod provider
tool dependency and remaining live-test limitations are explicit. No new model
guide or product capability added.

Validation: 17 Node helper tests and 3 Python adapter tests pass at their new
paths; doctor confirms build/tools/credential presence; skill links resolve.
No GPU allocated, app restarted or credentials changed.


## 2026-09-10 — Architecture baggage audit

Scanned all 272 tracked files and traced the current entrypoints, dependencies and provider lifecycle. [Audit and prioritized simplification](../research/maintenance/REPO-ARCHITECTURE-AUDIT-2026-09-10.md). Main findings: remove the alternate Vast app launcher/connection restoration, replace remote worker source patching with supported configuration, and retire the old direct-Comfy deployment path while keeping current RunPod support. Research and durable job/media handling remain useful. No runtime changes or GPU operations in this audit. Typecheck and all 17 provider-helper tests passed; paid end-to-end validation remains outstanding.


## 2026-09-11 — One local application launcher

Implemented the first architecture-audit checkpoint. Normal Seed accepts the exact loopback SSH worker endpoint alongside RunPod HTTPS. Deleted the alternate studio.mjs launcher and Vast app restart/backup/restore code; connect and teardown now manage only the tunnel and pairing. Failed exchange retains the prior saved connection; teardown retains the app and connection. Operator docs explain the one-time restart for old launcher installations. The remote worker adapter remains for the next image checkpoint.

Validation: build/typecheck passed; 41 application tests and 20 provider-helper tests passed. New coverage includes normal app startup with saved SSH connection, failed exchange persistence, tunnel-only connect and teardown. Fixed an initialization race in the new restart test found on the first suite run. No GPU rented or stopped; live provider lifecycle still requires an authorized GPU.


## 2026-09-11 — Complete simplification follow-through

Removed the retired direct-Comfy deployment tree (36 tracked files) while retaining current RunPod setup/template/volume support, base-image mirroring and all research. Removed the duplicate rebalanced prompting document. Reduced bootstrap/release runbooks to maintained responsibilities and linked the skill for operating instructions; corrected disposable-disk output semantics and stale skill names.

Worker startup now supports explicit HTTPS/SSH modes and writable absolute workspaces without source patching. Local image build and CPU connection-page smoke tests passed for both modes. Worker tests: 32 passed, one Windows symlink skip. Fixed stale session-test mocks/expectations for existing progress hooks. Remote publication proceeds through the existing GitHub workflow after explicit user authorization; no GPU rental.

The shared worker release pin replaces duplicated image constants. General provider helpers live in common.mjs, with no provider framework. Added npm run verify using existing runners and current-config secret scanning. Dense active modules were formatted for readability without a UI redesign. Build/typecheck, 41 app tests, 20 skill tests and secret scan passed. Browser validation and publication digest are recorded below when complete.


Completion evidence: GitHub run https://github.com/Skarian/runpod/actions/runs/34564842278 published `ghcr.io/skarian/seed-worker@sha256:212ec3c491923e70d6e6c0a621b01c5743894878af873a5fa2e5053dec3c83a8`. Pulled that digest anonymously and verified both connection-service modes in CPU-only network-disabled containers. Updated the single release pin. All 18 browser tests passed; desktop/mobile/viewer screenshots inspected. The remaining live check is model loading and generation on an authorized GPU, not an unfinished source refactor. No existing RunPod template or pod was changed. Net tracked files drop from 272 to 237 for this follow-through; research and user data remain intact.


## 2026-09-11 — Virginia live startup corrections

Reserved Vast instance 50601850, offer 47084317, RTX PRO 6000 S 96 GB/600 W, $1.664/h including 180 GB disk. No other active GPU. Live SSH revealed two issues: quote UserKnownHostsFile for OpenSSH parsing of Windows paths with spaces, and repair ownership/modes of Vast-injected authorized_keys at onstart. Regression tests include real ssh -G parsing. Logs confirmed bad ownership/modes despite matching attached public key. Updated onstart through update_template with explicit existing image; reboot does not regenerate its script. In-place recreation is awaiting user approval after automatic review rejection. Worker/model preparation has not started; no generation submitted.

## 2026-09-11 - Ohio replacement live

User authorized deleting failed Virginia instance 50601850/disk; confirmed absent, local media preserved. Rented only Ohio 50603637 (offer 46296973), RTX PRO 6000 S 96 GB/600 W, 180 GB disk, $1.5833/h plus $0.0078125/GB transfers. Advertised download 32.9 Gbps. SSH startup permissions repair and quoted known-hosts path worked; normal Seed paired automatically without source patching. Fixed duplicate account SSH key registration (Vast HTTP 400): now checks/reuses existing key. All 18 Vast helper tests pass.

All 11 base models (99,624,767,830 bytes) downloaded/verified in 191.19 seconds, effective 521.08 MB/s. Engine Ready; no paid generation submitted. Civitai returned 403 from the GPU host; restoring presets through PC/SSH fallback. GPU remains running for the user's session.

Completion: PC downloaded and SHA256-verified the three configured LoRAs; SSH transferred them and remote preset installer reverified/activated image, FL and ref routes. Local capabilities confirm SFW/NSFW for all three implemented workflows. Empty queue resumed, worker Ready and connected. No generation submitted. Committed/pushed startup fixes. Temporary transfer copies removed; Library untouched.

## 2026-09-11 - PC-owned model setup and token-free VM delivery

Decision: setup acquires all pinned base weights and configured LoRAs on the PC, then pushes missing files to the VM over SSH. No public model endpoint or object store. Hugging Face/Civitai/provider keys remain local on new launches; only pairing/Jupyter credentials go to workers. Existing Ohio worker and its already-provisioned credentials remain unchanged to preserve the creative session.

Implementation: server/model-cache.ts uses standard app data/models, bounded ranged downloads (up to three files concurrently), partial resume, SHA256 verification and warm receipts. seed setup and pod-setup prepare the cache; seed models resumes/updates it while Seed runs. Config/model-presets.json pins the user's Civitai version/file, size, hash, route and strength. Imported this user's three previously verified choices. Rent refuses an incomplete cache before allocating. Vast boot checks for an existing worker, sends verified local assets over SSH, activates presets, then starts without source tokens. Shared model-transfer.mjs/model_receiver.py support direct SSH for RunPod as well, but native RunPod SSH provisioning remains operator-managed and needs a live deployment test. Removed obsolete HEAD-only model preflight.

Worker release: GitHub run 34615766667 published ghcr.io/skarian/seed-worker@sha256:3fa0ccbdf10ecc11ea31452f4de353b272700b00d2e360ea7578ab2e310fcd18. Pulled anonymously and tested both connection-service transports with no model-source tokens, no network and no GPU. The worker waits for PC-delivered files when no HF token is present. Legacy token-supplied preparation remains supported for existing deployments.

Verification: full suite passed (45 app, 23 helper, 37 worker, one Windows symlink skip) before removing the obsolete preflight test; subsequent targeted tests passed. Added CDN credential-stripping, resume/hash/path tests and real interrupted/resumed 1 MiB SSH delivery in an isolated VM directory, removed after verification. Confirmed installed CLI help includes seed models, SQLite binding works, and existing app remains running. Source token-free bootstrap/preset transfer does not restart the current worker. Full cold 100 GB PC-to-VM timing is still unmeasured. Initial local 101.48 GB cache population is in progress, not yet complete; this must not be described as completed or used as evidence of cold transfer speed.

## 2026-09-11 — Official Hugging Face downloads on the PC

Replaced the custom Hugging Face HTTP path with the official hf CLI/Xet. Installed hf 1.31.0 and hf_xet 1.6.0 in the official isolated Windows environment; Seed remains Node-based. Civitai retains the existing HTTP downloader. Two files run concurrently with normal Xet parallelism on this 16 GB PC. Credentials are passed through the child environment, never arguments, and other provider credentials are excluded. Pinned commit, size and SHA256 checks remain mandatory before cache promotion. Existing verified files are reused; incompatible old HTTP partials are removed only after replacement verification.

Observed Ethernet receive rates of 123–125 MB/s during transfer, close to this PC's physical 1 Gbps link. This is not an end-to-end throughput claim: the first 13.49 GB Krea and 20.97 GB MiniMax FL files finished download plus verification at 560 and 586 seconds respectively. Remaining cache population continues. PC-to-GPU full transfer speed remains unmeasured. Current Seed app and Ohio GPU were not restarted or changed.

Validation: build/typecheck passed, 48 app tests, 23 provider-helper tests and 37 worker tests passed (one Windows symlink skip). Initial full app run timed out under download load; all passed with a 30-second test timeout, without changing production code or persistent test settings. Installed skill validated. Future setup uses the official CLI, retaining local models and source keys.

## 2026-09-11 — Direct GPU downloads with optional PC fallback

User approved direct-first preparation and an optional PC cache. Setup asks whether to keep a local fallback cache; Yes downloads and verifies all configured base models and LoRAs during setup, No skips local preparation. --cache-models and --no-cache-models support unattended setup; a new unattended install defaults off, reruns retain the saved choice. The preference is saved before downloads to support recovery. Explicit seed models remains available without changing the preference. This user's 14 files / 101.48 GB have all finished local verification and the cache is retained/enabled.

GPU preparation reuses verified remote files, attempts each missing file directly, and only if that fails and fallback is enabled downloads any missing PC copy and transfers it. Disabled fallback produces a retryable error without local model traffic. Manifest integrity validation remains a rental prerequisite; a complete local cache no longer is. Source tokens are supplied per file in SSH stdin and used as Python function arguments, not saved in configuration, argv or provider templates. Errors are redacted and Civitai credentials are not forwarded on CDN redirects. Host administrators can still inspect process memory. No public endpoint or persistent token broker was added. The helper uses the existing published worker's HF library; no new container release is needed.

At the user's request, destroyed Vast instance 50603637 and its disk after the helper confirmed output safety. Provider status showed no instances afterward; local Library and cache remain. No replacement GPU is authorized yet. RunPod can use the same SSH preparation helper; automated RunPod SSH provisioning remains outside this checkpoint.

Verification: setup choice persistence and download invocation/skip tests; helper tests for warm remote files, direct success, cached fallback, missing-local fallback, and disabled fallback; Python integrity, interrupted transfer and Civitai redirect credential tests. Live combined cold startup and complete PC-to-GPU timings remain for the next authorized GPU. Do not describe those checks as completed based on earlier direct-download benchmarks.

Completion evidence: full verification passed: build/typecheck, 49 app tests, 28 helper tests, 40 worker tests and one Windows symlink skip; no secret matches. Installed CLI modules and operating skill updated/validated without restarting the web app. Saved this user's localModelCache=true. Seed remains reachable at its existing LAN address; no GPU running.

## 2026-09-11 — Live reference reuse corrections

Live pipeline validation found two pre-submission issues: an earlier global npm install with scripts disabled had omitted FFmpeg, and saved generated videos lacked has_audio metadata when selected as references. Restored the matching FFmpeg binary; setup/start now validate FFmpeg and FFprobe execution. Media.describe lazily probes and persists missing saved-video/audio metadata for the API and reference preparation. The app was restarted only while idle, keeping the GPU/tunnel and saved media intact. Full checks passed: 51 app, 28 helper, 40 worker tests, one Windows symlink skip; no credential matches. Mixed image/video/soundtrack reference generation was accepted after the fix. Remaining live result evidence follows below.

## 2026-09-11 — Direct-first pipeline live acceptance

[Full live report](../research/infrastructure/VAST-DIRECT-FALLBACK-VALIDATION-2026-09-11.md). Vast 50616033 on a single RTX PRO 6000 S 96 GB/600 W; $1.5167/hour. Base models downloaded directly (99.62 GB, 282.48 seconds wall span), three Civitai failures used verified PC fallback; all 14 models verified and presets activated. Full preparation 408.468 seconds after container readiness. Cold-PC fallback and disabled-fallback branches also passed in isolated temporary storage, then cleaned up. Repeated boot reused the worker. All six generation cases (three workflows × both modes, five-second videos) completed, saved and passed content hashes with cleanup complete. Mixed references included a Library image and video with soundtrack; peak VRAM reached 87.6 GiB. No telemetry sample failures. Local media-tool and saved-video metadata issues were corrected in 8c609a7 and pushed. Worker left Ready for owner use; no other active GPU. Long-duration/max-reference benchmarking remains separate.

## 2026-09-11 — Repository review and next priorities

Vast 50616033 and its disk were destroyed on owner request; provider status confirmed no instances. Reviewed current repository shape and documentation drift. The current prioritized review backlog is [TODO](TODO.md): agree on distribution/update UX, rewrite current documentation, make installation/recovery reproducible, complete validation, then identity editing. Code organization is deferred at the owner's request. Last live success required temporary diagnostics/test scripts and a manual FFmpeg repair; do not present it as an unattended clean-install proof.
