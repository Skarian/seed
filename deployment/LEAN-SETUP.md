# Legacy direct-Comfy deployment and recovery

This is the pre-Seed deployment, retained for recovery. Pod/template IDs and prices
below are historical. For current Seed operation use [START-HERE](START-HERE.md).

The saved template uses our public GitHub Container Registry mirror of the pinned Hearmeman image, a small startup script, and the existing 150 GB network volume. No image build or local computer is needed to start it. See [registry publishing and rollback](GHCR.md).

The template was switched to GHCR on 8 September 2026 (Chicago) after Docker Hub connection timeouts. Existing pods retain their old image reference; deploy from the updated template or explicitly update the existing pod before restarting. Public registry access and image digest were verified; a GPU startup from GHCR has not yet been tested.

## Daily use

1. Open [Runpod Pods](https://console.runpod.io/pods) and start **neil-comfyui-replacement** (`s1bsc8hbjh0vqx`).
2. Wait for startup, then **Connect → HTTP port 8080**. Sign in with your existing Jupyter token. Port 8888 opens the administration/file browser with the same token.
3. Open your saved **Neil H3**, **Neil Krea 2**, or **Neil Qwen Rapid** workflows.
4. Save workflow changes, finish or cancel the queue, then **Stop** the pod. Closing the browser does not stop compute billing.

The token is saved in the private template and locally in `access.private.json` (`jupyter_token`). You can retrieve it from the pod's environment configuration when signed in to Runpod. Do not put it in a URL or share it.

## If Start says “Pod does not have any GPUs available”

This is a capacity problem on the old host. Your files remain on the network volume. Repeatedly editing startup scripts will not fix it.

1. Leave the old pod stopped. Never run two pods against this workspace simultaneously.
2. Open Runpod's pod deployment screen and select the **existing network volume** `neil-h3-models` (`f7vnixgws1`), **150 GB**, in **EUR-IS-1**. You can also start from that volume's deployment action in Storage. Do not create a new empty volume.
3. Choose the private template **Neil ComfyUI - H3 Krea Qwen** (`7522irqo4q`) and one **RTX PRO 6000 Blackwell Server Edition (96 GB)**, Secure Cloud, on-demand. Require CUDA 13.0 or newer and at least 128 GB host RAM.
4. Before deploying, verify the existing volume is attached at `/workspace`, the temporary container disk is **150 GB**, and HTTP ports **8080** and **8888** are exposed. Review the offered price; the tested GPU rate was **$2.09/hour**, plus disk and persistent storage.
5. Deploy and use the new pod's **Connect → 8080** link. Check that your saved workflows and uploads are present, then run a generation. The new pod has a new URL.
6. Keep the old pod stopped until the replacement works. Removing old stopped pods is optional separate cleanup; retain the network volume.

If the deployment screen has no compatible GPU for this volume, there is no automatic same-region workaround. Wait for capacity. A different GPU needs compatibility testing; another data center requires copying the data to a separate volume first. Do not select EUR-IS-2 merely because it has GPUs: this volume is in EUR-IS-1. A successful replacement is not guaranteed by the template.

During implementation, the capacity catalog omitted EUR-IS-1 even after the old pod stopped, but an actual deployment against the volume succeeded. The deployment result is the definitive capacity check.

## What is saved

- Private template `7522irqo4q`: image digest, startup command, existing login token, ports and environment.
- `/workspace/ComfyUI`: models, custom-node additions, uploads, outputs, saved workflows and settings.
- `/workspace/h3-deployment/lean-v1`: `start.sh`, `pin-startup.py`, `pins.json`, `nginx.conf`. Local copies are in `deployment/lean/`.
- Startup command: `bash /workspace/h3-deployment/lean-v1/start.sh`.

Startup checks the mounted workspace, installs nginx if missing, restores the authentication proxy, pins the upstream startup code and bundled nodes, then runs the upstream launcher. Existing models are reused. No model hash scan, test generation, idle monitor or custom dependency framework runs at startup.

The image and startup/node revisions are pinned. Upstream still installs its small bundled requirements when needed; this is not a completely frozen Python environment. The three personal Krea/Qwen extensions currently require no additional packages beyond the image. Missing future dependencies should be added explicitly to startup.

## Modifying it later

Workflow edits and model additions stay on the volume immediately. Custom-node source also stays there; any newly required Python/system packages must be included in startup so a replacement gets them. Changes only under `/ComfyUI` or elsewhere in the container are disposable.

For startup changes, copy `lean-v1` to `lean-v2`, edit and test the new copy, then change both the private template and the current pod's startup command. Updating a template does not update an existing pod. Keep the previous directory for rollback. Local edits are not deployed until copied to the volume.

To update pinned upstream repositories in an existing container, first inspect and discard only the generated edits in `/comfyui-runtime/src/runtime_nodes.json` and `/comfyui-minimax/template.json`, or test using a fresh replacement. Otherwise Git can refuse to switch revisions. Do not reset personal custom nodes.

## Recovery and backups

The pre-change workflows/settings and personal custom nodes are backed up in `/workspace/h3-deployment/before-lean-startup.tar.gz` and locally in `before-lean-startup.private.tar.gz`. That archive is not a backup of models or generated outputs. Download valuable outputs separately.

For a bad startup change, restore the prior script path in both the template and pod configuration, then restart. Restore user files from backup only if the upgrade changed them; replacing scripts does not undo a data migration. The superseded original bootstrap is available in Git history; `lean/start.sh` is the retained legacy startup.

Use the pod's Runpod container logs if startup fails. ComfyUI logs are at `/workspace/comfyui_<pod-id>_nohup.log`. The script intentionally fails if the expected mounted workspace/models are missing. It does not delete files or silently construct an empty setup.

The network volume continues billing while compute is stopped. Retained pod storage may also incur charges. Use the Runpod console for current total pricing.
