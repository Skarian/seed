# Personal media studio MVP

Scope revision 5, 9 September 2026. The [local application foundation](studio/DEVELOPMENT.md) is implemented; full MVP integration and deployment remain pending. This replaces the earlier LLM-first design. Existing operational instructions remain in [LEAN-SETUP](deployment/LEAN-SETUP.md).

## Product

One persistent studio on the owner's PC, delivered as a local application without requiring Docker. Remote hosting and browser access are owner-managed, outside this project. The working display name is **Studio**. Top navigation is **Generate / Library**, with pod connection and a counted jobs icon at the top-right, each opening a popover; Open RunPod belongs inside connection details. Generate places the workflow selector on the left and SFW/NSFW on the right. Technical graph names, pod addresses and credentials stay behind the API. All workflows include a generation count (default one) and a collapsed Advanced section for random/fixed seed and later supported controls. Multiple generations run as individually tracked sequential jobs. Forms lead with the prompt, include a visible resize handle and reset-current-form control, and use shape-based aspect choices. Omit introductory/tagline copy and fixed output-resolution labels. Show the output panel only after submission, with a logo-only loading placeholder.

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

One reusable setup script installs/configures the app, automatically uses standard per-user data/config/cache directories and creates a shortcut. The preference question is: "Would you like this to start automatically when logged in?" (Yes/No). No folder selection is required. Preferred packaging is a Node.js application with its runtime and media dependencies supplied. Autostart runs quietly; the normal shortcut opens the browser UI. Re-running setup preserves data and avoids duplicate startup entries. RunPod still uses its published container image. Docker may be used to build that image on this PC, but the studio runs without it.

## Deployment and storage

RunPod only, manual deploy/terminate, one published software template and a reusable network volume. A small local setup utility creates/reuses storage, shows current cost before creation, saves volume ID/pairing secret and prints launch instructions. No Terraform, model packaging, external storage service or provider adapters.

Preferred model source is direct Hugging Face download into the volume, with read credentials where needed and explicit exceptions for owner-selected LoRAs. No mandatory local model copies. Keep the GHCR software image and pinned dependency/model manifests. See [source inventory](studio/RELEASE-AND-INFRASTRUCTURE.md).

A port-8080 connection page is available while preparation runs. Unlock with pairing secret, paste a short-lived single-use value into the PC studio, and exchange it for a worker credential. Browser refresh retains the connection; replacement pods require pairing. Jupyter stays separate for administration.

Permanent uploads, prepared media, generated results and SQLite records live on PC disk. A temporary volume spool retains pending completed outputs across replacement. Delete worker copies only after durable local receipt; retry transfers/acknowledgments without duplicate Library entries. No automatic regeneration of ambiguous jobs.

Worker status: Preparing, Ready, Busy, Disconnected. Job progress distinguishes uploading/input saved/sending/queued/generating/retrieving/verifying/saved/cleanup/complete. Safe to terminate requires paused dispatch, no active work and no unsaved outputs based on fresh observation. Cleanup-only failure does not make saved data unsafe. Disconnected is not proof of safety or billing shutdown.

Public hosting, tunnel/VPS, domain, TLS and external browser login are outside the studio project. Deliver a local app with a configurable port, persistent data directory and standard reverse-proxy compatibility. No tunnel choice or deployment gates MVP completion. Pod pairing and authenticated worker transfers remain in scope. PC sleep interrupts studio availability, not RunPod billing.

## Product and delivery boundaries

SwarmUI evaluation and broader UI choices remain separate. Retain four workflow forms/adapters, waiting queue, preset snapshots, Library filters, full native references and meaningful Advanced. Owner-selected LoRAs use the Civitai API, with exact version/file and compatibility records; updates are explicit, not automatic replacement with the latest version. SFW denotes a configured preset, not a content-classification guarantee.

First obtain all access with owner present. Prove setup/pairing during preparation, blank/warm caches and one durable generation/transfer/replacement round trip before broad UI work. Implementation requires authorization for at most one active pod/one GPU and verified compute off at session end. Remove only the verified retired Qwen Rapid checkpoint/redownload hooks then, preserving shared encoders/VAEs.

[Current direction](studio/CURRENT-DIRECTION.md), [bootstrap/pairing](studio/POD-BOOTSTRAP.md), [execution](studio/EXECUTION-PLAN.md), [architecture](studio/ARCHITECTURE.md), [API](studio/API-CONTRACT.md), [graph changes](studio/COMFYUI-CHANGES.md).

No revised deployment is implemented. Current readiness is unresolved; historical percentages do not apply. LLM/Pi, timeline editing, remote object storage and automatic lifecycle remain deferred.
