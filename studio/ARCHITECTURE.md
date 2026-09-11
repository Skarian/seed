# Seed architecture

A local React/Node art studio talks to an authenticated ComfyUI worker. The agent
skill acquires compute separately. Permanent media and history belong to the PC;
worker disk is temporary job storage and a reusable model cache where available.

| Code | Responsibility |
|---|---|
| `web/` | React/Vite Generate and Library, shared media previews, references and progress |
| `server/http.ts` | Fastify routes, origin checks, tus uploads and streamed media |
| `server/db.ts` | SQLite migrations and durable asset/job/dispatcher records |
| `server/jobs.ts` | Serialized submission, reconciliation, cancellation and output receipt |
| `server/worker.ts` | Authenticated worker connection, pairing and status |
| `server/workflows.ts` | Trusted image/video graphs, reference roles and validation |
| `server/media.ts`, `server/video.ts` | Sharp/FFmpeg/ffprobe media normalization and saved derivatives |
| `server/storage.ts` | Standard per-user directories, separate media/config/cache/log locations |
| `server/cli.ts`, `settings.ts`, `credentials.ts`, `lifecycle.ts` | Local setup/start/status/stop and optional Windows sign-in startup |
| `server/pod-setup.ts` | RunPod private template/network-volume setup; no runtime acquisition in UI |
| `worker/` | Pinned model preparation, authenticated control, transfer spool and Jupyter |
| `worker/comfy_seed/` | Comfy execution/session integration and native telemetry aggregation |
| `skills/seed/` | Agent-operated Vast/RunPod setup, acquisition, connection and cleanup |
| `tests/`, `worker/test_*.py` | Local regression tests; paid lifecycle checks are separate |

Package versions and runtime are pinned in package.json/lockfile and the worker
image. There is no Zod, separate WebSocket library, ORM, generic graph compiler or
provider orchestration daemon. Earlier module proposals are superseded by this map.
Identity editing remains unfinished; see README for current workflow coverage.

## State and transport

Keep the existing RunpodStudio internal directory name to preserve user data.
SQLite, originals, prepared assets and outputs live in the data directory;
credentials and worker connection live in config. Cache/temp can be recreated;
permanent media and unfinished transfers cannot. Setup/update preserves user data.

One local dispatcher submits jobs. Worker process/session identity prevents an
engine restart from being mistaken for a continuation. Durable output receipt
precedes deletion of the worker copy. Queue pause and fresh worker observations
establish termination safety; disconnected never proves billing is off.

RunPod uses the normal authenticated HTTPS worker protocol and a network volume.
Vast uses an SSH tunnel to the fixed loopback endpoint on port 18080. Both
providers use the normal app launcher; ending a Vast session stops the tunnel,
leaving the app and its saved connection intact. The image supports both transports directly. Both use the same local Library and job API; provider lifecycle stays
outside the browser UI. See the skill references for compatibility limits.

## Local application

A Node CLI starts/reuses one background server; authenticated loopback control
handles status/stop without trusting a saved PID alone. Windows sign-in startup
is optional. No desktop wrapper, bundled Node runtime or local Docker requirement.
Public hosting, router settings and external authentication remain owner-managed.
The app defaults to loopback; a configured private LAN address enables phone use.

Current commands/tests are in [DEVELOPMENT](DEVELOPMENT.md), API details in
[API-CONTRACT](API-CONTRACT.md), and decisions/evidence in
[EXECUTION-PLAN](EXECUTION-PLAN.md). Avoid duplicating those specifications here.
