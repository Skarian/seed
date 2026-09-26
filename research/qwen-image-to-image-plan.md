# Qwen 2.1 Image to image — implementation plan

Date: 2026-09-23
Status: approved and implemented through offline validation and Image container publication on 2026-09-23. Paused before the paid RTX 5090 test as requested. See [implementation and validation report](qwen-image-edit-implementation.md). The proposal below preserves the pre-implementation context; the report records the shipped assets and measured checks.

## Recommended scope

Add **Image to image** to Seed's Generate and Chat workflows, using Qwen Image 2.1 on the existing **Image** worker class. Keep Krea as Text to image and H3 on Video workers. A source image, an editing instruction, optional reference images, Quantity and Seed should be enough to use it.

Reuse the current submission, queue, upload, preview, library, worker acquisition and shutdown paths. Run Krea and Qwen through the Image worker's existing ComfyUI engine. Use the official Qwen editing template as the starting point, targeting a single RTX 5090 32 GB. Remove assumptions that every non-Krea workflow is video. A second Diffusers engine and process-switching supervisor are unnecessary for this direction.

The original proposal overemphasized the memory requirements of our packaged full-BF16 Diffusers setup. The official ComfyUI edit template instead selects INT8 ConvRot diffusion and text-encoder weights, a BF16 VAE, 25 steps and CFG 1. This is the proposed serving baseline; it is not equivalent to the original full-BF16/40-step proposal. [Official ComfyUI editing template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json).

Proposed first-release boundary:

- Instruction-based editing with one explicitly selected source image and optional additional image references. Reference count is bounded by a tested worker profile; do not advertise the model's maximum as verified on every GPU.
- About 1 MP output, matching the source's aspect ratio. Preserve the complete input rather than silently cropping it. No arbitrary output-size controls initially.
- Existing Quantity range and seed behavior; one durable output job per seed.
- PNG results, normal preview/library handling, and an **Edit image** action on an image's preview.
- No masking/painting UI, Qwen-specific LoRA import, new Qwen text-to-image selector, or new worker class in this phase.
- No edit-strength slider: this pipeline does not expose the conventional img2img `strength` argument.

Working assumption: include optional reference images. This can be reduced to single-source editing without changing the worker architecture.

## What is already present

| Area | Verified state | Consequence |
| --- | --- | --- |
| Model assets | `worker/qwen-model.json` pins `Qwen/Qwen-Image-2.1` at `790c92633540aa0cb11d9abf19eb46d861714758`; approximately 33.13 GB of assets | No new model acquisition flow in the app |
| Container | Full-BF16 Diffusers assets are baked into the Image image at `/opt/models/qwen-image-2.1` | Replace these with pinned Comfy-compatible serving assets; avoid shipping both formats without a use case |
| Runtime | Separate `/opt/qwen-venv`, pinned Diffusers commit `8b3c707ebd3ec4881f4190cf42931da07eaf3b65`; existing Comfy pin lacks the QwenImage21 model class | Upgrade and pin ComfyUI in the Image target, regression-test Krea; the unused Diffusers overlay can then be removed |
| Verification | Existing build verifies assets and offline import | This is not evidence of successful Qwen CUDA inference |
| Execution | `worker/run.py` launches ComfyUI; submissions and capabilities already use it | Extend the existing graph, capability and receipt paths for Qwen |
| Workflow contract | Three workflows; several layers use `workflow !== 'text-to-image'` to mean video | Explicit workflow classification is required before adding the fourth |
| Image hardware | Current minimum is nominally 32 GB VRAM | RTX 5090 is the intended baseline; verify our exact graph, reference count and latency on it |

