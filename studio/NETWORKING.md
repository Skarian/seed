# Reliable worker networking

Working proposal, September 12, 2026. Branch: `feat/tailscale-networking`.
Research and owner alignment only; no networking implementation or new GPU rental authorized by this document.

## Objective and decisions

Keep SSH a supported, resilient route. Prefer Tailscale when configured and verified usable. Both must operate the same worker and preserve job identity, credentials, resumable transfers and durable output acknowledgment. The UI should not need to understand the transport. Current scope is private PC-to-GPU networking only, prioritizing measured transfer performance and reliable recovery. Public frontend access, Funnel and login are deferred. The future requirement for browser access without Tailscale remains recorded, not part of this implementation.

One Node package and one pinned GPU worker image remain. No relay service of our own, generic networking framework, new storage service, exit node, or provider migration system. Provider lifecycle commands retain native details. Tailscale software can be in the image; enrollment credentials cannot.

## Implementation boundary agreed with owner

Preparation over the early worker API is part of this networking feature, not a later follow-up. Deliver one preparation implementation for SSH, Tailscale and retained RunPod HTTPS. The container starts its minimal authenticated API before any models exist. Provider configuration supplies startup/enrollment material; the API must not depend on an SSH session to stay alive.

The PC requests preparation with a stable operation ID. The worker owns the task and reports status; disconnecting the PC does not stop a download. Query after reconnect rather than start a duplicate. Keep source credentials in memory, persist only non-secret progress/receipts, and request credentials again if a worker restart loses them. Reuse current receiver download/hash/partial-file logic behind the API. Optional PC fallback uses resumable API upload on either route. Start Comfy only after verified preparation. No arbitrary remote shell endpoint.

SSH is a first-class transport: supervised port forwarding, diagnostics and narrowly necessary bootstrap actions. It does not get a second model-preparation implementation. A killed tunnel may interrupt HTTP but must not kill preparation/generation. Authentication/key failures, transport loss, worker restart and an unknown operation outcome need distinct handling. Existing matching-worker checks and durable output receipts remain shared.

Included: worker preparation API, shared transport selection/recovery, optional Tailscale enrollment, both-provider integration and meaningful failure/transfer tests. Excluded: Tailscale SSH-specific authentication, general remote execution, self-hosted relay/control plane, model artifacts/new storage, automatic GPU replacement and unrelated generation features. Public tunnel/authentication and remote frontend changes are explicitly deferred by the owner. Keep current LAN/browser access unchanged.

## Current implementation, verified from source

| Traffic | Current route | Proposed Tailscale route |
|---|---|---|
| Browser to PC app | Local/LAN HTTP, host and origin checks | Unchanged; public remote access deferred |
| PC to provider APIs | HTTPS, provider credentials stay local | Unchanged |
| Container image pull | Host to GHCR | Unchanged |
| GPU readiness/bootstrap commands | System OpenSSH CLI; Vast installs/starts helper; RunPod gets SSH endpoint from API | Early worker preparation API in this implementation; SSH tunnels carry the same API |
| Model download control and credentials | SSH stdin to Python receiver on either provider | Authenticated preparation API; token only in request/runtime memory |
| Actual model downloads | GPU directly to HF/Civitai using HTTPS | Unchanged, no routing through PC |
| Optional PC model fallback | Binary stdin over SSH, offset probe/hash verification | Resumable HTTP transfer over tailnet; reuse receiver integrity logic |
| Vast worker API, job input/output, progress | HTTP through SSH localhost 18080 to worker 8080 | Same API directly through tailnet |
| RunPod worker API, input/output, progress | HTTPS through RunPod proxy | Same API directly through tailnet |
| Vast Jupyter | SSH localhost 18888 to worker 8888 | Keep existing administration path; new tailnet exposure deferred |
| Worker to ComfyUI | GPU loopback HTTP | Unchanged |

