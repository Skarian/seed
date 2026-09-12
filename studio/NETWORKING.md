# Reliable worker networking

Recommended design after adversarial reviewer waves, September 12, 2026.
Branch: `feat/tailscale-networking`. Implementation authorized by owner September 12, 2026. Low-cost networking-test
instances on Vast and RunPod are explicitly allowed outside normal GPU selection
rules; delete test rental/disk before using intended RTX hardware for generation.
Use one test rental at a time and the previously agreed $10 test cap unless revised. Review findings are in [the review record](reviews/NETWORKING-REVIEW.md).

## Outcome and operating model

Seed remains a local Node app with a separate pinned Python/ComfyUI worker image.
The user starts Seed and the agent acquires one suitable GPU. Seed connects,
prepares missing models and runs generation. Brief disconnections do not stop
remote preparation or trigger duplicate generation. Outputs are removed from the
worker only after durable local receipt or explicit owner discard.

Use two private transports on either provider: OpenSSH port forwarding and
optional Tailscale. Select a route when connecting and reconnect that route after
transient failures. Changing routes is an explicit CLI action against the same
recorded worker. There is no continuous route ranking or automatic cross-route
failover. The app remains disconnected during an unusable route; remote work and
spool files remain intact.

Recommended behavior change: retire RunPod's HTTPS proxy route after direct SSH
and Tailscale are validated there. Current RunPod setup already requires direct
SSH for preparation; this is not removal of a currently SSH-independent setup.
The tradeoff is losing that alternate HTTP reachability path. A single loopback
worker API then serves both providers through either private transport. The owner accepted retiring this route on the experimental branch.

Keep existing pairing and bearer authentication. Do not add an authentication
migration to networking. Public frontend access, Funnel and login are deferred;
LAN browser access remains unchanged. GPU source downloads continue directly to
Hugging Face/Civitai. No exit nodes, remote PC file server or new storage service.

## Reuse existing software

| Responsibility | Chosen approach | Seed owns |
|---|---|---|
| SSH encryption/auth/forwarding | System OpenSSH | Small existing process supervisor, terminal error reporting, explicit stop |
| Tailnet networking/enrollment/startup | Pinned official containerboot, tailscaled and CLI | Configuration, child lifetime, rental association |
| Resumable PC model uploads | Official tusd plus existing tus-js-client, subject to integration gate | Authentication, allowed manifest, hash verification and activation |
| Provider model downloads | Existing HF library and Civitai download helpers | Pinned source policy, two bounded lanes and verified receipts |
| Generated output downloads | Existing HTTP Range and aiohttp FileResponse | Existing local partials, hash check and durable receipt |
| Preparation | Existing worker supervisor plus a singleton desired-state record | Manifest, status and starting Comfy after complete preparation |

Do not add ssh2 or autossh by default. OpenSSH already implements transport;
replacing approximately 50 lines of process supervision does not justify another
client and Windows packaging burden. Do not build our own tailscaled/up/Serve
reconciliation loop: containerboot already does that. tsnet would add a Go
component without a demonstrated benefit here.

One added upload subprocess is preferable to maintaining a new resumable upload
protocol. The reviewed aiohttp tus candidates did not establish a maintained,
suitable drop-in server; do not select one merely for matching our framework.
If tusd integration requires duplicating its offset/locking engine, stop and
reassess before implementation. No custom HEAD/PATCH protocol as a silent fallback.

## Startup and identity

Provider startup launches the existing worker supervisor and authenticated API
before models exist. Fix Vast onstart/runtype to actually launch that supervisor;
remove the separate boot/PID/env helper once verified. Initial pairing remains
unlock/code/exchange; the CLI performs it, then requests preparation. Jupyter
remains on its existing administrative path and must not gate worker readiness.

SSH is the initial trust/bootstrap route for both providers in this recommended
model. Through that authenticated worker connection, read its local Tailscale
peer ID/address when enrollment completes. Match it to the recorded rental,
then verify worker/workspace identity over the proposed route before adopting it.
This avoids a device-discovery API and broad device-management permissions.
Explicit limitation: an initial authenticated SSH connection is required even
when the session will subsequently use Tailscale. Tailscale reconnect does not
need an ongoing SSH tunnel once selected.

