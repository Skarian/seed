# Wave 2: lean architecture review

Reviewer: architecture. Planning only, 9 September 2026. Independently re-read
revision 2 of the MVP, architecture, API, assets, ComfyUI, execution and research
documents. No implementation or runtime tests performed.

**Planning confidence: 95/100. No actionable critical or major architecture blocker.**
This is confidence that the architecture is sufficiently concrete and small to
execute, not a 95% runtime, quality or capacity guarantee.

## Wave 1 findings resolved

| Prior concern | Revision 2 disposition |
|---|---|
| Custom upload protocol | Official embedded tus libraries; one transport and completion hook |
| Persisted event/SSE infrastructure | Snapshot polling; private Comfy WebSocket remains an adapter detail |
| Generic UI/graph framework | Four explicit forms and four trusted adapters |
| Excess database concepts | Five tables, JSON snapshots, tus bookkeeping, local drafts |
| Product/infrastructure creep | Rich editor, live cost estimator, extra services and hardware deferred |

React/Vite, Fastify, Zod, better-sqlite3, tus, Sharp and FFmpeg are now explicit
choices with clear ownership. One module owns lifecycle and job dispatch; HTTP
persists intent instead of starting independent loops. Unknown provider outcomes
block duplicate compute, output copy failure no longer holds the GPU indefinitely,
and maintenance excludes competing manual dispatch. These are practical safeguards
for the user's request, not extra systems.

## Why the remaining 5% does not justify more architecture

The plan moves private proxy/Tailscale/storage and a bounded cold-start/stop proof
before broad development. Exact runtime graph/timing behavior, maximum reference
memory, phone codecs and LoRA quality are explicitly tested, not assumed. Failed
required capabilities require a revised decision with the user; hiding them cannot
satisfy acceptance. These environmental/model unknowns cannot be removed by adding
another framework, service or abstract interface during planning.

The model/API specialist should still sign off the final-frame candidate and frame
grid details; this review does not substitute for their graph audit. Likewise,
infrastructure approval remains conditional on proving the exe.dev ingress boundary.
Both are already early, owned gates in the plan.

## Small implementation notes, not blockers

- Pin package versions in the lockfile and exercise native SQLite/Sharp dependencies
  inside the chosen Linux image once. Do not introduce an ORM to avoid that work.
- Use the same simple process lock for normal startup and maintenance; do not build
  a distributed lease service. One Compose replica plus durable reconciliation is
  the declared scope.
- Treat metadata-only admissibility and preview availability separately: a file
  may be convertible on the backend even if the phone lacks a player. The revised
  asset document correctly permits this after local probing.
- Keep tests focused on these ownership, validation and recovery edges. Avoid a
  large compatibility framework or exhaustive generated graph-combination suite.

No additional service, library family, hardware purchase or API subsystem is
recommended. Freeze this shape, complete the independent specialist checks, and
move to the access-first implementation session when the user authorizes it.
