# Worker startup and storage

Provider operating steps live in [the Seed skill](../skills/seed/SKILL.md).
The same pinned image runs on reusable RunPod volumes or disposable Vast disk.

| Setting | HTTPS / RunPod | SSH / Vast |
|---|---|---|
| `SEED_TRANSPORT` | `https` (default) | `ssh` |
| `SEED_PUBLIC_URL` | HTTPS origin, default from `RUNPOD_POD_ID` | Fixed `http://127.0.0.1:18080` |
| Worker/Jupyter bind | `0.0.0.0` | `127.0.0.1` |
| `SEED_WORKSPACE` | `/workspace`, network volume | `/workspace`, instance disk |

The workspace must be absolute and writable, not necessarily a mount point.
Private pairing and Jupyter secrets require at least 24 characters. New bootstraps
keep HF/Civitai/provider keys on the PC and send verified files over SSH. Existing
token-supplied workers remain compatible; changing code does not remove their keys.

`worker/run.py` serves the connection page while waiting for or verifying models. Jupyter is a
separate administration tool. Without HF_TOKEN, `prepare.py` waits for PC-delivered
manifest files and verifies/reuses them; it makes no model-source requests. Comfy starts privately after preparation; child
processes do not inherit download/pairing secrets. The Vast bootstrap supplies
secrets through SSH stdin and invokes the entrypoint without rewriting source.

Local Hugging Face acquisition uses the official hf CLI/Xet; Civitai remains a
separate HTTP source. Both verify hashes before files enter the transferable cache.

The PC owns the model cache, originals, prepared media, results and SQLite history.
Vast boot transfers missing files before starting the worker. RunPod may start
first and wait for transfer; direct SSH access is currently operator-managed. Worker spool
files retain outputs until durable PC receipt; acknowledgment and cleanup are
repeatable. A retained RunPod volume can preserve spool files across replacement.
Destroying Vast disk destroys models and unsaved outputs. Disconnection never
proves termination safety or billing state.

Worker identity changes on container startup and engine identity on Comfy restart.
Neither promises resumable generation. See [API contract](API-CONTRACT.md) and
[Comfy integration](COMFYUI-CHANGES.md) for job/session/receipt semantics.