Persist worker identity and bearer verifier in private rental-scoped state across
ordinary process restarts. New rentals get new identities. Preserve workspace
identity and existing job/receipt records; engine session identity changes when
Comfy restarts. Never silently adopt another rental's credentials or replay an
uncertain generation. A worker restart can interrupt inference; network recovery
is not inference recovery.

Use official containerboot in userspace mode with raw TCP Serve to loopback worker
port 8080. Copy matching pinned official binaries and verify runtime dependencies.
Persist rental-scoped node state, use auth-once, and disable unwanted route/DNS/
cluster features. Launch containerboot in its own process group and terminate/reap the group
before restarting it, including after fatal exits. Pass an allowlisted environment
with TS_KUBE_SECRET empty and unwanted proxy/cluster/metrics configuration absent.
Child shutdown must terminate its descendants without taking
down the worker API on an ordinary Tailscale failure. Verify the pinned binary's
raw-TCP configuration without certificate consent. Kernel mode and new tailnet
exposure for Jupyter are excluded initially.

Normal enrollment recommendation: PC-held OAuth credential limited to auth-key
issuance for the worker tag; mint a one-use ephemeral key only when enrollment is
needed. Do not ship reusable enrollment authority or OAuth credentials to rentals.
No separate pilot enrollment system. Manual one-use key input can be used to test
this same path, not maintained as another deployment architecture. Keep node/key
state separate from source credentials; filter enrollment secrets from child
processes and diagnostics. Source credentials remain in memory only.

Allow PC-to-worker access to the intended port, not worker-initiated access to
personal devices. Inspect existing broad grants rather than assuming new tags
restrict them. On authorized teardown delete paid compute/disk first. Rely on
Tailscale ephemeral cleanup, optionally best-effort logout, without device-deletion
API/scopes or a cleanup queue. Offline peers can remain visible temporarily;
that does not represent a retained GPU or continuing compute charges.

## One preparation resource

Extend the current worker API, not a new service or a generation-job framework.

- PUT /worker/v1/preparation: ensure the requested immutable manifest/digest is
  prepared; credentials are transient. An identical request reconciles/resumes
  existing work rather than starting a duplicate.
- GET /worker/v1/preparation: current state, digest, per-file progress and sanitized
  error, plus existing worker/workspace identities.
- POST /worker/v1/preparation/cancel: persist cancellation intent, stop/join writers,
  retain partials. Restart cannot resurrect a cancelled preparation. A subsequent
  explicit ensure request may resume it only with the current control revision
  returned by GET. Cancellation increments that revision; delayed or stale
  pre-cancel PUT requests cannot resume work (return current state/conflict).

Persist only the current desired manifest and control intent atomically. Verified
files and receipts determine actual progress after restart. No operation IDs,
preparation history database, separate resume endpoint or terminal-job API.
After restart, ask for lost source credentials as needed; never journal tokens.
Reject a changed manifest while preparing or ready. Model changes require an
explicit idle restart/reprepare; do not add live mutation/draining machinery.
Preparation and generation admission share a gate so they cannot race.

Reuse existing receiver download, source validation, hash and partial-file helpers
as importable worker code. Preserve supported pinned HF/Civitai sources and preset
activation. Do not expose arbitrary URLs, destinations or shell execution. Start
Comfy only after every required asset and preset is verified/activated. Retire
poll-for-files startup and receiver-copy/SSH-stdin dispatch after parity tests.

## Retain optional PC cache fallback

Preserve the feature the owner already opted into. If direct download fails and
fallback is enabled, stop/join that download before uploading the matching PC
asset. One fallback file at a time; no download/upload race or parallel chunking.
Keep direct-source partials distinct from tus upload state.

Run pinned tusd on loopback behind the existing authenticated worker API; authorize
every request. Restrict upload creation and destination mapping to the current
manifest's hash/size. Persist tus upload identifiers for the current manifest and
use tus offsets/restart behavior, not a second offset journal. Reconcile lost
creation/completion responses. File completion is not model readiness: Seed must
verify full size/hash and atomically promote/activate it. No arbitrary upload UI,
concatenation, deferred lengths or adoption of unrelated partial uploads.

Keep original media upload behavior for this feature; do not migrate every upload
in the application to tus just because model fallback needs it. Output downloads
keep existing HTTP Range and durable acknowledgment. Worker-pull from the PC was
rejected: it adds a PC file service, inbound grants, SSH reverse tunnels and
userspace egress configuration to avoid one local upload subprocess.

