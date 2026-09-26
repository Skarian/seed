# Reliability acceptance: fixed-release gate

**Superseded release:** the user's next Vast Video rental exposed the SSH
rollout gap in the old Video image. The corrected release and expanded checks
are documented in [Video SSH rollout correction](worker-video-ssh-rollout-2026-09-24.md).
The results below remain evidence for the earlier fingerprint, not acceptance
counts for the replacement Video digest.

23 September 2026. Branch `codex/fal-only`. The local recovery gate passed.
Fresh paid qualification resumed after the user changed the approval setting;
the live results below use the unchanged, fingerprinted application and images.

## Defects reproduced and corrected

Three new regression cases failed against the application before correction:

1. Cancellation accepted during output saving could still publish the late
   output to the Library.
2. A completed worker receipt arriving after accepted cancellation could also
   publish an output.
3. Cancelling a request blocked by a local save error left it stuck waiting for
   Retry saving.

Cancellation now wins before Library publication. It clears a save-recovery
block, removes unpublished output/partial files, and acknowledges the remote
terminal receipt before releasing the worker's assignment. A fourth regression
checks that cancellation survives application reconstruction after a lost
acknowledgement. Already saved, completed outputs are preserved.

An initial cleanup assertion caught a missing `-0` output filename suffix in
the correction; this was fixed before qualification. No container or model
settings were changed.

## Evidence and its limits

| Check | Result | What it establishes |
| --- | --- | --- |
| Application suite | 310 tests passed in 35 files | Covered application behavior, including the four cancellation cases |
| Typecheck and production build | Passed | Built release is valid; app restarted with it |
| Process-crash recovery | 12/12 passed | Six interruption boundaries on each production provider client, real HTTP, real application/SQLite recovery |
| Published containers | 15/15 passed | Exact Image and Video pins; actual startup/SSH/pairing and worker transport |
| Browser regressions | 15/15 passed | Worker controls, Generate feedback, shutdown and recovery UI with fixture compute |
| Repository secret scan | 522 files, zero potential matches | Checked source and fixtures; not a claim about every external log |

Process recovery now uses `createProviders`, not substitute provider drivers.
A separate local HTTP replay service survives the application being killed
while it holds a response after the allocation/deletion side effect. It uses
allowlisted, anonymized responses captured during real rentals. The six crash
points are allocation, generation submission, partial save, complete file
before Library commit, terminal acknowledgement and deletion. Every case checks
one allocation, one generation where applicable, one Library output, confirmed
release, and a preserved billing clock. This is deterministic fault injection;
its controlled allocation/visibility logic does not model marketplace behavior.

The container harness defaults to `worker/releases.json`, verifies each local
registry digest, and first runs the published ENTRYPOINT/CMD unchanged with
network disabled. It pairs through actual SSH before entering separate CPU
transport fixtures. Image additionally passes conflicting `PUBLIC_KEY` versus
`SEED_SSH_PUBLIC_KEY`, replacement of the provider-managed authorized-key file,
and rejection of an unrelated key. Positive authentication uses the Windows
production client; the negative check uses Linux OpenSSH inside the container
and verifies the server's rejection log. Both Docker log streams are retained.
Large model preparation, GPU readiness and inference remain substituted only
in the subsequent transport tests. Video has its earlier startup implementation;
it passed ordinary startup but is not claimed to have Image's isolated-key fix.

Private machine-readable evidence:

- `.local/tests/process-recovery-qD6F9G/results.json`
- `.local/tests/container-transport-Z185Xn/results.json`
- `.local/acceptance-2026-09-23/release.json`

Harness development failures are retained in their earlier `.local/tests/`
directories. They include harness response-field/audit issues and an inconclusive
Windows wrong-key probe; these are not counted as successful provider journeys.
One full-suite invocation overlapped a build and lost `dist/server/cli.js` during
cleanup; the final full suite ran against a stable completed build and passed.

## Frozen release

Built application SHA-256:
`44e58538889c7def1bd7003b713f08e825bc660b6534704048e1d1a7438bbc5a`

- Image: `sha256:8edf7a9eb0567e4cd935cb7f3602029bc8d69525c340da671ec8bd0ffc8508cb`
- Video: `sha256:1f6d058442ed9bb866514b2f07511fbc52388d84aae00dc8a9ce9d2375135b61`

