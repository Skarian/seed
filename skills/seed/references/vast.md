# Vast

Complete [setup](setup.md), then start the local app. These commands use the
installed package and per-user state; no checkout or helper scripts are needed.

1. `seed gpu vast doctor` checks dependencies and configured credentials.
2. `seed gpu vast status` lists rentals and local studio state.
3. `seed gpu vast offers` finds suitable one-GPU offers. Inspect hourly and transfer
   prices, disk, network and reliability against the user's authorization.
4. `seed gpu vast rent --offer-id ID --max-hourly USD --disk-gb 180` rents the
   selected offer. It checks current pricing and records intent before creation.
5. `seed gpu vast wait` waits at most five minutes for running state/direct SSH.
6. `seed gpu vast boot` prepares models and starts the pinned worker. Repeat to
   reuse verified files after an interruption. Never run during active generation.
7. `seed gpu vast connect` establishes a private SSH tunnel and pairs automatically.
8. `seed gpu vast status` verifies the session. Return the local app URL and cost.

`offers --gpu NAME` may be repeated for approved hardware alternatives. Rental
requires at least 120GB disk; allow room for the model manifest and temporary outputs.
No particular host or startup time is guaranteed.

## Recovery

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
workflows in both modes, with five-second videos. The new packaged CLI and recovery
commands are undergoing the validation recorded in studio/VALIDATION.md in the repo.
Do not claim maximum-reference capacity or all desktop platforms are proven.
