# GPU type filter — implementation and QA

Added a shared, alphabetized GPU type multi-select to Image and Video worker acquisition for Vast and RunPod. An empty selection shows all types. GPU filtering combines with region and price filters and leaves offer sorting independent. Each of the four views remembers its selections and sort order while the picker is mounted.

The GPU list comes from the full provider catalog, so changing sort, price, or region does not reorder or hide the GPU choices. Selected types that disappear on refresh remain selected and marked unavailable; the UI does not silently show unrelated offers. Users can clear the filter explicitly.

Implementation uses `web/gpu-type-filter.tsx` and `web/hooks/use-worker-offer-filters.ts`, integrated in the existing shared worker picker. No provider acquisition or billing behavior changed.

## Validation

- TypeScript checks passed.
- Both worker offer unit tests passed.
- `node scripts/test-worker-offers.mjs --live --gpu-filter` passed all 31 browser tests: eight new desktop/mobile filter cases plus worker form/action regressions.
- The new cases cover alphabetization, single/multiple selections, independent sorting, context switching, price intersection, clearing, keyboard interaction, disappearing offers, and narrow viewports. Launch requests are explicitly guarded and counted.
- Captured live catalogs at 2026-09-26 03:37 UTC: Image/Vast 48 offers, Image/RunPod 18, Video/Vast 27, Video/RunPod 2. These real offers were replayed in the isolated test harness.
- Reviewed all 16 new screenshots individually. Review notes and screenshot hashes are in `gpu-type-filter-visual-review-2026-09-26.json`.
- After publication, checked all four combinations in the live application against current offers. Multi-selection and sorting worked in every view. No rental offers were selected and no GPUs were rented.

## Rollout and evidence

Published the web build at 2026-09-26 03:41 UTC without restarting the server. Verified the live index matched the staged build and its assets were reachable. Preserved old hashed assets and backed up the prior index files.

- Run ID: `2026-09-26T03:37:30.522Z`
- Local evidence: `.local/gpu-type-filter/`, including catalogs, manifest, screenshots, rollout receipt, and live browser checks.
- Backup: `.local/gpu-type-filter-web-backup-1790394090209/`
- Live app: <http://192.168.1.212:4310/>
- Desktop/mobile gallery: <http://192.168.1.212:4314/gpu-type-filter/index.html>

No paid resources or private user requests were accessed for this task.
