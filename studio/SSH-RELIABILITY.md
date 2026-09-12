# SSH-only reliability implementation plan

Status: implemented; local and both-provider acceptance passed; owner checkpoint pending. September 12, 2026.
Branch: `feat/tailscale-networking`; keep this experimental branch until the
release/user checkpoint. This replaces the design in [NETWORKING.md](NETWORKING.md).
The previous implementation and investigation remain historical evidence.

## Outcome

Start preparation or submit a job once. After a temporary connection failure,
Seed reconnects to the same worker and completes the operation without an agent
rerunning a command, re-pairing, clicking Resume or resubmitting a generation.
Remote work continues while the PC is disconnected. Files are deleted from the
worker only after durable local save and acknowledgement.

This is recovery from a connection interruption, not a promise to survive rental
deletion or resume interrupted inference after an engine crash. When execution
cannot safely be established, retain the evidence/files and explain the problem.
No new providers, automatic GPU acquisition, transfer service, task queue or
transport plugin framework. Tailscale is removed from Seed.

## Keep and simplify

System OpenSSH remains the sole transport, forwarding loopback port 18080 to the
authenticated worker API. Keep early worker startup, preparation manifests,
official tusd/tus-js-client, stable worker/workspace identity, output manifests,
Range downloads, hashes and receipts. Keep source downloads directly from
Hugging Face/Civitai with optional local-cache fallback.

Three existing owners remain:

| Owner | Responsibility |
| --- | --- |
| `operations/tunnel.mjs` | Reopen the same SSH tunnel; report connecting, usable, or terminal failure; stop cleanly. |
| `operations/preparation.mjs` | Keep one preparation invocation alive through transient faults and reconcile the same manifest/upload. |
| `server/jobs.ts` | Persist and reconcile jobs, retry inputs/output saving/receipts, and prevent duplicate execution. |

Implementation decisions: permanent file failures pause the existing queue, retain
files, and require its existing Resume action after the cause is fixed. There is
no new recovery screen. Preparation watches the existing authenticated local SSH
supervisor control: a temporary SSH reconnect keeps that control alive; a stopped
or replaced supervisor ends preparation with a reconnect instruction.

Small helpers for typed errors, waiting, and transfer bodies are appropriate if
they simplify these modules. Do not put a universal retry loop in provider
`requestJson`: retrying a billable creation request is a different problem.
Do not hold the jobs serialization lock inside a second long-running retry loop;
the existing scheduler owns the next attempt.

## Exact recovery contract

| Interrupted operation | Required behavior |
| --- | --- |
| Worker status/preparation reads | Wait/back off on a transport failure, verify the same authenticated worker, then read again. |
| Preparation manifest PUT, response lost | Read current manifest/revision first; reconcile the same intent. Do not reset cancellation or start a second preparation. |
| PC model-cache upload | Keep the original prepare command alive beyond tus's short retry burst. Reopen the stream and use the same upload ID; HEAD determines the authoritative offset. Verify the complete hash. |
| Reference/input upload | Automatically retry the same job/filename before submission. Whole-file restart is acceptable for this scope and must be reported honestly; partial inputs must never become usable. Validate completion and prevent overlapping attempts from corrupting the destination. |
| Prompt never accepted | After reconciling absence on the same worker/workspace/engine, resend the exact frozen graph/preset with the original job ID. Existing worker lock and journal deduplicate an original request still in flight. |
| Prompt accepted, response lost | Read the existing job/queue/manifest; no new job ID or second execution. A journal entry with no queue/terminal proof remains uncertain, not permission to rerun. |
| Connection lost during generation | Reconcile the same job when connectivity returns; recover its outputs even if generation finished during the outage. |
| Output interrupted mid-body | Retain `.part`, issue an actual nonzero Range request on retry, validate response range/size/hash, and create one Library item. |
| Receipt accepted, response lost | Preserve local completed state. Repeat the same manifest-digest receipt until cleanup is confirmed. |
| App restarted with pending output/receipt | Existing database/partials drive recovery when the app starts; no new jobs or duplicate Library entries. |

