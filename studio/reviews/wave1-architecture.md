# Wave 1: lean architecture review

Reviewer: architecture. Planning only, 9 September 2026. Read the MVP, API, asset,
ComfyUI and execution specifications. No runtime or infrastructure changes.

**Planning confidence: 84/100.** The deployment shape is good; bespoke transport,
event replay, schema-driven UI ambitions and excessive persistence tables need
removing. This score concerns implementability of the plan, not generation quality
or a measured runtime success rate. No critical blocker; five major design issues.

## Keep

One React frontend + one TypeScript HTTP/controller process, one SQLite database,
local media, one existing ComfyUI GPU. Four explicit forms, shared validation,
private exe.dev entry, Tailscale, one active pod/GPU, manual-session shutdown
verification. Existing graph templates and small binding functions are the correct
abstraction. User selection checks before any upload are necessary, not optional.

## Remove or replace before implementation

1. **Custom resumable protocol:** replace offset handlers and explicit completion
   endpoint with `tus-js-client` plus `@tus/server`/`@tus/file-store`, embedded in the
   existing server. Keep authenticated `GET /assets/{id}` readiness and server
   completion hook. Do not implement tus ourselves, add tusd as a service, or ship
   both Uppy and a hand-built tray without demonstrated need. Preflight completes
   before invoking the tus client. Resumability remains worthwhile for phone videos.
   [Official implementations](https://tus.io/implementations),
   [Node implementation](https://github.com/tus/tus-node-server),
   [browser client](https://github.com/tus/tus-js-client).
2. **Persisted SSE/event replay:** remove `/events`, event log table, retention and
   cursor protocol. Browser polls studio and visible jobs every 2 seconds while
   active, slower while idle, refreshes on focus. ComfyUI WebSocket remains a private
   backend integration; store latest observed progress on the job. Generation takes
   minutes: browser push infrastructure adds little. Revisit SSE only after a real
   UX issue. No frontend WebSocket or Redux/event bus.
3. **Generic form/schema platform:** write four React forms and a shared reference
   tray. Zod request schemas plus explicit capability data (limits/presets/enabled
   roles) suffice. No arbitrary `advanced` form generator, plug-in architecture or
   generic workflow compiler. Four adapter functions clone trusted graph JSON and
   bind settings/reference/LoRA chains. Editable ComfyUI exports are optional, not
   a second product requiring a graph-codegen platform.
4. **Database scope:** use `assets`, `jobs`, `operations`, singleton `service_state`
   and schema migrations. Store resolved configuration/graph snapshots as JSON on
   jobs, derivative metadata on assets. Tus owns upload bookkeeping. Drafts can
   use localStorage per workflow; remove optimistic concurrency draft API unless
   cross-device drafts are an explicit requirement. Library/results remain shared.
   No revisions/ownership/events/derivatives tables just because concepts exist.
5. **Optional product breadth:** defer structured sound/music/dialogue form and rich
   prompt token editor; one prompt textarea with reference-label insertion buttons
   plus a persisted ID-to-label map satisfies expression. Keep trim ranges and
   reference roles. Defer live spend estimation; elapsed runtime and configured
   hourly maximum suffice until a reliable price source is integrated. Preset sync
   remains an owner command, not an admin interface or background sync system.

## Concrete module and library choice

- `web/`: React + Vite + ordinary CSS, four forms/reference tray/library/status.
  `fetch`, native media previews and `tus-js-client`; no framework server rendering.
- `shared/`: Zod schemas and pure `validateSelection`/capability definitions. Keep
  dynamic capability data separate from code; pin dependency versions at build.
- `server/http.ts`: Fastify, static frontend/media routes, origin checks, embedded
  tus handler. Bypass the normal body parser only for tus streams; keep finite JSON
  request limits (not asset limits). [Fastify body limit](https://fastify.dev/docs/latest/Reference/Server/).
- `server/db.ts`: `better-sqlite3`, explicit SQL migrations and transactions; no ORM
  needed for five tables. [Library](https://github.com/WiseLibs/better-sqlite3).
- `server/controller.ts`: one timer-driven lifecycle/job reconciler, durable intent
  before provider calls. Separate `runpod.ts`, `comfy.ts` adapters using native fetch
  and a WebSocket client; no general provider SDK abstraction across vendors.
- `server/media.ts`: native FFmpeg/ffprobe child processes with argument arrays;
  `sharp` for image derivatives. One preparation process at a time, bounded decoded
  resources and clear operational errors rather than invented file caps.
  [Sharp orientation](https://sharp.pixelplumbing.com/api-operation/),
  [Sharp sizing](https://sharp.pixelplumbing.com/api-resize/).
- `workflows/`: four trusted adapters plus baseline JSON and preset files.
- `cli/`: one sync-presets command and backup/restore scripts. Built-in Civitai
  download logic must be narrowly scoped; no general media fetch service.
- Vitest for pure validation/adapters/controller; Playwright for preflight and main
  UI flows. Docker build exercises native dependencies. No test-only infrastructure.

Do not add a broad WASM video transcoder. Native browser decode/probe plus header
inspection handles baseline media; a lazy HEIC decoder can be evaluated explicitly.
Decode support, preview support and model acceptance must remain distinct. The plan
cannot promise every browser opens every codec. Server FFmpeg prepares accepted
files automatically, but never receives a file solely to determine if it is valid.

## Existing software/hardware alternatives

The existing ComfyUI apps already cover baseline generation but not private frontend
lifecycle, mixed inputs and durable output library. Replacing ComfyUI or introducing
a generic AI studio platform expands migration risk. Use its native API directly.
No hardware purchase or second GPU is needed; existing 96 GB Runpod capacity is the
only sensible baseline until measured limitations justify changing it. A NAS/S3
gateway or cross-provider GPU broker does not solve any current requirement.

## Exact path to >=95 planning confidence

Incorporate the removals and choose the libraries/modules above (or an equally
concrete smaller choice), then re-review consistency across all documents. Explicitly
specify: single-process ownership on restart; uncertain create/submit reconciliation;
accepted asset to job handoff; copying completion before shutdown; first live tests
for userspace Tailscale, uploaded media loaders, and mixed reference/anchor behavior.
Those live gates can remain bounded implementation tasks; they must not be marketed
as proven. Keep raw model capability separate from launch-enabled UI combinations.

Architecture score can reach 95 without deploying: no unresolved competing stacks,
bespoke transport, duplicate state machinery, or unclear ownership. Full-quality
multimodal success still requires the explicitly authorized one-GPU test session.
