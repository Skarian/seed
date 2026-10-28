# User privacy

The user forbids agents from inspecting their generated or uploaded images and
their prompt text. This restriction applies to debugging, verification, browser
previews, logs, API responses, and delegated work. Do not open image files or
image previews, display prompt text, or request either from another agent.

Use metadata only: job IDs and states, timing and resource measurements, download
progress, hashes, sizes, and technical errors that do not contain prompt text.
Prefer endpoints and diagnostic exports that omit private content at the source.
Do not inspect raw user job snapshots or raw logs that may include prompts.
Tests may use agent-authored synthetic fixtures that contain no user content.