Input safety is a small required change, not a new transfer subsystem. Inspection
of the actual local worker image confirmed pinned Comfy commit
`12d5279438bfefc058a269eae805ceab6047777f` parses the multipart body, then opens
the final path with `wb`. Parsing first protects against an incomplete body but
does not make a delayed duplicate's final rewrite atomic to the inference thread.
Replace the thin worker upload relay with a narrow job-scoped input saver:
unique temporary file, expected size/hash validation, atomic publication, existing
identical file acknowledged without rewriting, conflicting content rejected.
Keep the multipart API/response shape and whole-file retry. Validate job UUID and
basename; include extracted audio in the size/hash contract. Hold a short per-path
lock only for final existence check/publication, never throughout upload. Clean
abandoned temporary files; no upload registry or additional resumable protocol.

Worker/engine identity changes, invalid authentication/host keys, invalid protocol
or graph, and full local/remote disk are actionable failures, not endless network
retries. A concrete retryable HTTP response must be distinguished from a permanent
one; preserve sanitized status/error category through wrappers instead of catch-all
"transfer interrupted" messages. For hash failure discard only the corrupt partial,
retry a bounded integrity attempt, then surface repeated corruption for attention.
Engine changes prohibit replay of uncertain inference, but must not prohibit
retrieving a valid terminal output manifest belonging to the same surviving
workspace and the job's recorded original engine session.

Use capped reconnect backoff, retaining the current 1–30 second SSH schedule.
No arbitrary total startup/preparation timeout. Transfer attempts need an idle
progress deadline rather than a ten-minute total file-size limit: abort a body
that stops moving, preserve its state, and let its owner retry. Start with 30 s
without byte progress; a progressing large transfer may take longer. Small
control requests retain bounded response deadlines. Stop/cancel must interrupt
waits and streams; loss of a cancellation response is reconciled by saved state
and revision, not blindly replayed.

The CLI and existing connection/job UI distinguish "retrying automatically" from
"needs attention". Retain existing colors/components; no new dashboard or large
UI redesign. Logs show the operation/job, attempt, timestamps, saved offset and
terminal cause without credentials. Do not describe whole-input replay as byte
resume or a live supervisor process as proof of a healthy authenticated worker.

## Tailscale removal and upgrade

Delete `operations/tailscale.mjs`, `worker/network.py`, Docker binaries/stage,
dependency pins/checks, network enrollment routes, setup prompts, provider route
flags/state branches, and the general route-switching API. Remove unused status
fields and tests that exist only for Tailscale. Keep protocol and SSH tests.

Use a narrow saved-config upgrade, not a compatibility framework. Preserve the
bearer, worker/workspace identity, provider rental, jobs and Library. Normalize a
recognized old tailnet connection to the fixed SSH endpoint but keep operations
inactive until reconnecting the recorded rental and verifying its identity.
Do not crash startup, delete the connection, automatically pair another worker,
or rent replacement compute. Strip only Seed's obsolete route/peer/OAuth fields.
An inactive historical connection remains inspectable when its rental no longer
exists or its image differs from the new pin; preserve evidence and compatibility
checks rather than force an automatic migration to another worker.
Continue filtering retired credential environment names so old environment values
cannot leak into child processes.

Revoke only the exact Seed-owned OAuth client created for this work, and remove
Seed-owned stored copies of those credentials. Leave the PC's personal Tailscale
installation, other devices, and general tailnet policy alone. Worker node state
disappears with its disposable disk. Keep investigation reports and private logs;
never commit packet captures containing authenticated HTTP.

## Milestones and commits

1. **Freeze contract and reproduce gaps locally.** Add deterministic acceptance
   tests around real app/CLI entry points. Show failures for prepare exiting,
   stalled-body recovery, and lost-before-acceptance submission. Audit input
   delayed duplicate/atomic completion before implementing the narrow input saver. Commit
   test infrastructure and failures as a documented development checkpoint.
2. **Implement operation recovery.** Preserve current owners, add only necessary
   classification/progress handling and safe same-ID reconciliation. Run the
   unattended local matrix. Commit independently reviewable fixes with evidence.
3. **Remove Tailscale.** Delete the code/container/config/UI/skill surfaces and add
   the targeted upgrade. Run removal, negative identity and package preservation
   checks. Archive the previous active proposal and update the current instructions.
   Commit the simplification; keep research history.
