# Seed

Seed is a local image and video studio powered by fal. Your PC stores media,
chat history, notes, and job records. fal runs Krea 2 Turbo for images and standard
MiniMax H3 for videos. There are no GPU rentals, tunnels, worker containers, or
base-model downloads to manage.

## Run locally

Use Node 26.8.2 or later in the 26.x line, then:

```sh
npm ci
npm run build
node dist/server/cli.js setup
node dist/server/cli.js start
```

Setup asks for `FAL_KEY`. It can also read it from your environment or a local
`.env`. A separate `.env.fal` works with `node --env-file=.env.fal ...`.
The optional chat assistant uses an OpenRouter key configured by setup.
API keys stay on the local server. Open the address printed by `start`.
You can also start without keys and add them in **Admin → Credentials**: fal,
OpenRouter, and Civitai. No billing or fal Admin key is needed. Saved keys are
never returned to the browser; replacement and removal take effect immediately.

`seed status` and `seed stop` control the local app. Stopping Seed does not
cancel a request already accepted by fal; restart to recover its output.

## Generation

- Images: Krea 2 Turbo, 1280×720 or 720×1280, PNG.
- Videos: standard H3, 768P, 5–15 seconds in whole-second increments.
- Text to video, reference to video, or first/last-frame guides.
- General references and frame guides cannot be combined in one fal request.
- Up to 16 outputs per local batch, with two requests active at a time.
- Generated audio or local removal of the soundtrack.
- Pick Frame in a saved video's preview: scrub, step by frame, and save a
  full-resolution PNG to the Library without another generation charge.
- Prompt expansion is disabled. fal does not publish enough implementation detail
  to promise a particular model precision or an identical self-hosted sampler.

LoRAs are explicit selections. Each can be available in both modes or Spicy only;
Standard mode hides and rejects Spicy-only adapters. Mode also controls the
requested safety-checker setting; fal account permissions still apply.

## LoRAs

```sh
seed loras add /path/to/adapter.safetensors image "My Krea adapter"
seed loras add /path/to/adapter.safetensors fl "My H3 frame adapter"
seed loras add /path/to/adapter.safetensors ref "My H3 reference adapter"
seed loras list
```

**Admin → LoRAs** is the normal import flow. Paste a Civitai URL, select the
version, file, and compatible workflow, then set its name, description, trigger
words, and preferred strength. Seed downloads and checks the file against
Civitai's SHA-256, converts supported H3 names when needed, and uploads to fal.
Interrupted imports can be retried. Adding in Standard makes the adapter
available in Standard and Spicy; adding in Spicy makes it Spicy only. Edit its
guidance, strength, or enabled state in Admin. Mode filtering is implicit in the
UI; it is not described in ordinary user-facing copy.

The master lives in `DATA/loras/<sha256>.safetensors`, with metadata in
`CONFIG/loras.json`. Select up to three adapters with strengths from 0 to 4.
Chat receives only eligible adapters with your descriptions and preferred
strengths, and generally proposes one or none. Its approval cards show the
selected names and strengths. CLI imports remain available for local files.

Uploads use fal CDN v3 with a private ACL, one-year retention, and temporary
read-only signed URLs. The app reuses the upload, refreshing it from the local
master near expiry. Reference uploads last seven days and are reused during
an app session. Generated outputs are requested with a private ACL and seven-day
retention, and saved to your local Library as soon as they finish.

New imports are untested until they complete a generation. Successful requests
record compatibility evidence and display “Tested on fal”; judge artistic quality
from the outputs. Our existing Krea **LoKR**, H3 FL, and H3 Ref adapters have all
completed live fal tests. H3 FL and Ref variants stay separate.

H3 imports automatically convert the supported ComfyUI/Kohya block naming to
fal-compatible `lora_A`/`lora_B` names. This conversion preserves every matrix
byte and dtype and requires alpha equal to rank. Unknown mappings or scaling
are rejected. The original remains in the local LoRA directory; the catalog
records both hashes and uploads only the converted adapter. Other already
compatible adapters are uploaded unchanged.

## Cost previews

Generate and Chat approval cards show a current fal estimate before submission,
including per-output and batch totals. A changed batch, duration, reference clip,
or LoRA selection requires a matching fresh preview. Pricing uses the regular
fal key, binary megapixels for Krea, and the 768p multiplier and reference-video
seconds for H3. Estimates are not account balances or guaranteed final charges.

Exhausted credits hold unsent outputs and link to fal billing. Activity offers request-specific continuation; there are no global pause/resume controls. Invalid keys,
permissions, rate limits, unsupported inputs, content policy rejections, unavailable
files, model failures, and timeouts have distinct recovery messages. A possibly
accepted submission is never automatically sent again.

## Recovery and data

Requests are persisted before submission. A known fal request ID is polled after
restart; failed downloads can resume without another generation. An ambiguous
submission stops for review instead of retrying a paid POST. Check fal request
history before acknowledging it. Cancellation of an already-running request may
not stop generation or its charge; a late completed output is still saved.

This branch starts with a fresh fal database. It has no legacy job migration or
capability negotiation. Default application folders are named `Seed`; use
`STUDIO_DEV_ROOT=profile:fal-only` for this worktree’s isolated profile within the
standard per-user Seed folders. An absolute/local directory is also supported
for disposable tests. Existing
credentials and local LoRA masters can be kept independently of the database.

## Development

`npm run verify` builds, typechecks, runs the app tests, and scans for credentials.
`npm run test:browser` checks the current UI with an isolated, offline fal fixture.
See [architecture](studio/ARCHITECTURE.md) and [development](studio/DEVELOPMENT.md).
See [fal acceptance measurements](research/fal-acceptance.md). Historical research
is under `research/archive/`; executable spikes have been retired. The worktree
library, chats, and job history were cleared for this migration at the owner’s
request. The fal key, local LoRAs, and private measurement ledger are preserved.
