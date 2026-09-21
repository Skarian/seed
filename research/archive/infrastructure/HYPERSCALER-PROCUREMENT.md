# Hyperscaler procurement for Seed

Research date: 2026-09-10. Read-only investigation; no account creation, quota request, reservation, deployment, or purchase. Prices USD, excluding tax. This is a procurement shortlist, not evidence that our account can allocate a GPU today.

## Decision

Synthesis review: the [main procurement report](GPU-PROCUREMENT-REPORT.md) chooses Google G4 first to match the previously working host RAM more closely. This memo's AWS-first ranking below prioritizes indicative cost and VM shape; the main report's conservative-memory trial order is reasonable and takes precedence for the next experiment. Neither ranking claims measured capacity superiority.

**First trial: AWS `g7e.4xlarge` in Ohio or Virginia, subject to quota and a current quote.** Its 128GiB RAM and full 96GB GPU are a more conservative match than the cheapest 64GiB variant, and a plain VM preserves Seed's existing asynchronous engine and file-transfer design. Google `g4-standard-48` is the second VM trial if AWS admission fails, with more host memory for roughly $0.50/hour additional indicative compute cost. Google Cloud Run RTX PRO 6000 is a separate managed-service experiment, not the first migration target: its storage and request lifetime require more adaptation. Azure's full-GPU shapes are unusually large, with price/admission unresolved. None has proven Seed's workload or restart availability.

Do not build a hyperscaler migration solely because a comparison site lists a GPU. First procure one short allocation, run the existing container and the two requested workflows, save the results locally, and measure multiple cold starts before investing in integration.

## Exact hardware, not GPU-name matches

| Product | Exact single-GPU configuration | Host CPU / RAM | Procurement implications |
|---|---|---|---|
| AWS EC2 | `g7e.2xlarge`, RTX PRO 6000 Blackwell Server, 96GB | 8 vCPU / 64GiB | Smallest full-GPU option; host RAM may be too small for video loading/offload. |
| AWS EC2 | `g7e.4xlarge`, same 96GB | 16 vCPU / 128GiB | Better initial full-workflow candidate if measured host memory requires it. |
| Google Compute Engine | `g4-standard-48`, RTX PRO 6000, 96GB | 48 vCPU / 180GiB | Full GPU; smaller G4 sizes are fractional. |
| Google Cloud Run service | `nvidia-rtx-pro-6000`, one 96GB GPU | Minimum 20 CPU / 80GiB | Managed runtime; separate CPU and RAM charges; minimum is not a maximum. |
| Azure | `Standard_NC144lds_xl_RTXPRO6000BSE_v6`, one 96GB | 144 vCPU / 264GiB | Compute-optimized full GPU; large compulsory CPU bundle. |
| Azure | `Standard_NC144ds_xl_RTXPRO6000BSE_v6`, one 96GB | 144 vCPU / 516GiB | General-purpose full GPU, even larger RAM bundle. |