4. **Publish and validate one candidate.** Publish the worker, verify anonymous
   pull and immutable digest, build a package pinned to it, and run isolated
   installation/upgrade checks. Test the same package/image sequentially on Vast
   and RunPod. Collect evidence before teardown, delete VM and disk, confirm both
   inventories, and record posted versus estimated charges separately.
   If a production fix is needed during live testing, rebuild/publish/pin the
   corrected candidate and repeat affected gates on both providers. Do not combine
   results from different binaries into a single release claim.
5. **Owner checkpoint.** Install the validated package and synchronize the skill;
   preserve and reconcile the previously explicitly discarded historical frame
   job so it does not block pairing. Present the existing LAN UI for a short
   recovery-status/Library review, results, known limitations and clean Git state.
   Do not merge main automatically. Stop for the owner's judgment here or earlier
   only if a real product choice, required credential, or budget limit blocks work.

No VM is needed for planning. Implementation test rentals remain one at a time;
carry forward the approved low-cost networking-test exception and $10 total test
cap after checking spend already incurred. Do not assume a fresh $10 allocation.
Use model-free fixtures for networking. If a genuine model inference test becomes
necessary, delete the cheap test rental/disk first and use authorized suitable
hardware; do not download the full model set merely to test a reconnect.

## Acceptance: operations, not manual recovery demonstrations

Run the real local app scheduler and production `prepare` invocation, OpenSSH,
worker API, tusd, and Comfy submission/journal handlers. A test-only deterministic
Comfy fixture supplies small valid media with controlled execution duration; it
must use real validation, enqueue, completion and spool callbacks. It must not
fake acceptance or bypass the job-admission protocol, and must not ship enabled
in production. Keep existing lower-level protocol tests labelled as such.
Use a real uploaded PNG and `LoadImage` feeding node `9` `SaveImage` with output
prefix `seed/<job-id>/image`. Any test-only readiness/graph override must be
explicit; production acceptance, native enqueue and output callbacks remain real.

The harness can inject faults and observe results. After injection it must not
rerun prepare, issue reconnect/resume, manually call reconcile, switch transport,
or retransmit for the application. Trigger body interruptions from measured byte
progress, not a lucky sleep. Use both a killed SSH child and a test-only transport
blackhole that lasts 75 seconds, beyond the old tus retry burst. Restore only the
network; Seed must finish independently. This duration is a test case, not a
product retry cutoff.

Local matrix:

- Mid-input upload, including a stalled/half-open attempt and a lost success response.
- Delay an old input attempt until its retry completes and generation begins;
  it must not truncate/alter the published file. Verify worker-side input hash.
- Stall only a bulk stream while status requests remain healthy; idle detection
  must abort that stream and its normal owner must retry it.
- Mid-model upload, lost creation/completion response, and preparation polling/PUT failure.
- Prompt loss before acceptance and response loss after acceptance.
- Generation completes while disconnected; exactly one native enqueue.
- Mid-output body failure and app restart with a nonzero local partial.
- Receipt committed remotely with response lost; app restart while cleanup pending.
- Cancellation during reconnect, wrong worker/engine, invalid key, full disk,
  corrupt output and changed upload metadata. No unsafe replay/cleanup.

Repeat core upload, submission, generation-outage, output and receipt cases on
each provider with the same candidate. Negative protocol/config cases can remain
local. Each claimed pass must show same worker/job/seed, exactly one enqueue,
automatic progress after connection restoration, final hashes, one Library item,
receipt ordering, and no active or unsaved work before safe termination. Report
input bytes retransferred separately from resumed offsets for models/outputs.
Record fault/detection/reconnect/progress/completion times. Test watchdogs bound
the experiment and fail a hang; they do not silently change product behavior.
Once the route is healthy again, require an automatic progress attempt within
90 seconds (30 s idle deadline + capped backoff + control/scheduler allowance).
For the fixed fixture, require completion within 90 seconds plus three times its
healthy baseline duration. These are deliberately generous test bounds, not
performance targets or product retry cutoffs; publish actual measured times.

Live generation/model performance remains separate from these networking claims.
If any matrix case fails, retain the host long enough to capture logs and diagnose
the failure; a manual rescue can recover data but cannot turn that case into a pass.

## Resource audit at planning start

Live reads on September 12: RunPod pods `[]`, network volumes `[]`; Vast
instances `[]`, standalone local/network volumes `[]`. Previous test teardown
confirmed disposable disks deleted. No resource required deletion during this
planning pass. Billing can still post earlier usage; empty inventory is not a
claim that historical charges are zero.
