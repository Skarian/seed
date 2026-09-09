# Studio container registry

The manual **Mirror studio image to GHCR** GitHub Actions workflow copies the
approved upstream image to `ghcr.io/skarian/runpod-studio:v1.0.0` without building
or adding repository files. It preserves and verifies the upstream digest.

Run it from the private `Skarian/runpod` repository's Actions page. The workflow
uses GitHub's temporary job token with package-write permission; no personal
credential is committed. GitHub-hosted runner minutes may count against the
account's Actions allowance. Container registry storage/bandwidth is currently
free under GitHub's published policy.

The package is initially private. A public mirror needs no Runpod registry
credential; a private mirror needs a classic GitHub token with `read:packages`
stored in Runpod's container registry credentials. Package visibility is separate
from repository visibility. This mirror contains only the public upstream image.

After the workflow succeeds and registry access is configured, update the Runpod
template image to:

```
ghcr.io/skarian/runpod-studio@sha256:5b01d3f62ce157792bd6aab4bef0b7c6b4c95b1b37ed4d9e3454f898e1bcca15
```

Existing pods keep their old image reference until explicitly updated/replaced.
Always attach `neil-h3-models` (`f7vnixgws1`) at `/workspace`. Mirroring the image
does not copy models, apps, outputs, or the startup files from that volume.

For a future upstream upgrade, change SOURCE and EXPECTED_DIGEST together and
choose a new version tag. Publish and verify before changing the Runpod template.
The original Docker Hub digest remains the rollback image reference.
