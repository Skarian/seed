# seed MVP

Current infrastructure direction: [agent-operated Vast and RunPod](studio/CURRENT-DIRECTION.md).
The persistent app, generation UI and storage ownership below still apply.
Current setup is in [README](README.md), current implementation evidence in the
[execution journal](studio/EXECUTION-PLAN.md). No Terraform or standalone provider
orchestrator is planned.

## Product

One persistent studio on the owner's PC, delivered as a local application without requiring Docker. Remote hosting and browser access are owner-managed, outside this project. The application name is **seed**. Top navigation is **Generate / Library**, with pod connection and a counted jobs icon at the top-right, each opening a popover; Open RunPod belongs inside connection details. Generate places the workflow selector on the left and SFW/NSFW on the right. Technical graph names, pod addresses and credentials stay behind the API. All workflows include a generation count (default one) and a collapsed Advanced section for random/fixed seed and later supported controls. Multiple generations run as individually tracked sequential jobs. Forms lead with the prompt, include a visible resize handle and reset-current-form control, and use shape-based aspect choices. Omit introductory/tagline copy and fixed output-resolution labels. Show the output panel only after submission, with a logo-only loading placeholder.

### Connection indicator

Four visible states: **Not connected** (amber: action needed), **Working** (blue: activity), **Ready** (bright green: engine available), and **Error** (red: confirmed failure). Connecting, checking, preparing and generating appear as explanatory detail under Working, not additional badge states. Only activity animates; respect reduced-motion preferences. Always include text alongside color, including the accessible name on mobile.

The header and connection popover share the same status. A saved connection is not evidence of reachability; stale/unreachable workers must never remain green. Distinguish an unpaired worker from an unreachable saved worker in the explanatory text. Neither means the provider has stopped billing. Preparation errors override activity; Ready hides all stale preparation messages. Ready describes engine availability, not output-transfer safety or completion of M3 generation integration.

Show the code form when unpaired. Only an unreachable saved pod offers **Connect a pod** to reveal the replacement pairing form. Ready shows status and a quiet **Forget connection** action, with no replacement prompt. Keep **Forget connection** secondary. Invalid code errors stay beside the form without falsely marking an existing healthy worker as failed. Visually inspect the actual browser UI at desktop and mobile widths before handoff, including fixture states where live transitions are impractical; do not disconnect a working pod merely to inspect styling.

Exactly four workflows:

| Workflow | Default engine | Main controls |
|---|---|---|
| Text to image | Krea 2 | Prompt, aspect/size, mode |
| Image to image | Krea Identity Edit | Source, optional subject, edit instructions, framing |
| Text to video | H3 | Prompt, aspect, duration, mode, audio output |
| Reference to video | H3 | Image/video/audio tray, prompt, aspect, duration, mode, audio output |

Start with portrait 9:16 and landscape 16:9, 5/10/15 seconds and 720p video exports. Native generation uses a 768-pixel short edge. Other documented ratios, native export and 4–15-second duration belong in Advanced after validation. Do not imply native 1080p. Seed and meaningful engine controls also belong in Advanced; unsupported/no-effect controls are omitted.

One prompt textarea accommodates action, sound, music and dialogue. Reference-label insertion buttons help describe inputs. No structured prompt editor or automatic LLM rewrite. One image initially defaults to first frame; explicit roles remain intact when more media is added. Mixed references and anchors must be tested before advertised. Full native image/video/audio references are required for delivery; optional time-positioned clip guides can follow.

Uploads and Library work while compute is off. Drafts persist in this browser, per workflow; saved job settings can be reused across devices. Refreshing does not duplicate/cancel a job. Results offer playback, Download, Reuse settings, Edit and Animate; those actions fill a form without starting another job.

## Easy media handling

No arbitrary upload byte or megapixel cap. The browser checks media requirements before transfer, automatically prepares previews and offers inline trimming where needed. Backend preparation converts admitted originals to model-ready derivatives. A large usable photo should simply work. Actual storage exhaustion is an operational condition, not an invented model limit.

There is no Balanced/Detailed control: these were proposed labels for real internal ComfyUI `match`/`max` settings, not established model quality tiers. Start with versioned automatic `match` sizing and compare fidelity before changing it. Preserve originals. Browser inspection cannot establish perfect file integrity or support every codec; ordinary unsupported selections fail locally, later corruption remains an integrity error. Details: [asset preparation](studio/ASSET-PREPARATION.md).

