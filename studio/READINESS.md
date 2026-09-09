# Historical readiness review

This is a preimplementation snapshot. Current decisions and runtime evidence are in
[the milestone journal](EXECUTION-PLAN.md); npm CLI packaging supersedes the earlier
Windows package discussion below.

Fresh static review after standard app directories and optional startup were agreed, 9 September 2026. Nine core documents reviewed; no runtime tests or infrastructure actions. Earlier read-through findings are historical where these decisions resolve them.

## Assessment

Product/deployment shape is coherent and sufficiently settled for a first implementation slice. The full engineering specification is not yet complete. Remaining contract details are assistant implementation-design work, not reasons to reopen accepted choices or ask the owner to design protocol internals. No numerical readiness claim.

Resolved: local Node app without runtime Docker dependency; standard app directories; yes/no sign-in startup; manual RunPod deployment; HF model cache and Civitai LoRAs; early pairing/status; durable local media with acknowledged spool cleanup; shutdown indicator; hosting outside scope. No additional infrastructure recommended.

## Concrete specification debt

- Worker boundary: choose one early worker process/library and enumerate pairing/status/preset-sync/output-receipt routes. Define restart/token lifetime and transfer acknowledgment semantics. API explicitly labels these unfinished. Reuse ComfyUI's execution API and its narrow process checks.
- Saved versus cleanup: API job-state list still lacks concrete orthogonal fields for saved/cleanup pending/cleanup failed and safe-to-terminate true/false/unknown with reasons. Agreeing the UX does not define its serialized contract yet.
- Preset propagation: Civitai discovery/download source is settled, but document the local config to worker activation path and map internal preset keys to public workflow IDs. Updating a local file alone must not be claimed to update a running pod.
- Shipping details: choose exact Windows package/runtime/media binaries, launcher and local-only access defaults. Standard data locations and installer UX are resolved; do not reintroduce directory questions or Docker. Build/package details should be tested during the first slice.

## Documentation cleanup

Architecture still says candidate custom stack pending SwarmUI. Node packaging is now the preferred agreed direction; determine whether SwarmUI remains an actual alternative or just evaluation history before broad UI implementation, without blocking the infrastructure proof. CURRENT-DIRECTION repeats the MVP and both accumulate chronological decisions. Consolidate once the remaining contracts are written. Historical review scores/findings are not active implementation requirements.

## Proof, not more speculative planning

Model revision/access pinning and selected content LoRAs remain concrete acquisition work. Windows launch, native uploads, source downloads, references/audio/ending-frame quality and durable transfer/replacement require live tests. They cannot be established through repeated document reviews. First authorized slice: start the local app, pair during preparation, generate one image, save/acknowledge it, then recover a retained output via replacement. Follow with video and full workflow coverage. All access first; one pod/GPU; verified compute off at test-session end.

## Static checks

Local links in the nine core docs resolve; job and LoRA JSON examples parse. No claim of semantic schema validation or live acceptance.
