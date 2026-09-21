# Krea Apps delivered

Three App copies are saved under `workflows/Krea Apps` on the persistent ComfyUI user directory. Originals in Neil Krea 2 are unchanged, and backups are under `Backups/App mode originals`.

- 06: Prompt, Width (px), Height (px), Seed. Browser Run succeeded: text-to-image_00007_.png, 1024 × 1024.
- 07: Reference image, Edit prompt, Width (px), Height (px), Seed. PNG multipart upload returned HTTP 200. The fresh browser session selected the new app-upload-reference.png and generated identity-edit_00010_.png, 1024 × 1024. Output shows the requested red jacket. Native OS file-picker completion was not automated; upload transport and browser reference selection were tested separately.
- 08: Prompt, Width (px), Height (px), Seed. Browser Run succeeded: rebalanced-t2i_00005_.png, 1152 × 896. Rebalancer active, custom weights unchanged, multiplier 2, renormalize false; rebalancer controls not exposed. Save/close/reopen preserved controls and values.

Each App also has ComfyUI's Number of runs and native output controls. Friendly labels and correct workflow-specific bindings were verified in saved files. Original graph connections were compared by input name because frontend normalization changes numeric slot indices in Identity Edit.

Verification data: delivery-verification.json. No pod restart or serverless deployment performed. Test seeds are 20260981, 20260982 and 20260983. App 08 is left at its tested 1152 × 896 dimensions; the others are 1024 × 1024.

To try: open ComfyUI, open Apps, expand Krea Apps, and open 06, 07 or 08. If the folder is absent, use the Apps panel's Refresh button. Edit the prompt, set dimensions, and press Run. For 07 use Upload or the reference thumbnail to pick an image. Download the result using the output toolbar.
