# Image and Video workers

The complete base-image provenance and reproducible mirror procedure are in the
[release guide](../docs/releases.md). The pinned GHCR base is a byte-preserving
mirror of the upstream Docker Hub image; the role-specific stages below are
built from the tracked Dockerfile in this repository.

## One engine

`engine.json` is the one software spec for cloud and local, image and video:
Python, ComfyUI, PyTorch, the native kernels, and the launch flags. To upgrade,
edit that file, run `node scripts/lock-engine.mjs`, and test. The script writes
one hashed lockfile per OS, `requirements-windows.lock` and
`requirements-linux.lock`. `--disable-comfy-compiler` stays on every host.

`run.py` is the one worker entry point. A cloud container configures it from its
environment. Seed configures a local worker through a launch file.
`install_engine.py` applies the spec to the worker image at build time.

`hardware.json` holds hardware profiles, selected by the detected GPU rather than
by cloud or local. A profile names the video model files, the attention tuning,
and its VRAM and RAM needs. `5090` covers local and rented RTX 5090s;
`RTX PRO 6000` covers rented 96 GB cards. Both use the same weights today, and
they can diverge by editing that file. Only these two GPUs are offered for video.

The Image image bakes in 17.28 GB of verified Qwen Image 2.1 INT8 ConvRot model,
encoder, and BF16 VAE files, with the model license. Krea and Qwen share one
process, and Qwen loads on the first editing job. Local workers download the same
files during setup.

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
Both packages are public and must be pullable without registry credentials.
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
GPU and enough memory, with 5% tolerance for driver reservations. Image needs
32 GB. Video needs a hardware profile and that profile's VRAM. Capabilities
include the device name, physical VRAM, and the selected profile.

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
`{prompt_id, prompt, route, loras}`; `loras` contains up to three ordered
`{filename, sha256, strength_model}` selections, strengths 0–4. Adapter nodes
30–32 form the same ordered chain from image node 1 or video node 16. The worker
checks the LoRA inventory, safe paths, and canvas sizes. Graphs come from one
builder, `server/worker-graphs.ts`, and are the same on every host.

Video settings are `steps` (10, 15, 20, 30) and `detail`. `full`, the default,
is Comfy's H3 template with its default attention. `standard` is labelled Fast
and adds Kitchen INT8 and Sol sparse attention, which trades accuracy for speed.
Any steps value works with either detail.

`POST /studio/stop` stops a local engine. It requires the launch token, refuses
new work, interrupts any job and waits for it to end, unloads models through
ComfyUI's model management, then leaves through ComfyUI's normal exit path.
Cloud engines get no token, so the route refuses every call there.

## Validation

Run `python -m pytest worker` using `requirements-test.txt`. The tests do not
need a GPU. Local container checks cover startup, role assets, and pinned
packages. They do not cover CUDA execution, speed, or output quality, so record
image-build results separately from unit tests.

Keep private build logs outside the repository. Before changing `releases.json`,
record and verify the source revision, registry digest, anonymous pull, and
role-specific test results. CUDA generation and provider startup still need a
real rented GPU.