`operations/vast.mjs` spawns `ssh` and `ssh-keygen` through Node child_process; no embedded JS SSH library. On this PC this resolves to Windows OpenSSH 9.5p1. SSH uses a per-provider private key, IdentitiesOnly, batch mode, accept-new dedicated known-hosts file, and a 15-second connection handshake timeout. Vast tunnel adds keepalive every 15 seconds, three missed replies, and ExitOnForwardFailure. `operations/tunnel.mjs` restarts a closed tunnel with 1/2/4/8/16/30-second backoff. Explicit stop cancels retries. This does not retry every bootstrap command or guarantee a live but stalled connection recovers.

`operations/model-transfer.mjs` sends two bounded download lanes through separate SSH commands. Verified files and supported partial downloads are reused on a later boot; an SSH failure currently fails the operation. Do not describe this as automatic command recovery. `operations/runpod-lifecycle.mjs` shares this transfer path. `server/worker.ts` accepts only fixed loopback tunnel or RunPod proxy origins; Tailscale requires an explicit endpoint-validation change. `server/http.ts` accepts one configured local Host/Origin; putting Serve in front alone is insufficient.

## Small abstraction to work toward

A connection module selects and owns a route, returning an endpoint plus the verified worker identity and reporting route health. Implement SSH tunnel and Tailscale adapters; preserve RunPod HTTPS during transition. Selection is separate from job submission and file transfer. Suggested CLI preference: auto, ssh, tailscale (names provisional).

Auto means prefer a configured, reachable Tailscale peer; otherwise use the supported SSH/provider route. Merely finding the Tailscale executable is not sufficient. An explicit tailscale choice should report failure rather than silently change routes. Mid-job fallback may change transport only after confirming it is the same paired worker/workspace; it must not re-pair, submit another job or acquire a replacement GPU. Relay use is visible diagnostic information, not automatically a failure.

Keep these responsibilities small: connection selection, SSH process supervision/command execution, Tailscale peer/service setup, existing worker HTTP client, existing model receiver. Move shared SSH helpers out of Vast-specific code when implementing. No abstract shell-over-HTTP endpoint.

## Resilience contract

- Transport reconnect and operation retry are different. SSH remains supported without Tailscale.
- Retry reads/probes on transient failures with cancellation and progress. Authentication or host-key errors need actionable diagnostics, not endless retry.
- Give preparation a stable operation ID and query it after a lost response. Long-running downloads must survive loss of the control connection; extend the existing worker supervisor with one preparation task and atomic operation journal, rather than another daemon.
- Resume file transfer from a verified remote/local offset and validate final hash. Never blindly replay an upload stream or shell mutation.
- After uncertain generation submission, reconcile its existing ID before retrying; preserve current job ownership checks and durable receipt protocol.
- Distinguish disconnected route, stopped engine, failed preparation and terminal provider state. No arbitrary overall five-minute startup cutoff.
- Capture route type, direct/relay status, request duration, bytes, retries and sanitized failure reason. No tokens or signed URLs in logs.

## Tailscale choices and research findings

Tailscale is encrypted IP connectivity; HTTP and SSH can both run over it. Ordinary OpenSSH over a Tailscale address keeps our key authentication. Tailscale SSH is a different optional SSH server/auth policy feature; it is not required to replace HTTP tunnels. Start without introducing that extra choice.

Userspace networking supports restricted containers without a TUN device. First implementation candidate: explicitly supervise pinned tailscaled in userspace mode and configure private TCP Serve on port 8080 to the existing loopback worker API. HTTP inside the encrypted tailnet retains bearer authentication. The intent is to avoid certificate/HTTPS consent setup on disposable workers; official raw-TCP CLI and general Serve documentation differ in emphasis, so unattended configuration must be proven with the pinned binary before claiming it. Copying binaries into our image does not make official containerboot TS_* environment variables work automatically. Kernel mode is out of the initial implementation; reconsider only if measured userspace limitations warrant a separate decision. It requires appropriate host capabilities and cannot be assumed available on arbitrary Vast/RunPod containers. Validate inbound service routing, direct UDP establishment and throughput on both providers before setting the default.

