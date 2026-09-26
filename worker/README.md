# Image and Video workers

The Video role keeps its pinned H3 ComfyUI runtime and original HQ recipe.
The Image role upgrades ComfyUI to the revision in qwen-model.json and shares
one process between Krea and Qwen. It includes 17.28 GB of verified Qwen Image
2.1 INT8 ConvRot model/encoder and BF16 VAE files, with the model license.
No separate Diffusers environment remains. Qwen loads on the first editing job.
Generate and Chat support image editing; RTX 5090 execution still needs the
explicitly deferred paid GPU qualification.

Build locally (no cloud allocation or publishing):

The Image build needs a builder with at least 100 GB free for dependencies,
weights and temporary image export. Downloads use bounded HTTP to avoid large
Xet reconstruction buffers on builders with limited memory.
The final Image stage copies Qwen's pinned weight shards into separate layers;
it does not inherit the full download layer. Each layer stays below GHCR's
10 GB limit. The publishing workflow checks this before uploading.

```sh
docker build --platform linux/amd64 --target video -t seed-worker-video:pool-local -f worker/Dockerfile worker
docker build --platform linux/amd64 --target image -t seed-worker-image:pool-local -f worker/Dockerfile worker
```

`releases.json` pins the published Image and Video packages by registry digest.
Both packages are public and can be pulled without registry credentials. See
[`publication-evidence.json`](publication-evidence.json) for tags, digests,
anonymous-access checks and the exact tested image identities.
The application refuses live acquisition with `release_unavailable` if the
selected role lacks a published, pinned image; normal preflight still applies.
Local Docker IDs are not downloadable registry digests. The manual build workflow
can publish new role candidates when its publish input is selected. Verify its
release artifacts and public access before updating `releases.json`. Do not
point a new role at an old single-worker release as a fallback.

## Protocol

Worker URLs retain `/worker/v1` and `/comfy` for transport routing; the payload
protocol version is 2. Identity includes `worker_class`, `runtime_revision`,
`image_revision`, workspace ID, worker-instance ID and engine-session ID.
Pairing connection-code envelope version 1 is unchanged.

Engine readiness also verifies the assigned CUDA hardware: exactly one visible
GPU, at least 32 GB for Image or 96 GB for Video with 5% capacity tolerance for
driver reservations, and RTX PRO 6000 Blackwell for Video. Capabilities include
the actual device name and physical VRAM. Passing this check does not qualify
throughput or image quality on cheaper Image GPUs.

Preparation PUT body is `{entries, credentials, revision}`. Credentials retain
the transport field names `huggingFaceToken` and `civitaiApiToken`, are supplied
in memory, and are never journaled. The app resolves them from Admin.
Each base entry is exactly a role manifest record. Each optional adapter entry
is `{path, url, sha256, size, routes}`, with path
`loras/seed-<sha256>.safetensors`, a pinned Civitai version/file URL, and routes
from `image`, `fl`, `ref`. Merge identical files' routes before submission.

The first manifest is immutable. Failed adapters can be omitted only before
readiness with POST `/worker/v1/preparation/omit` `{paths, revision}`. The worker
increments the revision and persists omissions separately from the original
manifest digest. Mandatory base models cannot be omitted. Retry uses the same
original manifest with the latest revision. LoRAs are never uploaded through
the local-cache fallback endpoint.

If a mandatory base model cannot download on the worker, the application can
recover through the PC: it downloads the same pinned Hugging Face file into the
standard application cache, verifies its SHA-256, and relays it over that worker's
authenticated SSH connection using resumable tus uploads. Worker-side verification
finishes preparation automatically. This path requires no separate CLI login and
never handles LoRA files.

Capabilities and status report `installed_loras` as
`[{filename, sha256, routes}]`. New imports require later workers. Each job sends
`{prompt_id, prompt, route, loras, video_profile?}`; `loras` contains up to three
ordered `{filename, sha256, strength_model}` selections, strengths 0–4. Adapter
nodes 30–32 form the same ordered chain from image node 1 or video node 16.
The image sampler consumes the final chain; H3 node 17 consumes it before the
unchanged Kitchen/Sol attention and 30-step `h3-high-v1` profile. No global preset
or hidden strength override is applied.

## Validation

Run `python -m pytest worker` using `requirements-test.txt`. The tests do not
require a GPU. Local container checks validate startup, role assets and pinned
packages. They do not qualify CUDA execution, generation performance or Qwen
editing quality. Record actual image-build results separately from unit tests.

The completed local builds and their exact source fingerprints are recorded in
[`build-evidence.json`](build-evidence.json). That record distinguishes reuse of
verified recovered model assets from a fresh all-download build and retains the
remaining GPU limitations. Publication and live availability were subsequently
verified; CUDA generation and provider startup still require a rented GPU test.
