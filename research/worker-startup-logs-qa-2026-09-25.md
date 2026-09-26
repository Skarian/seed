# Worker startup logs: delivered

**Live acceptance completed September 26 UTC:** one Vast image worker and one RunPod video worker reached Ready through the real browser flow, displayed real startup/setup logs, retained their saved logs after release, and were confirmed deleted with their disposable disks. Combined compute/disk estimate $0.26620, plus Vast bandwidth, under the authorized $5 cap. No generation tests or private requests inspected. [Timings, scope and cleanup evidence](worker-startup-logs-live-2026-09-26.md).

Published to http://192.168.1.212:4310. Open GPU workers and choose **View startup logs** on a worker. Released workers retain their startup record under Recently released and through Activity.

The server captures RunPod system or Vast daemon boot output before model preparation, then saves preparation progress, reported errors, retry actions and engine readiness. The browser only reads saved records. Provider reads are bounded, throttled, cancellable and separate from readiness/shutdown. Failed log updates retain previous text. Collection closes at the startup boundary and never reopens for generation failures, reconnects or previously ready workers.

One bounded database record per worker replaces reliance on expiring general diagnostic events for this feature. The record is capped below 64 KiB. General lifetime engine-log reads were removed from pool and generation-failure paths; structured operational failure reporting remains. Unknown/older workers have no retrospective capture. This version does not expose full engine console tracebacks or first-generation model loading.

## Verification

- TypeScript check passed.
- 138 tests passed across startup logs, provider logs, pool lifecycle, pool workers/providers, diagnostics, jobs, credentials and HTTP.
- 24 browser scenarios passed: twelve states on desktop/mobile, including startup, loading, empty output, delayed updates, browser read failure, downloads, verification, engine startup, readiness, setup failures, released history and long text/multiple workers.
- Two additional browser tests passed: Activity opens an older released worker beyond the recent-list limit at desktop/mobile widths; keyboard disclosure and Escape work, and reading/refeshing saved logs does not call providers or mutate rentals.
- Late-result tests cover preparation handoff, readiness, adapter freezing, quit/release and an authoritative state change without a saved seal. Other checks cover restart retention, legacy exclusions, auth/backoff, byte limits, redaction, a total Vast export deadline and storage failures not blocking shutdown.
- First visual inspection found log content against the card edge. Added consistent insets and human-readable download totals, rebuilt, reran the atlas and inspected every final screenshot separately. No final visual blockers found.
- A Windows file-lock failure occurred in test credential setup. The fixture now writes both fake credentials once; the final full focused run passed. Product credential behavior was not changed.

Final atlas run: `2026-09-26T02:48:57.982Z`.

[LAN gallery](http://192.168.1.212:4314/startup-logs/index.html). [Individual review records and screenshot hashes](worker-startup-logs-visual-review-2026-09-25.json).

Staged web: `.local/startup-logs-web-iJXStu`; staged server: `.local/startup-logs-server-01UzEO`.

## Rollout

The first restricted restart could not open Seed's standard AppData log file. The rollout restored the previous compiled files; the app was then successfully updated/restarted with the necessary filesystem access. Final health, served index/assets and the new endpoint's nonexistent-worker response were verified. Receipt: `.local/startup-logs-atlas/rollout.json`. Backup: `.local/startup-logs-rollout-1790391439638`.

Only idle counts were checked before restart, not request contents. No real generation requests, chats, media, or worker-log contents were inspected. No rentals, provider mutations, generation tests, image publication or GPU spending. Browser tests use the isolated fixture server and assert zero external calls; provider unit tests use public contracts and the existing redacted startup fixture. These checks do not claim fresh validation against live provider hosts.
