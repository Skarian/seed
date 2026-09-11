# GPU capacity market: procurement notes for Seed

Research date: 2026-09-10. Read-only research; no accounts created, capacity reserved, or VMs launched. This memo contributes market, alternative-provider, and recent community evidence to the broader procurement report. Prices are public list prices, not account quotes. Availability remains unverified until an authenticated allocation succeeds.

## Recommendation from this evidence

**Nebius RTX PRO 6000 is a strong candidate for an actual procurement trial**, alongside the hyperscaler candidates in the main report. Its price, same 96GB GPU, native stop/start semantics, and account-aware capacity advisor directly address Seed's needs. This is a much stronger basis than choosing a vendor simply because it is investing heavily. **Verda is the second credible same-GPU alternative**; DigitalOcean H200 is a useful higher-memory fallback. None is proven to be reliably launchable for this account.

The most important distinction is between (1) GPU listed in a region, (2) public provider availability signal, (3) quota and physical capacity visible to our account, and (4) a successful launch. Only the fourth is procurement proof. A successful launch still does not guarantee later restart after capacity is released.

## Retail-accessible alternatives

| Candidate | Verified public configuration and price | Procurement relevance | Remaining gate |
|---|---|---|---|
| Nebius RTX PRO 6000 | 1 GPU, 96GB; `1gpu-24vcpu-218gb`; `gpu-rtx6000` in `us-central1`, `gpu-rtx6000-a` in `uk-south2`. Both platforms $1.80/GPU-hour on-demand. | Same architecture as tested Seed worker, substantial host RAM, low hourly price. | New account quota, live physical capacity, final account quote, policy clarification. |
| Nebius H200 | 1 GPU, 141GB; 16 vCPU/200GiB host RAM; $4.50/hour; public regions include `eu-north1`, `eu-west1`, `us-central1`. | Useful memory fallback within same API, but >2x RTX price. | Must validate actual Seed video performance; not automatically the economical choice. |
| Verda RTX PRO 6000 | Single GPU offered; 96GB, 30 CPU threads, 90GB host RAM. $1.89/hour on-demand. | Same GPU at a competitive price. | Allocation, region/storage mapping, potential host-RAM pressure, content-policy interpretation. |
| DigitalOcean H200 | 1 GPU, 141GB; 24 vCPU/240GiB host RAM; $4.47/hour. | Only $0.06/hour above its H100; sensible DO hardware candidate for uncertain video VRAM. | Account GPU access, actual capacity, preserving models while destroying VM. |
| Scaleway H100 PCIe | Single 80GB H100, 24 vCPU/240GB RAM; documented PAR2 and WAW2. | Clearly purchasable single-card SKU, credible European infrastructure. | Less VRAM than tested 96GB, exact current selected-zone quote and capacity. |
| Lambda H100 SXM/PCIe | Both single-card 80GB configurations exist. | Suitable software architecture, but no evidence here that it improves availability sufficiently. | Current quote and allocation, region-bound filesystems; avoid confusing ARM GH200 96GB with x86 GPU. |

