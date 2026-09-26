# Video worker SSH rollout correction

24 September 2026 UTC. Branch `codex/fal-only`.

## Incident and cleanup

The user's Vast Video rental `63a7abc6-49fb-4f1f-9690-cff23f650981`
(provider instance `52322221`) started its container, then rejected Seed's
SSH key with `Permission denied (publickey)`. Model preparation had not begun.
The app preserved the provider's successful key-registration response, SSH
failure, failed SSH-based log collection, and successful provider-side container
log export. Image rental `b00b43f3-0b89-46e2-a316-f3dc92f05ae1`
was progressing through downloads when the user requested both be terminated.

Both were terminated through Seed at 00:24:52Z. Rental compute/storage estimates
were $0.04293 Image and $0.09700 Video, excluding transfer charges. Independent
provider inventories at 00:26:10Z confirmed zero Vast instances, zero RunPod
pods, zero Vast volumes and zero RunPod network volumes. Attached disposable
disks were removed with the instances. No new paid workers were created.

## Cause and correction

The previous rollout published the corrected shared SSH entrypoint only in the
Image container. Video still used the older `PUBLIC_KEY` and provider-managed
authorized-key path. The transport harness also applied the conflicting-key and
provider-file-replacement checks only to Image. That was a release/testing gap.

The harness now applies those checks to **both** published images. Against the
old Video digest it reproduced `SSH authentication failed` during gateway
pairing. The newly built Video image passed the same scenario. This establishes
the old image's vulnerability and the fix's behavior under the tested conditions;
the failed live rental's logs do not expose the provider's internal key rewriting.

Video now packages the same reviewed `worker/entrypoint.py` as Image:
`SEED_SSH_PUBLIC_KEY` takes precedence, the authorized key is root-owned under
`/run/seed-ssh`, password login is disabled, and SSH diagnostics are retained.
Both roles additionally verify their packaged entrypoint hash matches source.

Published Video tag: `ghcr.io/skarian/seed-worker-video:v0.1.0-diagnostics.4`.
New pinned Video digest:
`sha256:36d20d1bc596cc1f18cbc7dc5e724aa05725940f3d377539c85522dd75308bd5`.
Image remains on its already corrected digest:
`sha256:8edf7a9eb0567e4cd935cb7f3602029bc8d69525c340da671ec8bd0ffc8508cb`.
Model manifests, quality settings and inference runtime pins were preserved.

## Verification

- Old Video image failed the expanded real-SSH container regression. Evidence:
  `.local/tests/container-transport-gws4F7/results.json`.
- Updated published images passed **16/16** container checks, including actual
  startup, SSH pairing, conflicting provider keys, provider key-file replacement,
  rejection of unrelated keys, reconnect, transfer and receipt recovery.
  Evidence: `.local/tests/container-transport-sP6E6a/results.json`.
- The startup/authentication checks use unmodified published container commands
  with networking disabled. Subsequent inference/transfer checks use CPU fixtures;
  this is not a new GPU inference qualification.
- Anonymous GHCR access verified both manifests, configurations and all layers;
  registry image identities matched the local tested images.
- Packaged source hashes matched the workspace: 31 files Image, 29 Video.
- Production build, typecheck and **310 tests across 35 files** passed.
- Secret scan: 524 files, zero potential credential matches.
- Restarted the real LAN app with the new built release. Chrome showed zero
  rented workers and $0/hour, then loaded fresh Video offers from both Vast and
  RunPod. Left the worker picker open with no offers selected. Final independent
  compute/storage audit at 00:31:30Z remained empty.

Private incident history, cleanup proof, registry verification, source hashes,
build/push logs and the new application fingerprint are retained under
`.local/video-ssh-rollout-2026-09-24/`.

The previous two-journey frozen-release evidence is historical; this updated
Video digest starts a new release cohort. It has not yet had a new paid GPU run.
