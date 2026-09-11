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
Private pairing and Jupyter secrets require at least 24 characters. HF_TOKEN is
required for preparation; Civitai is optional. Provider keys never enter the worker.

`worker/run.py` serves the connection page before downloading models. Jupyter is a
separate administration tool. `prepare.py` stages and verifies missing manifest
files and reuses verified models. Comfy starts privately after preparation; child
processes do not inherit download/pairing secrets. The Vast bootstrap supplies
secrets through SSH stdin and invokes the entrypoint without rewriting source.

The PC owns originals, prepared media, results and SQLite history. Worker spool
files retain outputs until durable PC receipt; acknowledgment and cleanup are
repeatable. A retained RunPod volume can preserve spool files across replacement.
Destroying Vast disk destroys models and unsaved outputs. Disconnection never
proves termination safety or billing state.

Worker identity changes on container startup and engine identity on Comfy restart.
Neither promises resumable generation. See [API contract](API-CONTRACT.md) and
[Comfy integration](COMFYUI-CHANGES.md) for job/session/receipt semantics.
