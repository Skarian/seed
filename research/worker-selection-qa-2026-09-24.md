# Worker selection update and validation

Implemented the minimal comparison from [the selection inventory](worker-selection-inventory-2026-09-24.md).

- Shared offer card shows GPU/VRAM/RAM, disk-inclusive hourly cost, base-model download estimate, advertised download speed, provider host-quality evidence, and location/availability.
- Vast preserves separate download/upload prices, verification, reliability, network speed and machine ID. Search again prioritizes reliability, network speed, then price before the provider limit. The UI defaults to hourly price and also sorts download cost, speed or reliability; missing measurements sort last.
- RunPod keeps automatic global placement, required minimum RAM, Secure Cloud and regional stock. Its app quantity limit is no longer described as available inventory. No network performance or transfer rate is invented.
- Download charge uses decimal GB from the current worker base-model manifest times ingress price. LoRAs, image layers, retries and running time are excluded and explained in details. It is not a total cold-start estimate.
- No provider rentals, lifecycle actions, user generation requests, conversations or uploaded assets were accessed during this work.

## Evidence

Read-only live catalog capture at 2026-09-25 03:45 UTC: image 49 Vast + 17 RunPod; video 10 Vast + 2 RunPod. These captured real offers drive the browser QA; quote expiration is renewed for display-only replay. The missing-measurements case removes optional fields deliberately and is labeled as an edge case. Fixture lifecycle regression tests remain isolated from paid providers.

Vast units were checked against its [official CLI](https://github.com/vast-ai/vast-python/blob/master/vast.py): network in Mb/s, ingress/egress prices in dollars per GB. RAM/VRAM conversion retains the existing application and CLI convention; display precision is bounded. RunPod mappings follow its public v2 catalog schema.

- TypeScript check passed.
- 55 provider, pool lifecycle and offer-cost/sort tests passed.
- 39 browser tests passed, including 16 offer scenarios and existing worker/form actions.
- All 16 primary desktop/mobile captures reviewed individually, plus expanded regional stock and mobile filter layout. Automated overflow checks cover every returned card at 320, 360, 390, 768, 1024 and 1440 pixels.
- Visual corrections: compact uniform mobile filter columns; readable comparison text; full-width expanded details; bounded VRAM precision; four-decimal transfer rates; regional-stock capture scroll accounts for the sticky footer.

The final build was staged separately, then published after an aggregate idle check. The app was gracefully restarted; no worker resources existed or were changed. Post-publication catalog checks returned no provider issues: image 48 Vast + 17 RunPod in 1,126 ms; video 11 Vast + 2 RunPod in 830 ms. Stock is transient and does not establish allocation success.

[LAN app](http://192.168.1.212:4310) · [Numbered screenshot gallery](http://192.168.1.212:4314/worker-offers/index.html)

Re-run with `node scripts/test-worker-offers.mjs --live` for fresh read-only catalogs, or omit `--live` to reuse the capture. Artifacts and exact build paths are in `.local/worker-offers-atlas`; only gallery HTML, screenshots and scenario metadata are copied into the LAN gallery, not raw provider responses.

## Follow-up: separate provider views

The user rejected comparing providers with different available measurements in one list. The picker now has Vast/RunPod toggles. Each provider retains its own filter and sort state, and the common selection retains workers from both. The footer and provider toggles expose the selected counts so switching views does not conceal the launch total.

Vast exposes region, hourly price, download cost, download speed and reliability. RunPod exposes hourly price and categorical availability sorting; its cards show stock, cloud, automatic placement and number of regions with stock. RunPod no longer has empty network/download-cost cells or a misleading region filter. Provider errors stay with the affected tab, with an attention indicator on that toggle.

Fresh read-only capture at 2026-09-25 04:04 UTC: 48 Vast and 16 RunPod image listings; 16 Vast and 2 RunPod video listings. No rentals. Two pure cost/sort tests and 43 browser tests passed, including 20 desktop/mobile offer scenarios. Provider switching, selection/filter retention, credentials recovery, and both-provider launch behavior were checked in the isolated fixture. Captures were inspected individually; the active-toggle contrast was corrected after that review. The follow-up only changes frontend behavior and is published without restarting the app.
