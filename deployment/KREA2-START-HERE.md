# Krea 2: installed and tested

Use [START-HERE.md](START-HERE.md) for the current pod, login and startup instructions.

In ComfyUI's Workflows sidebar, open **Neil Krea 2**:

- **06 - Krea 2 - Text to image:** change the positive prompt, seed and dimensions, then Run. Default 1024×1024, Turbo 8 steps, Euler/simple, CFG 1.
- **07 - Krea 2 - Identity Edit:** choose/upload a source in Load Image, write your change instruction in the positive grounded-encode node, then Run. Default 1024×1024, 10 steps, CFG 1, full v1.2 LoRA, reference boost 4, grounding 768. The included source is the tested generated portrait. Set a new seed for a different variation; the saved test seed is fixed for reproducibility.

Outputs save under `/workspace/ComfyUI/output/Krea2/`. Models, custom editing nodes, input image and both workflows live on the persistent volume. Existing H3 workflows remain in **Neil H3**. To animate an image, save it and load it into H3's image-to-video workflow.

**Verified 8 September 2026**

Actual requests were submitted through the externally accessible authenticated ComfyUI API. Both completed successfully, outputs were downloaded, and the images were visually inspected.

| Test | Time | Result |
|---|---:|---|
| Text to image, 1024², 8 steps | 6.429 s | Portrait generated successfully |
| Identity Edit, 1024², 10 steps | 17.728 s | Blue jacket changed to red; recognizable person, pose and backdrop retained |
| Edit with reference boost 1 | 6.092 s | Completed; did not solve added skin texture |
| FP8 diffusion comparison | 10.383 s | Completed; similar added texture, so INT8 retained |

These are individual measured runs, not averages. Caching differs between runs; the last two reuse reference/text conditioning. Times exclude pod startup and downloads. Tests establish the generation and single-image editing paths; they do not establish all possible editing tasks or two-reference accuracy. Browser workflow graphs are generated from the tested API graphs; this turn did not test clicking Run in the browser.

Identity Edit does not preserve every pixel outside the requested edit. In this example it adds pronounced texture to skin and fabric. Keep the original and compare results; changing reference strength or using FP8 did not eliminate that effect in this test. Do not interpret identity preservation as a guarantee of exact facial geometry.

**Installed assets**

- Krea 2 Turbo INT8 ConvRot
- Qwen3VL 4B FP8 encoder
- Qwen Image VAE
- Full Identity Edit v1.2 LoRA
- Editing nodes v1.2.5, pinned commit `86f886dac23013d88996e3a2e99093ba44d322fb`

All four persistent model files match published SHA-256 hashes. Combined size: **20,817,217,142 bytes**. The FP8 comparison model was downloaded only to temporary container storage and is not required by either saved workflow.

Volume `f7vnixgws1` is **120 GB STANDARD, EUR-IS-1**, $8.40/month. Running compute remains approximately $2.11/hour including the temporary container disk. GPU billing ends when stopped; volume billing continues.

The prior pod `l9mwstucse5fmd` could not resume because its original host had no free GPUs. A replacement of the same GPU type and price was created in the same region and attached to the same volume. The prior pod remains stopped. Use the new pod and URL above, and run only one pod against these workflows at a time.

Local test images: `samples/krea2-t2i.png`, `samples/krea2-edit.png`. API histories and download hashes are saved beside this guide for reproducibility.
