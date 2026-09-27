# Development

[← Back to Seed](../README.md)

Use Node.js 26.8.2 or later in the 26.x line.

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
