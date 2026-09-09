# Qwen Rapid AIO v19

Use [START-HERE.md](START-HERE.md) for the current pod, login and startup instructions.

Open **Workflows → Neil Qwen Rapid → 10 - Qwen Rapid AIO v19 - Image Edit**. Refresh the workflow list/page if needed. Upload a source in Load Image, change the positive edit instruction, and Run. The bundled source is a generated adult portrait used in the earlier Krea acceptance test.

Defaults: 1024×1024, 4 steps, CFG 1, Euler ancestral/beta, denoise 1, fixed seed 20260908. Try 8 steps for a comparison. Match output aspect ratio to your source; the author's sizing fix center-crops references to the target ratio. Outputs save in `/workspace/ComfyUI/output/QwenRapid/`.

Installed checkpoint: `Qwen-Rapid-AIO-NSFW-v19.safetensors`, the author's NSFW variant selected for the requested content flexibility. This is a 28,431,843,583-byte FP8 all-in-one checkpoint containing the diffusion model, text encoder, and VAE. No extra acceleration LoRA is required. The workflow is adapted from the author's example for a single image and persistent saved output.

The author's `fixed-textencode-node/nodes_qwen.v2.py` is installed as a separate custom extension, exposing `Phr00tTextEncodeQwenImageEditPlus`. Core ComfyUI nodes are not replaced. The target latent is connected to the encoder for reference sizing.

Upstream: https://huggingface.co/Phr00t/Qwen-Image-Edit-Rapid-AIO

Pinned revision: `691024f438640508f8aa86414863fc15edfb8a84`

Expected SHA-256: `ba71575515709c9912560d1176b2386eaa49294fedc6ce57b9734aa57e91e5ac`

Download completed and exact file size checked. SHA-256 verification was stopped at the user's request; the expected hash above is upstream metadata, not a completed verification result.

The persistent network volume `f7vnixgws1` was expanded from 120 GB to 150 GB with user approval. Models, custom nodes, saved workflows, inputs, and outputs are on that volume. Workflow and node source backups are also in this local project. Existing H3 and Krea workflows remain available.

Validation passed through the externally accessible authenticated ComfyUI API. A 1024×1024 four-step edit completed in 63.713 seconds, including initial model loading. The result was downloaded and visually inspected: blue jacket became red, with recognizable face, pose, hair and background retained. The jacket's tailoring also changed, so this is not exact pixel-preserving recoloring. This single test does not establish performance across other edits. Browser Run was not separately tested; the saved graph's links and server read-back were checked, and its matching API graph executed successfully.

Evidence: `qwen-history.json`; local output `samples/qwen-rapid-v19-edit.png`. Prompt ID: `3e889aa1-d122-45b1-a83b-1b910123ac41`.
