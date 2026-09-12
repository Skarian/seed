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
and required eight-step turbo LoRA. The optional content LoRA follows the technical
adapter and feeds both guider and scheduler. Do not mix route-specific weights.

First-frame FL uses native first-frame conditioning. Last-frame and mixed Ref
anchors use AddGuide with the original joint latent retained for sampling. Schema
acceptance alone does not prove visual influence; maximum-reference/long-duration
and last-frame influence validation remain explicit capacity/quality work.

SeedLoadVideo reads prepared MP4s. SeedVideoSave writes exact 5/10/15-second,
24fps H.264/AAC exports: 120/240/360 frames from native 124/243/362-frame sampling.
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
