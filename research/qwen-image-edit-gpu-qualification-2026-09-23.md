# Qwen Image to image — real GPU qualification

Date: 23 September 2026. Completed in normal mode on the real Seed app. **All test workers and their attached disks have been deleted.** Independent provider inventory reads at 15:48 UTC showed zero Vast instances, zero RunPod pods, zero Vast volumes and zero RunPod network volumes. Seed also showed zero active workers.

## Result

The published Image worker runs Qwen Image 2.1 on a **32 GB RTX 5090**. Generate, Chat, Library output retention, model switching, multiple outputs, cancellation, restart recovery and cross-provider scheduling all worked in this test. A 32 GB RTX PRO 4500 Blackwell also worked, with slower warm inference.

The main remaining problem is inconsistent host startup performance. Two inexpensive Vast hosts were unsuitable because container/model downloads or input transfers were too slow. A third Vast host became ready in 9m 33s and then performed well. No quality or latency result below relies on the two unsuitable hosts.

[Numbered source/output gallery on the LAN](http://192.168.1.212:4312/qwen-gpu/index.html) — 38 saved application outputs, individually reviewed. Click an image to open it larger. The gallery labels the mixed-reference failures explicitly. Two additional standalone 5090 outputs were inspected individually and retained in the raw evidence directory.

## Serving configuration

- Published digest: `ghcr.io/skarian/seed-worker-image@sha256:1477fc24167c9662b7a9907bf61052da13fa16f4e688a01b86aeb992d8d7433b`.
- Qwen Image 2.1 INT8 ConvRot diffusion model and Qwen3-VL encoder; BF16 VAE; Euler/simple; 25 steps; CFG 1; native Qwen cache defaults.
- One source plus up to nine additional image references; source-shaped output up to about 1 MP. No LoRAs were applied in these generations.
- Krea and Qwen used the same Image worker and ComfyUI memory manager. The video worker and H3 were not part of this qualification.
- The three Qwen files are baked into the pinned container. Krea files and the frozen adapter inventory downloaded directly from their hosting providers. Seed did not relay model weights from the PC.

The container, source and model pins are recorded in [the implementation report](qwen-image-edit-implementation.md). This qualification did not change the published image digest.

## Measured latency

These are small-sample measurements, not percentile guarantees. End-to-end means request accepted by Seed to output saved locally; it includes preparation, transfer, scheduling, polling and download. Quantity four is measured to the last saved output.

| Test | RTX PRO 4500 32 GB | RTX 5090 32 GB |
| --- | ---: | ---: |
| First Qwen edit in the app | 26.60 s | 22.77 s |
| Warm edit with a changed instruction | 18.32 s | 9.13 s |
| Four seeded outputs, one worker | 73.93 s | 38.28 s |
| Krea after Qwen | 19.78 s, portrait | 6.97 s, product |
| Qwen portrait edit after Krea | 25.11 s | 20.11 s |
| Five related input images | 38.36 s | 26.60 s |
| Ten mixed input images | 81.04 s | 46.61 s |
| EXIF orientation case | 23.79 s | 8.84 s |
| Smaller transparent-image case | 9.86 s | 5.78 s |

The Krea rows use different compositions, so they are not a controlled speed comparison. EXIF and alpha inputs also have different preprocessing and shapes; do not generalize their latency to every image.

A four-output request spread across the Vast 5090 and a second RunPod 4500 finished in **23.10 s**. Seed assigned three outputs to the faster 5090 and one to the 4500. Both GPUs actually executed work. This is an observed batch result, not a claim that a second worker always halves latency.

The isolated 5090 probe took 19.64 s of native execution on its first run and 4.63 s for a second seed with identical conditioning. That second run reused the source/prompt conditioning nodes. The app timings above are the better product benchmark; the isolated probe excludes transport and application orchestration.

### Where execution time went

Approximate node intervals from the worker's ComfyUI events:

| Stage | Warm 4500 edit | Warm 5090 edit | 5090 ten-input case |
| --- | ---: | ---: | ---: |
| Image/text conditioning | 2.22 s | 0.66 s | 12.23 s |
| Sampling | 8.69 s | 4.63 s | 24.88 s |
| Decode | 0.24 s | 0.14 s | 0.14 s |
| Native PNG save | 0.14 s | 0.09 s | 0.09 s |
| Total native execution | 11.33 s | 5.97 s | 37.50 s |
| Entire app request | 18.32 s | 9.13 s | 46.61 s |

Node intervals include work performed lazily inside those nodes, including model loading where applicable. They are not CUDA kernel profiler measurements. A newly loaded Qwen profile pays substantially more initialization cost than a warm one. The worker and PC clocks differed, so cross-machine timestamp subtraction was not used to claim separate upload/return durations; native durations and local end-to-end durations are reported independently.

The app's per-output input paths cause conditioning to run again for each output. The direct probe demonstrates an opportunity to reuse conditioning for same-source/same-prompt variants, but no such optimization was introduced in this pass.

## Memory and quality

Sampled `nvidia-smi` peak usage was **23,886 MiB on the 4500** and **24,348 MiB on the 5090**. These samples include allocator residency and are not guaranteed instantaneous maxima. Both are below their approximately 32 GB physical capacity. ComfyUI's smaller “used” figure excludes reclaimable cache and should not be confused with the physical residency measurement.

The ten-input case reached about **37.6 GiB of system RAM used** on the 5090 worker. This includes the surrounding runtime/cache and is not a per-model allocation figure. A worker with only 32 GB of host RAM has not been qualified; the tested 5090 host had roughly 64 GB.

Individually reviewed results:

- Simple color edits preserved the object, composition and surrounding scene well in these examples.
- Clothing edits retained the portrait's identity and overall expression, with some ordinary generative texture/face changes. This is not an exact-pixel preservation tool.
- Scene lighting changed while the cabin/mountain composition remained recognizable.
- EXIF-rotated input stayed upright. Transparent input retained a non-opaque alpha channel; those outputs were also inspected against white to avoid mistaking hidden RGB content for a visible defect.
- Source plus one reference and five relevant inputs worked well.
- **Ten mixed references failed the requested quality constraint**, despite executing successfully. The model introduced extra mugs and, in several runs, a person from a reference. More unrelated references are not automatically better. Chat now explicitly prefers only references needed for the edit.
- Repeating the same seed/request on the same 4500 produced identical decoded pixels. Between the 4500 and 5090, matched single-edit outputs differed slightly; bitwise reproducibility across different GPUs is not promised.

The reference limit remains a capacity limit. Passing one ten-input memory test does not establish reliable instruction following for every ten-image combination.

## Real application and lifecycle checks

| Check | Result |
| --- | --- |
| Generate → Library image → Edit image → submit → shared preview | Passed; purple-mug edit saved and previewed |
| Switch Generate workflows after completion | Passed; the old result did not appear in the other workflow |
| Chat attachment → explicit workflow selection → proposal → review → approve → preview | Passed; source reused from the conversation and turquoise edit saved |
| Cancel a queued request through the UI | Passed; other queued work was unaffected |
| Cancel a running GPU request | Passed; no output published; a following edit succeeded |
| Restart Seed during real inference | Passed; existing worker receipt reconciled and one output saved |
| Finish jobs and quit | Passed; RunPod saved the accepted output before deletion |
| Quit one busy worker in a two-worker pool | Passed; its job cancelled, other worker's job completed |
| Cancel jobs and quit on Vast during real inference | Passed; job cancelled without output, instance deleted |
| Final independent provider and volume audit | Passed; all inventories empty |

The real acquisition/cost/shutdown UI was inspected on desktop and mobile. Generate and Chat approvals/previews were inspected in Chrome. The numbered result gallery and its full-image preview were also checked at desktop and 390 × 844 mobile sizing; the viewport override was reset.

Local regression validation: **286 tests in 33 files passed**, type checking passed, and the production build passed. The previous implementation report separately records the larger synthetic browser and container-transport matrix; those results are not being presented as paid inference.

## Acquisition and fixes

| Rental | Quoted GPU + disk rate | Outcome |
| --- | ---: | --- |
| Vast US 5090, first host | $0.5233/h | Released after roughly 48 minutes of unusably slow image acquisition; no inference |
| Vast Korea 5090 | $0.5517/h | Container took about 32 minutes; later downloads/transfers were unreliable; released |
| RunPod 4500, first rental | $0.7425/h | Ready in 12m 11s; completed the primary app/lifecycle matrix |
| Vast Nevada 5090 | $0.8750/h | Image pull about 6m 51s; ready in 9m 33s; completed 5090 and pool tests |
| RunPod 4500, second rental | $0.7425/h | Ready in 7m 30s; completed cross-provider scheduling and active shutdown tests |

The first unsuccessful Vast host's application release timestamp lagged actual provider deletion while the deletion-response bug was being diagnosed. The budget estimate deliberately includes that extra time. Early download ETA readings were volatile and should not be treated as reliable cold-start forecasts.

Fixed during real testing:

1. Vast offer revalidation now uses `ask_contract_id`, which the live API accepts for the quoted offer.
2. Vast SSH setup registers the existing per-worker public key on that instance. It handles the provider's “already associated” response idempotently and does not add an account-wide key. The Nevada launch confirmed automatic preparation with the fix.
3. Provider reads are throttled and back off on rate limits. Quit/release verification bypasses the cache and still checks the provider directly.
4. Vast's successful `instances: null` response now confirms deletion; malformed responses still fail verification.
5. Image-worker setup labels its VAE as an image decoder.

## Cost and cleanup evidence

The conservative elapsed-time estimate for all five rentals, including GPU and attached disk, was **$2.05**. Vast's observed transfer charges added **$0.104**, making the conservative test estimate approximately **$2.16**, below the $5 authorization. This is not a final combined provider invoice. It includes acquisition/idle time and intentionally overestimates some Vast GPU time during image pulling.

At the audit, Vast reported $0.778 in total charges for its three instances. RunPod's pod-billing endpoint had not yet populated records for these rentals, so their quoted elapsed rates remain the basis of the conservative estimate. The Chat test also used a small OpenRouter request; that service was outside the GPU rental ledger and was not presented as a GPU invoice.

Each rental used a 162 GB disposable container disk. No persistent or network volume was created. Both normal release and direct provider absence were verified. The final audit returned:

```json
{"vast_instances":[],"runpod_pods":[],"vast_volumes":[],"runpod_network_volumes":[],"app_active_workers":0}
```

The watchdog, observation helper and temporary keep-awake processes exited. Local Library images and the QA gallery remain available; no user Library data was deleted.

Raw evidence is under `.local/qwen-gpu/run-2026-09-23T13-55-27-365Z/`: requests, saved job receipts, native event logs, GPU samples, timing summaries, individual PNGs, visual review ledger, rental ledger, billing audit and final inventory/cleanup records. The curated review ledger is [qwen-image-edit-gpu-visual-review.json](qwen-image-edit-gpu-visual-review.json).

## Practical conclusion

Use the current 5090 Image worker for ordinary edits. The tested warm path is already fast enough to begin normal iteration. Cold acquisition and host selection deserve attention before changing model precision or sampling settings. Keep reference sets focused, and treat exact conditioning reuse as a later optimization with its own validation.
