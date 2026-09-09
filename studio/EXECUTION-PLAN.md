# Implementation plan, checkpoints and acceptance

Revision 6, planning only. This defines how implementation will run; it does not start paid resources, install software, publish images or make commits now. Product scope is [STUDIO-MVP](../STUDIO-MVP.md). Technical references remain [architecture](ARCHITECTURE.md), [API](API-CONTRACT.md), [worker](POD-BOOTSTRAP.md), [sources/setup](RELEASE-AND-INFRASTRUCTURE.md) and [workflows](COMFYUI-CHANGES.md).

## 0. Owner-present kickoff: obtain all access first

Collect credentials using the service login flow or ignored local secret files, not chat, committed files or public templates. Reuse working existing access rather than asking for replacement secrets. Verify access with read-only calls before provisioning. Record checks as passed/missing without recording secret values.

| Access or input | Purpose and validation |
|---|---|
| RunPod API key in local ignored .env | Standalone setup/operator work: inspect account, templates and volumes; later create/reuse approved storage and inspect/terminate authorized test compute. Verify account and resource IDs. Never give this key to the studio web handler or GPU worker. |
| RunPod console login | Owner deployment workflow and manual recovery. Record selected volume/template and intended GPU class/data center; inspect current state rather than relying on saved snapshots. |
| Hugging Face read/fine-grained token, when needed | Check metadata/access to exact required files, including account approval for gated models. A token is not a substitute for accepting model terms. Pass download credentials privately to the worker. |
| Civitai API token and exact selected LoRA version/file IDs | Validate metadata and download entitlement. Obtain the desired mode mappings at kickoff if available; missing assets block final mode acceptance, not unrelated development. Do not purchase assets or select paid subscriptions without explicit authorization. |
| GitHub repository access and GHCR publish/pull access | Verify local Git authentication separately from app/browser login. Reuse the existing image namespace; plan public worker-image pulls without a GHCR read secret on the pod and GitHub Releases for the Windows package. Publishing still requires authorized access. Establish whether pushes are authorized and target branch/review preference at kickoff; local commits do not imply push or publication permission. |
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
| M1: local application | Packaged Node app, built UI shell, standard env-paths storage, SQLite, Windows shortcut and yes/no sign-in startup. No Docker runtime requirement. Test fresh/repeated setup, duplicate launch, stop/restart, existing-data preservation, local-only access and optional proxy configuration. | Show the actual setup and Generate/Library shell. Confirm usability before polishing or expanding the UI. | Local app, then Windows packaging/setup. |
| M2: setup and worker connection | runpod-setup reuses volume ID/secret, shows live storage cost before creation, preflights HF/Civitai access. Pinned GHCR worker/template; port 8080 works during preparation; single-use pairing and progress work. Test blank/warm cache, interrupted downloads, expired/reused codes and lost exchange replies. | Demonstrate deploy → pair while preparing. Present any unavoidable extra user steps. | Setup/source manifest, then worker bootstrap/pairing. |
| M3: one reliable round trip | One real image job goes through native ComfyUI APIs, saves durably on PC and acknowledges cleanup. Reconnect/replacement recovers a deliberately retained completed output. Test copy interruption, duplicate receipt, cleanup-only failure, uncertain submission and safe-to-terminate state. | Show a saved result and recovery behavior. This is the first end-to-end product proof. | Image vertical slice, then recovery/receipt behavior. |
| M4: four expressive workflows | Text/image creation/edit and text/reference video, shared media handling, Library, queue, Civitai preset sync. Test mobile fixtures, reference labels/roles, first/last frames, mixed images/audio/video, legal input budgets, selected/effective ranges, exact exports and meaningful LoRA influence. | Review representative image/edit/video results and controls; owner assesses output usefulness as well as technical correctness. | Separate image, video/reference and preset changes as useful. |
| M5: acceptance and handover | Fresh setup/relaunch, worker replacement, PC restart, disk-full paths, backup/restore, update/rollback and agreed workflow matrix. Verify only the retired Qwen checkpoint/redownload hooks are removed during authorized maintenance. Document start/pair/terminate/update/recover. | Final walkthrough; identify any failed or deferred requirements explicitly. | Acceptance fixes, then release/docs with tested versions. |

M2/M3 paid work begins only after kickoff authorization. Test risky media transfer paths early, comparing native Comfy locally, worker proxy and RunPod outer endpoint. Do not build all UI/workflows around an unproven transfer path. Milestones are dependency order, not speculative calendar promises.

## 3. Review and communication cadence

At each milestone review the diff for scope, correctness, data loss/duplication, credential handling and regressions. Use focused independent reviewers for the worker/transfer contracts and after M3/M4, as previously requested. Reviewers report concrete defects and missing evidence, not confidence percentages. Address findings before promoting the affected work. Use unit/contract tests for pure logic, browser tests for actual flows, and live GPU tests for model/transfer behavior. Do not write tests that only mirror trivial implementation.

Send concise progress updates during work and a milestone note covering what changed, what was tested, costs/compute state and remaining issues. Owner review is for visible UX/results and material scope changes; ordinary engineering choices and fixes proceed autonomously within authorization. If the owner is away, continue independent work and leave a concrete demo/check-in queued. Do not treat silence as approval for scope expansion or spending above the agreed limit. Never leave compute running while waiting for feedback.

Do not repeatedly request credentials or permission already established at kickoff. Interrupt for a real access blocker, unavoidable change to agreed behavior, destructive action outside scope or spending beyond authorization. No automatic restart of ambiguous paid generation.

## 4. Commit and publication policy

Use named-file staging and review the staged diff, including generated code/config. Before each commit run checks appropriate to the change and check for leaked credentials/private data. Commit coherent pieces as they pass; do not wait until final delivery for a giant commit. Record validation in the commit/milestone notes and clearly distinguish tests not run. Pin runtime/model/dependency revisions and keep generated binaries, models, media and secrets outside Git.

Push according to the kickoff agreement; never force-push or rewrite unrelated history. Publishing a worker image or changing the deployment template is a separate release action, not a consequence of committing. Publish authorized candidate versions, test them and retain the prior working image/template for rollback before promoting the new default. A code rollback cannot substitute for database compatibility/restore checks.

## 5. Paid sessions and completion

Before each paid session verify no other authorized test GPU is active, inspect intended resources and respect the recorded ceiling/budget. Use one pod/one GPU at a time, including replacement tests. After each session, stop/terminate the authorized compute through the supported operator path and verify the provider state, even when tests fail. Record pod ID/final state/time. If shutdown cannot be verified, report it immediately with manual recovery instructions; never claim compute is off from a disconnected UI. Retained volume storage continues billing.

Completion requires live validation across setup, pairing, downloads, transfers, updates and all four workflows, plus a final owner walkthrough and known-limitations record. The app should keep unique media safe, avoid duplicate paid work and accurately distinguish generation/transfer/cleanup outcomes. End with relevant commits recorded, no unexplained authored changes, preserved local-only assets and verified compute off. No numerical confidence claim replaces acceptance evidence.
