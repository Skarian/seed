---
license: apache-2.0
base_model:
- Qwen/Qwen-Image-Edit-2511
pipeline_tag: text-to-image
library_name: comfyUI
tags:
- qwen
- qwen-edit
- t2i
- i2i
---
**NOTICE: After ~23 iterations of this "all in one", I'm winding down providing updates. v19 is likely best for consistency in edits, while v23 is likely best for prompt adherence. I feel this project has peaked as new image edit models are being released. Thank you for all the feedback and help!**

Merge of accelerators, VAE and CLIP to allow for easy and fast Qwen Image Edit (and text to image) support.

Use a "Load Checkpoint" node. 1 CFG, 4 step. Use the "TextEncodeQwenImageEditPlus" node for input images (which are optional) and prompt. Provide no images to just do pure text to image. FP8 precision.

**Both NSFW and SFW models are available!** v4 and older combine both NSFW and SFW uses in one model, but performance is subpar. v5+ separates out a NSFW and SFW version, so please pick which model for your use case. 

**Having problems with scaling, cropping or zooming?** Scaling images in the TextEncoderQwenEditPlus node is the problem. There are many workarounds, but I prefer just fixing the node and I've supplied my version in the Files area. It also supports up to 4 input images. Use the "v2" version and supply the same latent you are sampling with (usually an empty latent), which provides sizing for informed scaling.