## Recovery and speed

OpenSSH handles keepalives; the current supervisor reconnects closed processes.
Add actionable handling for auth/host-key/bind failures and detect a stalled but
open tunnel through existing worker request failures. Stop/recreate that tunnel
only after repeated transport evidence; an engine/preparation error is not a
network failure. Cancellation stops retry. Tailscale owns its network recovery;
Seed does not implement a parallel VPN reconnect engine.

An explicit route change preserves bearer and checks the same worker/workspace
before atomically switching. Clear stale status and reconcile pending work. Never
re-pair, resubmit a paid job or acquire a replacement GPU to repair a route.

Measure actual API traffic on the same host in both directions. Alternate test
order, report cold/warm state, bytes, elapsed time, MB/s, direct/relay status,
small-request latency during transfer and hash results. Use representative frame
batches and a sustained larger incompressible file within the approved budget.
Separate disk/hash costs from network time where useful. No speed guarantees,
arbitrary overall startup deadline or automatic performance-selection daemon.

## Delivery gates and owner check-ins

1. Owner aligns on the recommended operating changes: explicit route selection,
   SSH bootstrap on both providers, retiring RunPod HTTPS, automated scoped
   enrollment and delayed peer disappearance. Cache fallback stays included.
2. Local dependency-fit tests: pinned containerboot raw TCP startup/restart;
   tusd authenticated sequential upload, restart, lost response and hash failure.
   Use isolated test data and generated test keys; never mount PC private keys.
3. Implement singleton preparation and one HTTP client path over SSH first.
   Preserve identity, direct downloads, optional fallback and existing output
   receipts. Test PC/worker restart and disconnected preparation. Remove old paths.
4. Integrate Tailscale configuration/enrollment and explicit route selection in
   existing CLI/provider commands. Pin compatible package/image; fail clearly on
   incompatible old workers. Update skill and operating docs.
5. Within the owner-authorized testing scope and budget, validate both providers' startup,
   same-host transfers/recovery and accurate diagnostics. The current authorization
   permits low-cost networking-only hosts, then intended RTX hardware only if needed.
6. Fresh authorized end-to-end frame generation, durable delivery, Library review
   and confirmed teardown. The prior live test proved generation, not delivery.

Commit coherent tested changes at each gate. Check in for operating-model/UI
judgment and failed feasibility assumptions; run ordinary engineering/tests
unattended within approved scope. Capture failure logs before teardown.

## Evidence and remaining limits

The design is intentionally smaller than the prior review: two transports, one
selected session route, one preparation manifest and official network/upload
binaries. Tests must prove container compatibility, signal/child behavior, auth
scopes, restart semantics and real transfer speed. Review consensus is not runtime
proof. No numerical confidence claim or code-size estimate without implementation.

Historical [first networking review](archive/NETWORKING-FIRST-REVIEW.md),
[feature plan](archive/H3-IMAGE-EDIT.md), [old checklist](archive/TODO.md),
[deferred public access](archive/PUBLIC-ACCESS.md) and [validation](VALIDATION.md)
retain decisions and limits. Latest Vast instance/disk were deleted by owner
request; unsaved test originals were discarded. Live delivery, old final RunPod
bill reconciliation and previously deferred product/platform work remain separate.

