# Architecture

[← Back to Seed](../README.md)

Seed is a local coordinator for image and video generation. The Fastify server,
React interface, SQLite database, credentials, chat history, job history, and
Library all live on the user's computer. Generation runs on GPU workers that the
user explicitly rents from Vast or RunPod.

## Request flow

1. The user selects an Image or Video offer and confirms the quoted rental.
2. Seed records launch intent before asking the provider to create the rental.
3. Seed connects to the worker through a private SSH tunnel and verifies its
   identity, role, protocol version, and pinned container release.
4. The worker downloads its pinned base models and the enabled LoRAs for its
   immutable launch manifest. Credentials are supplied in memory and are not
   written to worker logs or job history.
5. Seed durably assigns compatible requests. Each worker processes one output
   at a time; additional compatible workers allow parallel outputs.
6. The coordinator downloads each result, verifies it, saves it into the local
   Library, and only then acknowledges deletion of the remote copy.
7. The user explicitly drains or cancels work before Seed releases the rental.

Seed never rents or replaces a GPU automatically. Closing the browser or
stopping the local server does not terminate a provider rental.

## Worker roles

- **Image** runs text-to-image with Krea 2 Turbo and image-to-image with Qwen
  Image 2.1.
- **Video** runs text-to-video and reference-to-video with MiniMax H3.

The application pins the deployable images by digest in
[`worker/releases.json`](../worker/releases.json). The worker protocol and
container layout are documented in [`worker/README.md`](../worker/README.md).

## Persistence and recovery

SQLite is the durable coordinator. Provider launches, worker assignments,
submissions, receipts, output transfers, and release intent are recorded before
irreversible external actions. On restart, Seed reconciles provider resources
and worker receipts rather than repeating an uncertain launch or generation.

Historical records from the retired API-provider implementation remain readable
so upgrades do not lose job history or replay unfinished requests. They are
migration data, not an active generation path.

## Interfaces

The HTTP API is internal to the bundled web application. Its authoritative
routes live in [`server/http.ts`](../server/http.ts),
[`server/admin.ts`](../server/admin.ts), and
[`server/chat/http.ts`](../server/chat/http.ts). Shared request and response
types live under [`shared/`](../shared/). This document intentionally describes
system boundaries instead of duplicating every internal route.
