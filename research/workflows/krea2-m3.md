# Krea 2 M3 workflow research

Reviewed 2026-09-09. Primary-source comparison; no weights downloaded, credentials read, or GPU used. Runtime compatibility and comparative image quality remain live tests.

## Recommended baseline

Use the official Comfy INT8 Turbo pipeline as the baseline rather than treating our older graph as authoritative. Its sampler matches our existing `deployment/krea2-t2i-api.json`: eight steps, Euler, simple scheduler, CFG 1, denoise 1. The three loaders also match: INT8 ConvRot Turbo diffusion model, Qwen3VL 4B FP8 encoder with `type:krea2`, and Qwen Image VAE. Differences: official uses `EmptyLatentImage`, `ConditioningZeroOut` for negative conditioning, optional `LoraLoaderModelOnly`, and optional local `TextGenerate` prompt enhancement. Our graph uses `EmptySD3LatentImage`, a separately encoded blank negative, and no enhancement/LoRA. Mirror the official latent/conditioning nodes and verify on the pinned engine. The official template defaults to 1024 square and one image. [Official template](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_krea2_turbo_t2i_int8.json)

Keep SFW base-only; NSFW adds the selected SNOFS asset through model-only LoRA loading. Both modes otherwise use the same baseline. Do not silently substitute modes if the selected asset is unavailable. Keep prompt enhancement explicitly optional: it changes the submitted prompt, so freeze any effective expanded text and show it to the owner rather than silently rewriting their instructions.

Krea recommends Turbo for fast high-quality inference and training LoRAs on Raw for application to Turbo. Its native example uses eight steps and guidance zero. This is not a contradiction: Diffusers documents Krea guidance as `cond + scale*(cond-uncond)`, whereas conventional CFG uses `uncond + cfg*(cond-uncond)`. Krea zero corresponds to Comfy CFG one. Do not change Comfy to zero based on the model card. [Krea code/model guidance](https://github.com/krea-ai/krea-2), [Diffusers guidance convention](https://github.com/huggingface/diffusers/blob/main/docs/source/en/api/pipelines/krea2.md)

Krea's prompting guide recommends natural language, detailed descriptions, and quoted literal text; its examples use 2K output. A future direct higher-resolution option is plausible, but the present 1MP choices remain the agreed UI scope pending owner approval and measured runtime. More steps are not automatically better for a distilled model. [Author prompting guide](https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md)

## Selected content adapter: author evidence

Public Civitai metadata confirms model 1972981, version 3290120, `Krea 2 v1.4`, base model `Krea 2`, and an empty trained-words list. The selected file is `snofs_krea_v1_4.safetensors`, file 3174557. The author describes this family as LoKR; the extension `.safetensors` does not establish adapter architecture. Confirm actual key matching in Comfy logs and a visible same-seed effect before declaring support. The author reports v1.4 texture and stacking improvements, recommends natural sentences and explicit photo/photograph wording for photographic results, and advises trying SNOFS alone before stacking other general content adapters. [Version API](https://civitai.com/api/v1/model-versions/3290120), [Model API/author description](https://civitai.com/api/v1/models/1972981), [Owner model page](https://civitai.com/models/1972981?modelVersionId=3290120)

No explicit SNOFS v1.4 strength recommendation was found in those public metadata fields. Starting at 1.0 is an engineering trial, not an author-backed optimum. The description's 0.5–2 advice concerns a different photo-detail slider, not SNOFS itself. Do not append an invented mandatory trigger.

## Quality challenger, not another default workflow

The SNOFS author links a two-stage sampler: begin with Raw to improve variation/adherence, then switch to a Turbo LoRA for speed; optional final Raw stage permits negative guidance. The sampler author's README describes sigma-preserving handoff, optional resolution change, and fixed Turbo shift 1.15 versus Raw resolution-dependent shift. It does not establish universal superiority or one optimal handoff. This requires different assets and a custom node, so keep it as one controlled challenger if the baseline disappoints rather than expanding M3 immediately. [Author-linked sampler](https://github.com/Auryg/Krea-2-Two-Stage-Sampler)

## Quantized adapter caveats and acceptance

An upstream Comfy PR reports peak-memory failures when applying BF16 adapters to quantized Krea weights due to temporary merge/requantization. This is evidence of a compatibility risk, not proof our pinned INT8 runtime is affected or fixed. Record actual Comfy/comfy-kitchen versions, unmatched-key warnings, peak VRAM, and mode-switch behavior. Do not add third-party quantization patches or change checkpoint formats without a reproduced need. [Upstream report and proposed fix](https://github.com/Comfy-Org/ComfyUI/pull/14856)

Live acceptance: use fixed seeds and identical prompts/aspects to compare baseline SFW with the adapter enabled; confirm useful influence and return-to-SFW isolation. Review several photographic, illustration, text-rendering, and composition prompts with the owner, alongside measured latency/VRAM. If evaluating the Raw/Turbo challenger, use the same prompt set and explain extra cost and dependencies. Official provenance gives a strong baseline, not a guarantee of top-tier results for every prompt.
