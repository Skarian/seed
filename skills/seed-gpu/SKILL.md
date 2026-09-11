---
name: seed-gpu
description: Operate Seed on disposable Vast.ai or RunPod GPUs from Windows, macOS or Linux. Find and price suitable offers, launch the Seed worker, connect it privately over SSH, measure readiness and jobs, and remove paid resources after saving outputs.
---

# Seed GPU sessions

Use this repository's existing app and published worker. The user asks the agent to start/finish a session; the web UI runs generations and never rents compute. Keep one active GPU across both providers. Provider choice belongs to the user/session; do not automatically fail over and incur another rental.

## First-time setup

Find the checkout and pass its absolute path as `--repo`. Check Node against package.json and OpenSSH for Vast. Install missing dependencies only, then run `npm ci` and `npm run build`. No local Docker or Python is needed for the published worker.

Run `node dist/server/cli.js setup --provider vast` or `--provider runpod` in an interactive terminal. It collects the selected provider key, required Hugging Face token, optional Civitai token, and Windows sign-in preference. Never paste keys into chat or arguments. Existing keys are reused; switching providers preserves them. Stop the local app before changing setup, after checking there is no active work. `node dist/server/cli.js start` prints its URL. Use `setup --host LOCAL_IP` when the user requests LAN access; do not expose it publicly.

Default a fresh install to Vast; honor an existing saved provider or explicit user choice. The app is not published on npm: don't install the unrelated `seed` package. A discoverable installed skill still needs this checkout/build. If not installed, the agent can read this file directly from the repository.

## Provider routing

- **Vast:** follow the lifecycle below and [Vast operations](references/operations.md).
- **RunPod:** follow [RunPod operations](references/runpod.md), reusing Seed's private template, network storage, and normal HTTPS worker protocol. Use native provider tools for compute lifecycle; the included Node helper handles sanitized reads and automatic pairing.
- **Compare both:** read availability/prices for both, including retained storage and cold-start time, then choose one within current authorization. A catalog availability indicator is not a reservation. Do not run allocation loops or move storage automatically.

Before paid operations, state the selected hardware, hourly price and teardown policy. Honor current authorization; request missing spending authorization only. Credentials may be sent only to the selected authorized worker/provider. Check both accounts for active GPUs when both are configured; inability to check is not proof of zero instances. No paid acceptance is implied by installing this skill.

## Vast: find and launch

1. `doctor` reports local dependencies, build availability and credential presence without exposing values. `setup` delegates to the shared app setup and checks Vast authentication. HF/Civitai credentials come from that same flow. For missing dependencies, follow the reference; do not reinstall working software.
2. Run `offers`. Defaults target one full-power RTX PRO 6000 WS/Server, 96 GB VRAM, at least 96 GB host RAM, CUDA 13+, verified/reliable hosts and 180 GB disk. These are a starting profile for the tested image, not universal hardware requirements. Inspect price including disk, bandwidth rates, host download speed, location and RAM. Do not hard-code the South Korea machine or equate advertised bandwidth with achieved throughput. H100/H200 or Max-Q require an explicit change to the search and an explanation of the tradeoff; A100 worked but was slower in the benchmark.
3. State the chosen offer, total hourly rate and teardown policy. Honor existing authorization and budget; ask only for missing spending authorization. Skill invocation itself does not authorize a rental or reuse of another session's approval. Keep one active GPU. `rent --offer-id ... --max-hourly ...` rechecks the live offer, refuses an existing active Vast instance or unfinished saved rental, stores the returned instance ID immediately, and never retries an uncertain creation automatically.
4. Poll `status` during image setup; report meaningful progress. Once running, run `boot` to install fresh private worker secrets and send HF/optional Civitai tokens via SSH. The user must authorize those credentials being used on the selected provider; don't send the Vast control-plane key to the worker. `boot` is idempotent for this instance and reuses the saved SSH key and worker configuration. A failed SSH attempt is not a reason to rent another GPU.
5. Run `connect`. It preserves the previous Seed connection, starts the SSH tunnel, uses the existing local-worker test seam in a managed launcher, and pairs automatically. Pairing can happen during model preparation. Keep the app on its configured LAN address so mobile testing still works. Do not interrupt active local jobs to switch workers.

```sh
node <skill>/scripts/seed-vast.mjs offers --repo <checkout>
node <skill>/scripts/seed-vast.mjs rent --repo <checkout> --offer-id <id> --max-hourly <approved-price>
node <skill>/scripts/seed-vast.mjs status --repo <checkout>
node <skill>/scripts/seed-vast.mjs boot --repo <checkout>
node <skill>/scripts/seed-vast.mjs connect --repo <checkout>
```

## Vast: operate and finish

- `status` reports the selected instance and local Seed readiness. `preparation` reports first-stage and final verification timestamps, model byte counts and elapsed preparation time. Distinguish container setup, download+verification, model initialization, generation and transfer time.
- Normal generations run through Seed's existing UI/API. Do not automatically spend time on a 15-second benchmark for a user who just wants the UI started. When a benchmark is requested, retain workflow, inputs, settings, native job metrics and output validation. Native memory readings after switching models can include previously loaded models; do not present them as standalone model requirements.
- If the user wants to test, leave the requested GPU running and clearly report the cost. Otherwise follow the agreed teardown policy. Default recommendation for new sessions: delete disposable disk after use, given the observed five-minute model preparation. Do not silently turn a request to stop into permission to destroy a retained disk.
- `stop` pauses the queue and waits for a fresh `safe_to_terminate=true`; then stops the saved instance and restores the normal local launcher. Disk charges continue. `destroy` performs the same safety check for a running instance and deletes the instance/disk. It refuses deletion when the PC has unresolved work or output transfers, and never deletes an unrelated instance. If disconnected safety cannot be proven, inspect the worker and local job records before taking further action; don't override the check blindly.
- `billing` reports remaining credit and charges for the recorded instance. After teardown, verify provider state, local app health and saved outputs. Record useful measurements in the repository research folder and commit relevant non-secret changes. Do not commit `.local` state, keys or tokens.

No blind allocation loops, provider abstraction, scheduled shopping, extra storage service or registry is needed for this version. On an ambiguous rental response, inspect the account's instance list before any new attempt. Stop and diagnose repeated preparation errors instead of cycling GPU rentals or repeatedly downloading the same files.
