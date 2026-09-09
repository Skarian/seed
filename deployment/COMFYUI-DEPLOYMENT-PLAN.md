> Historical planning document. The implemented lean setup and current operating instructions are in [LEAN-SETUP.md](LEAN-SETUP.md).

# Agreed ComfyUI deployment plan

Planning only. Supersedes the custom-image, Tailscale/Funnel and routine-termination proposals. This document does not restart compute or change the live template.

## Desired experience

Normal use: Runpod → Start saved pod → Connect to HTTP port 8080 → sign in → use ComfyUI → Stop. No local terminal, home computer or registry account is required. Keep the same pod and URL when capacity allows. Replacement deployment is a recovery operation for unavailable capacity, a broken host or a deliberate runtime migration.

Use the pinned existing Hearmeman image, versioned startup scripts and one private template. The existing network volume holds models and personal files. The URL changes when a pod is replaced; use Runpod's Connect button. Closing the browser does not stop billing.

## Recorded starting configuration

| Resource | Configuration |
|---|---|
| Pod | `uuwayipczbkwcd`, `neil-comfyui-active`, last verified EXITED after requested stop |
| Template | `7522irqo4q`; audit and preserve its known-working configuration |
| Network volume | `f7vnixgws1`, `neil-h3-models`, 150 GB STANDARD, EUR-IS-1 |
| Mount | `/workspace` |
| First supported GPU | One RTX PRO 6000 Blackwell Server Edition, 96 GB |
| Temporary container disk | Current 150 GB; reduce only after measuring usage |
| Base image | `hearmeman/comfyui-minimax-template@sha256:5b01d3f62ce157792bd6aab4bef0b7c6b4c95b1b37ed4d9e3454f898e1bcca15` |

Re-read live configuration before implementation. Older handoff files contain stale pod IDs, volume sizes and status text; reconcile them as part of this work.

## Phase 1: capture and protect the working setup

During implementation, inventory the actual ComfyUI revision, required custom-node revisions, Python packages, CUDA/PyTorch, launch arguments, model mappings and authentication configuration. Compare live state with the older manifests before pinning it.

Cover H3 video, Krea generation/editing, Qwen Rapid v19, and saved user variants. Include the separately named Phr00t sizing node. Identify dependencies needed by those workflows rather than blindly freezing every unrelated package.

Back up saved workflows, settings and startup configuration outside the network volume before changing startup. Local copies suffice for the initial configuration backup. Choose a separate destination before implementing backup of valuable user outputs. Keep model download sources for recovery. Persistent storage alone is not a backup.

Deliverables: runtime manifest, required-node inventory, model inventory, dependency constraints and a preserved copy of the current bootstrap/template.

## Phase 2: make startup repeatable

Keep models, inputs, outputs, saved workflows, settings and custom-node sources under `/workspace/ComfyUI`. Put versioned scripts, manifests and logs under `/workspace/h3-deployment`. Treat container-local packages as disposable: persistent node source does not ensure its Python dependencies exist in a replacement container.

Implement a versioned bootstrap with these ordered stages:

1. Verify the expected mounted volume and workspace marker. Report a missing or incorrect volume instead of starting an empty workspace.
2. Check GPU/runtime compatibility and writable output paths.
3. Prevent concurrent sessions from modifying shared state. Test locking on this filesystem and stale-session recovery; a PID on one host cannot establish another pod's liveness.
4. Restore required node versions and install missing dependencies using the correct Python interpreter. Pin dependencies, inspect installed versions/imports, and reuse package caches where helpful. A marker file alone must not skip a broken environment. Preserve modified source files before any repair.
5. Recreate path mappings, proxy configuration and launch arguments. Seed examples only when absent; preserve user workflows and settings.
6. Start ComfyUI and authentication services with useful logs and process supervision. Audit upstream startup behavior and prevent uncontrolled code/package updates.
7. Check HTTP readiness, required node types and model entries. Print clear stages and READY only after checks pass. Do not generate an image or video on every boot.

Each stage must be safe to repeat after interruption, with bounded retries and clear failures. Never fix installation problems by upgrading the whole CUDA/Python stack automatically. Use expected-size/readability checks for model files; do not re-download complete models or hash large files on routine startup. Preserve the record that Qwen's full checksum verification was skipped at the user's request.

The template selects an explicit script release. Retain the previous release for rollback. Editing a startup script does not modify an already-running process; apply changes through a deliberate restart or replacement.

