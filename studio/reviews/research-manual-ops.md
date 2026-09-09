# Manual Runpod operation and shared identity — research

9 September 2026. Planning research only. No pods launched or storage accessed.

## Conclusion

Manual Runpod start/shutdown removes the application provisioning controller, provider key, replacement discovery and idle-stop logic. A single persistent Tailscale identity can move with the workspace **sequentially**. A duplicate startup must acquire workspace ownership before touching Tailscale state, launching ComfyUI, or running installers. This guard protects identity and data; it does not prevent a manually created second pod from being allocated/billed.

Public Runpod documentation does **not** establish cross-host `flock` behavior for the user's volume. Do not present `flock -n` as a proven distributed guard merely because two processes on one pod contend correctly. A conservative owner directory with explicit stale recovery is the lean fallback, but its atomic cross-client semantics still need provider evidence or an eventual permitted independent-client test. The single-pod operating procedure remains the primary constraint until then.

## Primary evidence

- Runpod volumes persist independently of pods, can be shared, and require application handling of concurrent writes. The public page does not specify the mounted filesystem, protocol version or distributed lock guarantees. [Network volumes](https://docs.runpod.io/storage/network-volumes)
- Linux `flock` is advisory and descriptor-bound. NFS support depends on client/server behavior; `local_lock` can make locks local. Locking therefore cannot be inferred solely from a successful syscall. [flock(2)](https://man7.org/linux/man-pages/man2/flock.2.html), [NFS mount options](https://man7.org/linux/man-pages/man5/nfs.5.html)
- `mkdir` rejects an existing path; permission and storage failures are separate errors. Linux documentation also notes NFS protocol complications. This supports a directory-acquisition pattern, not an undocumented Runpod guarantee. [mkdir(2)](https://man7.org/linux/man-pages/man2/mkdir.2.html)
- Tailscale state persisted in a directory preserves a container identity across restarts. Userspace networking is supported. [Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params)
- Tailscale explicitly documents duplicated filesystem state producing duplicate node keys/IP addresses when two systems run concurrently. Sharing state is not an HA mechanism. [Duplicate identity troubleshooting](https://tailscale.com/docs/reference/troubleshooting/network-configuration/multiple-devices-same-100-x-ip-address)
- Runpod currently documents network-volume pods as terminate-only in its management guide, while existing repo observations describe stop. Use the actual console/actions for this pod rather than promise one fixed button. Workspace survives in the network volume. [Manage Pods](https://docs.runpod.io/pods/manage-pods)
- Billing is based on allocated running resources; persistent network storage remains billed separately. A failed service health check or exited shell is not evidence that Runpod released the GPU. [Pod pricing](https://docs.runpod.io/pods/pricing), [Billing](https://docs.runpod.io/accounts-billing/billing)

## Recommended startup contract

1. Confirm expected mounted workspace and ownership directory parent. Never create an empty substitute workspace.
2. Acquire one guard before Tailscale, ComfyUI, model synchronization, nginx/Jupyter and upstream mutable startup. Unknown guard/storage errors fail closed.
3. Only the owner reads/writes the fixed private Tailscale state directory. Keep state on the network volume, socket/runtime files on local `/run`; never include state in a public image or repo. Enroll once as a non-ephemeral tagged identity; do not logout on normal shutdown. Document reauthentication/recovery without claiming the address is eternal after identity deletion.
4. Run userspace Tailscale and private Serve forwarding to ComfyUI loopback. Start the existing pinned runtime, preserving its expected persistent paths.
5. Hold ownership for the lifetime of **all** managed processes. The local upstream snapshot launches ComfyUI with `nohup` and ends in `sleep infinity` (`research/hearmeman_h3/runtime/src/start.sh`, lines 866 and 980). A wrapper must not release ownership just because its launcher exited or a trap fired while descendants survived.
6. On clean shutdown terminate/wait for managed ComfyUI and Tailscale descendants before releasing ownership. If exit/cleanup is uncertain, leave the marker. A failed startup must not clear someone else's marker or mutate their Tailscale state.

## Guard options and exact recovery

**Preferred conservative first implementation: atomic owner directory, no automatic stale stealing.** Attempt `mkdir` once on a fixed protected path; only success grants ownership. Write pod ID, unique launch token and diagnostic time inside it. Existing directory, incomplete metadata, unknown result or I/O error all deny startup. Never use age, an absent local PID, hostname or an unreachable Tailscale endpoint as proof of a dead owner. A PID is not globally meaningful.

Normal cleanup removes only the current owner's marker after all descendants have stopped. A killed container may leave the directory; that is intentional fail-closed behavior. Recovery requires checking Runpod shows the old pod off/terminated, ensuring no other workspace user runs, then explicitly clearing that exact marker while compute remains off using an available verified maintenance path. If S3 directory semantics cannot safely perform that operation, the sole authorized replacement may boot a maintenance command that does not start Tailscale/ComfyUI, inspect the marker, and clear it only after those provider checks. Retry ordinary startup afterward. Do not introduce another CPU maintenance pod.

**Possible later simplification: verified cross-client `flock`.** It auto-releases with process death, avoiding routine stale-directory recovery. Before selecting it, record filesystem type/mount options and obtain primary provider assurances or independent-client contention evidence for the actual storage. Lock a stable file opened for writing; do not unlink/recreate it while owners can exist. Keep its descriptor open through every child lifetime. Do not combine multiple independent fallbacks that silently downgrade from a failed lock to unguarded startup.

Neither pattern fences a malicious process or protects against a storage service violating consistency. A new distributed lease/watchdog service is out of scope; do not claim guarantees requiring one.

## Tests respecting one active pod and one GPU

### Before paid work

- Test wrapper concurrency locally with dummy Tailscale/ComfyUI commands that create sentinel files. Many parallel launchers must yield exactly one winner; losers must never run either command.
- Test signal, child failure, incomplete metadata, permissions, simulated I/O errors and abrupt wrapper death. Assert uncertain cleanup leaves ownership blocked, not stolen.
- Verify the user-operated console procedure and access credentials without provisioning. The deployed frontend needs no Runpod provisioning key for manual operation; a developer credential may still be used for authorized inspection/shutdown.

### On the sole authorized pod

- Inspect `findmnt -T` and `/proc/self/mountinfo` for the actual guard/state paths, filesystem and options. Do not remount storage speculatively.
- Run two independent guard-test processes on that volume, still one pod. Verify one winner and no loser sentinel. Exercise clean release and crash-stale recovery.
- This proves same-client behavior only. Two containers/processes sharing one kernel/mount do not prove cross-host locking. S3 object operations are not an equivalent second filesystem client.
- Enroll the sole identity, verify private endpoint and generated output, then shut the pod down in Runpod and verify actual provider state. Stop old compute before creating any replacement. Start a sequential replacement on the same volume; verify the expected identity/address and outputs persist.
- Test duplicate rejection with a second startup process inside the sole pod. Do **not** start a second billable pod to test a forbidden topology.
- Cross-host contention remains untested under the one-active-pod rule. Obtain provider confirmation for the actual storage protocol, or explicitly request a later exception only if that proof is required; never quietly use another CPU pod or a second GPU.

## Restart and billing caveat

The exact Runpod container restart policy after a failed entrypoint is not established by the public material inspected. Record it in the first live session. A fail-closed entrypoint may be retried or leave the allocation present; keep its error explicit and never treat exit as off. Every duplicate attempt must continue refusing startup until ownership is resolved. Avoid `sleep infinity` as a fake successful duplicate start. The user must stop/terminate an accidentally allocated duplicate in Runpod; the guard cannot undo provisioning when no provider-control component exists.

## Readiness assessment

Manual workflow and sequential identity reuse are well bounded. **A guaranteed cross-host duplicate guard is not established by the current evidence.** Plan it as an explicit filesystem-capability gate, use conservative no-steal recovery, and retain the user's one-pod procedure. Do not reuse the prior 95% automated-operations score as validation of this newly introduced shared-state assumption.