![image](https://cdn-uploads.huggingface.co/production/uploads/631be8402ea8535ea48abbc6/ynDNK35eRLlUjha75fYHH.png)

**V1:** Uses Qwen-Image-Edit-2509 & 4-step Lightning v2.0. Includes a touch of NSFW LORAs, so it should be a very versatile model for both SFW and NSFW use. sa_solver/beta recommended, but euler_a/beta and er_sde/beta can give decent results too.

**V2:** Now uses a mix of Qwen-Image-Edit accelerators, mixing both 8 and 4 steps in one. Also significantly tweaked the NSFW LORAs for better all-around SFW and NSFW use. sa_solver/simple strongly recommended.

**V3:** Uses new Qwen-Image-Edit lightning LORAs for much better results. Also significantly adjusted NSFW LORA mix, removing poor ones and increasing quality ones. sa_solver/beta highly recommended.

**V4:** Mix of many Qwen Edit and base Qwen accelerators, which I think gives better results. Added a touch of a skin correction LORA. **4-5 steps: use sa_solver/simple, lcm/beta or euler_a/beta** and **6-8 steps: use lcm/beta or euler_a/beta only**.

**V5:** NSFW and SFW use cases interfered with eachother too much, so I separated them to specialize in their use cases. Updated "snofs" and "qwen4play" NSFW LORAs + Meta4 for v5.2, then added "Qwen Image NSFW Adv." by fok3827 for v5.3. **SFW: lcm/beta or er_sde/beta generally recommended** and **NSFW: lcm/normal recommended**. Prompting "Professional digital photography" helps reduce the plastic look.

**V6:** Attempt at valiantcat/Qwen-Image-Edit-MeiTu and partially chestnutlzj/Edit-R1-Qwen-Image-Edit-2509 as a base model. However, this was a broken merge. It appears using them as LORAs may work better and I need to cook some more to find something useable. Stay on v5 until something newer comes out.

**V7:** valiantcat/Qwen-Image-Edit-MeiTu and chestnutlzj/Edit-R1-Qwen-Image-Edit-2509 included as LORAs. Accelerator and NSFW LORAs tweaks (v7.1 is more NSFW-heavy). This seemed to be working much better. **lcm/sgm_uniform recommended for 4-6 steps, lcm/normal for 7-8 steps**.

**V8:** Using BF16 to load in FP32 LORAs, only to scale down to FP8 for saving. This seems to help resolve "grid" issues and improves quality. Tweaked accelerator amounts. Significant NSFW LORA tweaks (and new SNOFS). **euler_a/beta recommended for 4-6 steps, lcm/normal for 7-8 steps**.

**V9:** OK, I lied. "Rebalancing" and "Smartphone Photoreal" LORAs really do help image generations for both SFW and NSFW purposes. If you don't want those LORAs integrated (like making anime or cartoons), use the "Lite" versions. Also, I had a typo in accelerators in V8 that has been fixed for V9. Tweaked NSFW LORAs and significantly reduced how heavy they need to be applied, which should hopefully help consistency. **euler_a/beta recommended for 4-6 steps**. More steps usually work better with sgm_normal or normal schedulers.

**V10:** This is kinda a mix of v5 and v9. MeiTu and Edit-R1 dropped. I'm keeping the "Rebalancing" and "Smartphone" LORAs at half strengths which I think help skin, variety and composition. NSFW LORAs closely resemble v5.3 (but with updated v1.2 snofs). v10.4 NSFW tweaked to improve character consistency and penises. **euler/beta strongly recommended for 4-8 steps** but **euler_a/sgm_uniform recommended for NSFW v10.2+**.

**V11:** Tweaked NSFW LORAs, using fewer to rely on more compatible ones instead. Spread out "realism" LORAs to more at lower strength. **euler/beta recommended** for both NSFW and SFW, but feel free to experiment with others!

**V12:** Getting inpatient waiting for Qwen Edit 2511 (2512?), so went looking for more LORAs and tweaks to reduce the "plastic" look. **euler/sgm_uniform for SFW** and **er_sde/sgm_uniform for NSFW**, although experimentation is healthy is this context.

**V13:** Tweaks to included LORAs in an attempt to reduce gridlines and increase character consistency (without returning the plastic look). **er_sde/beta recommended**. 

**V14:** Trimmed LORAs which may have been interfereing with character consistency (while hopefully still reducing the "plastic" look). Updated new SNOFS v1.3 for NSFW and trimmed poor NSFW LORAs too. **er_sde/beta recommended**. 

**V14.1:** Added "InSubject" LORA to both SFW and NSFW merges to improve character consistency. Otherwise, generally the same as v14. **er_sde/beta recommended**.

**V15:** Now using Qwen-Edit-2511! Slight tweaks to LORAs. Skipped making NSFW merge because this base merge wasn't that great. **er_sde/beta recommended**, but please experiment.

**V16:** Noticed some degradation from previous LORAs (mostly "realism" LORAs) that are not needed/compatible with 2511, so slimmed them down. Further tweaks to NSFW LORAs (added "Sex-tacular"). **er_sde/beta recommended**.

**V17:** Merged 2509 and 2511 together with the goal of correcting contrast issues and LORA compatibility with 2511 while maintaining character consistency. **euler_ancestral/beta highly recommended**.

**V18:** More 2511, a bit less 2509. Different merging method that I think corrects an issue I was having with many input images. **euler_ancestral/beta recommended**

**V19:** New Lightning Edit 2511 8-step mixed in (still recommend 4-8 steps). Also a new NSFW LORA (GNASS for Qwen 2512) that worked quite well in the NSFW merge. **er_sde/beta or euler_ancestral/beta recommended**.

**V20:** Returning to 100% Qwen Edit 2511. Tweaks to accelerators to hopefully give better results without 2509 mixed in. Added a minor amount of "BestFaceSwap". Tweaks to realism LORAs and significant tweaks to NSFW LORAs. **euler_ancestral/beta recommended**

**V21:** Removed older "realism" LORAs and added new 2511 "anything2real" and "anime2real" LORAs in hopes of improving skin texture and overall edit functionality. Tweaks to NSFW LORA weights. If you are soley interested in flat 2D anime, v20 or v19 may be suited better (this trends more realistic) **euler_a/beta recommended**

**V22:** Removed "anything2real" and "anime2real" which were stomping styles and causing inconsistencies. Added small amounts of JibMix Skin and qwen-skin-edit v1.1 to combat 'plastic' instead. Significant tweaks to NSFW LORA weights again. **euler_ancestral/beta recommended**

**V23:** Tweaks to skin and realism LORAs (removed JibMix which seemed to cause oddities). Reduced a "plastic" NSFW LORA that was making realistic results more difficult in that merge. This one was feeling pretty good. **euler_ancestral/beta recommended**