Primary specification sources: [AWS G7e](https://aws.amazon.com/ec2/instance-types/g7e/), [Google accelerator machines](https://docs.cloud.google.com/compute/docs/accelerator-optimized-machines), [Cloud Run GPU](https://docs.cloud.google.com/run/docs/configuring/services/gpu), [Azure NC series](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nc-rtxpro6000-bse-v6-series), [Microsoft source for compute-optimized sizes](https://github.com/MicrosoftDocs/azure-compute-docs/blob/main/articles/virtual-machines/sizes/gpu-accelerated/nc-rtxpro6000-bse-v6-series.md).

**Comparison-site trap:** the root researcher's live GPU Finder browser view showed a Google `n1-standard-16` + RTX PRO 6000 offer around $1.86/hour. That combination conflicts with Google's supported machine types. N1's attachable GPUs are T4, P4, P100, and V100; RTX PRO 6000 belongs to G4. Exclude that row from a purchase comparison unless the tracker corrects it. [Official N1 attachable GPU list](https://docs.cloud.google.com/compute/docs/gpus/create-gpu-vm-general-purpose)

Likewise, Azure's NC24lds / NC36lds / NC36ds RTX PRO 6000 entries are **24GB fractional GPUs**, not bargain 96GB cards. NC72 variants have 48GB. Do not infer available VRAM from the physical GPU model name. The NC144 entries above are the relevant full-GPU sizes.

H100 is also not one interchangeable SKU. AWS `p5.4xlarge` supplies one 80GB H100, 16 vCPU and 256GiB. Azure `Standard_NC40ads_H100_v5` supplies one **94GB H100 NVL**, 40 CPU and 320GiB. Google `a3-highgpu-1g` is an 80GB H100, but Google's current instructions require **Spot or Flex-start** for its smaller A3 High sizes. It is not an ordinary immediate on-demand replacement. Single-GPU H200 hyperscaler procurement was not established; do not divide the price of an eight-GPU machine by eight and present it as purchasable here. [AWS P5](https://aws.amazon.com/ec2/instance-types/p5/), [Azure H100](https://techcommunity.microsoft.com/blog/azurehighperformancecomputingblog/introducing-azure-nc-h100-v5-vms-for-mid-range-ai-and-hpc-workloads/3976798), [Google A3 restrictions](https://docs.cloud.google.com/compute/docs/gpus/create-vm-with-gpus)

## Cost envelope

| Candidate | Active compute cost | Confidence / exclusions |
|---|---:|---|
| G4 standard 48, Iowa | $4.49993/h | Official on-demand table, includes CPU/RAM/GPU; disk/network extra. |
| Cloud Run service, 20 CPU / 80GiB, no zonal GPU redundancy | $3.186792/h | Calculated from official Iowa service instance-based rates. |
| Same Cloud Run service, GPU redundancy on | $3.920868/h | Same calculation with higher GPU rate; quota separately relevant. |
| AWS G7e 2xlarge, US east/west | $3.3631/h indicative | Third-party Sep 5 snapshot; exact official quote still required. |
| AWS G7e 4xlarge, US east/west | $3.9982/h indicative | Same dated source methodology; 128GiB host RAM and 16 vCPU. |
| Azure full 96GB NC144 | Not verified | Public retail API returned 429; no invented estimate. |

Cloud Run calculation: `3600 × (20 × 0.000018 + 80 × 0.000002 + 0.00036522)`. GPU-only advertising would give $1.314792/h and omit mandatory host resources. Redundant GPU component is $0.00056913/second. Use **Services (instance-based billing)**, not the cheaper worker-pool/instance CPU table or a committed-use column. At minimum configuration, 10 active hours cost approximately $31.87, versus $45.00 for G4. This excludes cold preparation, idle running, transfer, storage, build and registry usage. [Cloud Run prices](https://cloud.google.com/run/pricing), [G4 prices](https://cloud.google.com/products/compute/pricing/accelerator-optimized), [indicative AWS snapshot](https://aws-pricing.com/g7e.2xlarge.html)

Model disks continue billing when compute stops. G4 does **not** accept ordinary Persistent Disk; its boot disk must be Hyperdisk Balanced. At the published Iowa $0.000109589/GiB-hour, 200GiB costs approximately $16/month at 730 hours, before performance above its included baseline. G4 optional local Titanium SSD is disposable. AWS G7e has 1.9TB local NVMe, also disposable on stop/termination; preserve models on EBS or restore from object storage. Do not build another hard dependency on one zone's irreplaceable disk. [Google disk compatibility](https://docs.cloud.google.com/compute/docs/accelerator-optimized-machines), [disk pricing](https://cloud.google.com/compute/disks-image-pricing), [AWS G7e specifications](https://docs.aws.amazon.com/ec2/latest/instancetypes/ac.html)

Internet output is a separate cost because permanent media stays on the PC. AWS publishes a pooled first 100GB/month free internet egress allowance. Cloud Run uses Premium Network Tier with 1GiB/month free within North America. Avoid adding a NAT gateway or load balancer to a one-worker proof merely to obtain outbound access. Before purchase, quote actual region-to-home transfer rates and a realistic generated-media volume. [AWS transfer pricing](https://aws.amazon.com/ec2/pricing/on-demand/), [Cloud Run transfer pricing](https://cloud.google.com/run/pricing)

## Admission, capacity, and restart

AWS 4xlarge price above is a provisional procurement estimate from the [September 5 per-region snapshot](https://aws-pricing.com/g7e.4xlarge.html), not a verified AWS quote. The intended first trial is about $8 compute for two active hours before disk and network, assuming that quote holds. Do not use a committed-use price in its place.

AWS new-account on-demand G-family quota defaults to **zero vCPUs**, independently of actual hardware supply. Request at least 8 for G7e 2xlarge or 16 for 4xlarge in each test region. Spot has a separate zero-default quota. A successful quota request only authorizes consumption; it does not reserve capacity. [Official quotas](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html)

Google admission also needs explicit care: a Free Trial billing account is not enough for GPU access or quota increases. Upgrade to a Paid billing account, then check the regional RTX PRO 6000 quota and the selected disk quota before requesting compute. Promotional credit does not imply GPU admission. [Free-program restrictions](https://docs.cloud.google.com/free/docs/free-cloud-features), [allocation quotas](https://docs.cloud.google.com/compute/resource-usage)

A stopped VM does not retain its GPU allocation. Azure explicitly documents failed allocation on create, resize and restart from deallocated state. AWS capacity reservations can hold supply, but active unused reservations are billed at the on-demand rate. For intermittent personal generation, permanent reservations undermine the cost objective. Savings commitments are not substitutes for checking reservation semantics. [Azure allocation failures](https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/windows/allocation-failure), [AWS reservation billing](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-capacity-reservations.html)

Cloud Run currently grants new regional RTX PRO 6000 deployments 3,000 milliGPU quota, equivalent to three GPUs, with redundancy disabled. Seed should still cap itself to one. Available RTX PRO regions are Iowa, Netherlands, Singapore and Delhi. Google describes on-demand service capacity without reservations, but explicitly says non-redundant GPU failover depends on spare capacity. This is better admission evidence than an unauthenticated VM stock listing, **not a measured launch-success rate**. [GPU service admission and redundancy](https://docs.cloud.google.com/run/docs/configuring/services/gpu)

For VM trials, shortlist US AWS east-1/east-2/west-2 and G4 zones currently listed in Iowa or US east/west; enumerate account-visible offerings before selecting storage. A zone being listed means the machine is offered there, not that it has spare capacity. Azure admission needs both relevant family quota and regional total quota; current account-specific access and price remain open.

## Maturity and buildout evidence

AWS launched G7e in January 2026 in Virginia and Ohio. Its May 7 regional expansion announcement lists Oregon, Spain, London, Tokyo and Seoul as well. That is concrete expansion of the exact GPU family rather than generic AI capital expenditure. It still says nothing about free capacity today. [Launch](https://aws.amazon.com/blogs/aws/announcing-amazon-ec2-g7e-instances-accelerated-by-nvidia-rtx-pro-6000-blackwell-server-edition-gpus/), [May expansion](https://aws.amazon.com/about-aws/whats-new/2026/05/amazon-ec2-g7e-london-region/)

Google G4 reached GA October 20, 2025. Its March 2026 NVIDIA announcement describes customer deployments and fractional-G4 expansion. Cloud Run RTX PRO 6000 is **GA since April 13, 2026**; February's preview announcement is stale for maturity assessment. Public GHCR imports became GA July 14. In contrast, Cloud Run ephemeral disks remain preview in the release notes, and individually addressable Cloud Run instances entered preview August 25. Do not conflate the mature GPU service with these newer primitives. [G4 GA](https://cloud.google.com/blog/products/compute/g4-vms-powered-by-nvidia-rtx-6000-blackwell-gpus-are-ga/), [GTC expansion](https://cloud.google.com/blog/products/compute/google-cloud-ai-infrastructure-at-nvidia-gtc-2026), [Cloud Run release notes](https://docs.cloud.google.com/run/docs/release-notes)

The Azure family underwent a sizing/GA transition in 2026, another reason to use current NC144 names instead of old NC128 listings. We lack a comparable public, recent exact-SKU stock history or confirmed account admission. Generic Microsoft infrastructure investment does not close that gap.

## Cloud Run integration risks to prove first

### Self-hosted model policy fit

The reviewed general [AWS AUP](https://aws.amazon.com/aup/) and [Google Cloud AUP](https://cloud.google.com/terms/aup) do not state a blanket prohibition on all lawful adult content. They prohibit illegal activity and rights violations; Google explicitly includes nonconsensual explicit imagery. This supports keeping these infrastructure candidates in scope for Seed's lawful adult mode, not promising provider endorsement or universal permissibility. Google's [service-specific terms](https://cloud.google.com/terms/service-terms) incorporate its separate generative-AI prohibited-use policy for its defined Generative AI Services. Do not automatically apply a Gemini hosted-model rule to a customer-owned ComfyUI model on a VM, or assume a third-party model license is waived. Azure's corresponding contract scope was not completed here and remains an admission check if selected.

### Execution and storage

The current worker is a long-running ComfyUI process with an asynchronous queue, authenticated file endpoints and a durable pending-output spool. A VM closely matches this. Cloud Run is not a drop-in promise merely because it accepts an OCI image.

- Linux amd64 image support and port 8080 align. GPU driver libraries are provided; CUDA newer than 13.0 requires checking NVIDIA forward compatibility. Root-like operations, nested mounts and host manipulation are restricted. [Container contract](https://docs.cloud.google.com/run/docs/container-contract)
- A Cloud Run service request can run up to 60 minutes; timeout closes the request but does not itself terminate the container. Reconnection is not guaranteed to reach the same instance. Seed must not queue a background generation, immediately return, then assume the instance and its output remain available indefinitely. Evaluate one held request per execution, or explicit session lifetime. [Request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout)
- Default writable storage is memory-backed. The model catalog is much larger than 80GiB; downloading all weights there is not safe. Preview ephemeral disk has only 10GB per-instance default quota and volumes limited to 100Gi each. Increasing quota or using supported object-storage mounts requires deliberate design and benchmarks. [Ephemeral disk](https://docs.cloud.google.com/run/docs/configuring/services/ephemeral-disk)
- 80GiB is the documented **minimum** host memory. A reliable GPU-specific maximum was not established in this research; generic memory docs still say 32GiB and conflict with the GPU minimum. Do not claim a 160GiB maximum without validating current API/console. Profile actual model-loading host RAM, not just steady GPU memory.
- “GPU ready in approximately five seconds” excludes container initialization, model fetch, hashing and loading. Measure end-to-end first usable generation, not this marketing subcomponent.
- Keep output durable before acknowledging completion. Cloud Storage may be necessary for serverless recovery even if the PC remains the permanent media home. Avoid adding it unless this path wins its proof.

## Procurement proof and acceptance gates

1. Obtain a billing-enabled account and inspect quota. No subscription commitment. Confirm exact SKU, full GPU, host RAM, hourly total, region and disk quote.
2. Test allocation with the current pinned Seed image. A diagnostic `nvidia-smi`/PyTorch check is enough to reject a bad environment before downloading weights.
3. Prepare the existing manifest; measure model transfer and loading times. Account for missing CUDA kernels or host RAM pressure.
4. Run one SFW text-to-image and one reference-to-video with native Comfy job statistics. Use the existing workflow/settings as the comparison baseline, not a different provider demo.
5. Confirm PC receipt and checksums. Stop compute, confirm billing cessation, then repeat startup at separate times. A single success is a compatibility proof, not reliability proof.
6. Compare startup failures, time-to-ready, per-job runtime, memory peak, end-to-end cost and manual interventions. Purchase decision should optimize successful sessions, not lowest nominal GPU-hour.

Proposed next engineering choice: keep VM deployment as the low-change baseline and conduct a bounded Cloud Run compatibility experiment before deciding whether its managed startup advantage justifies changes to storage and execution lifetime. Do not implement Terraform, Kubernetes, multicloud routing, or permanent reservations to conduct these tests.
