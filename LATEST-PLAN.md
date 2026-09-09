> Historical planning document. The implemented lean setup and current operating instructions are in [deployment/LEAN-SETUP.md](deployment/LEAN-SETUP.md).

# Latest agreed RunPod plan

September 7, 2026. Supersedes earlier 120 GB recommendations. Setup authorized and deployed; see [current handoff](deployment/START-HERE.md) and [status](deployment/STATUS.md).

- Stock Hearmeman MiniMax H3 v8 bundle: both pruned INT8 diffusion models, stock INT8 encoder, VAEs and bundled adapters/utilities. Verified assets: 81.4641 GB.
- Start with a **100 GB standard network volume** at **$7/month**. Raw headroom after model assets: **18.5359 GB**, shared by uploads, generations, workflows, user nodes and caches. Expand when needed; do not preallocate extra persistent space for future experiments.
- One RTX PRO 6000 Blackwell Server Edition, 96 GB, Secure Cloud on-demand. Previously observed GPU price: $2.09/hour; confirm offer at deployment. Prefer at least 128 GB host RAM and compatible CUDA 13 driver.
- EUR-IS-1 Iceland remains a candidate, subject to actual GPU/volume availability and separately established model-license eligibility. Hosting location alone does not settle user licensing.
- Retain the separate temporary container/staging allowance of 150 GB, approximately $0.021/running hour at $0.10/GB-month. This is disposable installation/staging capacity, not persistent output headroom; actual requirement remains to be measured.
- Browser ComfyUI behind authenticated HTTPS, token-protected administration. Preserve a working version manifest and persistent files. Use stock eight-step workflows initially, with a standard twenty-step comparison preset. No new experimental accelerators or encoder swaps.
- Keep models, inputs, outputs, workflows and settings on the mounted network volume. Verify complete persistent model files and test a generation after pod recreation before handoff.
- Off: finish the queue and release the pod while retaining the network volume. On: recreate from saved configuration with that volume. Browser URL may change. Closing the browser does not stop billing.
- Hardware change in the same data center: create a replacement pod with the desired compatible GPU and the existing network volume attached at deployment. No model redownload is needed when all assets are persisted. Recheck available capacity, CUDA compatibility, attention kernels and memory settings; run a smoke generation. A smaller GPU may require offloading or shorter/lower-resolution jobs.
- Hardware change requiring another data center: create a new volume there, copy the data, validate it and deploy against it. More work and temporary duplicate storage; no automatic cross-region volume portability.
- Approximate cost: $7/month persistent storage plus about $2.11 per running hour including the proposed temporary disk. Ten running hours/month ~ $28.11; thirty ~ $70.33, excluding tax or optional external services/licensing. Idle/download time counts.

Sources: [RunPod volumes, pricing, resizing and migration](https://docs.runpod.io/storage/network-volumes), [pod lifecycle](https://docs.runpod.io/pods/manage-pods). Timing estimates remain in H3-TIMING-ESTIMATES.md; its old 120 GB allocation is superseded here.
