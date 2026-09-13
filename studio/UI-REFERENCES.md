# Chat UI reference study — September 13, 2026

Reviewed the public source of [Open WebUI MessageInput](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/MessageInput.svelte), [Chat](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/Chat.svelte), and [T3 Code Sidebar](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/Sidebar.tsx). Also read the [official Codex app overview](https://openai.com/index/introducing-the-codex-app/); this was public product material, not inspection of private desktop source or the current app screen.

Open WebUI separates its input surface from the transcript, constrains reading width, and keeps secondary controls compact. Its composer uses a 58rem maximum width and small action controls, with suggestion rendering anchored to input. T3 Code uses shared row treatment, muted secondary text, and selection/hover backgrounds rather than treating every row as an elevated card.

Seed adaptations, implemented independently:

- Compact 244px sidebar, restrained 13px navigation rows and reduced header height.
- 768px conversation reading width and 800px composer maximum, with calmer surfaces.
- Remove the workflow select completely. A slash token at the caret opens a filtered list above the composer. Click, Enter or Tab activates; arrows navigate and Escape dismisses.
- Selection removes the command token while preserving surrounding draft text. One active workflow remains enabled until changed or removed with the compact label.
- Sending an incomplete command selects its highlighted workflow rather than sending a model message. Unknown commands display feedback.

QA: full 34-case browser suite passed after spacing/menu changes. Additional Chat checks cover activation without sending, filtered results, click/keyboard navigation, dismissal, unknown commands, and composer Send behavior. Desktop/mobile slash-menu screenshots were inspected. No model calls or GPU jobs were submitted during this work.
