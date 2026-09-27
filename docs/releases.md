# Releases

[← Back to Seed](../README.md)

Seed's source code is released under the [MIT License](../LICENSE). The local
application and the GPU worker containers are versioned separately.

## Application

Run the complete verification suite, build the package, and test the packed
artifact before tagging an application release:

```sh
npm run verify
npm pack --pack-destination .local
npm run test:package -- .local/skarian-seed-0.1.0.tgz
```

## Worker base

The worker Dockerfile starts from a digest-pinned mirror of:

```text
docker.io/hearmeman/comfyui-minimax-template@sha256:5b01d3f62ce157792bd6aab4bef0b7c6b4c95b1b37ed4d9e3454f898e1bcca15
```

The manual `Mirror worker base image` workflow copies that manifest and all of
its platform content to `ghcr.io/skarian/runpod-studio:v1.0.0` with `skopeo
copy --all --preserve-digests`, then verifies that the destination digest is
identical. No source files or layers are changed by the mirror operation.

Anyone can reproduce the mirror locally after authenticating to their chosen
destination registry:

```sh
skopeo copy --all --preserve-digests \
  docker://docker.io/hearmeman/comfyui-minimax-template@sha256:5b01d3f62ce157792bd6aab4bef0b7c6b4c95b1b37ed4d9e3454f898e1bcca15 \
  docker://REGISTRY/OWNER/seed-worker-base:v1.0.0
```

To use a different mirror, replace the second `FROM` reference in
[`worker/Dockerfile`](../worker/Dockerfile) while preserving the expected base
digest.

## Worker roles

The manual `Build worker role candidates` workflow builds Image and Video
targets from [`worker/Dockerfile`](../worker/Dockerfile), verifies their role
identity and pinned assets, checks layer sizes, and optionally publishes them.
After publishing, verify anonymous pulls and place only digest-pinned references
in [`worker/releases.json`](../worker/releases.json). The application refuses
to launch an unpublished worker release.

Model files named by the manifests are build/runtime inputs and are not stored
in this Git repository. Their own terms continue to apply when they are
downloaded or redistributed.
