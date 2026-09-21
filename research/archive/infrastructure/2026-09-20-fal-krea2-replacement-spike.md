> Historical experiment notes. Executable spikes have been retired; the current
> application uses fal directly. See [current architecture](../../studio/ARCHITECTURE.md).

# Krea 2 on fal: replacement feasibility and next spike

September 20, 2026. The owner subsequently chose a normal-endpoint spike without
LoRAs. That run is complete: one image, then one native four-image batch. No
adapter upload, model training, application migration or infrastructure removal
was performed. H3 Fast remains deferred by the owner.

## Measured normal-endpoint spike

Run `41af34e5-d757-4a01-b5d1-c6cf8ba2b327`, approximately 19:09 UTC. The two
requests ran sequentially, with no warmup, additional generation or POST retry.
Endpoint `fal-ai/krea-2/turbo`; 1280 x 720 PNG; prompt expansion false;
acceleration none; safety checker true; no LoRAs or image inputs. The baseline
image was copied locally for review, not uploaded to fal.

| Stage | Single image | Native batch of four |
| --- | ---: | ---: |
| Submit acknowledgment | 0.167 s | 0.036 s |
| Observed queue/startup | 0.340 s | 0.336 s |
| Observed processing | 1.484 s | 7.418 s |
| Result lookup | 0.034 s | 0.032 s |
| Download | 0.531 s | 2.483 s |
| Decode/hash verification | 0.070 s | 0.269 s |
| Submit to verified local files | **2.638 s** | **10.600 s** |
| Provider runner metric | 1.436 s | 7.544 s |
| Provider inference metric | 1.235 s | 7.369 s |
| Actual matched charge | **$0.00703125** | **$0.02812500** |
| Actual charge / saved image | **$0.00703125** | **$0.00703125** |

Total matched charges: **$0.03515625** (3.515625 cents). Local baseline
preparation took 0.090 s; pricing/billing lookups are outside generation totals.
Polling is every 250 ms; the observed boundaries are approximate, and request
persistence adds minor overhead. Provider metrics overlap wall-clock stages and
must not be added to them. Batch outputs download sequentially. Per-stage GPU
costs and model initialization are not separately exposed.

Receipts report 0.87890625 and 3.515625 megapixel units at $0.008, with no
discount. For these requests, quantities match pixels divided by 1024 squared.
The initial $0.04 conservative estimate rounded each image up to one megapixel.
Billing initially lagged, then resolved with a read-only refresh; no regeneration.

Request IDs:

- Single: `01a0c039-0cd2-7142-8ab6-7498085a06c6`.
- Batch: `01a0c039-16a0-7e83-87db-fad3ea1388c3`.

The original app baseline PNG contains its Comfy graph. Its prompt and seed
424242 were recovered and matched before submission; no LoRA was in that graph.
The single uses the same seed; batch seeds are 424243-424246. Original prompt:

> Cinematic natural photograph of an adult woman in her thirties wearing a blue cotton sweater, seated at a wooden table in a warmly lit cafe, medium shot, expressive face, natural skin detail, hands resting on the table, realistic proportions.

All five outputs fully decode as PNG at 1280 x 720, have distinct pixel hashes,
are nonblack, and have false provider safety flags. Visual inspection found the
requested blue sweater, cafe/table setting, warm photographic lighting and
visible hands throughout. The single is broadly comparable to the old baseline,
but has a different face/background/composition despite the same seed. The
subjects appear older than the requested thirties in both the baseline and
hosted results; do not claim complete prompt adherence or a quality improvement.
No reference identity was supplied, so this is not an identity-fidelity test.

The native batch showed no price saving or material per-image latency advantage
in this sample (2.650 s/image end-to-end versus 2.638 s for the single). It does
not tell us how four independent concurrent fal requests would perform. One
sample per shape cannot establish average, p95 or cold-start latency.

**Decision supported:** fal is a credible replacement for standard Krea image
generation, alongside the completed standard-H3 video spike. LoRAs, other H3
routes and app-level recovery/cancellation still need acceptance as part of
migration. No worker infrastructure has been removed based on this test alone.

