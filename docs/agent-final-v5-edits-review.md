# Independent final v5 prompt/input edit review

Evidence: `.local/agent-eval-final-v5-stable`. Scope:54 prompt revisions and36 input/label edits across3 repetitions. Compare actual follow-up with before/after prompts, all settings and input-instance ownership. Initial scene quality is not automatically rescored as full intent preservation when a narrow edit correctly inherits its existing content.

Reviewed90/90.80 narrow-edit passes;2 prompt-timing failures;8 uncertainties (6 guide-priority conflicts and2 source-trajectory/composition cases). All90 structural tool/settings trials pass with no retries across180 create/edit phases. No source changes during frozen run.

The six bookend closer-camera/background cases keep exact endpoint images but request changed framing or trees. Those guide images have plain backgrounds and fixed compositions. Correct input preservation cannot establish simultaneous visual compliance; these need explicit user priority or middle-shot-only edits returning to original endpoint. They are not semantic passes.

| Case | Verdict | Evidence |
|---|---|---|
| revisions-image-warm-r1 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-warm-r2 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-warm-r3 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-close-r1 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-close-r2 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-close-r3 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-blue-r1 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-blue-r2 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-blue-r3 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-slow-r1 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-slow-r2 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-slow-r3 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-background-r1 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-background-r2 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-background-r3 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-remove-detail-r1 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-remove-detail-r2 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-image-remove-detail-r3 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-bookends-warm-r1 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-bookends-warm-r2 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-bookends-warm-r3 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-bookends-close-r1 | uncertain | Closer camera conflicts with unchanged exact endpoint image; requires clarification of framing vs guide priority. |
| revisions-bookends-close-r2 | uncertain | Closer camera conflicts with unchanged exact endpoint image; requires clarification of framing vs guide priority. |
| revisions-bookends-close-r3 | uncertain | Closer camera conflicts with unchanged exact endpoint image; requires clarification of framing vs guide priority. |
| revisions-bookends-blue-r1 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-bookends-blue-r2 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-bookends-blue-r3 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-bookends-slow-r1 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-bookends-slow-r2 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-bookends-slow-r3 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-bookends-background-r1 | uncertain | Trees added despite exact plain-background bookend guides. Reference preservation is correct, visual priority needs clarification. |
| revisions-bookends-background-r2 | uncertain | Trees added despite exact plain-background bookend guides. Reference preservation is correct, visual priority needs clarification. |
| revisions-bookends-background-r3 | uncertain | Trees added despite exact plain-background bookend guides. Reference preservation is correct, visual priority needs clarification. |
| revisions-bookends-remove-detail-r1 | pass | Only requested lighting/camera/clear-air edit; input identities, clips and settings unchanged. |
| revisions-bookends-remove-detail-r2 | pass | Requested prompt edit only; all inputs and settings unchanged. |
| revisions-bookends-remove-detail-r3 | pass | Only requested lighting/camera/clear-air edit; input identities, clips and settings unchanged. |
| revisions-mixed-warm-r1 | pass | Only requested lighting/camera/clear-air edit; input identities, clips and settings unchanged. |
| revisions-mixed-warm-r2 | pass | Only requested lighting/camera/clear-air edit; input identities, clips and settings unchanged. |
| revisions-mixed-warm-r3 | pass | Only requested lighting/camera/clear-air edit; input identities, clips and settings unchanged. |
| revisions-mixed-close-r1 | pass | Only requested lighting/camera/clear-air edit; input identities, clips and settings unchanged. |
| revisions-mixed-close-r2 | pass | Only requested scene/camera/light/speed edit. All settings and instance inputs unchanged; existing silent-output prompt contradictions are outside narrow edit scope. |
| revisions-mixed-close-r3 | pass | Only requested scene/camera/light/speed edit. All settings and instance inputs unchanged; existing silent-output prompt contradictions are outside narrow edit scope. |
| revisions-mixed-blue-r1 | pass | Only requested scene/camera/light/speed edit. All settings and instance inputs unchanged; existing silent-output prompt contradictions are outside narrow edit scope. |
| revisions-mixed-blue-r2 | pass | Only requested scene/camera/light/speed edit. All settings and instance inputs unchanged; existing silent-output prompt contradictions are outside narrow edit scope. |
| revisions-mixed-blue-r3 | pass | Only requested scene/camera/light/speed edit. All settings and instance inputs unchanged; existing silent-output prompt contradictions are outside narrow edit scope. |
| revisions-mixed-slow-r1 | pass | Only requested scene/camera/light/speed edit. All settings and instance inputs unchanged; existing silent-output prompt contradictions are outside narrow edit scope. |
| revisions-mixed-slow-r2 | pass | Only requested scene/camera/light/speed edit. All settings and instance inputs unchanged; existing silent-output prompt contradictions are outside narrow edit scope. |
| revisions-mixed-slow-r3 | pass | Only requested scene/camera/light/speed edit. All settings and instance inputs unchanged; existing silent-output prompt contradictions are outside narrow edit scope. |
| revisions-mixed-background-r1 | pass | Only requested scene/camera/light/speed edit. All settings and instance inputs unchanged; existing silent-output prompt contradictions are outside narrow edit scope. |
| revisions-mixed-background-r2 | pass | Adds distant trees only, preserving subject motion, settings and all references. |
| revisions-mixed-background-r3 | pass | Adds distant trees only, preserving subject motion, settings and all references. |
| revisions-mixed-remove-detail-r1 | pass | Adds clear air only; all other prompt, inputs and settings retained. |
| revisions-mixed-remove-detail-r2 | pass | Adds clear air only; all other prompt, inputs and settings retained. |
| revisions-mixed-remove-detail-r3 | pass | Adds clear air only; all other prompt, inputs and settings retained. |
| labels-reorder-images-sfw-r1 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-reorder-images-sfw-r2 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-reorder-images-sfw-r3 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-remove-scene-sfw-r1 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-remove-scene-sfw-r2 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-remove-scene-sfw-r3 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-disable-soundtrack-sfw-r1 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-disable-soundtrack-sfw-r2 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-disable-soundtrack-sfw-r3 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-remove-standalone-audio-sfw-r1 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-remove-standalone-audio-sfw-r2 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-remove-standalone-audio-sfw-r3 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-first-frame-plus-motion-sfw-r1 | fail | Unrequested timing drift: prior motion begins at1s, edit makes it immediate; guide identity/settings remain correct. |
| labels-first-frame-plus-motion-sfw-r2 | uncertain | Adds a specific corner-to-corner trajectory while opening guide is centered. Exact direction/source-motion fidelity and departure composition require verification; structural bindings are correct. |
| labels-first-frame-plus-motion-sfw-r3 | pass | Opening guide remains unnumbered, Video1 motion retained, input identities and settings unchanged. |
| labels-closing-only-sfw-r1 | pass | Opening input removed; ending guide retained without numbered Picture label. Departure may be rewritten abstractly; request does not explicitly preserve departing subject. |
| labels-closing-only-sfw-r2 | pass | Opening input removed; ending guide retained without numbered Picture label. Departure may be rewritten abstractly; request does not explicitly preserve departing subject. |
| labels-closing-only-sfw-r3 | pass | Opening input removed; ending guide retained without numbered Picture label. Departure may be rewritten abstractly; request does not explicitly preserve departing subject. |
| labels-reorder-images-nsfw-r1 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-reorder-images-nsfw-r2 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-reorder-images-nsfw-r3 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-remove-scene-nsfw-r1 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-remove-scene-nsfw-r2 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-remove-scene-nsfw-r3 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-disable-soundtrack-nsfw-r1 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-disable-soundtrack-nsfw-r2 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-disable-soundtrack-nsfw-r3 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-remove-standalone-audio-nsfw-r1 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-remove-standalone-audio-nsfw-r2 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-remove-standalone-audio-nsfw-r3 | pass | Correct requested input removal/reorder/audio toggle; identities, remaining clips/settings and provider bindings preserved. |
| labels-first-frame-plus-motion-nsfw-r1 | uncertain | Adds a specific corner-to-corner trajectory while opening guide is centered. Exact direction/source-motion fidelity and departure composition require verification; structural bindings are correct. |
| labels-first-frame-plus-motion-nsfw-r2 | pass | Opening guide remains unnumbered, Video1 motion retained, input identities and settings unchanged. |
| labels-first-frame-plus-motion-nsfw-r3 | fail | Unrequested timing drift: prior initial hold for a fraction of second removed. Also adds specific bottom-left/top-right source trajectory not established by this review. |
| labels-closing-only-nsfw-r1 | pass | Opening input removed; ending guide retained without numbered Picture label. Departure may be rewritten abstractly; request does not explicitly preserve departing subject. |
| labels-closing-only-nsfw-r2 | pass | Opening input removed; ending guide retained without numbered Picture label. Departure may be rewritten abstractly; request does not explicitly preserve departing subject. |
| labels-closing-only-nsfw-r3 | pass | Opening input removed; ending guide retained without numbered Picture label. Departure may be rewritten abstractly; request does not explicitly preserve departing subject. |