Sources: [Nebius live type/preset table](https://docs.nebius.com/compute/virtual-machines/types), [Nebius pricing](https://nebius.com/prices), [Verda RTX page](https://verda.com/rtx-pro-6000), [DO GPU pricing](https://www.digitalocean.com/pricing/gpu-droplets), [Scaleway H100](https://www.scaleway.com/en/h100/), [Lambda on-demand types](https://docs.lambda.ai/public-cloud/on-demand/).

Important corrections found by opening the current pages:

- Nebius search snippets only listed the US RTX region. The live documentation also lists **UK `uk-south2`**. Do not infer the fleet from stale snippets.
- Verda's headline says self-service access starts at $0.945/hour, but the actual pricing table labels that **Spot**; on-demand is $1.89.
- DigitalOcean's July regional article still presents H100 $3.39 and H200 $3.44. Current prices became $4.41 and $4.47 on August 1. Its [July 21 pricing announcement](https://www.digitalocean.com/blog/price-changes-gpus) explains the change. The current pricing documentation wins over the article.
- DigitalOcean's RTX 6000 Ada is **48GB**, not the 96GB RTX PRO 6000 Blackwell we need to compare. Similar names are not interchangeable.

## Lifecycle and storage: what would change in Seed

Nebius explicitly bills compute only while VMs run, with one-second billing; stopped VM disks remain charged. This aligns with the user's desired stop/restart experience. **Stopping returns GPUs to the shared pool; restart is not guaranteed without a paid reservation.** [Compute billing](https://docs.nebius.com/compute/resources/pricing), [reservation mechanics](https://docs.nebius.com/compute/virtual-machines/reservations).

For a model disk, Network SSD costs $0.071/GiB per 730 hours: **150GiB=$10.65/month; 200GiB=$14.20/month**, excluding boot disk/traffic/tax. Nonreplicated SSD costs $0.053 but sizes must be multiples of 93GiB: 186GiB=$9.858/month; 150 or 200GiB is not a valid NRD size. It has no redundancy. Standard Network SSD 200GiB is a cost baseline, not a performance recommendation: its bandwidth scales with capacity (15MiB/s per 32GiB allocation unit), so a 200GiB disk is around 90MiB/s rather than the advertised 450MiB/s maximum. Benchmark model loading; a replicated IO M3 186GiB disk costs **$21.948/month** and is an alternative to compare for speed. Verify selected disk performance in the actual allocation. Object storage standard is $0.0147/GiB-month ($2.205 for 150GiB), but still needs download into a model disk. Cross-region disk/snapshot portability has **not** been established by this review; do not promise seamless migration. [Storage types and size constraints](https://docs.nebius.com/compute/storage/types), [storage prices](https://nebius.com/prices).

Nebius's **Capacity Advisor** reports tenant quota plus current physical supply for each platform/preset/region, and a likelihood indicator. The CLI is `nebius capacity resource-advice list --parent-id <tenant_id>`. The data includes its timestamp and explicitly does not promise allocation at creation time. This is better evidence than a product catalog, not a reservation. [Capacity Advisor](https://docs.nebius.com/compute/virtual-machines/capacity-advisor).

**Verda and DigitalOcean keep charging when a VM is merely shut down.** To end compute billing, delete it. Verda permits retaining selected volumes and attaching them to a replacement; its former Hibernate option was removed. DO GPU snapshots preserve boot disk, not scratch disk. A migration to either must expose the correct termination action rather than carrying over the word Stop and leaving an expensive VM allocated. [Verda lifecycle, updated Aug 4](https://docs.verda.com/cpu-and-gpu-instances/shutdown-hibernate-and-delete/), [DO billing, verified Aug 25](https://docs.digitalocean.com/products/droplets/details/pricing/), [DO snapshots, verified Jul 13](https://docs.digitalocean.com/products/snapshots/how-to/snapshot-droplets/).

A provider switch does not make attached storage universal. Start with one provider-local model disk; keep the manifest authoritative and original sources reproducible. Do not implement global synchronization before the new provider passes the real workflow and restart trial. Permanent outputs remain on the PC.

## Recent community evidence

These are anecdotes, not statistically representative launch-success rates. Dates refer to posts, not search crawl dates.

| Date | Source | What it contributes | Limitation |
|---|---|---|---|
| 2026-08-29 | [GCP at capacity?](https://www.reddit.com/r/googlecloud/comments/1w1h6ds/gcp_at_capacity/) | Multiple users describe quota/capacity problems and region changes; one reports being advised to move regions then having quota denied. | Mixed CPU/GPU workloads and account situations; not proof G4 is unavailable everywhere. |
| 2026-08-24 | [Tracking live GPU availability by GCP zone](https://www.reddit.com/r/googlecloud/comments/1vx293i/is_there_a_site_for_tracking_live_gpu/) | Users distinguish region support from live inventory; no claimed comprehensive free-GPU count dashboard. | Community answer, not Google contract or inventory. |
| 2026-08-01 | [us-central1-a capacity](https://www.reddit.com/r/googlecloud/comments/1uycd85/whos_using_up_all_of_uscentral1a/) | Recent repeated allocation concerns in a frequently recommended region. | Not GPU-specific enough to rank RTX supply. |
| 2026-07-17 | [RunPod RTX PRO 6000 shortage](https://www.reddit.com/r/RunPod/comments/1uz4bki/rtx_pro_6000_shortage/) | Users report constraints and division of full cards into MIG 24/48GB options. | A full-card listing and fractional availability must be separated; comments don't quantify inventory. |
| 2026-07-07 | [GCP instance API availability](https://www.reddit.com/r/googlecloud/comments/1uptti5/api_to_see_available_instance_types_per_zone/) | A user reports treating real provisioning attempts as the on-demand availability signal. | Methodological support, not provider ranking. |
| Started 2026-06-01; thread has later updates | [RunPod GPU supply megathread](https://www.reddit.com/r/RunPod/comments/1ttfe7h/gpu_supply_and_availability_megathread_with/) | Explicit shortage discussion and regional supply updates. | Provider/community communication; additions may be sold before we request them. Read individual update dates. |

Recent forum reports support taking capacity seriously across clouds. They do **not** establish that AWS, GCP, Azure, or a smaller cloud will win for our exact single 96GB request. Discounted spot prices do not establish on-demand availability either.

## Investment and buildout: material, but not capacity we can buy

| Provider | Recent verified evidence | Procurement interpretation |
|---|---|---|
| AWS | July 30 Q2 release reports AWS revenue growth of 37%. Q2 filing reports $53.1B cash capex for quarter, majority technology infrastructure spend supporting AWS plus fulfillment. | Financial scale and expansion are real. Spending includes CPUs, custom chips, buildings and other uses; not a count of uncommitted RTX cards. |
| Microsoft | FY26 Q4 call reports $41B quarterly capex; about two-thirds short-lived CPU/GPU assets; FY27 investment expected to grow. | Azure can fund major expansion, but first-party AI and enterprise commitments compete with retail GPU VM supply. |
| Alphabet | Q2 2026 filing reports equity/preferred issuance net proceeds $49.6B, including AI infrastructure/global compute as purposes. | Funding is available. This doesn't identify G4 quotas or free cards in a particular zone. |
| Nebius | Aug 12 Q2 presentation raises year-end contracted-power guidance to 5GW; four large Q2 AI-cloud deals averaged >$1B. June 8 UK announcement commits ~£1.7B across four sites, 65MW when ramped in 2027. | Strong long-term supplier trajectory, but contracted power is not connected power, installed GPUs, or uncommitted on-demand capacity. Large deals can consume the buildout. Current UK RTX type is more useful than projected GW. |
| DigitalOcean | 2026 platform update identifies Atlanta AI datacenter launch; later regional guide names Atlanta/Richmond/Kansas City growth. | Concrete region/product expansion supports a trial. Reserved/contact-sales B300 offering is different from retail H200. |
| Verda | Jun 12 update projects Rubin deployments beginning H2 2026 and >100,000 GPUs during 2027; identifies Supermicro supplying Blackwell systems including RTX 6000. | Relevant roadmap, but future commitment, not inventory. Existing RTX hourly product is the useful near-term evidence. |

Primary sources: [AWS Q2 release](https://www.aboutamazon.com/news/company-news/amazon-earnings-q2-2026-report), [AWS Q2 SEC filing](https://www.sec.gov/Archives/edgar/data/1018724/000101872426000026/amzn-20260630.htm), [Microsoft FY26 Q4 call](https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q4), [Alphabet Q2 SEC release](https://www.sec.gov/Archives/edgar/data/1652044/000165204426000066/googexhibit991q22026.htm), [Nebius Q2 SEC presentation](https://www.sec.gov/Archives/edgar/data/1513845/000110465926094568/tm2622968d1_ex99-2.htm), [Nebius UK announcement](https://nebius.com/newsroom/nebius-expands-in-uk-with-more-nvidia-powered-infrastructure-more-customers-and-more-cloud-capabilities-for-agentic-and-enterprise-ai), [DO 2026 platform roadmap](https://www.digitalocean.com/blog/building-inference-cloud-what-comes-next), [Verda May digest published June 12](https://verda.com/blog/verda-monthly-digest-may-2026).

## Policy fit as a procurement gate

Seed's lawful adult-content mode matters; do not confuse running our own model on a VM with a vendor's managed inference policy. Nebius prohibits obscene/otherwise objectionable content and defines illegal pornography; Verda also includes an obscenity restriction. Neither page is a clear blanket approval of Seed's intended adult use. Request a concise provider clarification before committing if that mode is a must-have. DO's March 20 AUP explicitly targets unlawful pornography, CSAM and nonconsensual imagery; this is not a guarantee all intended content is approved. These are contract observations, not legal conclusions. [Nebius AUP](https://docs.nebius.com/legal/aup), [Verda terms §6](https://verda.com/terms-and-conditions), [DO AUP](https://www.digitalocean.com/legal/acceptable-use-policy).

## Proposed decision gate

1. Read authenticated candidate quota/capacity without spending: Nebius single RTX US/UK, alongside exact hyperscaler SKUs shortlisted by the main report. Obtain quotes for full VM plus a 200GiB model disk and expected outbound media.
2. Choose one candidate with an actual account-level path to allocate. Use existing container and model manifest; do not build a new orchestration platform first.
3. With deployment authorization, launch one GPU; record request-to-ready, image pull, model preparation, actual VRAM/host RAM, image job, reference video job, durable output arrival, total billable time.
4. Confirm stop/delete billing behavior, preserve model disk, and attempt a later restart/replacement. One initial successful launch is not enough to support a reliability claim.
5. Adopt only after workflow and lifecycle proof. If blocked, record exact quota vs capacity vs image/runtime error and move to the second candidate, not an unbounded search through regions.

Suggested priority from this memo: Nebius RTX PRO 6000 trial, then Verda RTX PRO 6000; DO H200 if extra memory is helpful and cost acceptable. Hyperscaler comparison may outrank these after its account/price analysis. No claim of 95% availability is supported by this research.

## Follow-up checks: admission, recent outage, EcoHash

**Nebius admission:** the March 26 launch article says account-manager access with self-service later. The current [self-service page](https://nebius.com/self-service) now explicitly lists RTX PRO 6000 and says customers can sign up, add payment details, and deposit at least $25 to deploy. This is stronger current admission evidence than list pricing alone. It still does not prove this user's quota. Both US and UK RTX platforms are now listed at $1.80/hour in the [live compute pricing page](https://docs.nebius.com/compute/resources/pricing).

**Nebius adverse operational evidence:** an August 19 storm-related facility event disabled cooling in us-central1 and caused a region-wide service disruption. Roughly one-third of running VMs were interrupted. Reserved capacity was restored by 08:38 UTC August 20; restoration of the remaining on-demand pool continued for several days. The August 27 postmortem identifies missing environmental alerting, manual region recovery, and stale disk attachments; the disk hot-plug fix was deployed, with broader resilience work still planned. This materially weakens any claim that Nebius is a proven reliability upgrade. It remains a value/fit trial candidate; ask about remedial completion and compare UK capacity rather than defaulting blindly to US. [Primary postmortem](https://nebius.com/blog/posts/incident-post-mortem-analysis-us-central1-service-disruption-on-august-19).

**EcoHash deserves a bounded trial slot, not an automatic win from its high GPU Finder history.** GPU Finder's July 30 changelog initially recorded pricing only, but its August 15 update explicitly added hourly stock data from EcoHash's public availability API; August 20 added US region mapping. Its current history therefore is not simply the old static catalog. It is still vendor-reported stock, not successful customer launches. [Collector changelog](https://gpufinder.dev/changelog).

EcoHash's official price is $1.89/GPU-hour with no minimum commitment; 200GB persistent storage is $20/month. The product supports 1/2/4/8 RTX PRO 6000 configurations. Its API documents arbitrary Linux x86_64 containers including public GHCR and an authenticated service URL supporting WebSockets/streaming. Launching requires a prepaid hold for the selected duration, minimum 1 hour, refunded minus use on termination. Autoexpiry must not kill a long video job unnoticed. Its public proxy expects an EcoHash bearer key or console cookie: potential conflict with Seed's own worker Authorization header needs solving before claiming drop-in compatibility. [Pricing](https://ecohash.com/pricing), [container images](https://docs.ecohash.com/gpu-compute/container-images), [launch/API](https://docs.ecohash.com/gpu-compute/launching-instance).

This is an identifiable company rather than an anonymous marketplace listing: parent Cango announced the subsidiary's commercial portal April 13. Its September 3 investor press-release headline describes the first GPU batch entering commercial service at the Georgia facility. That very recent operating history and the single-GPU 64GB host RAM are reasons to test carefully rather than rank it above established suppliers on a 99% stock badge. The parent site's 50MW mining facility is not 50MW of installed retail GPUs. Independent long-term operating evidence was not found in this pass. [Cango April announcement](https://ir-image.cangoonline.com/ir-documents/2026-04-13_Cango%27s-HPC-and-AI-Inference-Subsidiary-EcoHash-Begins-Commercial-Operations.pdf), [parent September 3 release listing](https://ir.cangoonline.com/news-events/press-releases), [spec comparison](https://getdeploying.com/ecohash).

The EcoHash SLA's 99% monthly success measure applies to dedicated inference endpoints; it should not be represented as a guarantee that a generic GPU workspace can be allocated. Persistent storage is region-local, and its product/retention documentation should be reconciled during a trial before deletion. [SLA](https://ecohash.com/legal/sla), [storage](https://ecohash.com/storage).
