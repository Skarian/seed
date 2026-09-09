# seed architecture and implementation boundaries

Revision 6. Local foundation implemented; worker integration and npm CLI packaging pending. One application will submit media jobs; the owner manages Runpod manually.

## Custom stack and implementation status

The first local slice uses React/Vite, Fastify, better-sqlite3 and env-paths with
Node 26.8.2 (current compatibility target). Exact package versions and the lockfile are committed. Native SQLite
crashed on this PC's older Node 22.13; the pinned runtime passed tests. See
[development](DEVELOPMENT.md) for running it, module coverage and limitations.
The table below includes later modules: it is not a claim they are all implemented.
The custom frontend follows the owner's agreed Generate/Library layout; earlier
SwarmUI exploration is a deferred alternative, not a blocker for this slice.

| Module | Choice and responsibility |
|---|---|
| `web/` | React + Vite + ordinary CSS; four explicit forms, shared media tray, status and Library; native fetch and browser previews |
| `shared/` | Zod request validation, plain capability data and pure selection/timing/label helpers; no schema-driven form engine |
| `server/http.ts` | Fastify routes, owner/origin checks, static files and authenticated range streams; embedded tus handler |
| `server/db.ts` | better-sqlite3, explicit SQL migrations, WAL and short transactions; no ORM |
| `server/jobs.ts` | One serialized job reconciliation/dispatch loop, durable queue and cancellation; no provider lifecycle or separate worker |
| `server/comfy.ts` | Native fetch and `ws`, configured authenticated HTTPS endpoint, process-session checks and trusted workflow submission |
| `server/storage.ts` | Local PC filesystem assets and durable output copies; no provider storage SDK |
| `server/media.ts` | Sharp image preparation; native ffprobe/FFmpeg via argument arrays; tus completion and output copies; one preparation at a time |
| `workflows/` | Four adapter functions cloning trusted API JSON; small reference/LoRA builders and node requirements; no graph DSL/compiler framework |
| `cli/` | Small runpod-setup utility, preset configuration and backup/restore |
| `deployment/studio/pod/` | Pinned runtime, early pairing/status page, authenticated engine/file API and HF preparation; separate Jupyter |
| Existing Comfy custom-node package | Narrow process-session guard and network-volume spool receipt/manifest hooks; no extra service |
| PC deployment | npm-installed CLI using system Node; seed setup/start/status/stop, optional Windows sign-in startup, standard per-user directories; no desktop wrapper or Docker requirement |
| Verification | Vitest for pure contracts/recovery decisions; Playwright for real browser flows; live graph/output checks |

Pin exact maintained package/runtime versions and lockfile during implementation after compatibility checks. Do not claim unspecified future package versions tested. Avoid a UI component platform, global state library, rich-text editor, generated admin console or extra server process unless concrete evidence requires one.

