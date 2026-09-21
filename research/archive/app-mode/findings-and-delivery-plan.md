# ComfyUI App mode: verified findings and delivery plan

Research and live prototype, 8 September 2026. Production workflows 06, 07 and 08 have not been converted in this research pass.

## What is proven

The installed frontend is 1.49.6. A temporary copy of workflow 06 was configured using the actual App builder: select individual input widgets, select Save Image as the output, preview and rename controls, save, enter App mode, reload and run through the browser.

The repaired `TEST - Verified App prototype.app.json` opens in App mode after reload with Prompt, width, height and seed controls. The built-in Number of runs control also appears. After reload, changing the prompt to a turquoise teapot and lemon and pressing Run produced `Krea2/text-to-image/text-to-image_00006_.png` at 1024 × 1024. The UI displayed the image and Download, Rerun and Reuse Parameters controls. A prior yellow teapot generation also succeeded. Re-running unchanged parameters returned the cached prior output; the changed-prompt run established fresh execution.

The builder enabled Nodes 2.0 automatically. No frontend upgrade or pod restart was required. The existing browser draft was preserved as `Backups/Browser draft before App prototype` before opening the prototype.

## Important save bug

Save As → App creates a new workflow ID but, in the tested path, retained input bindings referencing the old workflow ID. The resulting App had no editable controls. This matches upstream issue 14838. Re-selecting the widgets against the new workflow identity and using ordinary Save restored the controls; reload and generation then worked.

Delivery must establish each final filename and workflow identity BEFORE selecting App inputs. Then use ordinary Save. Do not duplicate a configured App and assume its bindings survived. Validate that every selected input references the final workflow ID. The repaired research prototype still contains stale bindings alongside the working new bindings; do not use that metadata as a clean production template.

For ordinary root-level nodes, the observed metadata is `extra.linearData.inputs`, containing pairs such as `["<workflow-id>:4:text", "text"]`, and `extra.linearData.outputs`, containing node IDs such as `"9"`. `extra.linearMode: true` was observed on the App-default file. Friendly prompt naming persisted in the node input label. These observations apply to this frontend version; do not assume portable behavior across upgrades.

## Proposed user-facing controls

| Workflow | Controls | Fixed behind the interface |
|---|---|---|
| 06 Text to image | Prompt; Width (px); Height (px); Seed | Current models, sampler and quality settings |
| 07 Identity Edit | Reference image; Edit prompt; dimensions if supported by its actual image-processing path; Seed | Current identity LoRA and grounding configuration |
| 08 Rebalanced text to image | Prompt; Width (px); Height (px); Seed | Rebalancer enabled with current weights and multiplier 2; current sampler/model settings |

All three show generated images and allow downloading through the native output panel. Use a short description for the seed and fixed/random behavior. Do not expose model selectors, negative prompt, rebalancer weights or multiplier in the default interface. Keep workflow 09 deleted.

## Delivery steps

1. Export fresh backups of the three current saved workflows, retaining their IDs, graph connections and values. Check for newer user edits before changing files. Preserve an original Graph version for rollback.
2. Establish each final App file and its identity. Avoid Save As after configuring inputs. Keep names clearly associated with 06, 07 and 08.
3. Use the native builder to select the positive prompt and relevant width, height and seed widgets. Select the native Load Image control for 07. Select Save Image as the displayed output. Rename controls and arrange them in the order in the table.
4. Validate 07's upload behavior in App mode: upload a PNG and a JPEG, confirm the thumbnail and chosen filename change, then run with the new image. The frontend source explicitly supports a native LoadImage drop indicator and upload callback, but this research pass did not run an Identity Edit App upload test. Preserve the existing working reference-conditioning path.
5. Treat the dimension node as an enhancement after the core interface works. Evaluate the installed native resolution node first. Any preset must visibly show the exact width and height BEFORE Run, and the queued generation must receive those same values. A node that calculates dimensions only during execution is insufficient for this requirement. If native App mode cannot expose a dependable pre-run readout, use clearly labeled numeric Width (px) and Height (px) controls for the first release. For 07, inspect how reference resizing and output dimensions actually connect before promising either preserve-source-size or preset behavior.
6. Keep 08's rebalancer node active and connected. Verify the queued graph contains its current custom weights `1, 1, 1, 1, 1, 1, 1, 2.5, 5.0, 1.1, 4.0, 1.0`, multiplier 2 and renormalize false. Its widgets are simply not selected as App controls.
7. Save, close and reopen each App, then reload the browser. Confirm controls, labels, defaults and output selection survive. Verify all input bindings reference the correct workflow identity and remove any stale bindings.
8. Run one fresh generation from EACH final App through its browser controls. Change a prompt or seed to avoid mistaking a cached result for a new generation. For 07, use a newly uploaded reference. Compare the queued model, conditioning and sampler settings with the original graph. Check output dimensions, visible preview and downloadable file. Test fixed seed and random behavior and one non-square dimension setting where applicable.
9. Check the layout at laptop size: upload area, prompt, dimensions, seed and Run must be usable without navigating the graph. Do not present builder Preview as an editable production form; its controls were inert in this version.
10. Deliver the three saved Apps, screenshots and a short Mac walkthrough: open Apps, choose workflow, enter prompt/upload reference, confirm dimensions, Run, Download. Remove only research prototypes after preserving their evidence. Keep rollback copies.

## Limits and operational notes

The core T2I App path is demonstrated; the final three Apps are not yet delivered. Identity upload in App mode and a preset with a live numerical dimension display remain explicit acceptance checks. No extra custom-node installation is needed for the basic App shell.

The current output stage was empty immediately after browser reload until another run. Saved images remain on the pod; do not promise that the open App's result strip is a durable gallery. Verify the Assets path separately during handoff.

App mode uses the same pod and authenticated ComfyUI address. It does not change GPU billing or make generation serverless. The running pod and the user's other generations were not stopped.

## Sources and local evidence

- [Official App mode guide](https://docs.comfy.org/interface/app-mode): input/output selection, preview, saving and usage. Its screenshots differ from the installed builder, which has three stages and a default-view footer.
- [Upstream Save As input-binding issue](https://github.com/Comfy-Org/ComfyUI_frontend/issues/14838): independently reproduced on this pod.
- [Frontend 1.49.6 App state](https://github.com/Comfy-Org/ComfyUI_frontend/blob/v1.49.6/src/stores/appModeStore.ts).
- [Frontend 1.49.6 builder save implementation](https://github.com/Comfy-Org/ComfyUI_frontend/blob/v1.49.6/src/components/builder/useBuilderSave.ts).
- Local source snapshots: `AppModeWidgetList.vue` (native LoadImage drop/upload handling), `appModeBuilder.spec.ts`, `appModeWidgetRename.spec.ts`, `workflowService.ts`.
- Local workflow evidence: `baseline-06.json`, `saved-prototype.json`, `save-as-bug.json`, `verified-app.json`.