Sources checked September 12, 2026:
- [OpenSSH alternative ssh2](https://github.com/mscdex/ssh2)
- [autossh](https://www.harding.motd.ca/autossh/)
- [Official containerboot](https://github.com/tailscale/tailscale/tree/main/cmd/containerboot)
- [Tailscale container configuration](https://tailscale.com/docs/features/containers/docker/docker-params)
- [Tailscale auth-key scopes](https://tailscale.com/docs/features/oauth-clients)
- [Ephemeral cleanup](https://tailscale.com/docs/features/ephemeral-nodes)
- [Connection types](https://tailscale.com/docs/reference/connection-types)
- [tusd releases](https://github.com/tus/tusd/releases)
- [tusd hooks and integration](https://tus.github.io/tusd/advanced-topics/hooks/)
- [tus clients and servers](https://tus.io/implementations)

## Implementation log

September 12: owner authorized implementation, both-provider networking tests and
small test instances outside normal skill GPU rules. Owner also authorized using
the signed-in Tailscale account and adding worker devices. PC Tailscale is running.
Owner approved the restricted policy, which was saved in the Tailscale console.
Personal-device connections remain allowed; only the Seed PC can reach tagged
workers on TCP 8080. Workers cannot initiate connections to personal devices.
Existing SSH and Funnel settings were preserved. The console accepted the policy
and its access tests; the saved tests were confirmed on the Tests page. No worker
device had been added at that policy checkpoint; subsequent validation is below.

Pinned official Docker dependency digests in worker/network-dependencies.json.
Windows Tailscale is 1.102.4; that Docker version tag was unavailable, so the
available official container was resolved and verified as 1.102.3. tusd is v2.10.0.
`npm run test:network-dependencies` passed binary checks and an 8 MiB random-data
upload, 3 MiB checkpoint, container restart, stale-offset rejection, exact resumed
hash and ranged retrieval. Test uses loopback only, no credentials/mounts, and
removes its container. Initial harness failure was a Docker random host-port change
on restart; reading the new mapping fixed the harness. No readiness deadline was
extended and no production code was changed to hide the failure.

This proves dependency behavior only, not worker authentication integration,
Tailscale enrollment/throughput or provider networking. Subsequent integration
evidence is recorded below. No VM/GPU rented during this dependency gate.

Implementation checkpoint: the restricted OAuth credential is stored in the PC's
private configuration, with only auth_keys and the worker tag. Local integrated
worker tests passed over real OpenSSH and Tailscale: early authenticated API,
generation admission gate, upload/restart/resume, stale offsets, corrupt-upload
rejection, full hash verification, lost completion, stable worker and peer
identities, ranged output retrieval and receipt cleanup. First integration attempt
found that tusd needs musl in Ubuntu; the build now installs it and checks both
binary versions. Logs were collected and test containers removed.

One narrow Linux child-ownership launcher closes abrupt supervisor-death gaps;
it has no retries or process discovery. It fences parent death, kills its own
command group and reaps descendants. Linux tests cover abrupt parent death,
leader exit with a leftover grandchild, unrelated siblings, expected-parent checks
and stdin/stdout/exit-code preservation. Source credentials supplied during an
active reconciliation are explicitly reported as unaccepted; the client retries
once after that pass if needed. Model status stops overwriting engine status when
preparation completes.

Shared provider connection/preparation code replaces the copied receiver and Vast
boot/PID/env helper. Both providers bootstrap over SSH; Tailscale route changes
verify the existing worker identity without rotating its bearer or replaying jobs.
The full local suite passed (66 app, 45 operations, 40 Python; one OS symlink skip).
Provider deployment/throughput validation and the updated packaged app are next;
these local results do not establish remote performance or live-provider readiness.

Review follow-up: local integration now also proves half-open upload cancellation
and replacement of a deleted promoted model after restart. Completed uploads are
removed through tusd's API; promotion joins filesystem work before cancellation
returns. SSH bootstrap waits for its detached control endpoint to register, and
RunPod teardown stops its tunnel after confirmed resource deletion. Verification:
66 app, 46 operations, 40 Python tests pass (one platform symlink skip). Container
publication is authorized. Local registry credentials lack packages-write scope;
use the repository's existing Actions publisher with its scoped GITHUB_TOKEN.

Live September 12: Vast host 17800 / test VM 50776245 (RTX 5060 Ti,
$0.15978/hour, 150 GB disposable disk) passed early API, SSH pairing, 64 MiB
random-file transfer with tus-js-client resumption across SSH → Tailscale,
unchanged bearer/identity, output hash checks, route restoration and receipts.
Forced SSH child termination recovered in 2.19 seconds without re-pairing.
SSH 16 MiB upload: 2.004 s; Tailscale remaining 48 MiB: 3.272 s. Downloads:
64 MiB SSH 3.277 s, Tailscale 5.786 s. A direct peer endpoint was observed.
These are short transfer samples, not model download or inference benchmarks.
VM and disk deletion confirmed. Private evidence is in .local/networking.

RunPod EUR-IS-1 test mjm8xqynaivjxd paired successfully. An interrupted upload
retained 15,183,182 bytes and resumed correctly. Tailscale enrollment could not
reach control/login endpoints; independent credential-free HTTPS probes also
failed from that pod, while Hugging Face responded. Collected logs, confirmed no
job records/user outputs, deleted pod/disk and reconciled absence. Another region
must pass before claiming RunPod Tailscale readiness.

Cleanup improvements: generation-model readiness no longer blocks reconciling
outputs or verifying idle shutdown. New dispatch still requires ready models.
Explicit teardown can cancel/join failed initial preparation and accept an
unused-worker proof only from the recorded identity, with an empty local queue,
no pending outputs, empty worker spool and a durable engine-never-started flag.
Missing/old metadata, an engine previously started, or any spool content require
normal reconciliation. The latch lives in existing identity metadata; no new
service. Local suite: 67 app, 47 operations, 41 Python pass (one OS skip).
The package install/start/upgrade/rollback/data-preservation acceptance test passed.

Final candidate publication: Actions run 34709993106 passed. Anonymous GHCR
manifest inspection verified digest 104ec310c1cc38f73b975a3b24a2822ad9d47e9069b7273c4c0bb716221d2bd3;
shared/worker-release.ts pins it. The final local integrated network test passed,
including half-open cancellation, restart/resume, both routes and receipt cleanup.
The final Python suite has 42 passes (one platform skip). Windows package acceptance
passed again; installed app and installed skill were updated, preserving user data.

RunPod follow-up: EU-RO-1 pod 6yhjhxustvhc1a, RTX 2000 Ada, $0.24/hour,
150 GB disposable disk. Early API and SSH pairing passed. SSH uploaded 16 MiB in
3.698 s, Tailscale enrollment/route change took 13.789 s, and resuming the remaining
48 MiB over Tailscale took 4.518 s. The bearer and worker identity stayed unchanged.
However, downloading 64 MiB over Tailscale hit the test's 120-second timeout.
A second bounded comparison verified 8 MiB over SSH in 2.038 s, while Tailscale
received only 6,457,704 bytes before 60 seconds. A direct peer path was observed;
this is not evidence of DERP being responsible. No production timeout was extended.

The full 64 MiB output subsequently passed its hash over SSH in 6.120 s, followed
by acknowledged receipt and worker output cleanup. Forced SSH-child termination
recovered in 3.170 s (authenticated listener returned 401 to an unauthenticated
probe). Collected worker/provider logs and deleted the pod and disk through the
normal CLI. Both provider listings were empty afterward. Vast posted $0.02;
RunPod billing still returned no records, so final charges remain unconfirmed.

RunPod Tailscale bulk-download performance remains an open gate. Similar userspace
proxy symptoms appear in [Tailscale issue 20026](https://github.com/tailscale/tailscale/issues/20026)
and userspace TCP loss recovery in [issue 20893](https://github.com/tailscale/tailscale/issues/20893).
These are investigation leads, not a diagnosis of our connection. SSH is proven
on both providers; Tailscale bulk transfers passed on Vast but not this RunPod host.
Do not silently auto-select routes or claim the both-provider performance gate passed.

Focused review found no concrete Seed routing or file-response bug. Next narrow
experiment: repeat identical downloads on one affected host with aiohttp's
existing AIOHTTP_NOSENDFILE=1 switch, then restore baseline, verifying hashes and
peer paths each time. This isolates sendfile versus buffered writes without
rewriting transfers. If unchanged, collect a Tailscale diagnostic trace rather
than adding speculative MTU, chunking or netstack changes. Not yet executed.

Follow-up executed on September 12 after explicit owner request. A second
EU-RO-1 host reproduced the slowdown. Buffered sending and an in-memory response
did not resolve it; curl was also slow. Packet capture showed unnecessary TCP
retransmissions on the Tailscale userspace path. See the
[full investigation](../research/infrastructure/2026-09-12-runpod-tailscale-throughput.md)
for controlled comparisons, limitations and upstream references. SSH verified
64 MiB in 6.280 s. VM ye7zsefqfzlzj5 and its disk were deleted after logs/capture
and output cleanup. No runtime workaround or automatic route fallback was added.

The owner's old frame test 7214742a-0f79-45ca-93c3-c4a7b056a822 remains recorded
as copy_pending even though the owner authorized discarding its remote files and
deleted that earlier rental. Installation preserved it. Reconcile that historical
record before a new main-app pairing; isolated networking tests did not modify it.
