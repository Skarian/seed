# Install and configure Seed

The skill is installed from the GitHub repository. It contains instructions, not
executable helpers. Seed's installable package supplies all commands.

## Installation

Check `node --version` and `seed help`. Supported Node: 26.8.2â€“26.x.
If Node is absent or incompatible, pause and ask permission to install/upgrade it;
explain that administrator approval may be needed. Use official Node downloads.
Also check OpenSSH (`ssh`, `ssh-keygen`). Optional local model downloads use the
official Hugging Face `hf` CLI; its Windows installer requires Python 3.10+.
Install that dependency only when local caching is requested.

Seed is not yet published to npm. Obtain the project package archive from the
maintainer. Developers create it with `npm ci` then `npm pack` in the checkout.
Install with `npm install --global /absolute/path/to/skarian-seed-VERSION.tgz`.
Do not use `--ignore-scripts`: media binaries need dependency installation scripts.
Do not install the unrelated unscoped package `seed`. No local Docker is needed.

Run `seed help`. Run `seed setup --provider vast` (or `runpod`) in an interactive
terminal. The CLI checks media binaries and asks for masked credentials:

- Selected provider key: Vast Manage Keys or RunPod Settings.
- Hugging Face token: required; accept any gated model terms on Hugging Face.
- Civitai token: optional, needed for the user's selected restricted LoRAs.

Setup offers optional local model caching. Yes downloads/verifies the pinned files
immediately; no skips local downloads. Unattended flags: `--cache-models` or
`--no-cache-models`. Use `seed models` to resume; it preserves the preference.
The agent starts the local app on demand with `seed start`. No sign-in entry is installed.

Setup prints private configuration and data paths. Credentials, presets, model
cache and Library live outside the installation. Environment overrides are
VAST_API_KEY, RUNPOD_API_KEY, HF_TOKEN and CIVITAI_API_TOKEN. Never print values.

## Open and update

`seed start`, `seed status`, and `seed stop` manage the local app, not GPU billing.
Default access is localhost. For the user's phone, configure `setup --host LOCAL_IP`
with the actual LAN address, while the app is stopped. Public hosting is outside scope.

On an explicitly requested update: wait for work to finish, stop Seed, install the
new package and restart. Windows locks loaded native dependencies; don't replace
modules individually. Rerun setup only when configuration needs changing.

## Models and LoRAs

GPU preparation reuses verified remote files, tries direct downloads, then uses PC
fallback only if enabled. A missing local fallback file is downloaded and verified
before transfer. Source tokens travel through the authenticated worker API over
SSH and are not persisted on GPU.

Private `model-presets.json` is an array of pinned LoRA entries: path, url, size,
sha256, route (`image`, `fl`, `ref`) and optional strength. Resolve user-provided
Civitai links through its metadata API; pin an exact version and file:
`https://civitai.com/api/download/models/VERSION_ID?fileId=FILE_ID`.
Never choose or update a LoRA silently. Base models are pinned in the package.
