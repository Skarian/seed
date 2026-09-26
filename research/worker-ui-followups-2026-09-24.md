# Worker UI follow-ups

Recorded at the user's request. Notes only; not implemented.

## Failed launch disappears from the worker list

Observed: Video launch `ec65acb5-465b-4296-8a59-086dc5171dac` on Vast
at 00:33:08Z. Availability revalidation returned an empty offers array before
the create request. No rental was created and estimated rental spend was zero.
Seed classified it as Released and hid it under Recently released.

Agreed fix direction:

- Distinguish **Launch failed** from **Released** in the server lifecycle and
  Activity. Released describes termination of a previously allocated resource.
- Keep a persistent failed-launch card in the worker popup until dismissed or
  successfully retried; an error toast supplements the card.
- For confirmed unavailable capacity, say: "Video worker couldn't start. That
  GPU is no longer available. No rental was created and you weren't charged."
  Only make the no-rental/no-charge statement when allocation is known not to
  have happened; uncertain creation must retain reconciliation and billing UI.
- Provide **Find another GPU** and **Dismiss**. Find another GPU refreshes
  availability and retains the selected worker class. Require review of the
  new offer/rate; do not silently replace or rent another machine.
- Report actual price changes separately and require a new quote review.
- Exclude confirmed rejected launches from active worker counts and spend.
- Dismissing the card preserves its error and diagnostic history.
- Cover desktop/mobile, partial multi-worker launch success, page reload and
  the recorded empty-offers provider response in regression tests.

The user's current Image and Video rentals are being observed read-only.
They explicitly requested no intervention while checking acquisition progress.

## Network speed when selecting and preparing workers

User request: network speed was useful when choosing good hosts and should be
visible in the self-service UI. Notes only during the current live session.

Current gaps found in code:

- Vast offers expose `inet_down` and `inet_up`, but `server/pool-providers.ts`
  does not retain them in the shared `WorkerOffer` contract. Transfer prices
  are retained; they do not tell the user how fast the host can download.
- `web/worker-pool.tsx` omits bandwidth from both offer rows and machine details.
- `web/worker-preparation.tsx` already displays observed model download speed,
  but hides the rate when stalled. Container acquisition has provider logs,
  without a reliable measured transfer-rate field.

Proposed implementation:

- Put **Reported download speed** directly in each offer row, beside hourly
  price and region. Include upload speed in machine details. Preserve the
  quote's metrics on the allocated worker for later comparison.
- Add download-speed sorting and a minimum-speed filter. Keep unknown values
  explicitly **Not reported**; do not infer a host's bandwidth from GPU type
  or provider, particularly where RunPod automatically selects the host.
- Normalize provider bandwidth to Mbps/Gbps and label actual transfers in
  MB/s. Test unit conversions explicitly; bits and bytes are different.
- Label bandwidth as provider-reported, not a promise of model download speed.
  GHCR/Hugging Face routes, retries, disk speed and unpacking can still dominate
  startup. Retain disk throughput, reliability and transfer fees in details
  where the provider supplies them.
- During preparation, show observed download rate, bytes/total, elapsed time
  and time since last progress. For a confirmed stall, show **0 MB/s** and
  **No progress for ...** instead of silently hiding speed. Surface retries.
- Keep container pulling, unpacking/verifying and model downloading distinct.
  Show actual container throughput only when the provider exposes measurable
  bytes/time; otherwise show its reported stage and last progress/retry event.
- Persist reported bandwidth with existing host/acquisition diagnostics and
  measured transfer outcomes, so later investigations can compare estimates
  with real startup behavior. Host rankings based on historical performance
  can be a later enhancement; no paid speed probes or automatic replacement.
- Cover recorded provider responses, omitted/zero metrics, units, sorting,
  filters, stalled downloads, retries, reload persistence and desktop/mobile.

Provider field reference:
https://github.com/vast-ai/vast-cli/blob/master/vast.py

No live worker, download, application process or provider resource was changed
while recording this follow-up.
