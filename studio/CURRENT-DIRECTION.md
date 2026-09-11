> September 11 update: setup caches all models and configured LoRAs on the PC. New workers receive verified files over SSH, not Hugging Face/Civitai keys. Reuse local and remote files; resume interrupted transfers. No public model server or separate object store. Current GPU sessions remain unchanged. Full cold PC-to-VM timing remains to be measured; RunPod direct SSH provisioning is operator-managed.

# Current Seed direction

## Adopted operating model — 10 September 2026

The agent operates Vast **or RunPod** through the repository's [seed skill](../skills/seed/SKILL.md).
One local browser app keeps permanent inputs/outputs/history; one authorized GPU
runs generations. The UI does not acquire hardware. No Terraform, orchestrator
service, multi-region replication or automatic provider failover.

Setup selects a provider, collects its key plus HF and optional Civitai, remembers
the choice and preserves other saved keys. Windows sign-in startup is optional
and starts only the local app. The repo contains ordinary React/Node app code,
worker code and a skill; copying the UI into skill instructions is unnecessary.

Vast uses disposable disk/direct model downloads and SSH. RunPod retains private
template/network-volume/HTTPS support. Stop and destroy are distinct; permanent
PC media is retained. Verify fresh output safety before teardown and verify the
provider state afterward. PC sleep does not stop billing.

### Next checkpoints

- Shared onboarding and provider-specific skill tests, including clean configuration.
- Live portable Vast lifecycle and new RunPod automatic-pairing path, one authorized
  GPU at a time, with current offer/budget and teardown agreement.
- User fresh-start/LAN UI review. No new generation UI redesign is required.
- Identity editing remains a separate unfinished workflow.

## Retained product decisions

Four workflow pages/forms, SFW/NSFW presets, meaningful Advanced controls,
sequential jobs and a local Library remain in scope. Native ComfyUI events and
history supply generation timing/progress; the PC records usage and durable
receipts. Do not add a second telemetry framework.

Models are fetched directly from pinned Hugging Face sources; owner-selected
LoRAs may use Civitai. No PC weight bundle or new storage service. New downloads
are verified; completed caches are reused. GHCR holds software, not credentials.

Jupyter remains an administration tool separate from Seed authentication. Public
hosting, DNS and home-network tunnels are owner-managed. LAN testing remains the
preferred user-review path. The user reviews UI/experience decisions; routine
implementation and tests proceed unattended. Decisions and validation evidence
belong in EXECUTION-PLAN.md; commit at coherent verified milestones.
