# Setup, software release and model sources

Revision 5, planning only. See [current direction](CURRENT-DIRECTION.md). Terraform, provider modules, OCI model artifacts and PC model-packaging are removed from the preferred plan.

## Simple setup

The local runpod-setup utility reads a Git-ignored .env RunPod key. It discovers existing resources, reuses the saved volume ID or asks the owner to select one, asks for data center/capacity, and shows current storage pricing before creating a new volume. Recommend capacity from unique model files plus temporary downloads, activation headroom and a bounded operational spool budget. Do not confuse that capacity estimate with a user upload-size limit. Save selected volume ID and generated pairing secret; rerunning never rotates secrets or duplicates resources automatically. After uncertain create results, reconcile before retrying.

Print the shared template link and explicit instructions for selecting the volume/GPU and supplying pairing/download credentials. No local model download, packing, S3 preload or pod provisioning in this utility. Preflight model metadata/access without downloading weights. No RunPod API key in the GPU worker or web request handler.

## Published software

Keep one complete pinned GHCR image for the worker, ComfyUI, custom nodes, Jupyter, media tools and HF download client. Pin compatible workflows/model manifest with it. Normal start must not run apt/pip/git updates. Audit inherited launcher downloads and mount overrides. Models remain separate files downloaded directly onto the reusable volume; no ORAS, model mirroring or large archive construction.

## Hugging Face source inventory

Checked against local graph filenames and upstream listings on 9 September 2026. File availability is not proof of byte identity with installed copies or successful authenticated download. Resolve/pin full revisions and size/integrity metadata before implementation.

| Required assets | Located source |
|---|---|
| Krea turbo INT8, Qwen3VL 4B encoder, Qwen image VAE | [Comfy-Org/Krea-2](https://huggingface.co/Comfy-Org/Krea-2/tree/main); exact existing references in deployment/krea2-assets.json |
| Identity Edit v1.2 LoRA | [conradlocke/krea2-identity-edit](https://huggingface.co/conradlocke/krea2-identity-edit) |
| H3 FL2VA and Ref2VA pruned INT8 ConvRot | [Comfy-Org/MiniMax-H3 diffusion models](https://huggingface.co/Comfy-Org/MiniMax-H3/tree/main/diffusion_models) |
| H3 Qwen3VL 32B INT8 ConvRot encoder | [H3 text encoders](https://huggingface.co/Comfy-Org/MiniMax-H3/tree/main/text_encoders) |
| H3 video FP16/audio FP32 VAEs | [H3 VAEs](https://huggingface.co/Comfy-Org/MiniMax-H3/tree/main/vae) |
| Exact FL2V 8-step 768p Comfy LoRA | [lightx2v file](https://huggingface.co/lightx2v/Minimax-h3-Turbo/blob/main/minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors) |
| Exact Ref2V 8-step 768p Comfy LoRA | [lightx2v file](https://huggingface.co/lightx2v/Minimax-h3-Turbo/blob/main/minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors) |
| Owner-selected SFW/NSFW content LoRAs | Not selected/verified; current example uses Civitai. HF-only coverage is not established. |

Use [HF download tooling](https://huggingface.co/docs/huggingface_hub/guides/cli) and a [read/fine-grained token](https://huggingface.co/docs/hub/security-tokens) for necessary access. Public ungated files do not inherently require a token. Gated access must be approved for the owner's account; a token alone does not grant it. Keep tokens out of public templates, logs and pairing payloads. Configure them privately on deployment. Source-specific content LoRAs can require their own credentials; do not silently substitute or mirror files.

Stage missing files, verify new downloads, then promote complete artifacts. Use completed metadata for warm starts, without full hash scans. Cache/download metadata live on the volume to avoid duplicate copies. Never download entire model repositories with unused precision variants. Existing models and spool data survive replacement. No generation as startup verification.

## Evidence gates

- Preflight exact required assets and owner access before paid setup; test actual cold downloads later.
- Empty volume becomes usable; interrupted preparation retries safely; complete cache performs no model downloads.
- Changed LoRA fetches only missing assets and atomically activates a complete preset; queued jobs retain settings.
- Connection page stays reachable during preparation and pairs before engine readiness.
- Output transfers survive PC disconnect and pod replacement on the same volume; repeated receipt/cleanup is harmless.
- Local studio works with GPU off and supports ordinary reverse-proxy hosting. The owner supplies external hosting separately.

Home-hosted model distribution remains an alternative only if selected later; it is not a second downloader to build now.

## Owner LoRA updates

Use the [Civitai REST API](https://github.com/civitai/civitai/wiki/REST-API-Reference) to resolve configured model-version/file IDs, download metadata and authenticated download locations. Download only explicitly selected assets on the pod into the reusable volume. Keep credentials separate from manifests/logs. Do not auto-upgrade to latest or rebuild the runtime image for a LoRA change. Pin the selection, stage/verify, then activate a complete compatible preset while dispatch is paused. Existing queued jobs retain their frozen preset. Exact current API fields and private/gated download behavior require live validation.

## GitHub publication layout

GHCR is GitHub Container Registry, part of the GitHub publishing setup. Use the GitHub repository for source/plans, GitHub Releases for the downloadable Windows application/setup package, and a public GHCR package for the RunPod worker container. A release ZIP is not a container-registry image reference. Public worker images allow anonymous pulls, so a deployment does not need a private GHCR pull credential; publishing still needs authorized GitHub access.

The owner is comfortable with public software artifacts. Repository visibility is separate from package visibility: retain current repository visibility until its source/history and private operational material have been reviewed as part of the publication decision. Do not publish personal media, credentials, local configuration or model weights. This note does not change remote visibility or publish anything.

References: [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).
