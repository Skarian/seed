# ComfyUI integration

Graphs are trusted server code, not browser-supplied JSON. The pinned worker image
contains ComfyUI and the narrow Seed integration. Exact assets are pinned in the
model manifest; user content LoRAs are private presets. Software and model pins
must change deliberately and be validated together.

## Images

server/workflows.ts builds Krea 2 text-to-image graphs. Required technical model
components remain in both modes. NSFW selects the configured content LoRA; SFW
omits it. These are presets, not content-classification guarantees. Batches expand
into individual seeded jobs. Identity editing is unfinished; do not present its
form or downloaded assets as proof of a working adapter.

## Video

server/video.ts selects native MiniMaxH3ImageToVideo for text/anchor-only FL and
MiniMaxH3ReferenceToVideo for general references. FL and Ref use their own model
and route-specific adapters. Fast retains the eight-step Turbo graph. High Quality
is an independent checkbox, off by default, and bypasses Turbo: 30-step
res_multistep/simple with video/audio shifts 12/3. Its native dense Comfy Kitchen
backend feeds BlockSparseAttention (Sol, tau 1.3, start 0.2, end 1, minimum 12288
tokens, 256 extra tokens, exact_kv_and_rows conditioning/audio protection).
The optional content LoRA uses strength 0.8 in HQ while retaining its verified
file identity and original preset metadata. Do not mix route-specific weights.
The candidate runtime is ComfyUI v0.35.0 at
40c4fcdf513a4523e39d54a9d391908af8df8171, Kitchen 0.2.33 and Aimdo 0.5.3.
No external attention node package is required. Kernel availability is advertised
separately from Turbo readiness; unavailable HQ never silently becomes Fast.

First-frame FL uses native first-frame conditioning. Last-frame and mixed Ref
anchors use AddGuide with the original joint latent retained for sampling. Schema
acceptance alone does not prove visual influence; maximum-reference/long-duration
and last-frame influence validation remain explicit capacity/quality work.

SeedLoadVideo reads prepared MP4s. New SeedVideoSave native-v1 exports retain the
generated tensor dimensions without resizing or cropping, in both quality modes.
They use H.264 CRF16/medium/yuv420p and AAC256k, 24fps and exactly seconds*24 frames
for integer durations 5 through 15. Frozen legacy graphs without export_version
retain the old 720p export contract. Native MP4s are high-quality compressed files,
not lossless masters; downloads retain the original encoded file unchanged.
Silent output omits the track; it is not a promise of lower compute. Final supplied
soundtrack replacement and raw native AV export are not implemented.

## Protocol and evidence

worker/comfy_seed provides process/session identity, guarded mutations, submission
receipts, terminal output manifests and native statistics aggregation. Seed's
wrapper authenticates access. Native Comfy upload/prompt/history/queue routes
remain the engine integration; no general workflow compiler is added.

Retain model/graph revisions, effective inputs, output properties and sampled
metrics for comparisons. Keep visual/audio quality judgments separate from a
successful graph execution. Never run test inference without authorization.
[Validation](VALIDATION.md) distinguishes live evidence from regression coverage.
The [worker protocol](POD-BOOTSTRAP.md) and [API](API-CONTRACT.md) own transport and
receipt semantics; the skill owns rental decisions and cleanup.
