# Set up a new Seed studio

## Locate the app

When reading this skill from the repository, REPO is two directories above this
folder: it contains `package.json`, `server/`, `web/` and `worker/`. When the skill
was installed separately, find the user's existing Seed checkout first.

If none exists, clone https://github.com/Skarian/runpod.git into a user-owned
folder. This repository is currently private; the user needs GitHub access to
clone it. Git authentication is separate from GPU-provider credentials. If access
is unavailable, ask the user to supply access or their checkout rather than
substituting another package. Seed is not published on npm; `npm install seed`
installs a different product.

Set REPO and SKILL to absolute paths in your tool calls. Examples below assume
you are working in REPO; placeholders such as LOCAL_IP must be replaced.

## Install and build

Check `node --version`. The supported runtime is **26.8.2 through 26.x**, also
recorded in package.json and `.node-version`. Install a matching system Node from
https://nodejs.org/dist/v26.8.2/ if needed. Vast also needs `ssh` and `ssh-keygen`:
OpenSSH Client on Windows, the supplied client on macOS, or the distribution's
OpenSSH client package on Linux. Do not reinstall tools that already work.

Run these commands from REPO:

```sh
npm ci
npm run build
node dist/server/cli.js help
```

Expected result: the build creates `dist/server/` and `dist/web/`, and help lists
setup/start/status/stop. If installation or native dependencies fail, resolve that
before renting a GPU. No local Docker or desktop wrapper is required. Model setup
uses the official Hugging Face `hf` CLI with Xet. Check `hf version` (or the
installer default at `~/.local/bin/hf`) and install it from
https://huggingface.co/docs/huggingface_hub/guides/cli when missing. The official
Windows installer uses Python 3.10+ and creates an isolated environment; skip
installing its extra agent skill unless requested. Seed itself remains a Node app.
`SEED_HF_CLI` can point to an alternative hf executable; otherwise Seed checks
the installer default and PATH. Never pass the HF token as a command argument.

## Configure credentials once

Use an interactive terminal for masked prompts:

```sh
node dist/server/cli.js setup --provider vast
```

Choose `--provider runpod` instead for RunPod. Setup collects:

| Credential | Where the user gets it | Needed for |
|---|---|---|
| Vast API key | https://cloud.vast.ai/manage-keys/ | Vast account with rental credit |
| RunPod API key | https://console.runpod.io/user/settings | RunPod account, only when selected |
| Hugging Face token | https://huggingface.co/settings/tokens | Model downloads; required by Seed |
| Civitai token | https://civitai.com/user/account | Optional owner-selected LoRAs |

Only the selected provider's key is required. The user may also need to accept
gated-model terms on Hugging Face. Do not ask them to paste keys into chat. Setup
prints the private credentials file location, not its values. It remembers the
provider and preserves earlier credentials when switching.

On Windows, answer the optional start-at-sign-in question. This starts only the
local studio, never a GPU. `--no-startup` disables it; macOS/Linux do not currently
have an automatic sign-in installer. VAST_API_KEY, RUNPOD_API_KEY, HF_TOKEN and
CIVITAI_API_TOKEN are also accepted through the process environment.

If setup says Seed is running, check for active work before using the CLI `stop`
command, then rerun setup. Never interrupt a creative session just to change a setting.

## Models stay on the PC

Setup downloads and verifies the pinned base models before any GPU is rented.
Allow about 102 GB for the current models and presets, plus free space for media.
Files live in the standard per-user data directory under `models/`, outside the
checkout. Two files are prepared at a time; Hugging Face handles parallel chunk
transfer and resume through Xet. Civitai keeps its separate HTTP path. Completed
files are SHA256-verified before use. Old custom HTTP partials are retained until
the official replacement verifies, then removed; those two resume formats are
not assumed compatible.
Run `node dist/server/cli.js models` to resume or fetch updates without stopping
Seed. Verified files are reused. This command does not acquire compute.

Owner-selected LoRAs are pinned in `model-presets.json` in the configuration
directory printed by setup. It is an array of entries with `path`, `url`, `size`,
`sha256`, `route` (`image`, `fl`, `ref`) and optional `strength` (default 1).
Use the exact Civitai version/file URL:
`https://civitai.com/api/download/models/VERSION_ID?fileId=FILE_ID`.
Resolve the user's links through Civitai metadata and verify the selected file's
size/SHA256; do not guess a file or silently change a pinned version. Base models
come from the application's pinned manifest. Identity's base LoRA remains there;
its UI workflow is still unfinished. Never put source tokens in these URLs.

Vast boot sends missing files over SSH and verifies them on the VM. A failed copy
resumes from its partial file. No public file server is needed. Source credentials
stay on the PC; VM bootstrap receives only per-worker pairing/Jupyter secrets.
A host still has access to the weights and job media it processes.

## Open and verify

```sh
node dist/server/cli.js start
node dist/server/cli.js status
```

Start prints the actual URL (default http://127.0.0.1:4310). Open it and verify
Generate and Library load. No GPU connection yet is expected on a new install.
The user can manage saved media while compute is off.

For requested phone/tablet use on the same Wi-Fi, obtain the PC's assigned private
IPv4 address, stop the idle app, run `setup --host LOCAL_IP`, then start again.
Verify the printed URL from the other device; don't copy a previous user's IP.
Public internet hosting/router changes are not part of studio setup.

Continue with vast.md or runpod.md to acquire compute. Setup does not establish
that provider/model access or a GPU allocation will succeed.

## Returning and troubleshooting

`start` reuses the managed local server; `status` prints its URL; `stop` stops only
that server. Media, database and configuration live in standard per-user directories
outside the checkout. Preserve them through updates. The internal directory name
is still RunpodStudio so existing users keep their libraries.

If startup fails, read the server.log path printed by the CLI. A busy port or an
outdated saved LAN address needs fixing locally, not another GPU rental. After
changing source, rebuild; a global npm installation is a separate copy. Operate
through the source commands above to avoid accidentally running an older package.
