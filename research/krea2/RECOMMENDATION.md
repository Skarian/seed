# Krea 2 and Identity Edit research — 8 September 2026

Recommendation: add native Krea 2 Turbo INT8 ConvRot, the FP8 Qwen3VL 4B encoder, Qwen Image VAE, and full Identity Edit v1.2. Keep the RTX PRO 6000 Blackwell and existing ComfyUI installation. Begin with generation and single-reference editing; defer Raw and optional styles until a concrete need arises. No pod changes or weight downloads were performed for this research.

**What these models do**

Krea 2 supplies downloadable image-generation weights. Identity Edit is an independent community editing LoRA, sharing the generator and encoder rather than requiring another full model. The official ComfyUI generation workflow is the appropriate starting point. Krea's style-reference workflow is a different tool: it borrows visual style, rather than supplying Identity Edit's person-preservation behavior. [Official ComfyUI guide](https://docs.comfy.org/tutorials/image/krea/krea-2), [Identity Edit repository](https://github.com/lbouaraba/comfyui-krea2edit).

**Downloads and storage**

Exact file sizes were retrieved from Hugging Face metadata; copies are beside this report. Decimal GB, not GiB:

| Asset | Bytes | GB |
|---|---:|---:|
| krea2_turbo_int8_convrot.safetensors | 13,492,686,496 | 13.493 |
| qwen3vl_4b_fp8_scaled.safetensors | 5,242,467,968 | 5.242 |
| qwen_image_vae.safetensors | 253,806,246 | 0.254 |
| krea2_identity_edit_v1_2.safetensors | 1,828,256,432 | 1.828 |
| Total | 20,817,217,142 | 20.817 |

[Krea model files](https://huggingface.co/Comfy-Org/Krea-2/tree/main), [Identity Edit files](https://huggingface.co/conradlocke/krea2-identity-edit/tree/main).

Your saved inventory contains about 81.513 GB of existing ComfyUI/model data. Together these would occupy roughly 102.33 GB before further outputs and caches. A 110 GB volume would leave approximately 7.67 GB; 120 GB would preserve approximately 17.67 GB. At the existing volume's recorded $0.07/GB/month rate, these would be $7.70 or $8.40/month respectively; recheck the rate before resizing. The larger option adds only $1.40/month to the present $7.00.

Using FP8 diffusion instead reduces the bundle to 20.466 GB. Reduced-rank editing LoRAs save 0.914 GB (r128) or 1.371 GB (r64), but still do not make this bundle fit the current free space. Full rank is my baseline because your GPU has ample VRAM; the maintainer's near-identical-quality claim for reduced rank has not been independently established here. Raw INT8 would add another 13.493 GB; Raw BF16 another 26.283 GB. Style Reference adds 0.457 GB. Do not download the entire repositories.

**Workflows to use**

1. Generate: the [official Turbo workflow](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_krea2_turbo_t2i.json), using native loaders and the selected model. Begin at 1024 square, batch one, 8 steps, Euler/simple, CFG 1. Use descriptive natural-language prompts; quote text that should appear in the image. Keep prompt expansion off for reproducible comparisons, then evaluate it separately. [Krea prompting guide](https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md).
2. Edit: the [maintainer's workflow](https://github.com/lbouaraba/comfyui-krea2edit/blob/main/workflows/krea2_identity_edit.json), full v1.2 LoRA at strength 1, Turbo 8–12 steps, CFG 1. Start at about 1 MP, grounding 768, reference boost 4 for strong likeness. Give an explicit change instruction. Scene-plus-person uses scene first, person second. Stay at or below 2 MP initially; 2048 square is over 4 MP. Raw at about 20 steps/CFG 3 is an optional removal workflow, with the negative conditioning grounded on the same reference. [Model card](https://huggingface.co/conradlocke/krea2-identity-edit).
3. Animate: save the approved image, then load it into the existing H3 image-to-video workflow. Preserve that image and its workflow as a reproducible intermediate. This is a proposed integration, not a tested Krea-to-H3 run.

**Compatibility and fixes worth keeping**

The saved `deployment/object_info.json` confirms native Krea support and `CLIPLoader` type `krea2`. The supplied edit graph's only missing execution nodes are `Krea2EditModelPatch` and `Krea2EditGroundedEncode`; `Note` is a frontend annotation. Install the matching node pack when deployment is authorized; no blanket ComfyUI upgrade is indicated by this inventory check. Graph presence does not prove runtime compatibility.

Use node pack v1.2.5 or a verified later revision with its matching workflow. Its `target_latent` connection pre-encodes references outside sampling, avoiding VAE-driven model eviction. The earlier geometry fix addresses outpainting alignment; FIT geometry accommodates differing source/output aspect ratios. Euler is preferable to stochastic er_sde for outpainting. These are better first moves than piling on cache nodes or alternate VAEs. [Maintainer changelog](https://github.com/lbouaraba/comfyui-krea2edit/blob/main/CHANGELOG.md).

The reported INT8 failure concerns the quantized text encoder under memory staging. The maintainer explicitly identifies the FP8 encoder as a workaround; it does not establish that INT8 diffusion is broken. We select FP8 text encoding accordingly. [Issue 19 and diagnosis](https://github.com/lbouaraba/comfyui-krea2edit/issues/19). A separate user fixed missing input errors by updating mismatched nodes, supporting pinning the workflow and node version together. [Issue 23](https://github.com/lbouaraba/comfyui-krea2edit/issues/23).

**Performance evidence**

A firsthand community benchmark used the same RTX PRO 6000 Blackwell Server Edition, 8-step generation, batch one, two discarded warmups and ten measured runs per format/resolution:

| Format | 1024 square | 2048 square |
|---|---:|---:|
| INT8 ConvRot | 2.424 s | 12.949 s |
| FP8 scaled | 2.855 s | 13.736 s |
| BF16 | 3.319 s | 15.887 s |
| INT4 ConvRot | 2.578 s | 12.678 s |

These are warm end-to-end generation medians, not Identity Edit or pod-start timings. The test used a BF16 encoder and a different software revision. It measures speed, not visual quality. Native INT8 is the initial choice because INT4 offers little additional speed here and memory is plentiful. [Full benchmark and methodology](https://www.reddit.com/r/StableDiffusion/comments/1uva117/krea_2_turbo_comfyui_speed_benchmark_8_model/).

No sufficiently controlled Identity Edit benchmark for your exact setup was verified. Reference encoding, additional image tokens, two references, and model loading add work; do not promise the generation timings for edits. At the previously recorded ~$2.11/hour running rate, 2.424 seconds represents ~$0.0014 of compute and 12.949 seconds ~$0.0076, excluding idle time, startup and storage. These are arithmetic illustrations, not per-image billing prices.

**Quality and acceptance**

Identity Edit can preserve texture while drifting facial proportions; clothing changes and removals remain inconsistent. Even upstream guidance conflicts on chaining versus simultaneous multi-person edits, so neither should be presented as a reliable identity guarantee. Test a small representative set before adopting it for repeat characters. No defensible universal “under 10% quality loss” number emerged. [Model limitations](https://huggingface.co/conradlocke/krea2-identity-edit), [Current node guidance](https://github.com/lbouaraba/comfyui-krea2edit).

When installing later, first verify one generation and one edit with this minimal stack. Then measure cold model load, warm single-reference edit, two-reference edit, and transition to H3. Compare likeness and edit adherence across fixed reference/prompt/seed examples before introducing lower-rank LoRAs, four-bit weights, or caching. Do not add Raw unless removal performance warrants its storage cost.

Krea uses a Community License. Commercial use is subject to a total company-wide trailing-year revenue threshold below $1 million, including affiliates; at or above it, an enterprise license is required. Outputs belong to the user subject to the agreement. [License](https://www.krea.ai/krea-2-licensing).
