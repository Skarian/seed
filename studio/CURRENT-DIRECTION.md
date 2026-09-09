# Current studio direction

Revision 5 product direction, 9 September 2026. The [local application foundation](DEVELOPMENT.md) has started; GPU infrastructure/runtime changes remain pending. This replaces the Terraform, exe.dev hosting, GHCR model-artifact and PC model-packaging proposals. Current implementation evidence is in the [milestone journal](EXECUTION-PLAN.md).

## Agreed shape

- Persistent studio on the owner's PC, storing originals, prepared media, generated files and SQLite job/history records outside the application installation directory.
- RunPod only. Manual deployment/termination using one published template and a reusable network volume. No Terraform, provider adapters, automatic GPU shopping, lifecycle controller or duplicate-pod guard.
- A small local runpod-setup utility reads the RunPod key from Git-ignored .env, creates/reuses a volume, asks for data center/capacity, shows current storage cost before creation and prints deployment instructions. Save exact volume ID and pairing secret locally; reruns reuse them. Resolve ambiguous resources instead of guessing by name. Final command spelling remains implementation detail.
- Keep the software image in GHCR, with pinned application/worker dependencies and Jupyter administration. Jupyter is separate from studio authentication.
- Pod connection page on port 8080 starts before model preparation. Unlock with pairing secret; copy a short-lived single-use connection value into the PC studio. The PC exchanges it for a worker credential kept server-side. Pairing works during preparation. No central code-directory service; copied value can include endpoint and opaque exchange token.
- Models/reusable caches live on the RunPod volume. A temporary per-job spool there preserves complete pending outputs across pod replacement. The PC is the permanent media home. Delete worker copies only after durable PC receipt; no S3 credentials or separate storage service.
- Retain the four workflows, full reference inputs, modes, meaningful Advanced, waiting queue, client preflight and resumable uploads. First implementation uses the agreed custom Generate/Library UI; earlier SwarmUI exploration remains a deferred alternative.

## PC application setup

No local Docker requirement. Preferred stack: a packaged Node.js app with bundled dependencies/media tools, started from a Windows shortcut. A reusable setup script automatically creates standard per-user directories via env-paths, creates the shortcut, and asks only the app-startup preference: "Would you like this to start automatically when logged in?" (Yes/No). It creates/removes the per-user startup item accordingly and preserves user data on reruns. RunPod resource/access setup still collects the separately required credentials and volume choices. Docker is allowed as optional developer tooling for the worker image, not required to run the app. No model artifacts are built. Rust/single-executable packaging is optional, not a new requirement. Hosting/router/tunnel configuration remains owner-managed.

## Preferred model-source revision

The latest proposal is direct Hugging Face download on first pod startup, avoiding model copies/artifact packaging on the PC. Core graph filenames were located on Hugging Face; see [source inventory](RELEASE-AND-INFRASTRUCTURE.md). Exact revisions, metadata and actual downloads still need validation. Use the Civitai API for owner-configured content LoRA metadata and downloads; exact model-version/file selections remain pinned. Do not silently restrict the model choices to Hugging Face.

Use a read-scoped HF token when required and preflight gated access before paid preparation. No paid inference API is involved. No full hashes every startup; stage and verify new downloads, reuse completed ones. GPU time during first preparation is accepted. GHCR software pull and HF cold downloads remain external availability dependencies.

## Progress and shutdown

Worker status: Preparing, Ready, Busy, Disconnected; preparation failures have explicit reasons. Job progress: Uploading → Input saved → Sending to GPU → Queued/Generating → Retrieving output → Verifying and saving → Saved, cleaning up → Complete.

Generation, transfer and cleanup failures remain distinct. Safe to terminate requires dispatch paused, no active generation and no unsaved outputs, based on a fresh worker observation. Cleanup-only failures after durable receipt do not mean data is unsafe. Disconnected means safety/billing state is unknown. The product never terminates pods itself.

## Hosting boundary

The studio runs locally on the owner's PC. Public hosting, tunnels, relay/VPS provisioning, domain/DNS configuration, TLS and external browser login are owner-managed and outside this project. No specific tunnel product is required, and choosing one is not an MVP readiness gate.

The application exposes a configurable HTTP port, keeps data in a persistent directory outside the installation, and supports ordinary reverse-proxy operation: configured public origin when used, explicit trusted-proxy settings, correct streamed/Range responses and resumable uploads. Bind to loopback by default. Public exposure requires an owner-provided authenticated access boundary; do not trust arbitrary identity/forwarding headers or add a bespoke account system. Preserve origin/CSRF checks within the app.

Pod pairing and authenticated PC↔RunPod requests remain studio responsibilities. They do not depend on the owner's browser tunnel. Acceptance covers local operation and a representative proxy compatibility test, not deployment of external hosting infrastructure.

PC availability and upstream bandwidth matter. Gigabit download does not establish gigabit upload or end-to-end throughput; do not promise it outperforms hosted services. PC sleep/reboot pauses studio access and transfers, but does not stop GPU billing. Preserve pending outputs in the volume spool.

## Remaining gates

Source/revision/access inventory including content LoRAs; generic proxy compatibility; single-use exchange expiry/retry behavior; large media transfer proof; blank/warm model-cache proof; durable acknowledgment/cleanup and replacement recovery; frontend fit. All logins first with owner present before implementation, then one authorized pod/GPU at a time and verified compute off after each test session. Historical percentage scores do not establish current readiness.

Owner confirmed shutdown-status semantics, reuse of native ComfyUI execution APIs with narrow pairing/receipt additions, and Civitai API LoRA updates. These are agreed directions; live validation still applies.

## Implementation process

The [execution plan](EXECUTION-PLAN.md) defines the owner-present credential/access checklist, fresh worktree backup and selective cleanup, implementation branch/baseline commit, M0–M5 milestones, owner demos and independent review gates, commit/publication boundaries, spending authorization and verified shutdown. This is process planning only; no credentials were changed, resources started or commits made by writing it.
