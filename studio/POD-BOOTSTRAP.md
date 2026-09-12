# Worker startup and storage

Provider operating steps live in [the Seed skill](../skills/seed/SKILL.md).
The same pinned image runs on disposable RunPod or Vast disk. Volume/template provisioning is retired.

| Setting | HTTPS / RunPod | SSH / Vast |
|---|---|---|
| `SEED_TRANSPORT` | `https` (default) | `ssh` |
| `SEED_PUBLIC_URL` | HTTPS origin, default from `RUNPOD_POD_ID` | Fixed `http://127.0.0.1:18080` |
| Worker/Jupyter bind | `0.0.0.0` | `127.0.0.1` |
| `SEED_WORKSPACE` | `/workspace`, pod disk | `/workspace`, instance disk |

The workspace must be absolute and writable, not necessarily a mount point.
Private pairing and Jupyter secrets require at least 24 characters. New bootstraps
send HF/Civitai tokens per download over SSH stdin without saving them on the VM.
Provider keys stay on the PC. Existing
token-supplied workers remain compatible; changing code does not remove their keys.

`worker/run.py` serves the connection page while waiting for or verifying models. Jupyter is a
separate administration tool. `prepare.py` always waits for externally prepared
manifest files and verifies/reuses them; it makes no model-source requests. Comfy starts privately after preparation; child
processes do not inherit download/pairing secrets. The Vast bootstrap supplies
secrets through SSH stdin and invokes the entrypoint without rewriting source.

Local Hugging Face acquisition uses the official hf CLI/Xet; Civitai remains a
separate HTTP source. Both verify hashes before files enter the transferable cache.

The PC owns the optional model cache, originals, prepared media, results and SQLite history.
Vast boot reuses verified files and attempts direct downloads before starting the
worker. Failed downloads use PC download/transfer only when local fallback is enabled. RunPod may start
first and wait for transfer; the CLI configures direct SSH access. Worker spool
files retain outputs until durable PC receipt; acknowledgment and cleanup are
repeatable. Any legacy retained volume can preserve spool files across replacement.
Destroying disposable disk on either provider destroys models and unsaved outputs. Disconnection never
proves termination safety or billing state.

Worker identity changes on container startup and engine identity on Comfy restart.
Neither promises resumable generation. See [API contract](API-CONTRACT.md) and
[Comfy integration](COMFYUI-CHANGES.md) for job/session/receipt semantics.