## Phase 3: save the browser launch configuration

Use Runpod's HTTPS proxy on 8080 and the existing authenticated proxy for the initial release. Test that logged-out requests cannot access ComfyUI APIs, WebSockets, uploads or outputs. Keep raw ComfyUI bound to localhost. Retain the existing token-protected Jupyter administration path as a recovery route and test it independently.

Move secret values to Runpod Secrets references where supported, preserving access during migration. Never place credentials in logs, code or workflow JSON. Avoid a surprise authentication redesign during packaging.

Save the image digest, selected bootstrap, ports and secret references in a private template with clear instructions. Its README identifies the existing volume and supported GPU. A `/workspace` mount setting alone does not attach the existing network volume; validate the actual console flow and document its exact selections.

## Phase 4: prove normal startup and replacement

Use a controlled GPU test session with only one pod operating on the workspace at a time:

1. Boot with the revised scripts and sign in through the external browser URL.
2. Test uploads, downloads, WebSocket previews and workflow save/reopen.
3. Run representative Qwen image editing, H3 video and Krea generation/editing tests. Check saved outputs and required nodes.
4. Stop/start the same pod if capacity permits. Verify the URL, settings and files, with no manual dependency repair.
5. Stop the original, deploy a fresh replacement with the same volume and template, and verify installation from a clean container. Confirm no model redownload and a successful generation with preserved settings.
6. Exercise missing-volume, interrupted-bootstrap, dependency-error and rollback paths without damaging user data.

Measure fresh-container startup separately from repeat startup and first-generation model loading. Set expectations from those measurements. HTTP readiness alone is not acceptance: require real generation and persistence after replacement. Keep the previous pod stopped until the replacement works; removing obsolete pods is separate cleanup.

## Daily operation and recovery

Normal: Start the saved pod, wait for READY, Connect to HTTP service 8080 and sign in. Finish/cancel queued jobs and save workflow edits before Stop. Verify the console shows a stopped pod. Retain both the pod and volume.

Replacement: stop the old pod; Runpod Pods → Deploy → select existing `neil-h3-models` network volume → choose the validated GPU in EUR-IS-1 → select the private template → review price → Deploy On-Demand. Open the new Connect link. Verify saved data and generation before deleting the old stopped pod.

The volume must be attached during deployment. Region availability still limits GPU choice. If capacity is unavailable, wait or deliberately validate another compatible GPU in that region. Another region requires a separate data migration; never silently create another volume.

Bad software upgrade: select the previous script/template release and restore affected configuration if needed. Software rollback alone does not undo data migrations. Full storage: report clearly and preserve files; no automatic deletion of user outputs.

## Maintenance and costs

Permanent node/package updates become a new tested bootstrap release. Workflow edits and compatible model additions do not require a rebuild, but new nodes may require dependency-manifest changes. Preserve previous releases and settings backups.

The persistent volume bills while compute is stopped. Published STANDARD storage pricing of $0.07/GB/month puts 150 GB at $10.50/month before tax. Confirm current GPU/disk rates at deployment; compute time includes installation and idle time. Check remaining capacity before new model downloads.

A custom image becomes worthwhile only if measured startup overhead or repeated installation failures justify maintaining a registry. Optional idle-stop comes later after reliable activity/queue detection exists. It must call the Runpod control plane and verify shutdown; exiting ComfyUI is not a billing control. Tailscale, custom domains, serverless and automatic termination are outside this first release.

## Final deliverables and implementation needs

Deliver the saved template link, current pod link, exact browser-tested Start/Connect/Stop and replacement instructions, versioned scripts/manifests, backup/rollback instructions, measured timings and acceptance report. Refresh START-HERE, STATUS and model guides to reference one authoritative configuration.

No registry account is needed. Implementation requires a paid GPU test session and existing Runpod access/secrets. A backup destination must be selected before exporting personal files to any new service. The currently stopped pod remains stopped during planning.

## Sources

- [Pod lifecycle](https://docs.runpod.io/pods/manage-pods)
- [GPU availability on restart](https://docs.runpod.io/pods/troubleshooting/zero-gpus)
- [Network volume deployment and pricing](https://docs.runpod.io/storage/network-volumes)
- [Private templates](https://docs.runpod.io/pods/templates/manage-templates)
- [Runpod Secrets](https://docs.runpod.io/pods/templates/secrets)
- [HTTP proxy URLs](https://docs.runpod.io/integrations/overview)
