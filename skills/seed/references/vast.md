# Vast

Complete [setup](setup.md), then start the local app. These commands use the
installed package and per-user state; no checkout or helper scripts are needed.

1. `seed gpu vast doctor` checks dependencies and configured credentials.
2. `seed gpu vast status` lists rentals and local studio state.
3. `seed gpu vast offers` finds suitable one-GPU offers. Prioritize verified hosts, high reliability and fast network transfer. Inspect
   hourly and transfer prices against the user's authorization.
4. `seed gpu vast rent --offer-id ID --max-hourly USD --disk-gb 180` rents the
   selected offer. It checks the fresh listing's price and records intent before
   creation. Listings expire after 60 seconds; refresh with the same disk size if
   necessary. It accepts that exact offer ID without a second host/slice search.
5. `seed gpu vast wait` waits about five minutes for running state and a successful
   authenticated SSH probe; port mappings alone do not prove readiness.
6. `seed gpu vast boot` prepares models and starts the pinned worker. Repeat to
   reuse verified files after an interruption. Never run during active generation.
7. `seed gpu vast connect` establishes a private SSH tunnel and pairs automatically.
8. `seed gpu vast status` verifies the session. Return the local app URL and cost.

`offers --gpu NAME` may be repeated for approved hardware alternatives. Rental
requires at least 120GB disk; allow room for the model manifest and temporary outputs.
No particular host or startup time is guaranteed.

Use `offers --all-gpus` for discovery or repeated `--gpu` values for exact catalog
names. Select the 96 GB RTX PRO 6000 family under the shared hardware rule;
discovery results do not authorize renting another GPU type. Do not lower VRAM
requirements for infrastructure tests. Confirm actual reported VRAM and model
variant before rental. Start with `--max-hourly 2`; this search ceiling is
adjustable, not a universal budget rule. Use `--min-download-mbps` for the network floor.

## Recovery

For a failed test, run `seed gpu vast logs` before cleanup. It saves redacted
container logs under Seed's private diagnostics directory. Use `logs --daemon-logs`
for host startup/network errors or empty container logs. The owner has authorized
Vast's S3-backed log export; do not ask again. Preserve collection errors too.

If a creation result is uncertain, `seed gpu vast reconcile` checks provider state.
An absent rental needs a second absence check after 30 seconds. An unidentified
existing instance blocks further allocation: inspect it instead of editing state.
After confirmed absence, another approved offer may be selected.

For startup failures, inspect status and retry wait once when there is progress.
For interrupted downloads, retry boot once; verified files are reused and partials
resume where supported. If the new worker still cannot be prepared, destroy it.
No indefinite retries. Do not delete an established session over a transient error.

## Finish

`seed gpu vast destroy` verifies safe output saving for paired sessions, deletes
the recorded instance/disk, stops the tunnel and confirms absence. Unpaired failed
launches may be destroyed with an idle local queue. Saved local media is preserved.
`stop` retains billable disk and is only for an explicitly requested pause.
`billing` reports account/recorded-instance charges; billing can lag provider actions.

## Evidence

The September 11 direct-download/fallback run validated all three implemented
workflows in both modes, with five-second videos. The packaged CLI lifecycle has passed live tests on full-size workers. Current
evidence and remaining limits are in studio/VALIDATION.md in the repo.
Do not claim maximum-reference capacity or all desktop platforms are proven.


Verified-only filtering remains the default and there is no verification bypass.
Reliability and network speed
matter alongside the shared under-$2/hour preference in SKILL.md. Search results retain Vast fields including verification,
network throughput, transfer prices and reliability so the agent can judge them.