`scripts/qualification-release.mjs` fingerprints the actual built files and
pins, including uncommitted work. Verify the saved fingerprint before a live
attempt. Any application/image change starts a separate cohort; do not combine
the prior debugging campaign's successes into this release's acceptance count.

```text
npm run verify
npm run test:recovery
npm run test:transport
node scripts/qualification-release.mjs snapshot EVIDENCE_FILE
node scripts/qualification-release.mjs verify EVIDENCE_FILE
```

Run build-containing commands sequentially. Once a live cohort begins, do not
rebuild or modify it until the result and any failure evidence are recorded.

## Live acceptance gate

Initial target: five fresh journeys for each provider/class combination,
20 total, spread over multiple days and placements. This is a personal-use
release gate, not a statistical 99% reliability claim. Record hardware explicitly;
success on one GPU does not qualify all advertised GPUs. Do not claim distinct
physical hosts where provider evidence does not identify them.

| Provider | Image | Video |
| --- | --- | --- |
| Vast | 0/5 on this frozen app release | 0/5 on this frozen app release |
| RunPod | 1/5 on this frozen app release | 1/5 on this frozen app release |

Each journey must acquire through Seed, become ready, generate, save and open a
real output, then release through Seed with independent compute/disk absence.
Image journeys use Krea followed by Qwen editing. Video journeys alternate text
and three real references. Across the sample cover quantity, Chat approval,
multiple workers, browser closure, server restart and both shutdown choices.

Record first-attempt readiness, automatic recoveries, manual interventions,
startup stages, submission/save time, quoted rate, estimated spend, output IDs,
failure evidence and verified deletion. Any manual worker repair fails that
journey. No duplicate rental, orphaned billable storage, false released state,
silent output loss, or publication after accepted cancellation is acceptable.

For the next limited-budget attempts, report readiness within 20 minutes as a
separate timeliness measure. Passing late remains a late result. This is a test
criterion, not a new automatic shutdown policy: workers remain under explicit
user control, with the campaign spending guard taking precedence.

## Paid-test boundary

The original authorization remains $10 total with cleanup beginning at $8;
prior estimated spend is $6.20564684. No new allowance is assumed and the budget
takes precedence over the 20-journey target.

## Live follow-up on the frozen release

RunPod Image worker `4e8772b2-381d-449b-8fbe-8f9848e27c5f` passed the
acquire/generate/edit/save/open/release journey without manual worker repair.
RTX PRO 4500 Blackwell, $0.7425/hour including 162 GB disposable disk.

- Requested 23:37:55Z; ready 23:44:57Z: **7m 02s** from request.
- Container/connection stage: about 5m 53s. Model preparation and verification:
  about 57s for 20.55 GB, followed by about 12s to ready.
- Queued a quantity-two Krea request, closed its browser tab, and restarted the
  Seed server during acquisition. The same two jobs and same two rentals
  recovered without duplicate allocations; the request ran automatically.
- Distinct seeds produced two distinct saved images. Worker submission to local
  save was **11.81s** and **5.03s**; user submission to save included the startup
  queue and took 323.44s and 330.21s respectively.
- Opened a saved image through Activity and the shared preview, passed it to
  Qwen through Edit image, and submitted a coral-orange color edit. The edited
  result saved **27.42s** after request (24.92s after worker submission).
- Requested Finish jobs and quit while Qwen was running. Saving completed
  before automatic release at 23:46:31Z. Independent RunPod inventory confirmed
  the rental absent. The edited image still opened after release.
- Estimated complete rental cost: **$0.10597**. Three PNGs decoded successfully;
  individual visual inspection confirmed two variants and the requested edit.

RunPod Video worker `73785ee8-8bb2-4d68-9679-01eddae84cc5` also passed without
manual worker repair. RTX PRO 6000 Blackwell Server Edition, $2.11514/hour
including disposable disk. Requested 23:39:01Z; ready 23:50:14Z: **11m 12s**.
Its five-second reference-video request used three actual PNG inputs: a puppy
video frame, a blue mug image, and a yellow mug image. All three were inspected
individually and their prepared-file SHA-256 hashes verified.

- Restarted Seed during reference-video inference. The server recovered the
  running job; history contains one submitting transition and one saved output.
- Reference-video submission to save: **180.16s**. User request to save,
  including startup queue: **694.71s**.