Prefer ephemeral, tagged workers with narrowly scoped access. Proposed automated enrollment: keep scoped enrollment-management credentials on the PC, issue a short-lived single-use auth key per rental, inject only that key at boot. Check provider secret delivery and restart behavior before implementation. Node state must persist privately within the rental, never be baked into the image or reused across independent rentals. Authenticate only if that state is unauthenticated; do not consume a one-use key again on every process restart. Track actual peer identity/address from the rental; no shared hostname lock. Tailnet policy must permit PC-to-worker services while denying new GPU-initiated connections to personal devices. Existing broad policy rules must be reviewed, not assumed safe. Retain worker bearer authentication.

Direct Tailscale connections can avoid the current proxy/tunnel path; relay fallback can be slower. No throughput guarantee and no claim that Tailscale fixes a poor host. No exit-node routing: model sources and provider APIs continue directly over the internet.

Future browser access without a Tailscale client is deferred together with Funnel and authentication. No public frontend changes or tunnel/auth dependency installation in this implementation.

Sources checked September 12, 2026:
- [Userspace networking](https://tailscale.com/docs/concepts/userspace-networking)
- [Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params)
- [Connection types and relays](https://tailscale.com/docs/reference/connection-types)
- [Auth keys and automated enrollment](https://tailscale.com/docs/features/access-control/auth-keys)
- [Ephemeral nodes](https://tailscale.com/docs/features/ephemeral-nodes)
- [Tagged devices](https://tailscale.com/docs/features/tags)
- [Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh)
- [Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Funnel](https://tailscale.com/docs/features/tailscale-funnel)
- [Serve CLI: raw TCP forwarding](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [OAuth scopes](https://tailscale.com/docs/features/oauth-clients)

## Transfer performance priority

No Funnel in any worker traffic path. Direct GPU downloads from HF/Civitai remain the default; only control messages/source credentials cross the PC-worker connection. Optional cached-model uploads and generated-media downloads use the selected private route. Do not route source downloads through the PC or a Tailscale exit node.

Compare direct Tailscale and direct SSH on the same host, with the same representative files, separately measuring PC-to-worker and worker-to-PC. Include small status requests, sustained transfer rate, elapsed time, hash checks and resume after interruption. Report Tailscale direct versus relayed status. A working relay is a recovery option, not proof of a fast route; do not promise Tailscale is faster before measuring. Use the userspace candidate initially; kernel mode requires a separate evidence-based decision. Do not add a benchmark/shopping daemon or self-hosted relay.

Prefer a verified direct Tailscale route when performance is suitable; keep SSH supported and selectable. If both routes perform poorly, report host/network limitations instead of hiding them with retries. Agree route selection from measured results before setting permanent defaults.

## Reviewer consensus: concrete implementation contract

### Startup, identity and endpoint ownership

The existing worker API is extended, not replaced by another service. Provider startup launches it before model preparation; pair through the existing unlock/code/exchange protocol, then prepare using the bearer credential. Vast must no longer wait for model transfer before starting worker.run. Jupyter remains available but its readiness/failure must not gate the worker API or model preparation. Retain RunPod wildcard binding for the supported HTTPS proxy route. Tailscale failure must leave the early API and SSH/provider route alive. Verify Vast runtype/onstart actually enters the image supervisor; do not assume the provider invokes Docker entrypoint unchanged.

Persist worker identity and bearer verifier for the lifetime of one recorded provider rental, in a private rental-scoped state directory. Ordinary supervisor/process restart keeps that identity; Comfy restart changes engine_session_id. Replacement rental always gets a fresh identity and never auto-adopts old credentials/active operations. Persist no HF/Civitai tokens. Restarted preparation re-probes files and reports needs_credentials before resuming with the same operation ID. A restart can interrupt generation: do not promise inference resumption or submit a replacement automatically.

Track Tailscale peer device ID and actual address with the provider rental. Accept only that recorded endpoint, verify worker/workspace identity, and reject redirects. A shared hostname or arbitrary address in 100.64.0.0/10 is not identity proof. Route changes reuse pairing. Initial peer discovery comes from the authenticated existing worker route, then is matched to the recorded rental and Tailscale peer. No discovery daemon. Clear cached route status when switching and reconcile pending operations. Old worker images fail with an actionable compatibility message; do not keep two preparation implementations for them. Pin the matching new image/package.

### Minimal preparation API

All routes require the existing worker bearer. Names are the implementation baseline, not an extensible RPC framework.

| Request | Behavior |
|---|---|
| PUT /worker/v1/preparations/{id} | Accept immutable manifest and transient credentials; atomically journal ID/digest before starting. Same ID+digest returns existing operation; conflicting digest or another active preparation returns 409. |
| GET /worker/v1/preparations/{id} | State, per-file progress, identities and sanitized errors; authoritative after a lost response. |
| POST /worker/v1/preparations/{id}/resume | Supply missing credentials to the same interrupted operation; no duplicate task. Terminal operations are not restarted; retry requires a new ID. |
| POST /worker/v1/preparations/{id}/cancel | Idempotent cooperative cancellation. Join active transfers before reporting cancelled; retain partial files. |
| HEAD /worker/v1/preparations/{id}/files/{sha256} | Current committed upload offset and completion; only assets in accepted manifest. |
| PATCH /worker/v1/preparations/{id}/files/{sha256} | Bounded streaming chunk with expected offset and length. Wrong offset returns 409; re-probe after unknown result. Final size/hash verification precedes promotion. |

One active preparation per worker; lock writes by asset hash so downloads and fallback cannot race. Reuse the two bounded download lanes. Preparation acceptance and job submission must share a mutation gate so checks cannot race. No model/preset mutation during queued or active generation; reject conflicting requests rather than draining jobs silently. Start Comfy only after complete manifest verification and preset activation. States: accepted, running, needs_credentials, needs_upload, completed, failed, cancelled; cancel may be requested while running and is not complete until task exit.

Reuse the existing Python receiver integrity/download functions as a worker module. Keep the operation journal small (atomic JSON, non-secret metadata); no task database/service framework. Validate supported HF/Civitai sources and destinations before acceptance, retain pinned hashes/size and preset activation checks, and do not forward source tokens to arbitrary URLs or cross-host redirects. Read signed URLs/credentials only in memory and redact diagnostics. Full source validation rules are mandatory implementation tests, not a general-purpose downloader feature.

Probe the upload partial after a direct-download failure: provider download staging and PC-upload staging are different files. Count an offset only after a chunk is committed; truncate uncommitted tails after interruption. Stream chunks without buffering a model into RAM. Determine chunk size from the current 1 MiB API limit and real RunPod proxy behavior, using a conservative initial chunk below that limit; widen only after measurement. Separate connection/header deadlines from progress/idle deadlines. Long preparation is not a long-held HTTP request.

### Cut list and evidence gates

Remove the receiver-copy/stdin dispatcher after moving its reusable functions into the image. Convert operations/model-transfer.mjs into the shared HTTP preparation client. Retire operations/worker.py boot/PID/env subsystem once provider startup owns the API. Replace the separate poll-for-model-files gate with the preparation result, including preset activation. Retain WorkerConnection as the single HTTP/bearer owner; make safe-shutdown checks use recorded rental/worker identity instead of assuming endpoint equality.

No new web service, generalized transport/plugin framework, generic shell endpoint, preparation database, automatic benchmarking daemon or simultaneous duplicate transfers. No public frontend dependencies. No Tailscale-specific SSH auth. Keep native provider lifecycle commands and existing worker job/media protocol.

Live feasibility must prove userspace inbound TCP forwarding, peer identity, credential enrollment/restart and realistic bidirectional throughput. Do not assume kernel privileges or direct UDP on arbitrary rentals. Test stalled-but-open SSH as well as a closed process. Terminal key/auth failures stop with diagnostics; transient outages reconnect cancellably. A healthy route change never resubmits a job. Peer disappearance does not authorize a new GPU.

Benchmark the same host/file over both routes, alternate test order, report cold/warm state and transferred bytes, use incompressible data and hash verification. Include at least one representative generated-output batch and one sustained larger transfer within the approved budget. Record direct/relay, elapsed seconds, MB/s, HTTP latency and recovery outcome. Report observed rates rather than inventing an SLA or promising fastest networking everywhere.

## Milestones and review points

1. Align on private worker enrollment, route selection and fallback behavior. Inspect installed Tailscale/configuration without exposing secrets. Confirm needed login/policy access with owner before changes. No install or account changes yet.
2. Prove container service connectivity locally without private-key mounts. Compare SSH and Tailscale transport on representative disposable hardware only with new rental approval. Measure direct/relay route, small request latency and meaningful file throughput; interrupt/reconnect and verify hashes. Do not regenerate models just to benchmark networking.
3. Agree preparation API shape and recovery behavior with owner. Implement the early worker API and move model control/fallback transfer to it on both transports in this release. Remove the superseded SSH-stdin preparation path after parity checks; reuse its Python download/integrity logic. Keep SSH fully tested and avoid retrying unknown mutations. Commit at each coherent tested step.
4. Integrate optional enrollment and route selection into provider lifecycle and setup/doctor; pin a compatible worker image. Test Tailscale absent, offline, direct and relayed, stale peer, wrong worker, revoked credentials and explicit shutdown. Delete the provider rental first when teardown is authorized and safe, then delete the exact recorded Tailscale peer. A peer-cleanup error must never retain paid compute. Revoking an enrollment key alone does not remove an enrolled peer.
5. Verify the existing LAN frontend works unchanged with both worker routes. No public access/login changes.
6. Fresh authorized end-to-end frame export: generation, full durable delivery, Library scrubber/Keep only and confirmed teardown. Record failures honestly; previous live delivery never passed.

## Remaining questions

Public browser access and existing-account login are deferred; see [archived scope](archive/PUBLIC-ACCESS.md). Enrollment decision still needs owner alignment: recommend a manually supplied disposable key only for the bounded local feasibility check, then tag-scoped PC-held automation for normal rental creation/peer deletion. The latter must document exact supported key-issuance and device-deletion permissions before implementation; do not silently expand scopes. Filter enrollment secrets from child environments and logs. No user management dashboard or extra credential service. The reviewed operation and restart contracts below define implementation intent. Container connectivity, provider launch configuration and scoped enrollment need feasibility validation. No 95% readiness claim: container throughput and enrollment are still unproven here.

## Historical work

Previous [execution checklist](archive/TODO.md) and [frame-export plan](archive/H3-IMAGE-EDIT.md) are archived. Main contains frame export and SSH reconnect changes. Latest Vast rental and disk were deleted at owner's request; unrecovered test originals were discarded. Preserve local logs/manifest as generation evidence only.

Carry forward: live frame delivery/Library validation; old final RunPod bill reconciliation; deferred npm publication, macOS validation, identity editing, maximum-reference benchmarks, LLM and timeline work. These do not silently become requirements for networking. Architecture, API and validation documents remain current references and must be updated when implementation changes.

## Review outcome — September 12, 2026

Two passes by three independent reviewers: architecture, recovery/transfer correctness, and execution/Tailscale feasibility. All three support the revised direction; no remaining architectural blocker or material contradiction was identified in their final pass. Root review agrees. This is consensus on design, not proof of live behavior.

Conditions before rollout: unattended pinned userspace forwarding; Vast supervisor startup and retained RunPod HTTPS coexistence; rental-scoped identity/enrollment restart and exact peer cleanup; scoped enrollment permissions; real bidirectional transfer and interruption tests. Confidence is high in the direction, conditional on those measurements. No artificial numerical readiness score.

Only planning documents changed during this review. No account configuration, installed application, worker image or paid resource was changed. Local document links and whitespace checks passed. Enrollment mechanism remains the next owner alignment point; do not interpret this document as rental authorization.
