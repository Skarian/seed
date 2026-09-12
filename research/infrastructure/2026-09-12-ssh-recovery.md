# SSH operation recovery: acceptance evidence

These tests check whether Seed completes an interrupted operation without an agent rerunning it. They are not GPU performance benchmarks. Local and live Vast/RunPod results are recorded separately below.

## What actually ran

`scripts/test-ssh-recovery.mjs` uses the production `WorkerConnection`, `Jobs` scheduler, SQLite records, and OpenSSH supervisor. The dispatcher runs in a separate Node process. A real worker container runs native ComfyUI on CPU with a small LoadImage → SaveImage graph. A test-only delay node makes execution overlap a controlled outage. No inference weights are downloaded or loaded.

The fixture supplies placeholder filenames solely to satisfy capability discovery and uses a separate test bootstrap. These shortcuts are outside the published worker and are not production readiness bypasses. Input upload, submission journaling, native queue insertion, output manifest persistence, Range download, Library save, and receipt cleanup use the real implementations.

The fault injector interrupts HTTP streams and, except for the stream-only test, kills the underlying OpenSSH child or withholds traffic. It does not invoke `Jobs.reconcile`, rerun a failed command, retransmit a prompt, or save outputs for the application.

## Results on September 12, 2026

All times below are UTC. Evidence directories are under `.local/networking/` and contain `result.json`, worker/container logs, and Comfy logs.

| Scenario | Start → finish | Evidence directory | Observed result |
| --- | --- | --- | --- |
| Mid-input disconnect, accepted prompt response lost, mid-output disconnect, accepted receipt response lost | 19:24:05 → 19:25:32 | `ssh-recovery-xErYaq` | All four recovered automatically; one native queue insertion and one Library output |
| Unfaulted baseline | 19:27:13 → 19:27:29 | `ssh-recovery-XtKBj7` | Completed and cleaned up |
| 75-second unresponsive connection plus prompt request lost before acceptance | 19:26:52 → 19:29:39 | `ssh-recovery-Q4OhvG` | Automatic recovery; output resumed at byte 1,034,240; one queue insertion |
| Dispatcher process killed and restarted during partial-output recovery and receipt recovery | 19:32:23 → 19:33:11 | `ssh-recovery-P6C1bV` | Persisted state recovered; output resumed at byte 1,013,760; no duplicate output |
| Native execution completes during a 20-second connection outage | 19:33:34 → 19:34:42 | `ssh-recovery-bZS3Ih` | Recorded completion occurred within the outage; output resumed at byte 1,048,576; no requeue |
| Input stream stalls while SSH and status requests remain healthy | 19:36:35 → 19:37:27 | `ssh-recovery-VRZnWd` | Transfer retried automatically; supervisor did not need to restart a healthy tunnel |
| Remote SSH fixture staging, baseline, log collection, and process teardown against a local Docker SSH host | 19:37:22 → 19:37:41 | `ssh-recovery-D49qOk` | Remote helper worked; this is not evidence of a paid-provider pass |

Every completed job checked one native queue insertion, one Library row, identical decoded input/output pixels, and completed worker receipt cleanup. Source files were approximately 12 MiB PNGs of random pixels. File integrity and resumable output saving used Seed's normal manifest checks. Input retries resend the whole file; they do not claim byte-level resume.

The earliest acceptance run used the scheduler in the harness process. Later runs use `scripts/fixtures/job-dispatcher.mjs`, allowing actual dispatcher process termination and startup from saved state. This exercises the job owner, not browser UI recovery.

## Preparation owner

`scripts/test-preparation-recovery.mjs` separately ran the production preparation
command in a child process through the real SSH supervisor and worker/tusd. The
fixture used a 24 MiB local model and deliberately unavailable source metadata.
After the worker saved 8,388,608 bytes, the test withheld traffic for 75 seconds.
The same invocation survived six retries, obtained that saved offset through HEAD,
uploaded the remaining bytes, and verified the complete remote SHA-256. It finished
30.336 seconds after connectivity returned. No command or reconnect was repeated
by the harness. Evidence: `.local/networking/preparation-recovery.json` and adjacent
preparation logs; 19:31:51–19:33:42 UTC. Its Docker container was removed.

## Input publication regression checks

`worker/test_inputs.py` covers concurrent identical writes, conflicting concurrent writes, a late retry while an inference-style reader remains open, half-open input overlap followed by abort, idle expiration, malformed paths, authentication, size/hash mismatch, extracted audio, and disk-full classification.

A subsequent source fix shares the existing per-job receipt lock with input publication. A completed receipt prevents late input requests from recreating cleaned directories. Its regression test passed. The final fence was added after the initial local image build; the published candidate containing it passed the provider integration checks below.

Full Python suite after the fence: **48 passed, 1 skipped**. The skipped check is platform-specific.

## Repeat the checks

Build the worker image and current application code first. Set `SEED_NETWORK_TEST_IMAGE` to that candidate image.

```text
node scripts/test-ssh-recovery.mjs --baseline
node scripts/test-ssh-recovery.mjs
node scripts/test-ssh-recovery.mjs --before-acceptance --blackhole
node scripts/test-ssh-recovery.mjs --restart
node scripts/test-ssh-recovery.mjs --generation-outage
node scripts/test-ssh-recovery.mjs --stream-stall
```

For an existing disposable provider test rental, supply a Git-ignored JSON file with `sshArgs`, containing the provider CLI's exact SSH argument array, including the final target. Then add `--remote-config <file>` to a command above.

