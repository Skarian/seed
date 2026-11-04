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
npm run test:user
```

`npm run test:browser` runs the offline app suite at phone, tablet and desktop
widths: navigation, a direct make through GPU consent to results, the viewer,
Library search and the GPU page. `npm run test:user` holds a live Gemma
conversation (see Realistic user testing).

The browser harness blocks external network calls. Passing offline tests does
not qualify GPU compatibility, generation speed, output quality, or provider
availability. See the [operations guide](operations.md) for recovery and live
qualification guidance, and the [worker guide](../worker/README.md) for
container-specific validation.

## Realistic user testing

User-test mode runs Seed with the same offline fake GPU providers and workers
as the browser tests, but chat is live: Gemma 4 31B through OpenRouter. Every
start uses a fresh, isolated profile under `.local/user-test-*`. Only
`openrouter.ai` is reachable. Seed blocks and records every other outside
call, and the launcher fails if it finds any when it stops.

Set `OPENROUTER_API_KEY` in your shell, then build and start:

```powershell
$env:OPENROUTER_API_KEY = '<your OpenRouter key>'
npm run build
npm run user-test
```

Open the printed address (default `http://127.0.0.1:4312`; set `SEED_QA_PORT`
to change it). Press Ctrl+C to stop. The launcher prints the number of
OpenRouter calls and any blocked calls. The key goes only to the server
process environment. Seed never writes it to the profile, and the profile
does not hold any other OpenRouter key. Chats use real OpenRouter credit.

To run the Playwright user suite against a fresh instance at phone, tablet and
desktop widths:

```powershell
npm run test:user
```

The suite holds a multi-turn chat with Gemma that produces a text-to-image
request, approves it, rents a fake cloud worker, waits for the output and
finds it in the Library. Use only synthetic prompts in user tests. Live model
replies can vary, so a failure can come from the model as well as from Seed.
`npm run test:browser` is unchanged and still blocks all outside calls.

Native Windows GPU tests are documented in the [local worker guide](local-worker.md).
They use real models and run serially; normal unit tests do not load a GPU.
To run Python fixtures without public model downloads, set `HF_HUB_OFFLINE=1`.
In a restricted workspace, pass a fresh `--basetemp` below `.local/tests` and
`-p no:cacheprovider` to pytest. The missing-source preparation fixtures should
fail immediately offline rather than waiting for network retries.
