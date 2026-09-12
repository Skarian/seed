# RunPod

Run `seed setup --provider runpod`, then `seed start`. New workers use global
placement and disposable pod disk. No network volume or private template is
required. Existing volumes are left untouched and may remain billable.

## Inspect and choose

`seed gpu runpod catalog` exposes provider GPU prices, VRAM, CUDA availability and
per-datacenter capacity. `seed gpu runpod datacenters` exposes regional information.
RunPod does not supply Vast-equivalent host reliability or measured transfer speed;
report those as unknown. Inspect `status` on both providers before renting.
Apply the shared 96 GB RTX PRO 6000 hardware preference to tests too. Match the
catalog's exact model and actual VRAM. H200/H100 and other alternatives need
explicit user confirmation; a generic permission to test is not that confirmation.

## Create and prepare

`seed gpu runpod create --gpu GPU_ID --max-hourly USD --disk-gb 180`
creates one GPU globally. The hourly guard checks the catalog's compute price;
disk and other charges must also fit the user's total budget. Optional repeated
`--datacenter ID` flags restrict placement only when explicitly desired.
The pinned image, SSH public key and private pairing credentials are configured
by Seed. HF/Civitai tokens are not persisted in the pod environment.

`seed gpu runpod wait` waits for startup/direct SSH without a fixed startup deadline.
It reports progress every 30 seconds. Ctrl+C stops waiting, not the pod.
`seed gpu runpod connect --pod ID --route ssh` pairs over private SSH.
Use `--route tailscale` when enrollment is configured.
`seed gpu runpod prepare` downloads models through that worker API with optional
PC fallback. `reconnect --route ssh|tailscale` changes the route without new pairing.
`seed gpu runpod status` reports provider state, permitted actions, SSH/runtime
information and local studio status. Pairing can happen during model preparation.

For creation errors, read the sanitized provider detail. Do not call every HTTP
400 a capacity error. `reconcile` checks uncertain creation before another attempt;
repeat an absence check after 30 seconds. Never hand-edit a rental record.

## Finish

`seed gpu runpod safe --pod ID` checks output saving.
`seed gpu runpod destroy` removes the recorded pod and disposable disk, verifying
absence. Paired sessions require fresh safe-to-terminate status. Failed new,
unpaired launches can be cleaned up when the local queue is idle.
Do not delete old pods or network volumes as a side effect.

The RunPod HTTPS proxy is retired. Both preparation and normal app traffic use
the authenticated worker API over the explicitly selected SSH or Tailscale route. Keep provider-specific errors and capabilities visible to the agent.
Live evidence and remaining limitations are in studio/VALIDATION.md in the repo.