Artifacts: `.local/fal-krea2-spike/cafe-v1/` contains the comparison gallery,
baseline, five outputs, immutable manifest, durable state/events, stage CSV and
matched billing receipts. [Runner and recovery instructions](../../scripts/fal-krea2-spike.md).
Twenty-two targeted H3/Krea transport/recovery tests pass.

## Confirmed fit

Seed currently generates images with Krea 2 Turbo INT8 ConvRot, a Qwen3-VL 4B
FP8 text encoder, eight steps, CFG 1, Euler/simple sampling, and optionally a
model-only private LoRA. Images are 1280 x 720 or 720 x 1280; count is 1-16.
See `server/workflows.ts` and `worker/models.json`.

The matching hosted family is the open Krea 2 Turbo model, not the separate
Krea 2 Medium/Large products. Public documentation does not establish fal's
precision, checkpoint revision, sampler or numerical equivalence to our worker.
The Turbo name here is the model we already use; it is unrelated to the rejected
H3 Max Fast mode. Krea recommends training LoRAs on RAW and applying them to
Turbo, but compatibility still has to be checked for individual adapter formats.
[Official model repository](https://github.com/krea-ai/krea-2).

| Route | Endpoint | Live catalog price |
| --- | --- | ---: |
| Images without adapters | `fal-ai/krea-2/turbo` | $0.008 / megapixel |
| Images with adapters | `fal-ai/krea-2/turbo/lora` | $0.010 / megapixel |

Prices were read from the authenticated fal pricing API using the existing
inference key. Currency USD; unit `megapixels`; no inference was submitted.
The [base model page](https://fal.ai/models/fal-ai/krea-2/turbo) and
[LoRA model page](https://fal.ai/models/fal-ai/krea-2/turbo/lora) are the public
pricing references. Exact charges, including pixel rounding, need receipts.

The [LoRA schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/krea-2/turbo/lora)
accepts up to three `loras`, each with `path` and `scale` (0-4, default 1).
Paths may be URLs or Hugging Face repo IDs; a local path means provider-side
storage, not access to this PC. Use a pinned downloadable file for reproducible
experiments. Supported inputs include explicit image dimensions, seeds, 1-4
images per request, PNG/JPEG, optional prompt expansion, and acceleration
`none`/`regular`. The API has a 5,000-character prompt limit; our image validator
currently permits 12,000. Reject oversize requests clearly rather than truncate.

There is also a public style catalog, [loratlas](https://www.loratlas.com/),
linked by [fal's Krea guide](https://fal.ai/learn/tools/how-to-use-krea-2-open-source).
Documented endpoint support and catalog availability do not prove that any
particular existing private/Comfy adapter loads correctly.

## Original proposed LoRA test (deferred in favor of the normal run above)

Use the existing private `.env.fal`, queue transport, durable acknowledgments,
result downloads and request-matched billing approach from the H3 spike. Keep
the test separate from the application. Extend the transport endpoint allowlist
deliberately; the existing adapter currently only admits H3 endpoints.

Proposed output budget: approximately six cents; a $0.25 local admission ceiling
leaves room for billing-unit rounding. This is not a provider-enforced hard cap.
Refresh pricing before submission. No training or rented GPUs are required.

| Test | Outputs | Purpose |
| --- | ---: | --- |
| Base | 1 | Native current-app dimensions, prompt, and seed; compare to an existing saved image |
| LoRA | 1 | Same prompt, dimensions and seed, with one pinned Krea style/character adapter |
| LoRA batch | 4 | One `num_images: 4` request; measure batch latency and cost per saved image |

Exactly three generation requests, six images. Use 1280 x 720 PNG,
`enable_prompt_expansion: false`, `acceleration: "none"`, and explicitly recorded
seeds. Use an existing suitable Standard-mode studio prompt and saved output for
comparison; do not rent a GPU to manufacture a baseline. The base and LoRA
single-image prompts must match, including any adapter trigger phrase. The
specific adapter URL, revision/hash, trigger and strength must be fixed in the
fixture before a live run; selecting a public style adapter only tests that
adapter, not the owner's private LoRA collection.

Keep the provider's default safety checker for this initial Standard-mode test.
Record returned safety flags and black/rejected outputs as unusable, never as
successful quality samples. Retain request IDs and all downloaded results.

Measure submission acknowledgment, observed queue/startup, observed processing,
provider timing fields, result lookup, download, decoding/hash verification,
total time to saved files, and batch completion time. Poll timing is approximate;
missed stages stay unknown. Record actual billed cost per request, per image and
per usable image. No fabricated per-stage costs: fal charges requests and does
not expose an itemized GPU cost for each span. Model load/adapter load and GPU
cold start are not separately identifiable unless fal exposes them.

Review composition, face consistency, detail, prompt adherence and the intended
LoRA effect side by side. Existing local and fal images are a practical quality
comparison, not a controlled precision experiment. One single and one batch do
not establish cold-start, average or p95 performance. Never resubmit an ambiguous
POST automatically; resume from durable provider acknowledgments.

## What prevents claiming complete parity today

- **Private LoRAs and Spicy mode:** the current image route uses a private preset.
  Fal's [API contract](https://fal.ai/models/fal-ai/krea-2/turbo/lora/api) says
  disabling its output safety checker requires account authorization; otherwise
  flagged outputs are black. This account's authorization and the private
  adapter's compatibility have not been verified. Generic LoRA support alone
  does not establish current Spicy-mode parity.
- **Image identity editing:** weights are in the manifest, but the app's
  `README.md` and `studio/VALIDATION.md` explicitly mark identity editing
  unfinished/deferred. The inspected text-to-image route has no reference-image
  input; an identity-conditioning LoRA cannot become an image-editing API just
  by loading its weights. This is deferred work, not a working feature to migrate.
- **Other H3 routes:** the completed spike covered one mixed-reference HQ request.
  Text-to-video, first/last frames, selected LoRAs, alternate aspect ratios,
  duration choices, cancellation, recovery and batch behavior need mapping and
  acceptance before removing their working implementation.
- **Music:** YuE2 appears in future architecture research, but is not an exposed
  workflow in the inspected app. It is not part of this image/video replacement.

## Simpler application target

Keep the browser UI, chats, approvals, media library, SQLite history and local
preview/export tools. The server owns one fal credential and translates jobs
into Krea Turbo (optional LoRAs) or standard H3 (optional LoRAs), saves the fal
request ID, follows the queue, downloads outputs into the existing library, and
records costs. No H3 Max mode in the new product surface.

`server/jobs.ts` is currently coupled to `WorkerConnection`, Comfy graphs,
workspace/session identities and transfer receipts. Replace that execution path
while preserving durable submission recovery, cancellation, history and saved
assets. Do not silently reinterpret historical `quality: fast` jobs as HQ.

After hosted acceptance, remove the active rented-worker implementation:
provider-specific modules in `operations/`, `server/gpu-cli.ts`, worker connection
and transfer code, model-cache/download code, the Comfy worker image/build,
provider setup fields, GPU CLI commands and their obsolete tests/build packaging.
Update the Seed skill and operational docs. Migrate settings without deleting
the user's media, history or private credentials as a side effect. Retain relevant
research/results as historical evidence rather than treating every mention of
Vast or RunPod as executable infrastructure.

The current app permits batches of 16; fal's native image request permits four.
The integration must choose one fal request per application image or explicitly
track groups of up to four, including partial results, per-image seeds and
cancellation semantics. Either can avoid GPU management. The proposed native
four-image spike measures only the latter request shape.

Confidence: high that fal supplies the required Krea text-to-image/LoRA interface;
moderate that it can replace every current workflow without a product change.
The normal five-image run above now supplies the first live evidence. Remaining
work is concrete private-adapter/account checks, H3 route acceptance and the
application integration before deleting worker support.
