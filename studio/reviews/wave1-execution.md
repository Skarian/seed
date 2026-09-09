# Wave 1 — execution and operations review

Reviewed 9 September 2026. Planning only; no infrastructure queried or changed.

**Planning confidence: 88/100.** The overall architecture is appropriate and small. Access-first, one active pod/GPU, persistent outputs, unknown-outcome reconciliation and explicit shutdown are already correctly emphasized. The score reflects specific design omissions below, not a demand for a broader platform or a claim that runtime reliability is measurable before testing.

## Required changes before 95

1. **Bound shutdown blockers.** The current statement that failed output transfer prevents shutdown conflicts with the user's expectation that development sessions end with compute off. Write all generation outputs and a small job manifest under the existing network volume from the outset. If copying to exe.dev fails, retain a `copy_pending` outcome, verify remote persistence, stop compute, and retry retrieval through Runpod S3 or on the next explicitly started session. Do not rerun generation. If persistence cannot be verified, surface that exceptional state; do not claim shutdown completed. Product Stop should stop accepting new jobs immediately so draining is finite. An explicit owner cancellation path remains necessary for a stuck job. This needs only job states and existing adapters, not a watchdog service.

2. **Choose the exact private transport.** Use a pod Tailscale userspace daemon and `tailscale serve --bg --http=8188 http://127.0.0.1:8188`, accessed using the recorded tailnet address and grants for that port. HTTP inside Tailscale avoids an unnecessary HTTPS certificate/MagicDNS enrollment dependency; the browser still has exe.dev HTTPS. Verify this exact arrangement before enabling generation. Do not describe HTTPS, TCP forwarding, TUN and a custom proxy as equal first implementations. TUN is a documented fallback only if the primary path fails. [Tailscale Serve flags](https://tailscale.com/docs/reference/tailscale-cli/serve)

3. **Make the single-controller boundary concrete.** One Compose replica, one SQLite file and one process owner lock. The maintenance CLI should run with the application controller stopped, or invoke its existing operations; never run an independent create loop concurrently. Persist the start-operation marker before calling Runpod. On an unknown create, adoption requires matching both marker and expected volume/template/GPU configuration; any ambiguity blocks another start. The plan already has the algorithm but needs this mundane execution rule to avoid two independently well-behaved tools racing.

4. **Turn startup failure into a cleanup path.** Put finite deadlines around GPU allocation, tailnet enrollment and ComfyUI health. A managed pod that fails readiness must be reconciled and stopped before returning a terminal failure or attempting a replacement. Preserve volume files and diagnostic logs. Cancellation during Start has the same cleanup behavior. A `Needs attention` badge alone must not strand a known, owned idle GPU.

5. **Pin the initial operating choices.** Keep the exact existing GPU, datacenter, volume and pinned image; configure a mandatory current hourly ceiling at access setup. Do not invent a rate from the historical guide. List actual `allowedActions` during access setup to select supported stop versus terminate. Preserve the current authenticated admin route during acceptance. The current guide explicitly says the GHCR cold start has not been tested, so this is an early live gate, not a proven baseline. [Runpod state transitions](https://docs.runpod.io/api-reference-v2/pods/trigger-a-pod-state-transition), [network volumes](https://docs.runpod.io/storage/network-volumes)

6. **Fix the access checklist wording.** Request a Runpod API key usable by the deployed backend, not only an interactive MCP login. Tailscale needs tagged enrollment authority and an explicit renewal/re-enrollment procedure for an expired persisted pod identity. S3 credentials are separate and should first prove a read/list against the existing volume. Verify exe.dev's private proxy and its authenticated identity header using logged-out and logged-in browser checks; do not build a second account/password system. [exe.dev proxy](https://exe.dev/docs/proxy)

## Removals and simplifications

- Remove session cost-estimate UI from required v1. Show elapsed runtime and the configured offered rate if available; computing accurate aggregate costs is unrelated to generating media. Provider console remains billing authority.
- Do not create a custom resumable transport. Use the maintained tus browser/server packages if the API review confirms their fit. No queue broker, external scheduler or separate worker is needed.
- Do not require cross-device synchronized drafts for the first delivery. A per-workflow local draft and durable job settings meet refresh/reuse needs; cloud draft editing can follow if the user actually needs it.
- Do not add provider abstraction, multi-region copies, automatic GPU-type search, object storage for all media, Kubernetes, MCP, an LLM or a second maintenance pod.
- Keep deployment to one application container plus host Tailscale. Existing Docker Compose and exe.dev login are sufficient. Do not add another proxy or identity service.
- Backup should be a documented SQLite-consistent snapshot plus file copy to an owner-selected separate destination. No backup platform required.
- LoRA synchronization should use ordinary proven download tooling and a small manifest resolver; it does not need a registry/database service of its own.

## Off-the-shelf hardware/software judgment

**No new hardware is needed for this MVP.** The existing hosted 96 GB GPU and pinned ComfyUI runtime avoid another hardware compatibility project. A local GPU workstation would alter upfront cost, home availability, power and remote maintenance; it is not a simplification justified by present requirements. Serverless would require packaging and execution changes rather than removing today's work. This is an architectural inference, not a price comparison.

Reuse ComfyUI's own execution queue and HTTP/WebSocket interface, the existing graphs and personal nodes, Docker Compose, exe.dev private HTTPS, Tailscale Serve, SQLite, FFmpeg and established upload libraries. The application owns only user forms, trusted graph bindings, job records and a small lifecycle controller.

## Evidence required during implementation, not extra planning systems

The first live session should prove cold start of the pinned GHCR image, actual stop semantics, private HTTP/WebSocket/transfer, mounted output persistence and one simple existing image/video generation. Finish that session by checking provider state is off. Later sessions add reference combinations incrementally and finish the same way. Browser codecs and H3 guide quality remain explicit live acceptance gates with disabled capability flags until proven.

If the six changes above are incorporated coherently and the stated removals are made or explicitly justified, I expect execution-planning confidence to reach 95/100. That is an expert readiness judgment, not a statistical guarantee of GPU availability or model quality.