- The same worker then switched to text-to-video. Submission to save:
  **134.34s**; request to save, including queue: **218.24s**.
- Both outputs fully decoded and played to completion in the real Chrome
  preview, with no media error. Each is 5 seconds, 1344×768, 24 fps, H.264 video
  with stereo AAC audio at 32 kHz. Sampled frames at 0.2, 2.5 and 4.8 seconds
  were reviewed individually. This is not a perceptual audio-quality benchmark.
- Submitted another text-video job, confirmed it running, then used Cancel jobs
  and quit now. It became cancelled with zero outputs. The rental was deleted
  at 23:57:40Z; previously saved media remained accessible afterward.
- Estimated entire video rental: **$0.65600**. Both workers became ready inside
  the predeclared 20-minute timeliness criterion. Neither needed a reconnect,
  preparation retry, manual repair, or a replacement rental.

The follow-up cost estimate is **$0.76197**, bringing the original campaign to
**$6.96761 of the $10 cap**. These are estimates, not provider invoices.
Independent inventories at 23:57:52–53Z confirmed zero Vast/RunPod rentals and
zero separately listed volumes. Both rental-attached disposable disks were
removed with their pods. The watchdog exited. The built release fingerprint
was verified unchanged after the run. No new application/container code was
introduced during these paid tests.

Final evidence assertions passed in `results.json`: two released rentals with
one create request each; six jobs with one submitting transition each; five
saved outputs matching the Library's recorded size and SHA-256; one intentional
cancellation with no output; two decodable stereo videos; and empty independent
compute/storage inventory. This qualifies **2 of the planned 20 journeys**,
both on RunPod. It is not a broad provider or hardware reliability claim.

Private evidence is in `.local/acceptance-2026-09-23/`: `live.json`,
`observations.jsonl`, per-worker histories, input/output integrity manifests,
and individually reviewed desktop/mobile captures. These are real application
journeys, not simulated provider results. The acceptance sample remains far
smaller than the planned 20 journeys.

Visual review: 14 final desktop/mobile screenshots were inspected individually
before building the navigation mosaics. No blocking layout issue was found in
this sample. Two nonblocking observations remain: Activity initially shows
worker records before its generation list loads, and an entirely cancelled
request is summarized as "Finished" in the list (the underlying job and its
details preserve cancellation). Download ETA is also volatile between large
files; the observed pauses resolved without intervention. These observations
are retained rather than changing the frozen app during qualification.

Capture-harness corrections are separate from product results: initial video
captures caught buffering; a subsequent playback wait accidentally inspected
an Activity thumbnail instead of the preview video. The wait was scoped to the
Media preview dialog, both final viewport captures reached playback end, and
the corrected screenshots were reinspected. Real Chrome playback and full
file decoding were verified independently of that harness.

### Earlier approval boundary (resolved for this follow-up)

The selected next rental is a RunPod RTX PRO 4500 Blackwell Image worker at
$0.7425/hour including disposable disk, using the final published Image pin.
Automatic approval review rejected the final UI submission, including a retry
after verifying the original authorization and cumulative spending guard. It
requires the user to perform the purchase click. No alternative API or terminal
purchase was attempted. Independent inventory confirmed zero workers and disks
before the handoff. Fresh live qualification remains outstanding.

Final inventory audit at 2026-09-23T23:15:06Z again confirmed zero Vast/RunPod
workers and zero separately listed volumes. No additional spend; cumulative
estimate remains $6.20564684. The idle campaign watchdog was stopped. Resume it
and adopt the exact new rental before continuing a user-initiated test.

At 2026-09-23T23:30Z the user explicitly reauthorized spending up to $10.
The existing cumulative budget guard was resumed, the RunPod offer refreshed,
and the same final UI submission attempted. Automatic approval review again
rejected creation of the billable resource, requiring the user to perform the
final click. No alternate purchase path was attempted. The campaign was finished
again: provider inventory and separate storage inventory were empty, the release
fingerprint remained unchanged, and estimated cumulative spend stayed at
$6.20564684. No new live journey ran.

At 2026-09-23T23:34Z a further explicit user instruction to perform the final
action was submitted with a fresh offer and active budget guard. Automatic
approval review rejected the click again, explicitly including authorization in
its stated reason. The campaign was stopped; independent compute and storage
inventories remained empty and spend did not change. The selected offer was
left open for the required user action.