The official model supports editing and multiple conditioning images. The ComfyUI template uses image 1 as the edit target and subsequent images as references. Keep that ordering explicit. The previously inspected Diffusers pipeline instead derives automatic sizing from its last condition image; do not mix its behavior into the Comfy graph. [Official model card](https://huggingface.co/Qwen/Qwen-Image-2.1), [ComfyUI editing template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json).

## User experience

### Generate

1. Choose **Image to image**.
2. Upload or choose a source image from the Library. Show its thumbnail using the existing input preview component.
3. Optionally add reference images for a person, object, outfit or style. Identify the source separately from these references. Only images are accepted.
4. Enter an instruction such as “Change the background to a beach, keeping the person and clothing the same.” Reuse `PromptField`, including image mentions when references are present.
5. Choose Quantity and Seed in the existing full-width settings layout. Default output shape follows the source. Do not show H3 controls, Krea LoRAs, an empty LoRA section, or per-generation prices.
6. Submit through the existing queue. If no compatible worker is available, the request waits and the GPU panel offers compatible Image workers.
7. Use existing submission/completion toasts and compact result thumbnails. Clicking a result opens the normal preview; it is also saved under Images in the Library.

Reuse shared field/input components and hooks, with a workflow-specific policy for accepted media and roles. Do not fork the Generate page or copy its form into Chat.

Drafts must be isolated by workflow and mode, including their source/reference selections. Existing `useReferences()` state is separate from the draft reducer: consolidate its durable selections with the workflow draft, retaining transient file/upload state in a keyed hook. Persist asset IDs after upload, never blob URLs or raw File objects. Switching workflows must not leak inputs, results, errors or prompt bindings.

### Preview and Library

Add **Edit image** for uploaded and generated image assets. It opens an Image to image draft with that asset as the source; it does not submit a job. Preserve an existing nonempty edit draft with the app's normal replacement interaction.

Keep “repeat this request” separate from “edit this output”: the former repeats the original workflow; the latter creates a new edit linked to the selected output asset. Store source/reference asset IDs, instruction, resolved dimensions, seed and runtime profile with each result. Never overwrite the original image. Preserve PNG alpha through upload, preparation and saving where supported, without adding a separate transparency editor.

### Chat

Add Image to image to the current workflow selector and existing create/edit request tools. The model selects an explicitly supplied source handle and optional image-reference handles, then writes a complete editing instruction. Tools create review cards; approval uses the existing job submission path.

Use the same request validator, input previews and settings components as Generate. Instructions should ask what to edit if no source is available, distinguish the source from reference images, and describe intended changes and retained details. Compile stable input handles to Qwen's own image ordering, rather than importing H3's multimodal prompt format. If references change, preserve or reject bindings explicitly; never silently redirect an instruction to a different image.

Qwen requests expose no LoRA tool field in this release. Krea/H3 adapters must not appear compatible merely because Qwen uses the Image worker class. Existing server-side asset visibility rules and hidden mode behavior still apply.

## Shared contracts and server integration

### Explicit workflow definitions

Extend `shared/workflows.ts` into a small, typed definition table for worker class, engine, input policy, output kind and adapter family. Keep display labels and IDs synchronized. Replace the relevant image-versus-video ternaries across drafts, request settings, Chat schemas, dispatch, retrieval and worker capacity checks.

Make the request type a discriminated `GenerationRequest` union, retaining an `ImageRequest` alias temporarily if useful for a contained migration. Existing serialized requests remain valid. Do not rewrite old jobs or library assets.

Illustrative edit request:

```json
{
  "workflow": "image-to-image",
  "mode": "sfw",
  "prompt": "Change the background to a sunset beach; preserve the person.",
  "references": [
    { "id": "source", "asset_id": "asset-id", "kind": "image", "role": "source" }
  ],
  "output": { "aspect": "source", "size": "1mp" },
  "count": 1,
  "seed": "random"
}
```

The server validates exactly one source, image-only references, source availability/visibility, input limits, dimensions, prompt, quantity and seed. Reject video/audio controls and unsupported LoRAs rather than ignoring them. Resolve output dimensions once from EXIF-corrected source dimensions, round to valid model dimensions, and persist those dimensions before dispatch. Bound extreme aspect ratios and decoded pixel counts; provide an actionable validation error instead of allocating unbounded memory.

### Media preparation

`Media.prepare()` currently contains H3-specific dimensions and video handling. Extract a shared safe image-normalization helper and give Qwen its own recipe/cache version. Preserve orientation, aspect and alpha; remove video-specific resize/crop rules from the Qwen path. Reuse resumable uploads, asset checksums and worker transfer integrity checks. Each prepared input has a stable ordering and digest.

Use existing asset-retention/deletion rules for every source/reference while a job is queued or active. A deleted or corrupt input must fail clearly before dispatch. Closing a browser during upload may interrupt an unsubmitted draft; once the server accepts a job, execution and recovery must be independent of the browser.

### Scheduling and worker compatibility

Image worker class alone is not sufficient eligibility. Advertise concrete workflow/profile capabilities, qualified input/output limits, and engine readiness separately from whether the model is currently resident. Feed these capabilities into pool selection and UI capacity checks.

Old workers continue serving their existing supported workflows. A Qwen edit waits for a compatible new Image worker and explains why an older Image worker cannot run it. Keep older workers visible and releasable. Update the protocol checks deliberately: several currently require version 2 exactly. Prefer an additive capability extension where sufficient; if dispatch needs a new protocol version, support the old version's recovery/shutdown path explicitly.

Keep existing per-output job records and idempotency. Quantity 4 creates four independently tracked outputs, schedulable across compatible Image workers through the current pool. A worker has one active output slot. Reuse ComfyUI's loaded models across consecutive edits, without introducing a second hidden batch queue or silently reordering jobs for model affinity.

## Image worker execution

### Extend the existing ComfyUI path

Pin a ComfyUI revision and dependencies that contain the official Qwen 2.1 nodes. Apply the runtime update to the Image target only and verify the existing Krea graph and LoRA path against it. Keep the Video image's proven runtime unchanged.

Adapt the official editing template into a server-generated API graph with prepared input filenames, prompt, seed, dimensions and an allowlisted runtime profile. Flatten template subgraphs as needed; its frontend JSON is not itself an API graph. Map its output into the existing checksummed PNG/receipt contract, verifying that RGBA survives the chosen save node. Do not accept arbitrary graphs, Python or remote URLs from the application client.

Execution:

```text
Accepted job -> reserve worker slot -> verify inputs/profile
             -> ComfyUI loads/offloads required model components
             -> encode -> denoise -> decode/save -> durable result manifest
             -> app downloads and verifies -> acknowledgment/cleanup
```

- Use one Comfy process and its existing memory manager. Do not force Krea and Qwen to remain simultaneously GPU-resident, or restart the process routinely between them.
- Test Krea → Qwen → Krea explicitly for model/cache isolation and memory recovery. Add explicit unloading only if the measured default behavior needs it.
- Pin the Comfy-Org diffusion, encoder and VAE artifacts by revision and hash. Replace the baked Diffusers assets with these files, integrate their model paths and readiness verification, and preserve offline inference. Downloads during image building come directly from the model host; no weights pass through the Seed app.
- Keep the selected model warm where memory permits. Model switching and an empty queue never release the rental.
- Preserve existing worker and engine-session identity and durable receipts. A model load is normal job activity, not a worker reconnect.
- Report “Loading image editor”, “Editing”, and “Saving” as job/activity phases. Use actual step progress where available; do not invent a completion ETA from step count.

Reuse the existing Comfy plugin's durable admission, spool and terminal manifests. Extend its profile validation and capability reporting to recognize Qwen editing independently of Krea LoRAs. An uncertain HTTP response must reconcile without duplicating generation. A terminal manifest appears only after the complete PNG is validated and saved. A process crash produces a recoverable failure, not an automatically repeated job.

### Runtime profile and hardware qualification

Use the official template's serving profile: INT8 ConvRot DiT, INT8 ConvRot Qwen3-VL 8B encoder, BF16 VAE, Euler/simple, 25 steps and CFG 1. Pin the actual template/runtime revisions during implementation. Record precision, scheduler, steps, cache behavior, seed and resolved dimensions with each job. These are reproducibility metadata, not additional UI controls. Quantization and fewer steps are quality/performance choices, not claims of equivalence to BF16/40-step output.

Target **1× RTX 5090 32 GB** with ComfyUI's normal memory management. The old plan's 33.13 GB Diffusers artifact total is not the VRAM requirement of this INT8 serving graph. Verify host RAM, reference-count limits and peak VRAM, but do not require 96 GB or add a second runtime preemptively.

For additional evidence, SGLang's official recipe explicitly includes an RTX 5090 with component offload, although its 5090 recipe has not been retested against the updated checkpoint. That confirms an intended consumer-GPU path, not a measured ComfyUI latency. Our remaining test is the exact Seed integration and workload limits. [SGLang hardware guidance](https://docs.sglang.io/cookbook/diffusion/Qwen-Image/Qwen-Image-2.1).

### Cancellation, shutdown and recovery

Cancellation must work during model loading as well as denoising and saving. Use cooperative cancellation at safe boundaries and a bounded process-group termination fallback. A cancelled run must not publish a partial or late image as success. Restore engine readiness before taking another job.

Both existing shutdown choices remain available throughout model loading and execution: **Finish jobs and quit** follows the pool's existing drain boundary; **Cancel jobs and quit now** cancels assigned work and releases compute even if an inference child is hung. Costs continue accruing during loading and waiting and remain visible in the existing hourly/elapsed totals.

Browser closure does not affect work. App-server restart reconciles persisted submissions and worker receipts. If the worker disappears, report the existing needs-attention/recovery flow; do not rent a replacement or duplicate an uncertain execution automatically.

## Implementation order

| Step | Deliverable | Exit condition |
| --- | --- | --- |
| 1. Contracts and media | Workflow definitions, request union/validator, source role, sizing, normalized inputs | Invalid routes/settings rejected; existing three workflows unchanged |
| 2. Worker execution | Pinned Image Comfy runtime, Qwen graph/assets/capabilities, existing results/cancel path | Required nodes and models validate; lifecycle harness passes; Krea regression checks pass |
| 3. Generate and preview | Shared image-input policy, isolated drafts, settings, Edit image entry point, queue status | Upload/library source and repeat/edit behavior work end to end with fixture execution |
| 4. Chat | Schemas, prompts, bindings, review cards and approval | Chat and Generate produce the same validated edit request |
| 5. QA and release candidate | Contract/lifecycle regression tests, desktop/mobile visual atlas, rebuilt Image image | Individual screenshot review, fixes and offline container checks complete |
| 6. GPU qualification | Approved real edits, model switching and memory/timing measurements | At least one declared hardware profile passes; only then advertise Qwen editing as ready |

Only the Image image needs a new model-execution release. Do not republish the Video image merely because app contracts changed; rebuild it only if a shared worker change actually affects it. Publication and any real GPU work should be explicit follow-up steps to this planning task.

## Validation and acceptance

### Automated and offline

- Contract tests: one source required, wrong media, unavailable asset, source/reference role handling, excessive inputs, extreme dimensions, forbidden controls/LoRAs, seed resolution and idempotency.
- Routing tests: all four workflows choose the correct worker/engine/output MIME; an old Krea worker cannot receive a Qwen job.
- Media tests: EXIF rotation, portrait/landscape/square, alpha, invalid files, preparation-cache separation, source-first dimension choice regardless of reference ordering.
- Lifecycle harness: Krea → Qwen → Krea, warm consecutive edits, concurrent submissions, loading failure/OOM, engine crash, cancellation during load/steps/save, duplicate admission, app restart, reconnect, receipt mismatch and both shutdown choices.
- Regression tests: Krea/H3 dispatch and adapter behavior, download integrity, pool spending, persisted drafts, repeat requests and library output classification.
- Container checks: exact pinned dependencies/assets, Qwen node/model support, offline graph validation, private API authentication, process ownership/cleanup and no download attempt at Qwen inference startup.

### Visual QA

Extend the existing atlas, not a separate demo app. Capture desktop and mobile scenarios with numbered titles. Inspect each full-resolution screenshot individually, log findings, deduplicate/fix and recapture before producing the mosaics.

Cover empty form; upload/verifying/error; library source; source plus references; reordered/removed references; seed/settings; queued without capacity; incompatible old worker; model loading; running/cancelling; failed/retry; completed preview; Edit image from Library; Chat creation/revision/approval; workflow switching without draft/result leakage; and GPU panel shutdown during a model change. Include long filenames/prompts, keyboard focus and narrow-screen overflow.

### Real GPU test, after approval

Use ordinary non-sensitive fixture photos on an RTX 5090 and keep a declared spend ceiling. Measure first edit, warm edit, Quantity 4, reference conditioning and Krea → Qwen → Krea. Record input transfer, model load/offload, conditioning, denoising, decoding, result download, peak GPU/host memory and total billed worker time. Include cancellation and verify provider release at the end of the test.

Evaluate instruction following and preservation of the subject/layout, not merely successful PNG creation. Test deterministic request replay under a fixed runtime profile, without claiming bit-identical results across different hardware or execution profiles. Report measured performance before promising latency or broad GPU compatibility.

Done means the same edit works through Generate and Chat, produces a traceable Library image, survives browser closure, can always be cancelled/released, and alternates with Krea without stale state or GPU memory contention. Packaging and mocked UI success alone are insufficient.

## Main files affected

| Area | Existing files to extend |
| --- | --- |
| Contracts/routing | `shared/generation.ts`, `shared/studio.ts`, `shared/workflows.ts`, `shared/pool.ts`, `shared/jobs.ts`, `shared/chat.ts` |
| Validation/media/jobs | `server/workflows.ts`, `server/media.ts`, `server/jobs.ts`, `server/worker-graphs.ts` |
| Pool/transport | `server/pool.ts`, `server/pool-worker.ts`, `server/worker.ts` |
| Worker | Image Docker target and Qwen asset manifest/builder, `worker/profile.py`, Comfy plugin capability/profile validation and output handling |
| Generate/shared UI | `web/generate.tsx`, `web/generation-draft.ts`, generation hooks, `web/references.tsx`, request fields/settings, workflow labels |
| Chat | `server/chat/request-tools.ts`, `server/chat/service.ts`, workflow prompts, shared request/input review components |
| Preview/Library | Existing media preview and image actions; explicit asset-to-edit draft handoff |
| QA/release | Existing workflow/lifecycle tests, browser atlas, Image Docker target and release evidence |

Confidence is high that RTX 5090 is an appropriate target with the official ComfyUI serving configuration. The exact pinned integration, edit quality, reference limits and latency still require a bounded GPU validation run. This is ordinary release verification, not a reason to design around a larger GPU.