The two label prompt failures concern preservation of existing timing without an explicit user request to change it: SFW first-frame-plus-motion r1 changes motion onset from1s to immediate, and NSFW r3 removes a brief initial hold. If this fixture intends a complete temporal rewrite, that must be stated; this review applies the default narrow-edit preservation expectation.

Two further first-frame/motion edits specify corner-to-corner paths despite a centered exact opening guide, with opposite directions between repetitions. They are uncertain rather than declared factually wrong without a full source trajectory measurement. All36 label cases retain correct input identity, clips, roles, soundtrack flags, remaining settings, and compiled numbering. Provider acceptance does not resolve visual ambiguity.

Closing-only revisions sometimes retain the departing sphere, sometimes replace it with abstract forms. These are narrow passes because the request explicitly removes the opening frame and asks to describe arrival at the ending frame; it does not specify preserving the departing narrative subject. To test that stronger requirement, state it explicitly.

Preexisting silent-output contradictions remain in some mixed initial prompts (e.g. mixed-background-r1/r2, mixed-blue-r1/r3, mixed-close-r2, mixed-remove-detail-r2, standalone-audio removal SFWr3 and NSFWr2): their soundscape specifies audible tones despite output audio silent. A correct narrow edit retaining such text is not a full initial-scene semantic pass. Raw trial data remains authoritative.
