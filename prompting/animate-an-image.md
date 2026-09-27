Write the generation prompt for the actual inputs and the user's request. This guide applies only to the tool's prompt field. It does not prevent tool calls or questions. Use English descriptions; preserve the original language of dialogue and visible text. Fit the scene to the requested duration.

Choose the format from the input roles, not the workflow name:

1. If any input has role reference, use the full-reference format below. This includes a single reference image. Do not add the starting-image preamble.
2. If all inputs are first_frame or last_frame images, use the frame-guide format below. A video cannot be a first or last frame.

Full-reference format:
Use six fields: subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, non_diegetic_music.
Define reusable people, objects, scenes, or motion as <Subject N>, citing the supplied input labels. Subjects are not file numbers. One subject may use several inputs.
Summarize the task and reference roles. State what to keep, change, copy, or borrow. Describe the resulting shots in detailed_description, with style before [Shot 1]. Aim for 350-500 words when the scene needs that detail; preserve requested dialogue rather than padding.
Use supplied Picture labels for frame anchors and Video labels for source structure. Cite Audio labels only for enabled audio inputs. Say whether sound is copied or only guides the voice or style.

Frame-guide format:
Use integrated_multimodal_description, overall_soundscape, non_diegetic_music.
If the supplied first-frame label is <Picture 1>, begin with this line and a blank line:
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
Start from the opening image when present. Describe how the scene reaches an ending image when present. An ending guide without a prompt label is described as the ending frame; never invent a Picture label for it.

In either format, copy input labels from the application context. Do not guess numbers from chat message labels. If stable input tokens are supplied instead, copy those tokens; the application converts them to model labels. Never use a prompt label as an input ID.

Begin the timeline with [Shot 1], untimed. Subsequent cuts: [Shot 2] At 00:03.500, the camera cuts to ...; times must increase within duration. Describe composition, action, lighting, and camera movement, adding amplitude/speed where useful. For frame-guide prompts, establish style at the start of [Shot 1].

Give speakers stable (S1), (S2) IDs and reuse them across shots. In full-reference prompts, the speaker number must match its Subject number: <Subject 2> speaks as (S2). For subjects that do not speak, use their <Subject N> name throughout; do not add an S-number. Write dialogue as: The woman (S1) says: <d>[English] Exact words.</d>. Use the actual language tag and preserve the requested words. Keep voice description and delivery outside tags. For voiceover use says in an off-screen voiceover and specify the corresponding on-screen character's closed lips afterward. Mark speech crossing cuts with <scenetrans> in both parts and describe uninterrupted audio; ending interruptions use <cutoff>. Quote visible text.

Place synchronized sounds and in-scene music in the timeline. overall_soundscape summarizes ambience/physical sounds; N/A only for explicitly requested total silence. non_diegetic_music describes audience-only instrumentation, tempo, and dynamics, or N/A for no score. Keep dialogue out of both sound summaries.

Before saving, check the user's request line by line:
- Copy each requested exclusion into detailed_description (or integrated_multimodal_description). For example, if the user says "no subtitles, no extra people", include those exact restrictions. Do not rely on silence or missing dialogue to mean no subtitles. Only include restrictions the user requested.
- Keep camera changes in the requested order. "Start locked, then push in" needs a still period before movement; do not start pushing at time zero.
- Keep the requested camera movement: a pull-back moves the camera, while a zoom changes the lens. Do not replace one with the other or describe them as synonyms.
- Keep sound priorities, such as ambience quieter than speech, in overall_soundscape.
- Describe only visible details you can identify. If a hairstyle or small object is unclear, preserve it from the reference without inventing a more specific description.
- For an edit, keep all earlier scene requirements unless the user changes them. Change only the requested parts.
