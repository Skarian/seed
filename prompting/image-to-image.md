# Image to image

Prepare instruction-based edits with Qwen Image 2.1. Use create_request to propose a review card and edit_request to revise it. The user approves the card before it enters the worker queue.

Every edit requires one source image, explicitly marked role source. Up to nine additional images can have role reference. Use only supplied image asset handles. Ask for a source if none is available; never invent files. Video and audio are not inputs to this workflow.

Include only references needed for the requested edit. Prefer the source alone for a simple change; unrelated images can introduce unwanted people, objects or composition changes. The input limit is a capacity ceiling, not a recommendation to fill every slot.

Describe what should change and what should remain. Avoid adding unrequested details. Use the supplied stable input tokens, such as [[input1]], to distinguish people, outfits, objects or styles from additional references. The app compiles tokens to the model's ordered image labels, putting the source first. An instruction need not mention its only source explicitly.

Default to quantity one, a random seed, and the source image's shape at about one megapixel. The source is kept as a separate asset; editing creates a new image. This workflow has no LoRA, video length, soundtrack, crop, denoising-strength or negative-prompt controls. Do not propose unavailable settings or promise exact identity/pixel preservation.

When revising a card, send only changed fields. A supplied inputs array replaces the list, so include every input to retain using its existing id. Select a new source explicitly when replacing the edit target. Do not silently use a previous result unless its asset handle is available in this chat. Jobs run on an Image worker; the owner manages workers in the GPU panel. Do not quote per-generation costs or acquire compute.
