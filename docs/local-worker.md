# Use your own GPU

Seed can generate on this PC alongside rented GPUs. It is off by default.
Opening Seed does not install Python, download models, start an engine, or rent
a GPU.

Local generation requires native Windows and one NVIDIA GPU. Images need at
least 32 GB of VRAM. Video needs a GPU with a hardware profile, which on a PC
means an RTX 5090.

## Set up

1. Open **GPU workers → Workers → This PC** and choose **Set up local GPU**.
2. Allow about 95 GiB for the models and 140 GiB free for the first setup.
   Seed checks free space, verifies every download by hash, and resumes partial
   downloads when you retry.
3. Choose **Enable This PC**. The card shows the GPU and its state.
4. Choose **Auto**, **This PC**, or **Cloud** on a request.

## Run on

- **Auto** uses an idle compatible rental first, then this PC.
- **This PC** never uses a rental.
- **Cloud** never uses this PC.

Seed never rents a GPU by itself. A request that cannot run on its target stays
queued with an explanation.

## How it runs

One engine process serves images and video. ComfyUI swaps models itself, so
moving between workflows does not restart anything. One output holds the GPU
through generation, saving, and acknowledgement, and the oldest queued output
runs next.

Windows stays awake while a job is assigned. The display can still turn off.

The engine stops 20 minutes after the last output is saved. **Unload now** on
the This PC card does the same at once, whenever no job is running.
**Pause after current** and **Turn off after current** let the running output
finish. **Cancel current and stop** interrupts it.

## How it stops

Seed never terminates an engine that is working or holding models. To stop, Seed
calls the engine's authenticated stop route. The engine refuses new work,
interrupts any job and waits for it to end, unloads models and frees memory
through ComfyUI's model management, then exits normally. Seed waits for that
exit before it uses the GPU again. If the exit does not arrive in two minutes,
the card reports it and the GPU stays reserved. Choose **Retry recovery**, or
restart Seed.

The gateway and engine run inside a Windows Job Object held by a small
supervisor. If Seed itself dies, the supervisor sees its pipe close and exits,
and Windows ends the engine. This is the only path that ends an engine from
outside. The Job name also keeps one GPU to one engine.

## Recovery

A job's record and output live in a durable spool on disk. After a crash or
restart, Seed starts a recovery gateway that loads no models, checks the job's
receipt, and saves any finished output.

Seed never regenerates by itself. If nothing can be recovered, **Retry on This
PC** starts a new attempt of the same job with the same seed. An output file
with no terminal receipt blocks the retry and is kept for review.

## Storage

The default runtime and model directory is `<Seed data>/local-worker`. The job
spool is `<Seed data>/local-workspace`. `SEED_LOCAL_ROOT` selects a different
runtime and model directory. Keep Library files out of its `models`, `engine`,
`python`, `tools`, `cache`, and `downloads` subdirectories.

**Local storage** on the card removes models, the runtime, or both when no job
is running. Library outputs and the job spool are kept. Logs for each engine are
in `local-worker/instances/<id>`.

## Troubleshooting

- **Setup interrupted:** choose Resume setup. Complete files are verified and
  partial downloads resume.
- **GPU changed, or Seed updated its engine:** run setup again.
- **Out of memory:** close other GPU applications and retry. Seed does not change
  Windows page-file settings.
- **Engine did not become ready:** read the latest `engine.log` and `gateway.log`.
  Startup has a three-minute limit.
- **Output retained / save failed:** fix local storage, then retry. The GPU stays
  reserved until the output is saved and acknowledged.

## Private diagnostics

Agents must not inspect user prompts or images. `/api/v1/jobs/:id/status` returns
metadata only: state, workflow, timestamps, executor, attempt ID, output count,
adapter count, and whether an error exists.

## Maintainer checks

Run from the repository after `npm run build`, with `SEED_LOCAL_ROOT` pointing at
an installed runtime:

```powershell
node scripts/setup-local-worker.mjs runtime
node scripts/setup-local-worker.mjs models
node scripts/test-local-supervisor.mjs <python.exe>
node scripts/test-local-runtime.mjs
node scripts/test-local-engine.mjs
```

The supervisor and runtime tests start no GPU engine. `test-local-engine.mjs`
runs real jobs serially through Seed's HTTP API, then Unload now. Check
`nvidia-smi` for other compute jobs first.

Never force-kill or terminate an engine that is working or holding models, in
tests or by hand. It has produced NVIDIA driver errors and a later crash. Use the
stop route, Unload now, or a normal exit.

`--disable-comfy-compiler` stays on for every host. With the compiler enabled, an
RTX 5090 blue-screened in `nvlddmkm.sys` during sampling.
