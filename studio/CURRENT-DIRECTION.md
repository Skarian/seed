# Current direction

Seed uses fal for Krea 2 Turbo images and standard MiniMax H3 videos. There is
one video quality path. No RunPod/Vast backend, worker image, model provisioning,
SSH tunnel, or Fast/H3 Max endpoint belongs in the application.

Keep local media, chat, approval, request editing, notes, repeat/branch, and job
history. Keep the API key server-side and make paid submissions durable without
blind retries. Import and select content-addressed adapters explicitly; separate
H3 FL and Ref variants and mark untested compatibility honestly.

The existing Krea LoKR and H3 FL/Ref adapters have passed live fal tests. H3
imports normalize the supported adapter naming without changing matrix values.
See VALIDATION.md for measured cost, latency and remaining quality review.
