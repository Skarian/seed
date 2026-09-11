# First-time setup

Locate the Seed checkout. A copied/installed skill still needs the app source;
the npm package is not published. Do not install the unrelated `seed` package.
From the checkout, use Node matching package.json (26.8.2–26.x) and OpenSSH for
Vast. Install missing dependencies through the platform's normal installer/package
manager, then `npm ci` and `npm run build`. No local Docker or Python is required.

Run `node dist/server/cli.js setup --provider vast` or `--provider runpod` in an
interactive terminal. Setup asks for the selected provider's key, required Hugging
Face token, optional Civitai token, and Windows sign-in preference. User enters
secrets in masked prompts, never in chat or arguments. Existing keys and media are
preserved. Stop the local app before changing setup, after checking for active jobs.

Fresh setup defaults to Vast; later setup remembers the choice. Provider keys
come from a funded provider account. Gated models may also require accepting HF
terms in the browser. Saved config lives in standard per-user directories printed
by setup, outside the repo. VAST_API_KEY, RUNPOD_API_KEY, HF_TOKEN and
CIVITAI_API_TOKEN environment overrides are supported.

`node dist/server/cli.js start` starts/reuses the local app and prints its URL.
`status` and `stop` manage that local app only. For requested Wi-Fi access, use
`setup --host LOCAL_IP` and verify the assigned address. Do not add public hosting,
router changes or a tunnel service as part of ordinary setup.

Vast's helper `setup` delegates to this shared setup and verifies the Vast key;
RunPod's `pod-setup` handles source preflight/private template/network-volume setup.
Neither app setup nor skill installation implies a GPU rental. A new user's
provider and source keys need checking before paid preparation.
