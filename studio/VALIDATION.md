# Validation

The fal migration passes a production build, TypeScript checks, 204 unit/integration tests,
and all 21 current browser tests (configuration, LoRA persistence and mode
availability, 768P video, frame picking, chat editing, input previews, sequences,
and mobile layout). Secret scan: no matches. Package contents exclude retired GPU
modules, operations, workers, and private files. A fresh Windows package install,
setup, start/stop, reinstall, version upgrade, failed-start rollback, and restart
all passed while preserving credentials and media. Cold installation exposed a
six-second CLI startup timeout; it now allows 30 seconds and stops early if the
server exits.

Tests cover ambiguous paid submissions, local idempotency, restart reconciliation,
output-save recovery, cancellation, private upload headers/multipart, adapter
hashes/routes, weight-preserving conversion and rejected scaling, request mapping,
chat approvals, media handling, and local CLI lifecycle.
Frame tests decode real video locally, verify full-resolution pixels, preserve
Spicy classification and notes, and ensure repeat saves do not duplicate assets.
Browser fixtures exercise seeking and saving without submitting a generation.

Live application tests spent **$4.472578126**, below the authorized $5. Existing
Krea LoKR and converted H3 FL/Ref adapters succeeded; matching no-adapter H3 outputs
were saved. Both initial H3 naming rejections billed $0. Full videos decoded
successfully. See [measurements and provenance](../research/fal-acceptance.md).

The earlier base-model spike results remain as historical research. No test
claims fal uses BF16 or that successful adapter loading proves artistic quality.
Obsolete provider/browser fixtures and one-off agent evaluation scripts were
removed. Current browser tests run against an isolated database with live fal
operations disabled. They cannot spend model credits.

The worktree library, chats, and job history were cleared at the owner’s request
after the paid acceptance tests. Credentials, adapter masters and compatibility
evidence, and the private billing/timing ledger remain.

## Admin and pricing update

Additional offline checks cover current-price units, batch and reference-video
charges, stale/mismatched estimates, credential redaction and environment removal,
Civitai metadata/redirect authorization, real fixture weight acquisition, SHA-256
mismatch rejection, persisted upload retry, Chat LoRA descriptions/defaults,
estimate-bound approval, exhausted-credit queue pause and model failure handling.
Browser tests import and edit a Standard adapter, submit a simulated credit
rejection, and approve a Chat proposal with its named LoRA and displayed quote.
Desktop and 390px layouts are captured. No new paid requests were made for this
update. Live pricing reads use the existing regular fal key.

Manual Chrome QA used the real LAN app for Credentials, Standard catalog
filtering and current fal pricing, plus a separate offline profile for Chat and
Generate submissions. Chat's proposal was edited from one image to four, repriced,
approved and saved four fixture outputs. The review modal now keeps its cost
preview in the fixed footer beside approval controls. The live profile was copied
to standard per-user Seed directories without modifying the installed main app.
