# Open Seed on RunPod

Complete [setup](setup.md) with `--provider runpod` first. RunPod uses a private
Seed template and a reusable network volume. Its worker connects over HTTPS;
no SSH tunnel is needed. REPO and SKILL mean absolute paths to the app
checkout and this skill, respectively.

## Prepare storage and the template

From REPO:

```sh
node dist/server/cli.js pod-setup
```

This checks model access and reuses saved volume/template IDs. On a fresh account:

- To select an existing suitable volume, use `pod-setup --volume VOLUME_ID`.
- To create one, use `pod-setup --create`. It asks for datacenter/capacity and shows
  cost before confirmation. Storage is billable even without a GPU.

Expected result: volume ID, location, and a deployment link for the private **seed**
template. Credentials and pinned image settings are populated privately. No GPU
has been created. Normal operation does not need `--show-secrets`.

The saved IDs and pairing secret are in pod-deployment.json under the private
config directory printed by setup. Read needed IDs without displaying the secret.
Keep the volume in its existing region; don't create regional replicas as a side effect.

## Find and start one GPU

```sh
node "SKILL/scripts/runpod.mjs" status --repo "REPO"
node "SKILL/scripts/runpod.mjs" catalog --repo "REPO"
```

Status lists pods without their secret environment values. Catalog lists GPU
prices/availability; additionally inspect datacenter-specific availability using
the provider tools. The network volume constrains the pod to that datacenter.
Check Vast too if it is configured: keep one active GPU across the accounts.

Use a connected RunPod MCP tool or the official runpodctl for compute lifecycle.
If neither exists, install the matching OS release from
https://github.com/runpod/runpodctl/releases. Inspect `runpodctl --help` and
`runpodctl pod create --help` for that version's flags. Authenticate using the saved
RunPod key in the child process's RUNPOD_API_KEY environment, never as an argument
or in chat. A Node child process can read credentials.json and supply that environment.
Do not print raw pod/template responses; they include model-source secrets.

Prefer a compatible existing pod if reusable. Otherwise create one pod using the
saved template ID, saved volume mounted at `/workspace`, ONE compatible GPU and
the volume's datacenter. The image requires CUDA 13+. RTX PRO 6000 96 GB is the
measured default; confirm hardware, RAM and current total cost against the user's
approved choice. Record intent and returned pod ID in ignored local state.

RunPod actions use the native provider tool, not this skill's Node helper. For API
inspection the authoritative contract is https://api.runpod.io/v2/openapi.json:
list/get/create pods under `/v2/pods`; start/stop via `/v2/pods/{id}/action`;
terminate via DELETE `/v2/pods/{id}`. Reuse existing private settings rather than
reconstructing secrets manually. The helper only supplies reads, pairing and safety.

If start/create fails for capacity, inspect actual pods before trying another
approved candidate. A timeout can conceal a successful allocation. Do not loop
blindly, migrate volumes, or switch providers outside the user's agreed alternatives.

## Connect the studio

Once the container is running and HTTP port 8080 responds:

```sh
node "SKILL/scripts/runpod.mjs" connect --repo "REPO" --pod POD_ID
node "SKILL/scripts/runpod.mjs" status --repo "REPO"
```

Use the exact pod ID returned by RunPod. The helper confirms the pod uses the saved
private Seed template, unlocks it and pairs automatically. If it rejects the
template, check pod-deployment.json against the actual pod; don't bypass that check
or send the pairing secret to a different endpoint. The local app must be running.

Connection can complete during model preparation. Check studio readiness rather
than equating RunPod RUNNING with a loaded engine. Deliver the local studio URL,
Preparing/Ready status and hourly cost. If the queue is paused, resume through the
jobs UI when the user wants its queued work to run. Don't auto-submit a benchmark.

The normal HTTPS path retains the historical RunPod proxy limitations; this skill
does not claim to fix provider upload failures. Inspect worker/app logs and retain
inputs on failure rather than changing models or regenerating ambiguous jobs.

## Finish

```sh
node "SKILL/scripts/runpod.mjs" safe --repo "REPO" --pod POD_ID
```

Safe pauses dispatch and requires a fresh affirmative output-safety check for the
same paired pod. If refused, wait for saving or reconcile the worker. Once safe,
immediately use the provider tool to stop or terminate that exact pod as agreed.
Run status again: confirm EXITED for stop, or absence for termination.

Stop retains billable storage. Termination removes pod-local disk but detaches,
rather than deletes, the network volume. Keep the network volume for future model
reuse unless the user separately asks to delete it. Report any continuing storage
cost. `seed stop` only stops the PC app and is not this teardown operation.

If a new pod never became usable, inspect its state/logs and confirm it has no
submitted work before emergency provider teardown. Never leave a failed rental
unmentioned. Earlier RunPod generation is live-tested; this skill's new automatic
pairing has fixtures/read-only validation but still needs a fresh paid lifecycle test.
