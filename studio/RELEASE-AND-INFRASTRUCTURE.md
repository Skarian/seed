# Release and infrastructure

Seed ships a Node package containing the local server, shared code, web assets,
and editable chat prompt templates. Build with npm run verify, then npm pack.
Use scripts/test-package.mjs through npm run test:package to check an archive.

Generation runs on fal's model APIs. There is no worker image release or provider
provisioning step. Never include credentials, models, local media or private
upload receipts in the package. Only local adapter masters and user media need
local disk; base-model weights remain fal's responsibility.

Do not silently replace a running installed app with a worktree test build.
Preserve its existing data/config paths. STUDIO_DEV_ROOT selects an isolated
worktree instance. Keep measured provider behavior separate from guarantees:
precision, caching, quantization and internal scheduling are not app-controlled.
