# Development

[← Back to Seed](../README.md)

Use Node.js 24 or later. On Windows, `npm ci` also needs Python and the C++
build tools, because npm runs node-gyp for `better-sqlite3`:

```powershell
winget install --id astral-sh.uv --exact --scope machine
uv python install 3.12 --default
uv python update-shell
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --override "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Open a new terminal afterwards so the updated PATH applies.

```sh
npm ci
npm run build
npm test
```

`npm run dev` builds and starts Seed. Set `STUDIO_DEV_ROOT` to an isolated
directory when developing against disposable application data. Provider and
worker tests use injected transports and fixtures unless a command explicitly
states that it performs paid live qualification.

## Verification

```sh
npm run verify
python -m pytest worker
npm pack --pack-destination .local
npm run test:package -- .local/skarian-seed-0.1.0.tgz
npm run test:browser
npm run test:visual
npm run test:cards
```

The browser harness blocks external network calls. Passing offline tests does
not qualify GPU compatibility, generation speed, output quality, or provider
availability. See the [operations guide](operations.md) for recovery and live
qualification guidance, and the [worker guide](../worker/README.md) for
container-specific validation.

Native Windows GPU tests are documented in the [local worker guide](local-worker.md).
They use real models and run serially; normal unit tests do not load a GPU.
To run Python fixtures without public model downloads, set `HF_HUB_OFFLINE=1`.
In a restricted workspace, pass a fresh `--basetemp` below `.local/tests` and
`-p no:cacheprovider` to pytest. The missing-source preparation fixtures should
fail immediately offline rather than waiting for network retries.
