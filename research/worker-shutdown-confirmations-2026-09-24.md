# Worker shutdown confirmations

All four shutdown controls now use the shared confirmation dialog: single-worker and all-worker versions of both Finish jobs and quit and Cancel jobs and quit now. Confirmation identifies the worker or pool count and explains job handling, rental-disk deletion, saved Library items, and billing until release is confirmed. Recovery actions are unchanged.

No shutdown request is sent before confirmation. Cancel and Escape return to the worker panel. While submitting, dismissal and repeat submission are blocked; request errors stay inside the confirmation for retry. The underlying provider lifecycle is unchanged.

Validation uses the isolated browser fixture, with external calls blocked and no real rentals changed:

- All 19 worker-action browser tests passed, including the existing graceful completion, recovery, and saved-output flows.
- All 13 confirmation, error, acquisition-state, and viewport checks passed after the final visual corrections (12 together, then the narrow-screen test after allowing its portal layout to settle).
- Single/bulk and immediate/graceful confirmations at 390px and 1280px; Cancel, Escape, default focus, focus return, exact request target/body, and one submission.
- Request failure/retry, disabled pending controls, and acquiring/preparing/failed-preparation cancellation.
- 320px portrait and 844px short landscape: no horizontal overflow and no toast covering the modal heading.
- TypeScript check and staged frontend build passed.

Visual review was performed one screenshot at a time. Corrected nested Escape handling, the overly wide inherited modal width, small confirmation touch targets, and toast overlap on short landscape screens. Final captures and the frontend-only deployment report are in `.local/worker-confirmation-evidence/`. No backend restart, worker-image update, or paid GPU action is needed for this change.
