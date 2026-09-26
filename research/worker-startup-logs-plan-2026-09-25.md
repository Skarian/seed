# Worker startup logs

Status: implemented and published. [Implementation and validation](worker-startup-logs-qa-2026-09-25.md). The plan was reviewed with three subagents covering provider APIs, lifecycle/privacy, and UI/QA. No private requests, chats, media, or runtime log contents were inspected. No GPU actions or spending.

## Recommendation

Add one expandable **Startup logs** section to each worker in the existing GPU dialog. Capture provider boot evidence before model preparation; keep structured download, verification, retry, failure, and engine-status events through first readiness. Save a bounded record so it remains available after readiness and release.

Start with an app-only change using the current worker images. Do not expose full engine stdout or claim that this first version contains every engine traceback. Those require a dedicated startup-only source inside the worker; treating the lifetime engine log as a startup log is not safe.

## What the review found

- `server/provider-logs.ts` already supports both providers, but throttles each source for five minutes, including after unsuccessful collection. It lacks an in-flight guard and a fresh lifecycle check before persisting asynchronous results.
- The Vast export request and repeated object reads have individual timeouts but no overall collection deadline. A single attempt can occupy tens of seconds.
- `server/pool-worker.ts` tails lifetime `comfy.log`; `server/pool.ts` and `server/jobs.ts` can request that capture after readiness or a generation failure. The new viewer must not expose this path or general diagnostic history.
- `worker/run.py` appends engine output throughout its lifetime. Worker request admission can begin before the desktop observes readiness, so collecting this file before desktop Ready does not establish a clean startup boundary.
- Existing structured preparation data already provides file states, bytes, rates, verification, stalls and errors. Reuse it.
- Generic diagnostic events expire after 90 days or the latest 10,000 events globally. They cannot alone guarantee retained startup evidence.
- Activity can select a released worker, but the dialog currently shows only brief released rows and initially limits those to 12. Historical log access needs a small correction.

## Sources and coverage

| Stage | Source | UI |
|---|---|---|
| Provider allocation/container boot | RunPod system logs; Vast daemon logs | Compact latest-line preview, provider name, last successful check, expandable bounded text |
| Model preparation | Existing preparation health and explicitly allowed preparation diagnostic fields | Current file/bytes/rate/checksum progress stays primary; saved transitions and failures remain in Startup logs |
| Engine startup | Existing readiness checks and controlled engine-status/error metadata | Starting engine, reported failure, or Ready; no promise of raw Python tracebacks |
| Ready or released | Locally retained record | Saved startup logs, capture end time and outcome; no new raw collection |

