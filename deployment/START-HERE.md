# RunPod deployment files

For the current **Seed art studio**, start with [the repository README](../README.md)
and [seed RunPod operations](../skills/seed/references/runpod.md).
The current worker uses private-template setup in `server/pod-setup.ts` and code
under `worker/`. It does not use the old Jupyter-authenticated ComfyUI proxy.

This directory retains the earlier direct-Comfy setup for recovery/reference:

- `lean/`: pinned startup scripts and nginx configuration.
- [Legacy operating guide](LEAN-SETUP.md), [acceptance summary](LEAN-ACCEPTANCE.md).
- [GHCR mirror](GHCR.md): also supplies the current worker's pinned base image.
- `workflows/` and retained API graphs: editable workflow sources for reference/rollback.
- [Krea](KREA2-START-HERE.md), [MiniMax apps](MINIMAX-APPS.md), [rebalancing](REBALANCER.md).
- `remote.py`, `comfy.py`: legacy diagnostics using local private credentials and
  `configuration.json`. They are not imported by Seed.

Old one-off installers, job histories, queue snapshots, retired Qwen deployment
hooks and generated acceptance scripts were removed during the exhaustive cleanup.
Git history preserves them. Historical pod IDs/prices in the guides are evidence,
not current deployment instructions. Never run an old mutation script recovered
from history without checking its hard-coded paths and resource IDs.
