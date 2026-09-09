# Wave 2 — execution and operations review

Reviewed revision 2 of MVP, architecture, API, execution and ComfyUI plans on 9 September 2026. No live infrastructure actions.

**Execution-planning confidence: 95/100.** This is a subjective readiness assessment within the operations scope, not a runtime reliability percentage. No unresolved operations design blocker remains. Environment-specific behavior is deliberately tested before broad development rather than assumed.

## Wave 1 findings resolved

- Output copy failures now have `copy_pending`, a persistent network-volume manifest, finite retry deadlines and a stopped-compute recovery path.
- The private transport is explicit: userspace Tailscale plus HTTP Serve on port 8188; browser HTTPS remains exe.dev's responsibility.
- One replica, process lock and controller own lifecycle and dispatch; maintenance cannot create a competing loop.
- Allocation/readiness deadlines, cancellation cleanup, provider-off evidence and unknown-outcome blocking are specified.
- The initial GPU, volume, region, image and spending ceiling are fixed. Actual provider actions and GHCR cold start are early acceptance gates.
- Backend API credentials, separate S3 credentials, enrollment renewal and exe.dev owner/proxy trust checks are included in access step one.
- Custom uploads, event replay, cloud drafts, spend accounting and extra hardware/platform components were removed. tus, polling and local drafts reduce the implementation surface materially.

## Small final clarification

State explicitly that **foreign/manual ComfyUI activity or an unknown live queue blocks automatic idle shutdown as well as dispatch**. Before an automatic Stop/terminate call, recheck queue ownership under the same controller lock. An owner requesting cancellation/stop can resolve it explicitly, but a dispatch pause must not accidentally allow the idle timer to stop somebody's job. Current exclusive-maintenance and foreign-work rules already establish this intent; one sentence makes the timer behavior unambiguous. This is a consistency clarification within the selected controller, not a new subsystem.

## Implementation gates remain honest

1. Verify private exe.dev proxy ingress before trusting owner headers; direct/spoofed routes must fail. Do not assume loopback binding or invent a second login service.
2. Verify userspace Serve HTTP/WebSocket/large transfer on the exact pinned container. The documented TUN fallback is only evaluated if necessary.
3. Verify actual Runpod allowed actions, GPU presence, persistent mount and verified off state in the first bounded session.
4. Verify native transfer/output persistence and S3 retrieval. An inaccessible copy is an outstanding transfer, never permission to duplicate generation.
5. Verify generation/reference quality separately. Operations confidence does not certify model influence, memory at maximal inputs or codecs across devices.

The plan treats a provider timeout as uncertainty and makes further starts impossible until reconciliation. It cannot guarantee a cleanup call runs after a host crash; the documented console recovery limitation is appropriate for this lean first version. Adding an independent watchdog merely to claim certainty would be misleading.

## Recommended next action

Finish consistency review and present the reduced design. Once the user authorizes implementation, perform access first, then the private-boundary/cold-start/stop proof. No further operations platform research, hardware shopping or new control-plane components are needed before that gate.
