These ComfyUI files are test fixtures from the image and video revisions in
`worker/local-runtime.json`. Each role includes its upstream GPL-3.0 license.
Tests verify their complete file hashes against that manifest, then extract only
`PromptQueue` and `prompt_worker` with Python AST. GPU libraries are never imported.

Upstream: https://github.com/Comfy-Org/ComfyUI

Image revision: b5cc8830279eae909a59de030af1e50761c36751
Video revision: 40c4fcdf513a4523e39d54a9d391908af8df8171
