# GPU availability evidence audit

Inspected September 10, 2026. This memo supports the procurement report; it is not a capacity reservation or a deployment result.

## GPU Finder: live RTX PRO 6000 page

The interactive [RTX PRO 6000 page](https://gpufinder.dev/gpu/rtx-pro-6000) has single-GPU seven-day availability and listing-level 30-day stock history. The monthly research export is not its entire dataset. Expanded browser listings showed AWS and Google prices but **No data** for their stock.

Observed single-GPU weekly scores, September 4–10: EcoHash 100%, AceCloud 51%, Shadeform 49%, Lium 25%, Runpod 18%, Vast 0%. These are tracked provider signals, not allocation success rates. A specific Lium listing had 80% over 506 covered hours despite the pooled weekly result; aggregations and windows differ.

The [price-history page](https://gpufinder.dev/gpu/rtx-pro-6000/price-history) covers April–September price floors. This is not six months of stock history. The live page identified 30 days as its longest stock history.

The Google $1.86 listing used an N1-plus-RTX-PRO configuration. Official Google documentation restricts N1 accelerators to older supported GPUs; RTX PRO uses G4. Do not procure against that listing. See [N1 GPU support](https://docs.cloud.google.com/compute/docs/gpus/create-gpu-vm-general-purpose) and [G4 specifications](https://docs.cloud.google.com/compute/docs/accelerator-optimized-machines).

The [methodology](https://gpufinder.dev/about) states that prices partly share SkyPilot's catalog, stock is provider-reported, and workloads are not tested. The founder discloses employment at Nebius. Corroboration must come from provider documentation and a real tenant allocation, rather than another site using the same upstream catalog.

## Cast AI

The [interactive map](https://cast.ai/spot-availability-map/) loaded successfully in the browser, including GPU Tracking for AWS, GCP and Azure. It displayed separate Spot and on-demand regional summaries. It did not provide a verified exact RTX PRO 6000 launch probability in the inspected summary.

Crucially, Cast AI's [2025 benchmark report](https://430224.fs1.hubspotusercontent-na1.net/hubfs/430224/Cast%20AI%202025%20Kubernetes%20Cost%20Benchmark%20Report.pdf) defines a GPU availability ratio as the fraction of GPU instance types offered in a region. That is catalog breadth. Do not interpret similarly named map ratios as successful allocation rates without confirming their current calculation. The 2025 report describes 2024 observations and is unsuitable for current Blackwell inventory ranking.

The map's insufficient-capacity and interruption views are useful context, but aggregate CPU/Spot activity cannot establish an on-demand 96GB GPU shortlist by itself. Earlier broad regional suggestions are hypotheses, not procurement evidence.

## Other sources

- [Signwl](https://signwl.com/tools/availability-map) estimates availability from Spot discounts. Its displayed update label was March 2026. This is a price-derived indicator, not a direct stock check; exclude it from capacity scoring.
- [SkyPilot catalog](https://github.com/skypilot-org/skypilot-catalog) is useful for cross-provider configurations and pricing, not free hardware counts. Shared provenance means agreement with GPU Finder is not independent confirmation.
- [ProviderBench methodology](https://providerbench.ai/gpu/methodology/) distinguishes catalog-listed from in-stock and identifies AWS/GCP/Azure pricing APIs as catalog sources. Its distinction is useful; it does not establish hyperscaler allocation history.
- [Foundry Signals](https://www.foundrysignals.com/) describes five-minute polling, selected providers, and a $4/hour filter for single H100/H200 offers. The retrieved page did not expose usable numeric history. Its price gate would exclude valid more expensive capacity, so its aggregate cannot answer whether any suitable GPU is obtainable.

## Procurement interpretation

Evidence strength, highest first: successful exact tenant allocation; fresh account-aware capacity advice plus approved quota; fresh provider stock signal; sufficiently covered historical stock; compatible official catalog SKU; launch announcement; funding or planned buildout.

None of the inspected third-party evidence establishes that AWS, GCP or Azure is the most reliable supplier for this exact workload. Conversely, missing stock observations do not mean zero capacity. The useful output is an exact, priced trial configuration and explicit admission gates. A historical badge is a reason to investigate a supplier, not a reason to migrate application code.
