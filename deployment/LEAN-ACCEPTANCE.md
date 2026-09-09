# Lean deployment acceptance — 8 September 2026 (Chicago)

Deployed private template **Neil ComfyUI - H3 Krea Qwen** (`7522irqo4q`), running `bash /workspace/h3-deployment/lean-v1/start.sh`. The image, upstream runtime/template commits and bundled custom-node revisions are pinned. Existing login credentials were preserved; obsolete bootstrap/base64 and unused Basic-auth environment variables were removed.

Same-pod stop/start and a clean replacement were exercised against the existing 150 GB volume, with only one pod running at a time. No manual dependency repair was needed on the fresh container.

| Test | Pod | Execution time, including model loading | Result |
|---|---|---:|---|
| restart-qwen | uuwayipczbkwcd | 109.62 s | success |
| replacement-h3 | s1bsc8hbjh0vqx | 237.07 s | success |
| replacement-krea | s1bsc8hbjh0vqx | 77.30 s | success |
| replacement-qwen | s1bsc8hbjh0vqx | 113.43 s | success |

Times exclude queue waiting and provisioning. These are individual acceptance runs, not throughput estimates. Fresh container logs show start at 01:30:45 UTC and the upstream ready banner at 01:31:11, approximately 26 seconds; authenticated external readiness was checked later, so this is not an exact browser-ready benchmark.

Verified:

- Required H3, Krea Identity Edit and Phr00t Qwen nodes/models available.
- Anonymous page/API/output requests receive login responses; cookie sign-in grants API access. Authenticated WebSocket handshake and status message passed.
- Real H3, Krea edit and Qwen edit generation succeeded through the externally accessible authenticated API on the replacement.
- Outputs downloaded through the protected proxy; H3 ffprobe confirms 1344×768, 24 fps, 5.166667 seconds and an audio stream.
- 83 backed-up files match after replacement, including personal workflows and custom-node source. Changes were limited to logs and the upstream troubleshooting example.
- Startup logs report ten existing H3 model files skipped and an empty download manifest. Krea/Qwen assets were also present and used. No full model hash scan was performed; Qwen's earlier checksum verification remains skipped as requested.

Evidence: `lean-tests.json`, `lean-*-history.json`, `lean-persistence.json`, `lean-audit.json`, `lean/pins.json`, and downloaded media in `samples/lean/`.

Limits: generation tests use the API graphs, not browser clicks on Run. No cross-region migration, alternate GPU, fault-injection campaign or automated backup/idle-shutdown system was added. Upstream dependency installation is retained and is not a complete package lockfile. See `STATUS.md` for the final stopped state and `LEAN-SETUP.md` for operation and recovery.
