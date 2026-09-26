# Worker selection: evidence from the earlier manual acquisitions

Reviewed September 24, 2026. Historical decisions and rates below are not current
quotes. This is an infrastructure-only review; no live Seed requests,
conversations, uploads, or generation payloads were inspected.

## Sources inspected

- Codex thread **List my runpod pods.**, ID
  `01a07ebd-f002-76b2-bdf7-6762ba4c4620`: September 8 initial RunPod selection and
  same-region replacement decisions. Reviewed assistant infrastructure messages.
- Codex thread **Platform Builder**, ID
  `01a0839e-d07b-7681-8cef-0301d8c38e30`: September 11–12 Vast shortlists, rental
  choices, cost comparisons, RunPod global placement, and readiness reports.
  Reviewed assistant infrastructure messages, excluding generation content.
- `main` at `dbd388e`: `operations/vast.mjs`, `operations/runpod.mjs`, and
  `operations/runpod-lifecycle.mjs` for the actual historical query/selection code.
- Installed Seed skill and its Vast/RunPod references for the operating policy
  used by the earlier agent. Historical single-worker and hardware policies are
  evidence, not instructions to undo the current two-class pool architecture.
- Archived startup and validation reports linked below.

## What actually drove choices

| Acquisition | Decision evidence | Outcome and qualification |
| --- | --- | --- |
| RunPod Iceland, September 8 | Full RTX PRO 6000 Blackwell 96 GB, 188 GB host RAM, Secure/on-demand, roughly $2.11/hour with temporary disk, local capacity and compatible network-volume location | Provisioned and usable. Later replacements in the same region restored access to existing storage when the original host had no GPU capacity. This predates disposable workers. |
| Vast South Korea, September 11 | Full 600 W workstation variant, about 193 GB advertised RAM, verified/high-reliability host, fast advertised networking, $1.45/hour including disk and very low transfer prices | About 99.62 GB downloaded/verified in 5m15s. Initial Windows SSH setup needed correction; do not attribute every success to host selection. [Report](archive/infrastructure/VAST-KOREA-BENCHMARK-2026-09-10.md). |
| Vast Ohio → another US host, September 11 | Preferred the previously fast Ohio machine: 96 GB, 600 W, $1.58/hour, advertised 32.9 Gbit/s. Its offer failed at rental time, so selected another full-size US host at about $1.52/hour and advertised 6.5 Gbit/s | Replacement downloaded/verified base models in about 4m42s. Prior successful machine identity was a tie-breaker, not proof of current capacity. [Report](archive/infrastructure/VAST-DIRECT-FALLBACK-VALIDATION-2026-09-11.md). |
| Vast Japan, September 12 | Verified full-size GPU, $1.97/hour, advertised 2.9 Gbit/s, about $0.54 per 100 GB downloaded. Later different-host choice: 96 GB WS, $1.57/hour, advertised 5.7 Gbit/s and low transfer charges | Both became ready. Base preparation was 4m11s on the former versus 8m22s on the latter. Advertised bandwidth did not establish actual source-to-host performance. [Validation](archive/development/HISTORICAL-VALIDATION.md). |
| Vast Switzerland, September 12 | Verified 96 GB WS, 99.76% reliability, advertised 7.42 Gbit/s, $2.136/hour including disk; about $0.26 per 100 GB download | Chosen over lower-hourly offers charging roughly $3.80–$3.90 per 100 GB. Ready 8m08s after acquisition. Clear evidence that total startup cost overrode lowest hourly price. [Report](archive/infrastructure/2026-09-12-vast-fresh-lifecycle.md). |
| RunPod global placement → Iceland EUR-IS-2, September 12 | Exact full-size GPU, compatible CUDA, Secure cloud, $2.09/GPU-hour plus 180 GB disposable disk, unconstrained regional placement | Selection/creation/startup 1m52s; Ready 16m20s from the message; direct download and verification succeeded. No host reliability or measured network score informed selection because that path did not supply them. [Validation](archive/development/HISTORICAL-VALIDATION.md). |

The September 10 [RunPod region survey](archive/infrastructure/RUNPOD-REGION-CHECK-2026-09-10.md)
was only a shortlist: displayed capacity did not establish successful allocation.
Its volume-location constraints and time-of-day conjecture should not become
ranking criteria for today's disposable pool.

## Concrete regression versus the previous selector

The old Vast query filtered verified, rentable, one-GPU hosts with compatible
VRAM, host RAM, CUDA, sufficient disk, direct SSH ports, and reliability >=0.99.
It sorted:

1. `reliability2` descending;
2. `inet_down` descending;
3. `dph_total` ascending.

The agent then compared total cost, including transfer fees, and refreshed or
changed offers when actual admission failed. The returned shortlist retained
GPU/VRAM, power, RAM, geography, machine ID, price/storage, download speed,
separate transfer prices, verification, and reliability. It did not return disk
benchmarks or PCIe metrics as decision fields.

The current `server/pool-providers.ts` instead requests the first 50 matches by
`dph_total` ascending, discards download speed/reliability from the normalized
offer, and collapses transfer rates into their maximum. RunPod retains the GPU
type and price but discards its regional/CUDA availability detail.

Restoring the missing selection signals is more consequential than exposing
every provider field. The old lexicographic sort is evidence of what ran, not
proof that a tiny reliability-score difference should always outweigh a large
price or speed difference.

## Minimal decision set

| Visible information | Purpose |
| --- | --- |
| GPU variant + VRAM; host RAM accessible alongside it | Hardware fit; distinguish Server/WS/Max-Q where supplied. Power can be a small hardware detail. |
| Total hourly price including allocated disk | Running/idle cost. |
| Estimated initial download charge | Compare cold-session cost. Use known required model bytes and separate ingress pricing; label image-pull traffic separately if not quantified. Unknown is not zero. |
| Advertised download speed, when supplied | Startup speed signal, explicitly not a guarantee or measured ETA. |
| Verified status + reliability for Vast; Secure/Community type for RunPod | Host-quality evidence. Cloud type is not an equivalent numeric reliability score. |
| Current availability + placement/location | Whether a compatible worker can plausibly be acquired now, and whether placement is global or constrained. Stock labels are not reservations. |

Enforce disk capacity, role-specific VRAM/RAM requirements, compatible GPU/CUDA,
and required connectivity automatically. Show the requirements in details rather
than requiring users to revalidate them for every offer. Preserve the current
separate image/video requirements; do not restore the old universal 96 GB rule.

Keep upload pricing, power, machine ID, and an optional previously successful-host
indicator in details. Machine identity mattered for deliberate same-host/different-
host trials; a familiar-host indicator is more useful than an unexplained ID.

Disk benchmark, CPU clock, PCIe generation/lanes, NVLink, theoretical FLOPs,
generic DLPerf, motherboard, and certifications are optional details. The
reviewed acquisitions do not demonstrate that these were necessary to make the
successful selection decisions. Disk speed is a plausible diagnostic signal,
not an evidence-backed requirement for the minimal picker.

## Recommended behavior

Apply compatibility and host-quality gates first. Compare running cost, expected
download charge, and network speed among eligible offers; retain global RunPod
placement by default. Provide simple price/download/reliability sorts instead of
an opaque universal score. Treat missing provider measurements as unknown.

No fixed network floor, promised startup ETA, or success-rate claim is justified
by these few trials. Cache state, source throttling, container startup, and SSH
defects also affected time-to-ready. This review made no application changes,
provider calls, or paid allocations.
