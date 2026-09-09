# MiniMax H3 mobile apps — proposed controls

Historical proposal. Superseded by MINIMAX-APPS.md: local H3 uses native 768p generation and standard 720p exports, not the proposed 1080p options below.

## Apps

- **Create a video**: describe the scene, action and camera movement.
- **Animate an image**: select/upload a starting image, then describe its movement and camera motion.

Both use the same Format and Duration dropdowns, with one Generate action and a playable/downloadable MP4 result. Start with the existing ComfyUI App mode rather than a separate website.

## Main controls

| Control | Choices/default |
|---|---|
| Format | TikTok / Portrait — 9:16, 1080×1920; Cinema / Landscape — 16:9, 1920×1080 |
| Duration | 5, 10 or 15 seconds; default 5 seconds |
| Prompt | Scene/action/camera; may also describe sound or dialogue |
| Starting image | Animate an image only |

Default format: Portrait. Use the user's Cinema label but show 16:9 explicitly; this does not mean ultrawide cinema.

Keep sampler, model, frame count and separate width/height fields hidden. Use the existing Turbo 8 configuration initially. Advanced controls should start with seed/randomization and image framing (fill/crop versus fit with borders), if supported cleanly in the existing App interface. Audio is generated as in the working H3 workflow; no additional sound controls are necessary for the first version.

## Implementation and validation

A small preset node can turn the friendly Format/Duration dropdowns into the numeric inputs required by the existing workflows. Native App mode can expose its combo widgets. Give each app a new workflow ID and bind its controls to that ID, avoiding the known Save As App binding bug. Preserve the existing Neil H3 workflows.

The captured installed H3 schema requires dimensions on a 32-pixel grid. Proposed native generation dimensions are 1920×1088 (landscape) or 1088×1920 (portrait), then crop four pixels per affected edge to export exact Full HD. Frame input follows a 17k+5 grid: 124, 243 and 362 frames cover 5, 10 and 15 seconds at 24 fps. Trim the final video and audio together to exact requested duration. Do not simply relabel the longer clips as exact durations.

Those are implementation mappings, not user controls. Full-HD generation and the 10/15-second combinations have not been validated on this setup. The previously verified preset is 1344×768, 124 frames, Turbo 8. The installed node describes approximately 124–362 frames as its trained range, which does not guarantee that every resolution/duration combination fits GPU memory or produces good results.

After the user completes migration, inspect the migrated pod, volume, login and startup first. Then implement the app copies and test native Full HD at 5 seconds in each orientation; test longer durations before marking them supported. Verify browser controls, uploaded-image framing, video playback/download, exact exported dimensions and duration, and audio synchronization. If Full-HD 15 seconds does not fit, discuss an explicitly labelled upscaled mode rather than silently lowering resolution.