Use [tus-js-client](https://github.com/tus/tus-js-client) with [@tus/server and @tus/file-store](https://github.com/tus/tus-node-server), embedded in Fastify using its raw request/response integration. tus owns offsets/resumption/expiration/termination; our completion hook creates usable assets. No Uppy dashboard or separate tusd needed for the custom tray. Stream media routes; a finite JSON-body limit is not a media upload cap.

Client preflight uses native decoders/metadata and a lazily loaded [MediaInfo metadata probe](https://github.com/buzz/mediainfo.js) where native metadata is insufficient. This is not a full browser video transcoder. Only add a specific HEIC decoder if actual mobile fixtures require it. Backend normalization uses installed FFmpeg; originals remain recoverable.

## Persistent state

Four SQLite tables: `assets`, `jobs`, singleton `dispatcher_state`, `schema_migrations`. Asset rows contain derivative and transfer metadata; jobs contain immutable settings, session/submission markers and remote output manifests. Dispatcher state records maintenance/pause and last observed engine session, not pod ownership or lifecycle operations. tus stores its own partial-transfer metadata. No operations, uploads, events, drafts or version-registry tables.

Browser polls studio and active jobs every two seconds while active, slower while idle; refresh on focus. ComfyUI WebSocket improves backend progress but queue/history reconcile after disconnect. No persisted SSE replay protocol. Drafts use localStorage with a draft schema version; files require reselection after browser restart unless already uploaded. Saved jobs support cross-device settings reuse.

Run one local PC app/dispatcher process. No GPU shared-volume ownership lock or Tailscale identity. See [bootstrap](POD-BOOTSTRAP.md).

The job dispatcher alone submits studio prompts. Direct manual Comfy generation requires an exclusive maintenance session with dispatch paused. The private Comfy process exposes its own random session UUID and checks the expected session on studio mutations; stable network identity must not conceal an engine restart. Normal readiness checks do not call Runpod or infer billing state.

Store the pasted endpoint/session credential server-side on local PC. No Runpod control/S3 credentials in the app. RunPod setup remains a standalone local utility. HF credentials are supplied privately to the worker; source preflight is part of setup.

## Reuse versus replacement

| Alternative | Decision |
|---|---|
| Existing ComfyUI + graphs | Keep execution, queue, nodes, model loaders and media tools; custom work is product forms, graph bindings and durable media jobs |
| [SwarmUI](https://github.com/mcmonkeyprojects/SwarmUI) | Earlier evaluation retained as an alternative; first slice proceeds with the agreed custom frontend |
| [InvokeAI](https://invoke.ai/features/workflows/comfyui-migration/) | Do not migrate: its own documentation says ComfyUI workflows cannot be directly imported; adds backend/model integration work |
| Full ComfyUI App export pipeline | Defer; preserve old editable graphs, maintain only new trusted API templates for this frontend |
| New local GPU/NAS, cross-vendor storage, serverless | No requirement justifies another hardware/storage/runtime project; begin with the existing 96 GB GPU class; measure cache/staging capacity before choosing volume size |

These are architectural fit judgments, not benchmarks or hardware price comparisons. [Fastify](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [Node releases](https://nodejs.org/en/about/previous-releases).

## Deliberate removals

Custom resumable upload protocol; SSE/event replay; synchronized drafts; generic forms/graphs; structured sound/dialogue editor; live spend estimator; app export generator; extra queue services and separate local worker processes; new hardware. Keep native model expressiveness through explicit fields and tested bindings rather than expanding infrastructure.

Manual lifecycle stays outside the app. Keep waiting jobs, preset snapshots and Advanced controls. No Tailscale, shared pod claims, S3 credentials or automatic lifecycle code. Retain pending output in a volume spool until durable PC receipt. Model files download directly to the reusable volume; see [setup/source design](RELEASE-AND-INFRASTRUCTURE.md).

## Hosting scope

Deliver the local app and persistent data-directory configuration. The owner supplies any tunnel, domain, TLS and external browser authentication. No relay infrastructure or tunnel SDK belongs in this project. Support explicit public-origin/trusted-proxy configuration, loopback by default, streamed/Range media and resumable uploads. Worker pairing/authentication stays in scope.

## npm CLI packaging and platform setup

Owner-approved direction: **seed** is an npm-installed Node.js CLI serving the browser UI. The command name is `seed`; candidate package name is `@skarian/seed` because unscoped `seed` is taken. Verify scope ownership before publishing. Keep the package private until publishing is authorized and ready. Source installation is not proof that a clean global npm install works.

Use system Node and pin compatible native dependencies in the lockfile. Node 26.8.2 plus better-sqlite3 13.0.3 passed an isolated native compatibility check. Verify build, database persistence, browser tests and a clean package install on that runtime. Do not bundle another Node copy or silently upgrade Node during npm install/setup. Detect unsupported Node versions and give an actionable message. Resolve FFmpeg/ffprobe binaries through explicit setup with verified downloads or a suitable maintained package; media tooling distribution still needs validation.

Planned commands: `seed setup`, `seed start`, `seed status`, `seed stop`. Start/reuse one background server and print verified loopback/LAN URLs. Keep logs, settings and media outside the global npm installation. Stop targets only the verified seed instance; upgrading/uninstalling the npm package does not delete media. Do not add a desktop window or separate Windows installer.

`seed setup` checks `process.platform`. On Windows, ask exactly: "Would you like seed to start automatically when you sign in?" (Yes/No). Create/update/remove a single per-user Startup entry accordingly, launching seed quietly without opening a browser. No service, scheduled task or administrator rights solely for sign-in startup. Preserve preferences on noninteractive reruns; interactive reruns can change them. Other OSes skip Windows integration. Test enabled/disabled/repeated setup and the actual startup entry, including paths with spaces and npm updates. This remains implementation work.

## Standard application directories

Use [env-paths](https://github.com/sindresorhus/env-paths) with a stable application identifier, existing `RunpodStudio` and empty suffix. Create the returned directories automatically. Retain this internal identifier, `studio.sqlite` and existing protocol paths during the seed rename so existing data is not stranded; a future path migration must be explicit and tested. No directory picker or manual folder setup in the ordinary installation flow.

| Library path | Contents |
|---|---|
| data | `studio.sqlite`, `media/originals/`, `media/prepared/`, `media/outputs/`, `transfers/` |
| config | App settings, local preset configuration and worker connection settings; secrets never exposed through media routes |
| cache | Rebuildable previews and other disposable acceleration data only |
| log | Application/launcher diagnostic logs, excluding credentials |
| temp | Disposable processing scratch only |

On Windows with that identifier, data resolves to `%LOCALAPPDATA%\RunpodStudio\Data`; config uses the library's per-user config location. Database, originals, results, retained prepared assets and resumable transfers never live in cache/temp. Upgrades preserve all user directories. Cache cleanup cannot delete media or pending transfers. Tests must cover repeat setup, path resolution and retained data through an app update.

Docker is optional developer tooling for building/publishing the RunPod worker image. It may be installed/used on this PC for that purpose but is not an installation/startup dependency of the local studio. There is no model-artifact build pipeline.
