# Seed GPU procurement decision

Research completed September 10, 2026. Prices are USD list prices before tax. No resources were purchased or deployed during this investigation. This report supersedes earlier informal provider rankings; it does not change the implementation plan automatically.

## Recommendation

**After confirming admission and an allocation path, build a small, ordinary GPU-VM deployment path for the existing Seed worker, starting with Google Compute Engine G4.** The exact first candidate is `g4-standard-48`: one full RTX PRO 6000 Blackwell 96GB, 48 vCPU, 180GiB host RAM. Iowa's published on-demand compute rate is **$4.49993/hour**. It closely matches the previously working worker's approximately 188GB host RAM, preserves the existing container and asynchronous protocol, and respects the preference to seriously evaluate hyperscalers. This is a compatibility and procurement recommendation, **not evidence of superior available capacity**. [Google specifications](https://docs.cloud.google.com/compute/docs/accelerator-optimized-machines), [official prices](https://cloud.google.com/products/compute/pricing/accelerator-optimized)

**Nebius RTX PRO 6000 is the strongest lower-cost alternative:** one 96GB card, 24 vCPU and 218GiB RAM at **$1.80/hour**. Its current self-service offering and account-aware capacity advisor make it more actionable than a sales-only GPU announcement. However, a recent regional outage and ambiguity in its adult-content terms prevent an unconditional recommendation for all of Seed's workflows. If those checks pass and Google admission is cumbersome, Nebius deserves the first practical trial instead. [Types](https://docs.nebius.com/compute/virtual-machines/types), [pricing](https://docs.nebius.com/compute/resources/pricing), [self-service](https://nebius.com/self-service), [capacity advisor](https://docs.nebius.com/compute/virtual-machines/capacity-advisor)

**AWS `g7e.4xlarge` is the second hyperscaler candidate**, with the same full GPU, 16 vCPU and 128GiB RAM. Its indicative $3.9982/hour rate is attractive, but a current official account quote and host-memory proof remain necessary. The specialist memo prefers AWS on price; this synthesis prefers Google's additional RAM for the first comparison because we have not measured peak host memory. That approximately $0.50/hour difference is a small price for avoiding an extra variable during a short test. [AWS G7e](https://aws.amazon.com/ec2/instance-types/g7e/), [September 5 indicative price snapshot](https://aws-pricing.com/g7e.4xlarge.html)

The next investment should be a bounded working demonstration, not a provider abstraction framework. Procurement must establish an actual launch path before extensive migration engineering.

## What Seed needs to buy

We need one GPU, one active job, and an interruptible-by-the-user session—not a multi-GPU training cluster. The PC remains the permanent home of media and job history. A remote disk caches reproducible models and protects outputs awaiting transfer acknowledgement.

The current manifest contains eleven files totaling **99.625GB / 92.78GiB**, before selected LoRAs and working space. All are prepared at startup today. A 200GiB model/workspace disk is a conservative initial allowance; image storage may need additional boot-disk space. The current CUDA 13.0 container needs compatible host drivers, GPU access, an actual writable workspace mount, and a reachable authenticated worker endpoint. Jupyter remains administrative and separate from worker authentication.

Existing results establish that the 96GB RTX configuration works: approximately 42 seconds for a first image, 184 seconds for a five-second text video including loading, 266 seconds for a five-second mixed-reference video, and 477 seconds for a fifteen-second text video. They do **not** establish minimum VRAM, peak host RAM, or fifteen-second performance with maximum references. The new native Comfy measurements still need their requested live verification. See the [repository audit](SEED-HOSTING-REQUIREMENTS.md) and [execution journal](../development/HISTORICAL-EXECUTION-PLAN.md).

These facts favor a full 96GB card and substantial host memory for the first trial. An 80GB H100 might work, but changing GPU architecture and memory capacity simultaneously would complicate diagnosis. An H200 offers more headroom at higher cost; it should win through measured performance, not its model number.

## Shortlist and reasons for exclusion

| Candidate | Relevant configuration | Compute/hour | Decision |
|---|---|---:|---|
| Google G4 standard 48 | 96GB GPU, 180GiB RAM | $4.49993 | First hyperscaler proof; quota and real allocation outstanding |
| Nebius RTX PRO 6000 | 96GB GPU, 218GiB RAM | $1.80 | Best value/fit alternative; admission, outage remediation and policy checks |
| AWS G7e 4xlarge | 96GB GPU, 128GiB RAM | ~$3.9982, indicative | Second hyperscaler; verify official quote and memory |
| Azure NC144 RTX PRO | 96GB GPU, 264 or 516GiB RAM | Unverified | Large compulsory CPU bundle; no verified quote or admission advantage |
| Google Cloud Run RTX PRO | 96GB GPU, minimum 80GiB RAM | ~$3.19 minimum total | Real option, but not a drop-in worker lifecycle |
| Verda RTX PRO | 96GB GPU, 90GB RAM | $1.89 | Lower RAM and delete-to-stop-billing semantics add uncertainty |
| DigitalOcean H200 | 141GB GPU, 240GiB RAM | $4.47 | Credible extra-memory fallback; destroy required to stop compute billing |
| EcoHash RTX PRO | 96GB GPU, 64GB RAM | $1.89 | Interesting stock history, but new operator and RAM/proxy concerns |

Supporting specifications, region details, lifecycle rules and citations are in the [hyperscaler memo](HYPERSCALER-PROCUREMENT.md) and [market memo](GPU-CAPACITY-MARKET.md). Azure's smaller NC24/36 offerings are fractional 24GB cards; their price is not a full-card bargain. Neither multi-GPU-node prices divided by GPU count nor Spot rates represent our intended purchase.

Cloud Run's RTX PRO service is now generally available, not merely a speculative roadmap item. But the minimum CPU/RAM charges bring its total above the GPU-only advertised component. More importantly, Seed returns immediately after queuing background generation, then polls and retrieves output. Scale-to-zero, instance routing and pending-output persistence require explicit changes. Default writable storage is memory-backed; downloading our entire manifest there is unsuitable. A managed runtime may eventually improve startup UX, but it should not be selected by ignoring that engineering work. [GPU service](https://docs.cloud.google.com/run/docs/configuring/services/gpu), [pricing](https://cloud.google.com/run/pricing), [container contract](https://docs.cloud.google.com/run/docs/container-contract)

## What the availability research actually establishes

The browser inspection corrected an important earlier omission: **GPU Finder does track RTX PRO 6000**, including seven-day and listing-level thirty-day stock history. It showed materially different signals between providers. Yet AWS and Google's entries had no stock history, and the Google listing combined N1 with RTX PRO 6000—an unsupported configuration according to Google's own documentation. That row cannot anchor a procurement decision. [GPU Finder RTX page](https://gpufinder.dev/gpu/rtx-pro-6000), [Google supported N1 accelerators](https://docs.cloud.google.com/compute/docs/gpus/create-gpu-vm-general-purpose)

Tracker observations, dates, limitations and source relationships are preserved in the [tracker audit](GPU-TRACKER-AUDIT.md). Important distinctions:

- A catalog listing means a provider sells that shape, not that a GPU is free.
- Provider-reported stock is useful, but can still fail for our quota, disk location, or request constraints.
- Thirty-day stock percentages are not measured successful customer launches. Different listing aggregations can disagree legitimately.
- Six months of price history is not six months of capacity history.
- Cast AI's published GPU availability-ratio definition measures regional catalog breadth. We should not reuse that percentage as a launch probability without verifying the current metric.
- Several comparison sites share pricing catalogs. Agreement is not independent corroboration.

There is no defensible public dataset here proving that a particular hyperscaler will supply our exact full-card VM on demand every evening. Conversely, missing data does not mean missing hardware. The appropriate next evidence is authenticated admission followed by repeated allocations.

Recent Reddit reports corroborate that both RunPod and Google users encounter shortages, but mix different GPU models, zones and account limits. They are useful failure-mode evidence, not a sound numerical ranking. The dated links and qualifications are retained in the market memo rather than transformed into false precision.

Our own RunPod history also needs careful interpretation. The failed requests were constrained combinations of GPU, CUDA and regional storage, not an exhaustive survey. The API uses HTTP 400 for multiple failure classes. The next RunPod diagnostic, if pursued, should flatten the template fields and accept the image's actual CUDA 13.0 requirement, preserving secrets privately. We have not proven that our request was defective, but neither have we proven every suitable RunPod GPU was unavailable. This corrective audit does not erase the poor user experience; it prevents carrying an avoidable configuration restriction to another provider.

## Investment, roadmap and operational maturity

Exact-product expansion matters more than company-wide AI spending. AWS's G7e launch and subsequent regional expansion establish more places selling the required GPU. Google's G4 GA and Cloud Run GPU GA establish delivered products. Neither announcement reveals uncommitted inventory. [AWS expansion](https://aws.amazon.com/about-aws/whats-new/2026/05/amazon-ec2-g7e-london-region/), [G4 GA](https://cloud.google.com/blog/products/compute/g4-vms-powered-by-nvidia-rtx-6000-blackwell-gpus-are-ga/), [Cloud Run releases](https://docs.cloud.google.com/run/docs/release-notes)

The research also examined AWS, Microsoft and Alphabet financial releases, Nebius's contracted-power and UK expansion announcements, DigitalOcean's new infrastructure roadmap, and Verda's hardware plans. The useful conclusion is not that the company with the largest spending figure wins. Contracted power can be years from service; commissioned GPUs can already be committed to large customers; CPU, custom silicon and buildings can dominate the headline. The market memo separates these categories and links the primary evidence.

Nebius supplies especially relevant contrary evidence. Its August 19 US-central cooling incident interrupted roughly one-third of running VMs, and restoration of remaining on-demand capacity continued for days. This materially weakens any claim that its attractive specification proves operational superiority. Its published postmortem is valuable transparency; remedial completion and UK admission deserve inspection before choosing a region. [Nebius postmortem](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19)

EcoHash's high observed stock signal merits attention, but its recent commercial buildout is not a long operating record. Its small host RAM and service-proxy authentication also need validation against Seed. We should keep it as a watchlist candidate, not migrate on the strength of one badge.

## Costs and the storage constraint

Illustrative monthly floor, assuming a retained 200GiB model disk and the stated number of active compute hours:

| Active hours/month | Google G4 + approximately $16 disk | Nebius RTX + $14.20 standard SSD |
|---:|---:|---:|
| 5 | $38.50 | $23.20 |
| 20 | $106.00 | $50.20 |
| 80 | $376.00 | $158.20 |

These are **compute-plus-model-disk illustrations, not all-in quotes**. Add boot/image storage if separate, public IPv4 where charged, internet egress, snapshots, performance provisioning, taxes, and billable cold preparation. G4 requires Hyperdisk rather than ordinary Persistent Disk. Nebius's cheaper nonreplicated disk has size increments; standard SSD is the simpler baseline. [Google disk pricing](https://cloud.google.com/compute/disks-image-pricing), [Nebius storage](https://docs.nebius.com/compute/storage/types), [Nebius prices](https://nebius.com/prices)

The relevant number is cost per successful session, including startup and retrieval. At twenty active hours the Google premium over Nebius is approximately $56/month before other fees. That may be acceptable if it produces a better experience, but research has not demonstrated that benefit yet.

Disk throughput is another procurement variable: Nebius standard SSD bandwidth scales by 32GiB allocation units, so a small disk does not receive the advertised maximum. Benchmark model loading before selecting it solely on price. Replicated IO M3 is a faster option with different size increments and a higher charge. On Nebius, use a **standalone disk**, because VM-managed disks are deleted with their VM. The trial must verify equivalent retention settings on Google. [Storage performance and lifecycle](https://docs.nebius.com/compute/storage/types)

**Moving providers does not abolish locality.** A retained model disk is normally tied to a zone or region. A stopped VM gives up unreserved GPU capacity. Maintaining a permanent capacity reservation incurs idle compute charges and conflicts with the low-cost goal. Snapshots or the pinned manifest allow rebuilding elsewhere, at a startup-time cost. Buy one local disk only after choosing an allocatable location; do not pre-create caches in many regions. Treat models as reconstructible and unreceived outputs as valuable. [AWS reservation billing](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-capacity-reservations.html), [Nebius reservations](https://docs.nebius.com/compute/virtual-machines/reservations)

If repeated allocation remains unacceptable across candidates, the real choice becomes paying to retain capacity versus accepting occasional waiting. No orchestration library can create uncommitted GPUs. A multicloud router might broaden attempts, but would add credentials, caches and failure modes before solving the basic proof.

## What we should build next

Keep the current application, public GHCR image, private runtime secrets, Comfy workflows and PC-owned library. The smallest implementation is:

1. An explicitly configured trusted HTTPS worker endpoint, replacing the current RunPod-only hostname restriction without accepting arbitrary destinations.
2. A provider-specific VM launch recipe that mounts the model disk, installs/uses a compatible NVIDIA runtime, injects secrets and runs the pinned existing container.
3. A tested HTTPS route for pairing, uploads, status, resumable downloads and acknowledgement. A health page alone is insufficient. Comfy remains private; Jupyter remains separately authenticated.
4. Clear provider-specific stop instructions and billing verification. Preserve the pending-output spool until the PC confirms receipt.

For the first VM, use Caddy as the small HTTPS reverse proxy in front of port 8080, with a user-controlled DNS name pointing to the VM; the PC initiates connections and needs no inbound home port. Confirm DNS access at setup. Bind worker access behind that proxy and retain worker authentication. Preserve or replay the local pinned LoRA/preset configuration as well as base-model definitions before retiring any old disk. This avoids declaring a successful migration that silently loses a content mode.

The HTTPS recipe follows [Caddy's automatic HTTPS requirements](https://caddyserver.com/docs/automatic-https): DNS, externally reachable VM ports and persistent certificate storage. No Terraform, Kubernetes, new registry, provider marketplace, automatic GPU shopping, or serverless protocol rewrite is required for this proof. Selective model preparation is a useful later optimization; keep the model set constant for the first comparison.

## Execution gates and decision rule

**Admission checkpoint, before buying compute:** use the selected account to confirm billing access, region/zone offerings, one-GPU quota, current full-VM quote and storage/egress charges. AWS new-account G-family quota defaults to zero; a quota grant is not a capacity reservation. Check that intended self-hosted workflows fit the applicable infrastructure contract; Nebius and Verda have wording requiring clarification for the desired adult mode. Do not silently disable a required mode to declare success. [AWS quotas](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html), [Nebius AUP](https://docs.nebius.com/legal/aup)

Google requires a **Paid billing account**, rather than merely an active Free Trial, for GPU access and quota increases. Confirm regional RTX PRO quota and the relevant Hyperdisk quota before creating storage. [Google billing restrictions](https://docs.cloud.google.com/free/docs/free-cloud-features)

**Proposed first experiment:** one GPU, at most two billed GPU-hours before reviewing results, with separately disclosed retained-storage and network costs. This is a proposed budget, not a purchase made by this report. Google compute would be about $9; Nebius about $3.60, though its initial self-service deposit is at least $25. Account setup is the next collaboration checkpoint.

Record the allocation request and exact failure category, GPU/driver/RAM readback, image pull, model download/hash times, service readiness and first-result latency. Run the already requested one text-to-image and one reference-to-video, capture native Comfy statistics and host memory, and save results on the PC. A representative fifteen-second high-reference test is the following workload-envelope check, not something previous results already proved.

Override the container command for the initial GPU/PyTorch diagnostic so it runs **before** the supervisor begins downloading the full model set. Proposed operational checkpoints: report an allocation still pending after five minutes; investigate a warm worker taking more than ten minutes to become ready; review cold preparation at forty-five minutes rather than leaving it unattended until the spending ceiling. These are proposed usability targets for the trial, not measured performance promises. Record first-result loading separately from service readiness.

Then interrupt a result transfer, reconnect and verify durable recovery. Stop compute correctly and inspect remaining charges. Repeat warm starts or replacements at three separate times before adopting the provider. Three successes establish practical repeatability, not a statistically meaningful uptime percentage.

**Adopt the candidate only if** real workflows, media transfer, repeated startup and billing cleanup pass within acceptable latency and cost. If admission fails, move to the named next candidate and record why; do not spend days polishing a deployment that cannot obtain a GPU. If memory or kernel compatibility fails, use the measurements to change hardware deliberately. If capacity fails repeatedly, revisit the price of retained capacity explicitly.

The research has narrowed the decision enough to execute a meaningful trial. It has not converted public marketing into guaranteed availability. The next confidence increase comes from this small procurement proof, not another layer of infrastructure.

## Supporting research

- [Hyperscaler procurement](HYPERSCALER-PROCUREMENT.md): exact shapes, prices, quota, maturity and Cloud Run contract.
- [Capacity market](GPU-CAPACITY-MARKET.md): alternative suppliers, recent community reports, expansion, outage and contract evidence.
- [Tracker audit](GPU-TRACKER-AUDIT.md): direct browser observations and limits of availability metrics.
- [Seed requirements](SEED-HOSTING-REQUIREMENTS.md): repository audit, actual workload evidence, portability and RunPod request constraints.
