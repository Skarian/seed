# Deferred studio LLM choices

Recorded 9 September 2026. Current MVP: media generation with direct controls.
No LLM pod, chat, Pi runtime or automatic prompt writer is required to ship it.

| Candidate | Proposed later role | Earlier research status |
|---|---|---|
| `llmfan46/gemma-4-31B-it-uncensored-heretic` | Director: reasoning, scripts, tools, image/video review | UGI snapshot: #8 thinking, 64.99; #63 non-thinking, 53.82 |
| `llmfan46/gemma-4-12B-it-uncensored-heretic` | Joint video/audio reviewer; first single-model trial | Not listed in the inspected UGI snapshot |
| `huihui-ai/Huihui-Qwen3-Omni-30B-A3B-Thinking-abliterated` | Alternate audiovisual reviewer | Fallback if Gemma 12B fails acceptance |

These are research candidates, not verified running services. No inference
acceptance tests have run here. Rankings are a dated snapshot. Preserve exact
processor, vision/audio components, chat template, quantization and serving-engine
requirements; parent-model benchmarks do not verify modified checkpoints.

[Full decision and evidence](MODEL-DECISION.md).
[Historical comparisons](SELECTION.md).

The media API will retain assets and exact settings so these models can invoke
the same actions later without replacing the generation system.
