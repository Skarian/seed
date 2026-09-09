# MiniMax H3 apps

Open **Apps → MiniMax Apps** in ComfyUI:

- **01 - Create a video**: describe the scene, movement, camera and sound.
- **02 - Animate an image**: upload a starting image and describe motion and sound.

Both offer portrait (TikTok, 9:16, 720×1280) and landscape (Cinema, 16:9,
1280×720), plus 5, 10 and 15 seconds. Default: portrait, 5 seconds.
Seed defaults to randomize; use its menu to choose a fixed seed for repeatability.
H.264 MP4 files with generated audio are saved under `ComfyUI/output/MiniMax/`.
Longer clips take more GPU time. Mismatched starting images are center-cropped to
fill the canvas, not stretched; keep the subject near the center.

## Local model limits

MiniMax's [official model description](https://github.com/MiniMax-AI/MiniMax-H3)
specifies 4–15 seconds, 24 fps, and a 768-pixel default short edge for H3-Base.
H3-Regenerate-2K is a separate stage from the open base weights. The
[template documentation](https://github.com/Hearmeman24/comfyui-minimax) also
identifies the local clips as 768p. These apps do not claim native 1080p.

Generate at 768×1344 or 1344×768 on H3's 32-pixel grid, then center-crop the small
aspect-ratio difference and downsample to exact 720p portrait/landscape.
The installed node uses 17k+5 frames: generate 124/243/362, then trim to
120/240/360 frames and source audio to 5/10/15 seconds. AAC encoding may report
a few milliseconds of audio rounding; the MP4 video duration is exact.

## Implementation and verification

`minimax_app_nodes.py` defines the preset mapper and export preparation using
existing ComfyUI dependencies. It is installed persistently at
`/workspace/ComfyUI/custom_nodes/neil_h3_apps/__init__.py`.

`minimax_build_apps.py` builds the apps from the accepted Turbo 8 graphs, with
the existing model, LoRA, sampler and scheduler. App IDs and widget bindings are
deterministic. The builder handles both legacy list and current COMBO schemas.
The image app includes center-crop preparation before H3 conditioning.

Local copies: `deployment/workflows/*.app.json`. Remote copies:
`/workspace/ComfyUI/user/default/workflows/MiniMax Apps/`.
Original H3/Krea workflows remain intact. Only ComfyUI was restarted to load the
nodes; the pod and storage were not restarted or replaced.

For a replacement pod using this network volume, the apps and custom nodes are
already present. For a fresh volume, restore `minimax_app_nodes.py` to the custom
node path above, restart ComfyUI once, then run `python deployment/minimax_build_apps.py`
from this repository with its usual deployment credentials and current pod ID.

`minimax-app-tests.json` records real generations. `minimax_check_apps.py` reads
their outcomes and runs ffprobe to check dimensions, fps, frame count and duration.
The image app is also submitted through its browser Run button to verify widget
serialization and image preprocessing, rather than testing only API JSON.

Live acceptance on RTX PRO 6000 Blackwell (96 GB): four successful generations,
covering 5/10/15 seconds, portrait and landscape, and both apps. ffprobe verified
exact video durations, 24 fps, expected dimensions and an audio stream. The final
image app was submitted from the browser and displayed its 720×1280 MP4 with a
Download button in the mobile Outputs panel. The earlier 15-second image test
predated the explicit input center-crop node; the final browser test exercised it.
The 15-second landscape generation took approximately five minutes. These are
representative checks, not an exhaustive test of every format/duration combination.