The remote helper starts an isolated test worker on ports 8081/8189 beside the production worker, stages files under `/var/lib/seed/ssh-test-<pid>`, collects logs, and stops the test process group. It does **not** acquire or delete the provider rental. The operator must still verify VM and disk deletion after collecting evidence. Do not run this fixture beside an actively generating engine: its test instrumentation temporarily modifies the disposable container's Comfy extension.

## Published candidate and provider acceptance

The published candidate is `ghcr.io/skarian/seed-worker@sha256:5c5e6119e6f6b0c4ec4a6cde5f833041c531ae3a833e038b75ee0ba4b4d15b50` (source `db2e9ac`). The installed CLI also includes subsequent terminal SSH error classification; that change does not affect the worker image.

RunPod A40, EU-SE-1, pod `9dbqkialxzjx9l`:

- Preparation passed at 20:08:02 UTC. One production command survived a 75-second blackout, resumed at 8,388,608 bytes, and verified the complete remote SHA256. Completion was 52.489 seconds after connectivity returned. Evidence: `.local/networking/preparation-runpod-recovery.json`.
- Job acceptance passed at 20:11:05 UTC. Input interruption, submission lost before acceptance, output interruption and receipt interruption all recovered without a harness retry. A 75-second unresponsive connection triggered automatic tunnel replacement. Native Comfy queue insertion and Library output counts were both exactly one; output resumed at 1,048,576 bytes and pixel content matched. Evidence: `.local/networking/ssh-recovery-NgGQtD/result.json`.
- Abrupt local dispatcher restarts during output and receipt handling passed at 20:12:28 UTC. The accepted prompt response was also lost; persisted recovery still produced one queue insertion and one verified Library result. Evidence: `.local/networking/ssh-recovery-J1Izx7/result.json`.
- Final review identified that the explicit generation-completes-during-outage case had only run locally and on Vast. A second A40 pod, `kwydxogt94j82s`, closed that coverage gap on the same candidate. It passed at 20:31:45 UTC: native execution completed within the 20-second outage, and the same job recovered automatically with exactly one enqueue, verified pixels, resumed output and complete receipt cleanup. Evidence: `.local/networking/ssh-recovery-tVcXZ4/result.json`. Its logs were collected and its pod/disk deleted afterward.

Job inputs restart as whole-file uploads rather than resuming byte ranges. For example, the RunPod blackhole fixture input was 12,607,321 bytes; the successful retry resent that complete file after the failed attempt crossed 1 MiB. Model uploads resumed at 8 MiB and output downloads at 1 MiB as recorded above. Total wire bytes including multipart/SSH overhead were not instrumented.

Vast RTX 4070S Ti, Minnesota machine 28014, instance `50795178`:

- Same image and key setup authenticated successfully. Inside the running container, numeric ownership was root for `/root`, `.ssh` and `authorized_keys`; effective `StrictModes` was enabled. No host-policy workaround was applied.
- Preparation passed at 20:19:43 UTC. The original invocation resumed at 8,388,608 bytes after the 75-second blackout; remote SHA256 matched. Completion was 31.488 seconds after connectivity returned. Evidence: `.local/networking/preparation-vast-recovery.json`.
- Job acceptance passed at 20:20:50 UTC. Native Comfy execution completed during a 20-second outage, then Seed recovered without requeueing. Input, accepted submission response, output and receipt interruptions all recovered; output resumed at 1,048,576 bytes, pixels matched, and cleanup completed. Evidence: `.local/networking/ssh-recovery-IFxbad/result.json`.

The first Vast host, machine 52305 / instance 50792238, failed before operation testing: both provider direct and proxy SSH rejected the attached key. Account/instance key association and the local key pair were checked. Reattaching the same test key did not fix authentication. Provider startup logs include host-key initialization ordering, and a stopped-container directory listing was preserved, but neither establishes the authentication root cause. The failed instance and its disk were destroyed; diagnostics are under `.local/networking/failed-vast-50792238/`. This is a failed host boot/authentication result, not a failed interruption-recovery result.

Review of that failure found a CLI issue: Vast readiness swallowed terminal SSH authentication errors. It now stops immediately for invalid keys, host identity changes and local forwarding conflicts. The supervisor also stops for missing/inaccessible OpenSSH executables; transient transport/spawn failures still retry. All 37 relevant operations tests pass (`2acb9d4`).

## Cleanup, installation and charges

All test rentals and their disposable disks were deleted after log collection. Final live inventories, rechecked after the additional RunPod case, showed no RunPod pods/network volumes and no Vast instances/volumes. Vast audit: `.local/networking/final-vast-audit.json`. Provider and worker logs remain private under `.local/networking/`.

At the final 20:32 audit, posted Vast charges were $0.050 for the failed host and $0.036 for the successful host; remaining credit was $26.284. These are posted snapshots, not guaranteed settled final invoices. RunPod returned no posted billing records yet. Its two $0.49/hour pods existed for about 14 and 7.5 minutes respectively, making total compute approximately $0.18 at the full quoted rate, plus disposable disk charges. The test spend remains far below the authorized $10 cap; zero billing records do not mean free compute.

The installed PC package includes `2acb9d4`; the installed skill is SSH-only. The app was restarted at `http://192.168.1.212:4310` and the Library visually checked. The previously discarded frame job was reconciled after database backup, preserving all 37 existing assets. Its lost remote originals were not represented as recovered.

## Interpretation

- Faults were injected deterministically, not naturally occurring provider faults.
- These tests establish operation recovery for the listed boundaries, not universal SSH availability or inference correctness.
- Preparation has local, RunPod and Vast acceptance evidence above; provider results are recorded separately.
- The 75-second blackout is an application-path traffic outage; it is not a measurement of provider network downtime.
- All local test containers were removed after these runs. The real local Seed app and its media were not used.
