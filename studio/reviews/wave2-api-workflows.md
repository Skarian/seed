# Wave 2 — API and workflow plan re-review

9 September 2026. Reviewed revision 2 of API-CONTRACT, ASSET-PREPARATION, COMFYUI-CHANGES, ARCHITECTURE and the expanded job examples. Planning only.

**Planning execution readiness: 95/100.** This is a subjective engineering assessment of a bounded implementation plan, not a measured generation-success probability. No critical design blocker remains. Four explicit forms/adapters, one process, tus uploads and polling are proportionate to the requested studio. Do not add more frameworks to improve this score.

## Wave 1 issues resolved

- The last-frame trim defect has a concrete native AddGuide candidate at exported frame119/239/359, with endpoint influence and fallback tests. The plan no longer confuses graph execution with exact frame reproduction.
- Native reference clipping/grid behavior is specified separately from source selection and export. Paired audio shares the effective conditioning range.
- Request fields now name framing, soundtrack replacement and source offsets. Prompt is one string. Examples cover all four workflows, two-image identity editing, first/last frames and an exact supplied soundtrack.
- Seeds have an explicit exactly representable JavaScript range; no hidden uint64 conversion bug.
- Concurrent manual generation is excluded through maintenance ownership, so global interrupt semantics are honest.
- Custom uploads, persisted SSE replay, synchronized server drafts, generic graph/form systems and duplicate App generation are removed.
- Client-side admission uses supported codec metadata/preparation paths, not browser playback alone or an impossible full corruption guarantee.

## Mathematics checked during this wave

The generation formula produces124/243/362 frames for5/10/15 seconds. Export counts are120/240/360, and corresponding endpoint indices are119/239/359. A120-frame selected reference rounds down to107 frames; a48-frame selected reference rounds down to39. The first17k+5 count above48 is56, not53.

The initial revision 2 text incorrectly said53 frames was the first valid grid count covering2 seconds. Root corrected this during review and, more appropriately, removed an invented effective-duration restriction: the official minimum concerns selected source duration, while native code itself permits the rounded39-frame result. The UI shows its1.625-second used span and a fixture verifies actual conditioning. This preserves usable2-second inputs instead of making the user lengthen them solely to satisfy an invented rule.

## Small implementation details to settle without expanding architecture

1. **Tus asset identity on resume — resolved during review:** the API now uses the same opaque server-generated ID for upload and asset, recoverable from standard Location/resume URL. This removes the creation-header dependency without adding a lookup service.
2. **Fast completion response — resolved during review:** the API now requires completion to persist `verifying` and return standard204; the existing controller performs probe/normalization afterward and reconciles interrupted promotions. Long FFmpeg processing does not hold the final PATCH response open.
3. **Reserved-byte bookkeeping:** do not count already-written partial bytes twice against current free disk. Reserve remaining upload bytes plus concrete preprocessing headroom; actual failures still report operational storage errors. One preparation at a time keeps this simple.
4. **Maximum reference tests:** distinguish official limits, the intentionally conservative combined-audio budget and demonstrated runtime envelope in capability data. Do not present unsupported combinations as working; do not solve OOM by silently dropping references. These are explicit test gates already in the plan, not a reason to design a second GPU/service now.

Tus's documented hooks support the chosen embedded integration, metadata and completion behavior; no new transport is required. [Server API](https://github.com/tus/tus-node-server/blob/main/packages/server/README.md), [client API](https://github.com/tus/tus-js-client/blob/main/docs/api.md). Native timing/conditioning behavior was checked against [ComfyUI H3 source](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py), with pinned-runtime verification still required.

## Stop reviewing by addition

The next useful evidence is implementation: access first, local contract/preflight tests, then one authorized pod for the bounded graph/network checks, and verified shutdown. Do not introduce general-purpose scheduling, generated UI, multi-provider support, live event history, or broad conversion infrastructure. Remaining uncertainty is explicitly isolated in fixtures, and the unchanged product can be implemented incrementally without replacing the architecture.
