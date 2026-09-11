# Operational details

## Package shape

The skill is the user-facing agent entry point, while the web app remains normal application code in the same repository. The agent can install/build that app and operate its worker; it does not need the React source copied into its skill instructions. Keep one repository and private local credentials, without another provider orchestration service. This first implementation expects an existing checkout; fetching the app from GitHub or an npm release is a later installer improvement, not an implemented command.

## Dependencies and state

`doctor` is read-only. The host needs PowerShell 7, Node compatible with the checkout's package.json (currently 26.8.2 through 26.x), OpenSSH client (`ssh`, `scp`, `ssh-keygen`), installed npm dependencies and `npm run build`. No Docker, local Python, Vast Python SDK or AWS tooling is needed to launch the published image. If missing, use the official Node installer matching package.json, PowerShell's official installer (`winget install --id Microsoft.PowerShell --exact` on Windows), or Windows OpenSSH Client optional capability. Agent installation must respect the user's system-change permissions. Run `npm ci` and `npm run build` in the checkout when needed. A system Node upgrade is not part of every launch.

The helper keeps per-checkout state under the Git-ignored `.local/seed-vast/` directory. Vast and worker secrets are DPAPI-encrypted; SSH keys are created by the actual Windows user with OpenSSH's private-file permissions. Node reads the Seed app config location through its existing storage module. HF_TOKEN/CIVITAI_API_TOKEN can override saved Seed credentials. Credential values are never returned in helper output. `setup` accepts masked terminal input; when the user needs a graphical input, create a masked local dialog under that same Windows identity and save with DPAPI. Do not route secrets through an agent's text-question widget.

The helper's API operations use the live-verified routes: `GET /api/v0/users/current/`, `POST /api/v0/bundles/`, `GET /api/v1/instances/`, `PUT /api/v0/asks/{offer}/`, per-instance `GET/PUT/DELETE /api/v0/instances/{id}/`, and `POST /api/v0/instances/{id}/ssh/`. Preserve trailing slashes: a redirect previously dropped authentication. Offer searches use machine_id/gpu filters rather than an unsupported ask-id filter, then match the returned id locally.

Official references: [Vast CLI](https://github.com/vast-ai/vast-cli), [SSH launch mode](https://docs.vast.ai/guides/instances/connect/overview), [data movement](https://docs.vast.ai/guides/instances/storage/data-movement), [instance management](https://docs.vast.ai/guides/instances/manage-instances). If the API changes, inspect the official client before inventing a replacement request. Provisioning a new instance is not an authentication diagnostic.

## Compatibility boundary

This skill initially pins the exact Seed image used in the successful September 10 trial. Vast uses SSH launch mode, which overrides the image command. `boot` copies a small launcher to the instance, generates fresh pairing/Jupyter credentials and starts the worker. The launcher makes narrow, checked substitutions to that image's worker entrypoint: loopback transport is allowed only with the existing development flag, and worker/Jupyter listen on loopback. It uses `/` as the mounted workspace for the disposable container disk. This is an explicit compatibility bridge, not a new public HTTP endpoint or a general-purpose code patcher. An incompatible entrypoint fails before launching.

The helper forwards local 18080/18888 to the remote loopback services. `connect` uses a managed local launcher with Seed's existing `localTestWorkerOrigin` option. It preserves the old connection and restores the ordinary app on teardown. The tunnel and trial launcher aren't sign-in services; after a PC restart, rerun `connect` with the retained instance running. A stopped instance must be started explicitly through Vast before `boot/connect`; GPU availability on that host is not guaranteed.

This keeps today's skill compatible without rebuilding the image or changing Seed's production endpoint validation. If this becomes the normal deployment path, replace the compatibility substitutions and test launcher with explicit, tested SSH-transport settings in Seed. Don't silently broaden the public endpoint allowlist.

## Baseline and validation status

The manual predecessor was live-validated on one RTX PRO 6000 WS in South Korea: all 99.62 GB/11 base-model files downloaded and verified in 314.79 seconds; 15-second mixed-reference video executed in 803.237 seconds at 63.33 GiB NVIDIA peak; a following image job took 12.284 seconds. Total provider charge was approximately $0.656, including GPU, disk and bandwidth. This is historical evidence, not a promise of price, speed or stock.

The reusable helper should be checked with `doctor`, `offers`, `billing`, PowerShell parsing and the local tests before use. Those read-only/offline checks do not validate a new full paid lifecycle. The next authorized live launch must verify provision → SSH → preparation → pairing → generation → safe teardown and document any differences. Never claim this refactoring has had a fresh live GPU test until that has happened.

Initial refactoring validation passed: skill frontmatter validator; PowerShell parsing; JavaScript syntax; three offline worker-entrypoint tests; two shutdown identity/safety scenarios; live read-only credential import, offer search and credit reporting. Run the Python tests from the checkout (or set `SEED_REPO`); the PowerShell safety tests require no account. No GPU was rented to validate this refactoring. A discoverable copy is installed under the user's Codex skills folder; the repository copy is the versioned source.
