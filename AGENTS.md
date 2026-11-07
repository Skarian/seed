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

## Synthetic test instances are exempt

Instances that agents start with `npm run user-test`, `npm run test:user`,
`npm run test:browser` or the visual atlas use a fresh isolated profile under
`.local/`. They hold only agent-written synthetic prompts and fixture media, never
user content. Agents may capture, open and inspect screenshots, browser previews,
images, prompts and API responses from those instances, including in delegated
work. The rules above still apply to every other Seed profile.