RunPod exposes separate system and container sources. Request `source=system`, reject any returned non-system frames, preserve opaque SSE cursors and enforce byte limits. The API documents resumable streams and authentication, permission, missing-resource and rate-limit errors. [Official RunPod API](https://docs.runpod.io/api-reference-v2/pods/stream-pod-logs).

Vast exposes asynchronous log export; request `daemon_logs:"true"`. Preserve export destination validation, disable redirects and never forward the API key to the export object. Daemon logs are the documented system source; their exact message coverage is not guaranteed. [Official Vast API](https://docs.vast.ai/api-reference/instances/show-logs).

Neither source guarantees application bootstrap output or complete engine exceptions. If startup fails without a structured error, show the last known stage and that detailed engine output is unavailable. Do not invent a cause or silently fall back to container stdout.

Ready means preparation and engine/hardware/capability checks passed. It does not mean every model is resident in GPU memory. First-generation model loading is outside this feature.

## Small implementation surface

1. **Reuse the collectors and pool lifecycle.** Adapt `ProviderLogs` to return typed, bounded startup snapshots. Collection runs in the server, independently of browser visibility, with one in-flight operation per worker. No new service or browser streaming connection.
2. **One bounded durable record per acquisition.** Add a small startup-record table in the existing database, keyed by worker ID. Target a 64 KiB total content budget with a preserved stage/outcome summary and recent tail. Retain it with acquisition history until application data is removed. Save changes and progress samples, not every two-second health poll.
3. **One read-only endpoint.** `GET /api/v1/pool/workers/:id/startup-logs` returns that record only. Keep text out of the global pool polling response. Do not forward `Diagnostics.details()` or backfill old mixed-source events.
4. **One hook and one component.** `useWorkerStartupLogs(workerId, enabled)` and `WorkerStartupLogs` reuse existing fetch cancellation, stale-response protection, formatting and worker-card styles. No new global store.
5. **Reuse the component for historical workers.** Activity opens the selected released worker's disclosure, including a selected record outside the first 12 recent entries.

The response needs: revision; phase; collection state; availability; last attempt and last successful check; content capture time; sealed time/reason; truncation; safe status reason; and source-labelled sections. Keep browser transport errors separate from server collection status.

## Collection and failure behavior

- Begin once a new acquisition has a provider resource. Proposed defaults: RunPod about every 10 seconds, Vast about every 15 seconds, with jitter. These are implementation targets, not provider guarantees.
- Bound each RunPod read window; give Vast one 15-second overall deadline including export polling and body reads. Coalesce concurrent attempts and enforce limits on actual bytes, including oversized chunks.
- Back off temporary failures to 30–60 seconds and honor provider retry guidance. Preserve the previous successful snapshot when an update fails.
- Authentication/permission failures suspend collection until credentials change. A logs 404 does not independently declare a rental missing. The existing resource lifecycle lookup remains authoritative.
- Distinguish Vast request-endpoint errors from a pending export object. Retrying object 403/404 is existing repository behavior, not a documented availability guarantee. Report an exhausted pending export as not available yet.
- A log read timeout, missing log, or ordinary line containing words such as "retrying" does not itself fail a worker or generate a worker-failed toast. Preserve collector diagnostics separately from actual acquisition failures.
- Use existing redaction utilities before storage; strip ANSI/control sequences and render escaped text. Only allow expected preparation fields/operations; do not export raw generic JSONL or arbitrary nested error objects.

## Startup boundary and privacy

- Create the capture scope during a new acquisition; never infer permission to capture from `ready === false` alone.
- Close provider collection at the first authoritative preparation handoff. Keep structured preparation events through first readiness. Store that closure durably so retries/reconnects do not reopen provider capture.
- Seal the complete startup record before first dispatch eligibility, or immediately on quit/release. First observed engine readiness must seal even if foreign activity prevents the pool from marking the worker available.
- Check scope and a capture generation token before reads and again inside the persistence writer. Also check authoritative `ready_at`, `adapters_frozen`, execution evidence and quit/release state, so a failed seal write cannot permit later capture. Abort outstanding reads and discard late results after handoff, readiness or quit. Do not wait for logs before Ready or shutdown.
- Restore the seal across coordinator restart. Ever-ready workers remain sealed after engine loss or reconnect. Legacy/ambiguous workers show an honest unavailable state, with no raw historical backfill.
- Recoverable preparation failures retain earlier evidence and append retry/omit/fallback attempt markers. They do not erase the startup history. A terminal rejection or release keeps whatever was captured.
- Replace broad raw-log capture calls with startup-scoped methods or guards. Remove the `jobs.ts` generation-failure raw-log fetch or make its collector incapable of fetching lifetime `comfy.log`; merely hiding its result from the new viewer is insufficient. Keep existing structured operational failure reporting; this is not a request to discard errors or inspect private generation content.
- Opening or refreshing the UI reads stored data only. It never triggers provider calls, SSH, retries, reconnects or resource mutations. The running local server continues collection when the browser closes.

## UI behavior

Keep the disclosure alongside, rather than inside, `WorkerPreparation`, which disappears after readiness. Before preparation, show a compact latest provider line and View startup logs. Once preparation begins, the existing progress UI leads; preserve the user's expanded/collapsed choice.

Use one inline disclosure, not another modal. Source labels, timestamps and a modest scroll height keep it readable on mobile. Wrap long lines, preserve manual scroll position, and announce concise status changes rather than the entire log. No per-line toasts, terminal emulation, HTML rendering or automatic scrolling over text the user is reading.

Explicit states: loading the saved record; waiting for first output; temporarily unavailable; updates delayed with previous text retained; saved at Ready; saved at release; unsupported legacy capture. A rejected launch without a resource gets an explanation rather than a spinner.

Freshness is based on successful checks, not the age of the last changed line. Silence alone is not evidence of a stall. Download/verification failures stay prominent in existing preparation/recovery controls regardless of whether logs are expanded.

## Validation and delivery

Provider tests extend the existing HTTP fixtures: split SSE frames/UTF-8, cursors, byte bounds, source filtering, pending export versus API denial, rate limits, overall deadlines, cancellation, deduplication and secret/control-sequence scrubbing. Use public contracts and existing redacted startup fixtures; do not read private production logs.

Lifecycle tests hold a collector response across handoff/Ready/job eligibility/release and assert it cannot persist afterward. Cover restart, reconnect, legacy workers, preparation retries, retained evidence after release, diagnostic storage failure and shutdown remaining independent of log collection. Use synthetic private-content sentinels to prove exclusion without inspecting user requests.

UI QA covers 12 representative states on desktop and mobile (24 baseline captures): fresh acquisition; initial loading; empty/unavailable; delayed updates; browser read failure; downloading; verification; engine startup; Ready/saved; pre-ready failure; released access; and multiple workers with long text. Distribute providers and worker classes across real reachable cases. Add behavior assertions for phase transitions, close/reopen, worker switching, selected historical records beyond the first 12, keyboard use and narrow/short viewports.

Review every capture individually at full resolution and retain a numbered, labelled mosaic/index for navigation. No real rentals or generation tests are needed for development. Any later provider validation should use an explicitly authorized startup-only acquisition; offline tests do not prove all real host behavior.

Deliver in order: durable scope/storage and lifecycle guards; bounded provider/preparation capture; endpoint/hook/disclosure and historical access; focused tests and visual review; app publication. The app-only version needs no worker image rebuild.

## Deferred: complete engine startup tracebacks

If provider logs plus structured startup errors prove insufficient, add a versioned bounded startup-only diagnostic source to both images. It must close inside the worker before any request admission, including direct engine routes, remain closed across engine restart, and exclude buffered post-boundary output. Older images must never fall back to lifetime logs. This is a separate container change, not a hidden prerequisite or a promise in the first version.
