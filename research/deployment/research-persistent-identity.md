# Persistent Tailscale identity for a manually operated pod

Primary-source research, 9 September 2026. Planning only; no live infrastructure.
Accepted direction: the owner starts/stops/replaces compute in Runpod. The frontend
only observes engine readiness and connects to one persistent media identity.

## Verdict

Persisting the complete Tailscale state directory on the existing volume is a lean
way to reuse one identity across **non-overlapping** pod instances. It removes
automatic enrollment, device-discovery and provider control from the application.
Treat it as one movable server, never as cloned concurrent replicas. Stable name/IP
depends on retaining valid state and the existing admin-console device record;
it is not a promise after deletion, logout or a forced reset.

[Tailscale container parameters](https://tailscale.com/docs/features/containers/docker/docker-params)
explicitly say persisted state retains identity through restarts. `TS_STATE_DIR`,
`TS_AUTH_ONCE` and `TS_USERSPACE` configure the official **containerboot** wrapper.
They do not replace flags when launching raw `tailscaled` inside our existing image.

## Minimal raw-daemon bootstrap

1. Require the expected network mount and workspace marker. Create a private
   `/workspace/studio-private` parent only on that verified mount. Apply `umask 077`,
   owner-only directory permissions and consistent container UID. Refuse symlinks
   or insecure ownership on the identity path; keep it outside Comfy input/output
   and any Jupyter/static publicly served tree.
2. Acquire the shared workspace lifetime lock **before starting tailscaled, reading
   its live state through a daemon, invoking ComfyUI, or running startup mutations**.
   If unavailable or unsupported, exit with a clear log; do not fall through into
   the old launcher. The user then stops the failed duplicate pod in Runpod.
3. Under the lock, launch the pinned daemon with explicit settings:

   ```sh
   tailscaled \
     --tun=userspace-networking \
     --statedir=/workspace/studio-private/tailscale \
     --state=/workspace/studio-private/tailscale/tailscaled.state \
     --socket=/run/studio-tailscale/tailscaled.sock \
     --encrypt-state=false
   ```

   The socket is local/ephemeral; identity is persistent. Use the same `--socket`
   argument for all CLI calls. State/preferences/keys live in the designated state
   directory; the default file is `tailscaled.state`.
   [Raw daemon flags](https://tailscale.com/docs/reference/tailscaled).
4. On first setup only, enroll non-ephemerally with the chosen stable hostname and
   `tag:studio-media`. Use a one-use, tagged/preapproved auth key or supervised login.
   Check device approval and Tailnet Lock during this session. Remove the bootstrap
   credential after successful enrollment; ordinary replacement needs no auth key.
5. On later starts, allow existing state to resume, inspect backend state with a
   finite wait, and call ordinary `up` only if intentionally down. Do not use
   `--force-reauth`, automatic logout or reset. If login is required, stop and report
   enrollment needs attention; do not silently create a replacement identity.
6. Reassert private Serve forwarding through the same socket:
   `tailscale --socket=/run/studio-tailscale/tailscaled.sock serve --bg --http=8188 http://127.0.0.1:8188`.
   Start the existing ComfyUI launcher under the same supervising lifetime. Verify
   private HTTP/WS/media transfer; bind ComfyUI loopback as already planned.
7. A small PID1 supervisor retains the lock until **both** daemon and Comfy processes
   have exited. Forward stop signals, wait/reap children, terminate the other child
   if either fails, and then release the lock. Shell `exec` into the old launcher
   must not accidentally abandon lock ownership. Normal shutdown kills processes;
   it does not call `tailscale logout`.

This is a bootstrap specification, not a tested shell script. Test child/signal and
file-descriptor lifetime in a local Linux container before deploying the wrapper.

## State security and validity

Node state contains authentication/encryption keys. Keep directory mode0700,
state files0600, no contents in logs, Git, images or public backup artifacts. Private
backups must not be restored into another running pod. All root processes in the
container can still access the state: permissions do not isolate it from trusted
custom nodes running as that same owner.

Pin a maintained Tailscale version >=1.92.5 and explicitly keep portable Linux state
unencrypted by TPM (`--encrypt-state=false`). Earlier1.90.2–1.92.4 versions enabled
encryption by default on supported hosts. TPM-protected state requires the same
physical TPM and cannot serve this cross-host replacement design. State-file
permissions and restricted volume access are therefore important.
[Secure state documentation](https://tailscale.com/docs/features/secure-node-state-storage).

Non-ephemeral tagged devices normally have node-key expiry disabled. Check the
actual device setting; retagging alone does not necessarily change expiry. An auth
key expiring is distinct from the enrolled node key expiring: already enrolled
devices remain authorized until their node key expires. No persistent OAuth client
or background credential-renewal subsystem is necessary.
[Auth keys](https://tailscale.com/docs/features/access-control/auth-keys),
[tag expiry](https://tailscale.com/docs/features/tags).

`tailscale logout` expires the current login and requires reauthentication next
time. It is inappropriate for ordinary pod stop. Ephemeral nodes can be removed
after inactivity and return with a new IP; they are inappropriate for this identity.
[CLI logout](https://tailscale.com/docs/reference/tailscale-cli),
[ephemeral nodes](https://tailscale.com/docs/features/ephemeral-nodes).

## Duplicate-start semantics

Tailscale detects cloned state as duplicate node keys/same100.x address. The shared
state must not be used as its own mutual exclusion mechanism; Tailscale detection
is not a startup lock or safe failover protocol.
[Official duplicate-state troubleshooting](https://tailscale.com/docs/reference/troubleshooting/network-configuration/multiple-devices-same-100-x-ip-address).

Prefer a **single atomic mkdir lock**
on the same filesystem, with owner pod ID and diagnostic timestamp. This is a
fail-closed ownership marker, not an expiring lease: never steal it based on age,
PID absence on another host, engine timeout, or stale heartbeat. Clean shutdown
removes it only after owned children exit. After a crash, the owner verifies the
old pod stopped/terminated in Runpod, then explicitly clears that lock. Verify
atomic namespace semantics before relying on this fallback. If neither mechanism
is supported, reject startup and resolve the storage path rather than inventing
a distributed lock service.

Nonblocking `flock` on a fixed lock file is an alternative only after actual shared
filesystem/mount locking support is established. Never unlink that file while its
inode may be locked. Local two-process tests do not establish cross-host behavior.
The conservative mkdir marker avoids assuming distributed advisory-lock lease
recovery is safe; its cost is explicit stale-lock recovery after a crash.
[flock filesystem caveats](https://man7.org/linux/man-pages/man1/flock.1.html).

Tailscale Services is an official alternative for a stable virtual service address
backed by changing hosts. It deliberately supports multiple service hosts and does
not establish exclusive ownership of ComfyUI or the shared model workspace. It
adds a service resource, host advertisements/approval and a separate identity
strategy. Retain the agreed shared-state design here; consider Services if multiple
independent backend replicas actually become a requirement.
[Tailscale Services](https://tailscale.com/docs/features/tailscale-services).

An existing lock may be stale, and a missed engine response may mean only network
failure. Neither is evidence old compute has stopped. The frontend cannot claim
GPU off because it only observes readiness. Duplicate startup refusal also cannot
stop Runpod billing automatically: the user must stop that failed pod in Runpod.

## Acceptance before promotion

- Same pod restart retains node identity and the configured endpoint.
- Stop old pod, verify off, then replacement on the same volume retains that identity.
- A second wrapper process fails **before** any Tailscale/Comfy child starts.
- Supervisor crash/stop behavior cannot release ownership while children still run.
- Simulated stale marker takes the explicit manual recovery path, never timed steal.
- Missing/revoked/expired identity reports Needs attention without automatic reset.
- Private Serve supports HTTP, WebSocket and media with loopback ComfyUI.
- No test requires violating the one-active-pod/one-GPU authorization. Cross-host
  lock evidence must come from documented storage semantics or a separately
  authorized non-GPU fixture, not secretly launching a second pod.

This removes more moving parts than it adds: one persistent state directory, one
startup guard, one supervisor. No frontend Runpod key, lifecycle API, node discovery,
OAuth enrollment service, billing monitor or distributed lock server is needed.
