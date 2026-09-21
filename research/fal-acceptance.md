# fal application acceptance — 2026-09-20

All jobs were submitted through the actual local application API in the isolated
fal worktree, with an explicit $5 authorization. Total billed: **$4.472578126**.
Six successful generations; two initial H3 adapter-format failures billed $0.
No further paid tests are pending.

## Measured results

Videos: standard H3, 15 seconds, 768P landscape, generated audio, seed 424242,
prompt expansion disabled. The reference route used a real portrait, a real
three-second cafe video with its soundtrack, and a separate three-second audio
file extracted from that same source recording. This is three user assets and
four provider files, including the extracted video soundtrack. The frame route
used the same portrait as its opening guide. LoRA strength 1.

Images: Krea 2 Turbo LoRA endpoint, 1280×720, seed 424242, PNG, acceleration none,
prompt expansion disabled, existing LoKR strength 1. Ordinary cafe prompts;
safety checker enabled for every test. This does not establish account-specific
NSFW permissions or explicit-content behavior.

| Test | Actual charge | Local wait + input setup (s) | fal inference_time (s) | Observed download/save (s) | End to end (s) |
|---|---:|---:|---:|---:|---:|
| H3 image-to-video + converted FL LoRA | $1.125000 | 1.15 | 38.61 | 2.97 | 43.83 |
| H3 three references + converted Ref LoRA | $1.350000 | 1.29 | 45.83 | 2.77 | 51.16 |
| Krea + original LoKR, first run | $0.008789 | 2.07 | 95.24 | 0.92 | 99.08 |
| H3 image-to-video, no adapter | $0.900000 | 0.56 | 229.18 | 1.30 | 232.61 |
| H3 three references, no adapter | $1.080000 | 74.83 | 28.84 | 2.61 | 106.95 |
| Krea + original LoKR, repeat | $0.008789 | 1.44 | 3.17 | 0.53 | 5.79 |

Local wait includes the dispatcher schedule and the two-active-request limit.
The reference baseline waited roughly 74 seconds behind other local jobs; its
fal inference metric was 28.84 seconds. Polling adds up to about two seconds of
observation error, so the columns are not an exact stage accounting identity.
fal's inference metric does not expose GPU initialization/denoising/decode splits.
The long frame baseline demonstrates latency variability, not a LoRA speedup.
These are individual observations, not a latency percentile benchmark.

The adapter files were preloaded. Private uploads took 782.579 seconds for the
1.56 GB Krea LoKR; converted H3 FL and Ref uploads took 74.032 and 66.064 seconds.
Those one-time transfer durations are excluded from generation times. Subsequent
requests reused private URLs and only renewed read signatures. The first Krea
request was much slower than its repeat; the API does not identify the precise
cause, so warm adapter caching is a plausible explanation, not a proven breakdown.

## Adapter compatibility

The original H3 files used ComfyUI/Kohya lora_down/lora_up names and scalar alpha
tensors. fal rejected those names. The app now imports the known H3 block
attention/MLP layout into reference lora_A/lora_B names, with alpha required to
match rank. Every matrix byte, dtype and shape is preserved; no quantization.
The original master remains on local disk. Unknown mappings/scaling fail locally.

| Variant | Original SHA-256 | Uploaded SHA-256 |
|---|---|---|
| Krea LoKR | 767888edde83003f14cf930f13f174fe2a7431e252a515ddf04bd93d382a8932 | unchanged |
| H3 FL | fc3e856d14c6c19557c888f48662d591e4794e281233ec0d987be5003068afba | 55dece6006bcb8b9ea26c179a59eb9632363330b2b03ce3300eb8bd44cc67d53 |
| H3 Ref | 106243744bb11cf962d66a92fd837f9744431ecdf2d4ebd63ff5385afec11b59 | f55b12af8c42ac247944e21da7191557988589f768058d4912ba35506b157027 |

All three files completed real generations and are recorded as tested in the
worktree catalog. That establishes API acceptance and output production, not a
general claim about arbitrary adapters or artistic fidelity. Samples were
visually inspected and all four video files fully decoded without errors.
Audio quality, temporal consistency and preferred LoRA strengths need owner
review. Provider precision and equivalence to self-hosted BF16 are unverified.

Private CDN validation: anonymous GET returned 403; a signed GET returned 200
with identical content. Upload ACL is checked by the app. Credentials, signed
URLs, billing responses and original prompts remain in ignored local files.

## Local evidence

Private ledger, billing events and stage summaries: .local/fal-acceptance/.
The worktree’s library, chats, jobs, and media were subsequently deleted at the
owner’s explicit request for the fal migration. The output names below are
historical provenance; the generated files are no longer in the worktree library.
The measurement ledger, billing events, credentials, and three LoRA masters remain.

| Test | fal request ID | Local output basename |
|---|---|---|
| H3 image-to-video + converted FL LoRA | 01a0c069-a909-71d2-b74d-94e7373af59f | 32c34c50-3982-45d0-b086-b48ad26a4bbb-0.mp4 |
| H3 three references + converted Ref LoRA | 01a0c069-ab18-7312-96af-51802814acab | 490a44cb-2da0-4731-be9d-dc89f7502afb-0.mp4 |
| Krea + original LoKR, first run | 01a0c06f-3c60-7202-bc9d-fc10724337bd | 67729710-87f1-4664-9f79-6b733c98c94d-0.png |
| H3 image-to-video, no adapter | 01a0c06f-99b8-7801-a8d6-58d678c8df49 | 0fc81690-2a8e-41ca-89e4-82b385f02fb7-0.mp4 |
| H3 three references, no adapter | 01a0c070-bd77-79a0-85ed-71bd33dc6ecd | 0370fcc1-cf7a-4d52-8a76-6b9b8b52ec07-0.mp4 |
| Krea + original LoKR, repeat | 01a0c072-5bb0-78e2-856c-571dd3c33c93 | 7477140b-4d88-4c5a-b9d5-be1a23adc684-0.png |

## Sources for the integration

- [fal private files and signed access](https://fal.ai/docs/documentation/model-apis/file-access-controls)
- [fal queue API](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [MiniMaxAI reference H3 adapter loader](https://huggingface.co/spaces/MiniMaxAI/MiniMax-H3-Turbo-Lora/blob/d8b48ff8e51e032036577583a43fb6dd66ef96c5/h3_lora.py)

Measured prices above come from this account's fal billing events for the listed
request IDs, rather than extrapolating from a model card's base-resolution price.