Official H3 limits and installed-node timing rules are distinct. The UI validates the entire selected set and shows effective clip ranges. It never silently drops inputs, changes their roles or lowers requested quality after an error. See [workflow evidence](research/workflows/MEDIA-WORKFLOW-PLAN.md).

## Windows setup

Install Seed from a locally packed npm artifact and use the system Node.js runtime; registry publication remains pending. No desktop wrapper, bundled Node runtime or Windows application installer. `seed setup` initializes standard per-user data/config/cache locations and detects Windows; on Windows it asks "Would you like seed to start automatically when you sign in?" (Yes/No). Rerunning setup can enable/disable one per-user Startup entry and preserves data. Non-Windows setup skips Windows startup integration. `seed start` runs/reuses a background server and prints local/LAN URLs; `seed status` and `seed stop` manage that local process. Sign-in startup stays quiet. Package dependencies must work with the tested supported Node release; setup reports incompatible versions rather than silently changing system Node. RunPod still uses its container image; Docker is not needed to run seed. CLI/package publication remains to be implemented.

## Deployment and storage

The agent operates Vast or RunPod through the seed skill, with one authorized GPU and no provider lifecycle controls in the UI. Vast uses disposable local disk and SSH; RunPod reuses a private template and network volume. RunPod setup shows storage cost before creating anything. No Terraform, model packaging, external storage service or automatic provider failover.

Setup downloads all pinned models and owner-selected LoRAs to the PC. Deployment pushes verified files over SSH, resuming partials and reusing remote copies. Hugging Face and Civitai credentials remain local on new deployments. Initial local setup completes before acquiring compute. Keep the GHCR software image and pinned dependency/model manifests. See [source inventory](studio/RELEASE-AND-INFRASTRUCTURE.md).

A port-8080 connection page is available while preparation runs. The skill unlocks it and exchanges a short-lived single-use code for a worker credential automatically. Manual copying remains a fallback. Browser refresh retains the connection; replacement workers require pairing. Jupyter stays separate for administration.

Permanent uploads, prepared media, generated results and SQLite records live on PC disk. The worker spool retains outputs until local receipt. RunPod volume retention can preserve it across replacement; destroying Vast disk loses unsaved outputs. Delete worker copies only after durable local receipt; retry transfers/acknowledgments without duplicate Library entries. No automatic regeneration of ambiguous jobs.

Worker status: Preparing, Ready, Busy, Disconnected. Job progress distinguishes uploading/input saved/sending/queued/generating/retrieving/verifying/saved/cleanup/complete. Safe to terminate requires paused dispatch, no active work and no unsaved outputs based on fresh observation. Cleanup-only failure does not make saved data unsafe. Disconnected is not proof of safety or billing shutdown.

Public hosting, tunnel/VPS, domain, TLS and external browser login are outside the studio project. Deliver a local app with a configurable port, persistent data directory and standard reverse-proxy compatibility. No tunnel choice or deployment gates MVP completion. Pod pairing and authenticated worker transfers remain in scope. PC sleep interrupts studio availability, not RunPod billing.

## Product and delivery boundaries

SwarmUI evaluation and broader UI choices remain separate. Retain four workflow forms/adapters, waiting queue, preset snapshots, Library filters, full native references and meaningful Advanced. Owner-selected LoRAs use the Civitai API, with exact version/file and compatibility records; updates are explicit, not automatic replacement with the latest version. SFW denotes a configured preset, not a content-classification guarantee.

First obtain all access with owner present. Prove setup/pairing during preparation, blank/warm caches and one durable generation/transfer/replacement round trip before broad UI work. Implementation requires authorization for at most one active GPU; leave a requested creative session running, and verify compute off when the owner ends it. Remove only the verified retired Qwen Rapid checkpoint/redownload hooks then, preserving shared encoders/VAEs.

[Current direction](studio/CURRENT-DIRECTION.md), [bootstrap/pairing](studio/POD-BOOTSTRAP.md), [execution](studio/EXECUTION-PLAN.md), [architecture](studio/ARCHITECTURE.md), [API](studio/API-CONTRACT.md), [graph changes](studio/COMFYUI-CHANGES.md).

Implementation status and remaining live-validation limits are recorded in the execution journal. LLM/Pi, timeline editing, remote object storage and automatic lifecycle remain deferred.
