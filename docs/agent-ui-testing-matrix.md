# Browser reference acceptance matrix

The frozen cases are in `scripts/agent-ui-cases.mjs`: 25 actual user sends, comprising 20 initial requests and five follow-up edits. Eighteen messages use real composer `@` picker selections; seven use ordinary descriptions only. Each conversation has at least two supplied assets. Follow-ups reuse the parent conversation and existing inputs rather than uploading duplicate files.

The fixtures include licensed real photographs of two people, a dog and a cafe; a six-second motion-study video and a six-second tone supply bounded clip/audio tests. The cafe uses the clean v2 download. These test the agent's submitted generation request, not GPU render quality. Explicit story exclusions are individual user requirements, not application restrictions.

| Case | Reference interaction | Required behavior |
| --- | --- | --- |
| 01 | Three image mentions | Distinct people, location, dialogue windows and ownership |
| 02 | Mentions differ from upload order | Identity stays correct regardless of attachment order |
| 03 | Dog and location mentions | Source identity, gaze sequence and silent output |
| 04 | Image and video mentions | Correct source range; video audio off |
| 05 | One video mentioned for two clips | Separate instances and ranges from one asset |
| 06 | Image, room and audio mentions | Alert source versus spoken voice |
| 07 | Image, video and audio mentions | Video soundtrack distinct from separate alert |
| 08 | Mention plus plain image description | All three sources retained and correctly assigned |
| 09 | Image and video mentions | Silent output, saved seed and batch |
| 10 | Two image mentions | Opening and ending guides, no general references |
| 11 | Opening image plus room mention | Opening guide distinct from general reference |
| 12 | Three subject mentions | Screen positions, dialogue and animal identity |
| 13 | Repeated mentions | No duplicate inputs from repeated text references |
| 14 | Mention plus plain audio description | Unmentioned supplied audio still usable |
| 15 | Four mixed-media mentions | Independent media ranges, roles and speech |
| 16 | Plain portrait descriptions | Correct identity and speakers without mentions |
| 17 | Plain dog and room descriptions | Distinct source purposes and action timing |
| 18 | Plain image and video descriptions | Clip selection and prop ownership |
| 19 | Plain image and audio descriptions | Tone reference and spoken dialogue remain distinct |
| 20 | Plain three-input description | Batch, note, muted source and silent output |
| 21 | Mention edit of 01 | Only the man's dialogue changes |
| 22 | Mention edit of 05 | Only second video instance enables source audio |
| 23 | Mention edit of 09 | Only image framing changes |
| 24 | Plain edit of 16 | Only man's reply changes |
| 25 | Plain edit of 20 | Only batch and seed change |

For every send, verify that the browser history contains the same text and reference selections the user entered; supplied files remain visible; request input identities agree with the mentions; clicking input previews shows the corresponding assets; and any displayed generation labels resolve to those same identities. Inspect the actual tool arguments and saved request against the case rubric. Separate first-attempt acceptance, retries, final acceptance and semantic correctness. A saved request alone is not a semantic pass. A failure must remain in the report even if a later corrected run succeeds.
