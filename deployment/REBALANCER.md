# Krea workflow copies with conditioning rebalancing

Installed on pod uuwayipczbkwcd, persistent network volume:

- Neil Krea 2 / 08 - Krea 2 - Text to image - Rebalanced
- Neil Krea 2 / 09 - Krea 2 - Identity Edit - Rebalanced

Copies of the currently saved 06/07 workflows, not the proposed Pixaroma workflow. Originals unchanged. New node is inserted on positive conditioning after prompt encoding, before KSampler. Identity Edit's model patch and reference inputs remain connected.

Settings: preset custom; per_layer_weights `1, 1, 1, 1, 1, 1, 1, 2.5, 5.0, 1.1, 4.0, 1.0`; multiplier 2; renormalize false. These are twelve encoder-layer tap gains, not word weights. Effective gains are 2,2,2,2,2,2,2,5,10,2.2,8,2. For an exact neutral setting use all twelve weights 1 and multiplier 1, or bypass the node. Multiplier 1 alone does not neutralize nonuniform weights.

Community implementation: https://github.com/huwhitememes/comfyui-krea2-conditioning
Pinned revision: 729cda4fade982988a375b01928f515458407a5c. Installed reviewed __init__.py, nodes.py, LICENSE, README.md plus revision file under /workspace/ComfyUI/custom_nodes/comfyui-krea2-conditioning. No new model or Python dependency downloads. This fork derives from nova452/Rebalance-Pack; its optional RMS normalization is disabled to preserve requested literal weighting behavior.

Verified runtime encoder flattens conditioning to B,sequence,30720, matching twelve 2560-wide taps. Tensor test verifies each requested gain times multiplier, preservation of metadata, and no mutation of input. Acceptance API graphs are reconstructed from the saved UI copies to validate widget settings and links.

Research does not establish universal visual improvement. Large gains can change color, texture and identity. Existing baseline workflows remain available for comparison.
`nAcceptance complete: both saved-copy graphs generated 1024x1024 images successfully. Original 06/07 saved workflows verified unchanged by JSON equality. Results: samples/rebalance-t2i.png and samples/rebalance-edit.png. Identity edit test changes the existing reference jacket to red; these tests establish operation, not universal quality superiority.
