# RunPod console region check

Historical research only. Seed now uses global GPU selection with disposable disk; the network-volume recommendations below are not current operating instructions.

Inspected logged-in RunPod console on September 10, 2026, approximately 7:15–7:35 pm America/Chicago (September 11, approximately 00:15–00:35 UTC). Read-only investigation: no pod or volume created, no deployment attempted.

## Recommendation

Try **EU-RO-1 (Romania)** first, **US-NC-2 (North Carolina)** second. Both displayed a full RTX PRO 6000 96GB in the deployment screen's Available tab, and both offer standard network volumes. Romania's displayed card was $2.09/hour, 283GB host RAM, 28 vCPU; North Carolina's was $2.09/hour, 188GB RAM, 16 vCPU. These are displayed candidate configurations, not reserved hardware or successful allocations. The existing Iceland location also showed low RTX stock, so this snapshot does not establish Romania has more free cards.

Romania is a schedule tie-breaker: 5 pm Central usually corresponds to 1 am the next day in Romania, midnight in continental western Europe, and 10/11 pm Iceland. Romania stays overnight through much of the user's evening. India/Japan are approaching or within their next working day during that window. Demand is global, jobs run overnight, and weekend users also compete; neither the UI nor this review establishes hourly demand curves. No claim that Romania is objectively least requested is supported.

## Scope

Expanded all four deployment-region lists: North America, Europe, Asia, Oceania. They contained 50 datacenters. The network-volume creation page offered 18 datacenters. Clicked **each of those 18** and read its GPU availability table; excluded the other 32 from the retained-network-volume recommendation because they were not offered in that storage creation screen. Did not claim to test GPU allocation at every datacenter.

Source UI: [volume creation](https://console.runpod.io/user/storage/create) and [pod deployment](https://console.runpod.io/deploy). Availability changed while browsing. Storage matrix and deployment cards are separate signals and sometimes disagreed for secondary GPUs. Low means the displayed label, not a known GPU count. N/A below also includes omission from a datacenter's GPU table unless specified.

## All network-volume locations inspected

| Datacenter | Relevant GPU stock shown in storage UI | Storage displayed per GB/month |
|---|---|---:|
| CA-MTL-4 | H200 N/A | $0.14 selected high-performance; switch available |
| EU-FR-1 | H100 SXM Low; H200 N/A | $0.14, high-performance required |
| EUR-NO-2 | H100 SXM Low | $0.14, high-performance required |
| US-CA-2 | H100 SXM/NVL, H200 and RTX PRO 6000 N/A | $0.14, high-performance required |
| AP-IN-2 | H100 SXM Low | $0.07 |
| AP-JP-1 | H100 SXM Low; H200 N/A | $0.07 |
| CA-MTL-3 | RTX PRO 6000 and H200 N/A | $0.07 |
| EU-NL-1 | RTX PRO 6000 and H100 SXM N/A | $0.07 |
| **EU-RO-1** | **RTX PRO 6000 Low; workstation variant N/A** | **$0.07** |
| EUR-IS-1 | RTX PRO 6000 Low; workstation variant N/A | $0.07 |
| EUR-IS-3 | H100 SXM Low | $0.07 |
| EUR-NO-1 | No relevant GPU shown available | $0.07 |
| US-CO-1 | H200 SXM Low | $0.07 |
| US-GA-2 | H100 SXM/NVL and H200 N/A | $0.07 |
| US-IL-1 | No relevant GPU shown available | $0.07 |
| US-MO-2 | RTX PRO 6000 N/A | $0.07 |
| **US-NC-2** | **RTX PRO 6000 Low** | **$0.07** |
| US-TX-3 | No relevant GPU shown available | $0.07 |

At 150GB, standard storage is $10.50/month, the same nominal rate as the original volume; high-performance is $21/month. A replacement should eventually replace, not permanently supplement, the original cache. No storage purchase occurred.

## Remaining deployment-only datacenters

Not offered for a new network volume in this UI snapshot:

- North America: CA-MTL-1, CA-MTL-2, US-CA-1, US-DE-1, US-GA-1, US-KS-1, US-KS-2, US-KS-3, US-MD-1, US-MO-1, US-NC-1, US-NE-1, US-OR-1, US-OR-2, US-PA-1, US-TX-1, US-TX-2, US-TX-4, US-TX-5, US-TX-6, US-WA-1, US-WA-2.
- Europe: EU-CZ-1, EU-DK-1, EU-SE-1, EU-SE-2, EUR-IS-2, EUR-IS-4, EUR-IS-5.
- Asia: AP-IN-1, SEA-SG-1.
- Oceania: OC-AU-1.

## Next action boundary

The user requested inspection and a recommendation, not deployment. Next practical test would use the existing Seed image/private configuration and a correctly specified Romania volume, then verify a real allocation before treating the move as successful. The deployment screen initially remembered an old Hearmeman template; no template was edited or deployed during this hardware comparison. Use the current Seed template for implementation, with compatible CUDA constraints and no inherited old mount. Do not infer that the UI's card proves every Seed-specific deployment constraint will pass.
