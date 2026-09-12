# SSH operation recovery: local acceptance evidence

These tests check whether Seed completes an interrupted operation without an agent rerunning it. They are not GPU performance benchmarks. Live Vast and RunPod validation is still required; no paid rental was created by these local tests.

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

A subsequent source fix shares the existing per-job receipt lock with input publication. A completed receipt prevents late input requests from recreating cleaned directories. Its regression test passed. That final fence was added after the initial local image build, so the published final candidate must still receive integration/provider validation.

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

## Limits

- Faults were injected deterministically, not naturally occurring provider faults.
- These tests establish operation recovery for the listed boundaries, not universal SSH availability or inference correctness.
- Local model preparation has the separate acceptance evidence above; it is not yet a paid-provider result.
- The 75-second blackout is an application-path traffic outage; it is not a measurement of provider network downtime.
- All local test containers were removed after these runs. The real local Seed app and its media were not used.
