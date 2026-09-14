# Independent final v5 settings review

Evidence: `.local/agent-eval-final-v5-stable`. All54 settings trials (18 scenarios ×3 repeats) individually compared by original edit instruction and complete before/after canonical request diff. Every edit changes exactly the requested fields and preserves prompt bytes, all reference instances/clips, note, other settings and identities. This is edit-preservation review, not a new full semantic score for the initial creative prompt.

54/54 edits pass on the first attempt. All54 final settings checks pass.53/54 whole trials pass without a create retry; settings-video-random-r1 required an initial-create repair, while its random-seed edit was correct first try. Each first saved request equals its phase final request.

| Trial | Edit correctness | Whole-trial first attempt | Exact changed top-level fields |
|---|---|---|---|
| settings-image-aspect-r1 | Pass | Pass | `{"output":[{"aspect":"16:9","size":"1mp"},{"aspect":"9:16","size":"1mp"}]}` |
| settings-image-aspect-r2 | Pass | Pass | `{"output":[{"aspect":"16:9","size":"1mp"},{"aspect":"9:16","size":"1mp"}]}` |
| settings-image-aspect-r3 | Pass | Pass | `{"output":[{"aspect":"16:9","size":"1mp"},{"aspect":"9:16","size":"1mp"}]}` |
| settings-image-combined-r1 | Pass | Pass | `{"seed":["42","99"],"count":[1,2]}` |
| settings-image-combined-r2 | Pass | Pass | `{"seed":["42","99"],"count":[1,2]}` |
| settings-image-combined-r3 | Pass | Pass | `{"seed":["42","99"],"count":[1,2]}` |
| settings-image-count-r1 | Pass | Pass | `{"count":[1,3]}` |
| settings-image-count-r2 | Pass | Pass | `{"count":[1,3]}` |
| settings-image-count-r3 | Pass | Pass | `{"count":[1,3]}` |
| settings-image-portrait-count-r1 | Pass | Pass | `{"output":[{"aspect":"16:9","size":"1mp"},{"aspect":"9:16","size":"1mp"}],"count":[1,2]}` |
| settings-image-portrait-count-r2 | Pass | Pass | `{"output":[{"aspect":"16:9","size":"1mp"},{"aspect":"9:16","size":"1mp"}],"count":[1,2]}` |
| settings-image-portrait-count-r3 | Pass | Pass | `{"output":[{"aspect":"16:9","size":"1mp"},{"aspect":"9:16","size":"1mp"}],"count":[1,2]}` |
| settings-image-random-r1 | Pass | Pass | `{"seed":["42","random"]}` |
| settings-image-random-r2 | Pass | Pass | `{"seed":["42","random"]}` |
| settings-image-random-r3 | Pass | Pass | `{"seed":["42","random"]}` |
| settings-image-seed-r1 | Pass | Pass | `{"seed":["42","876"]}` |
| settings-image-seed-r2 | Pass | Pass | `{"seed":["42","876"]}` |
| settings-image-seed-r3 | Pass | Pass | `{"seed":["42","876"]}` |
| settings-mixed-aspect-r1 | Pass | Pass | `{"output":[{"aspect":"16:9","size":"native","duration_seconds":5,"format":"video"},{"aspect":"9:16","size":"native","duration_seconds":5,"format":"video"}]}` |
| settings-mixed-aspect-r2 | Pass | Pass | `{"output":[{"aspect":"16:9","size":"native","duration_seconds":5,"format":"video"},{"aspect":"9:16","size":"native","duration_seconds":5,"format":"video"}]}` |
| settings-mixed-aspect-r3 | Pass | Pass | `{"output":[{"aspect":"16:9","size":"native","duration_seconds":5,"format":"video"},{"aspect":"9:16","size":"native","duration_seconds":5,"format":"video"}]}` |
| settings-mixed-combined-r1 | Pass | Pass | `{"count":[1,2],"seed":["42","99"]}` |
| settings-mixed-combined-r2 | Pass | Pass | `{"count":[1,2],"seed":["42","99"]}` |
| settings-mixed-combined-r3 | Pass | Pass | `{"count":[1,2],"seed":["42","99"]}` |
| settings-mixed-count-r1 | Pass | Pass | `{"count":[1,3]}` |
| settings-mixed-count-r2 | Pass | Pass | `{"count":[1,3]}` |
| settings-mixed-count-r3 | Pass | Pass | `{"count":[1,3]}` |
| settings-mixed-portrait-count-r1 | Pass | Pass | `{"count":[1,2],"output":[{"aspect":"16:9","size":"native","duration_seconds":5,"format":"video"},{"aspect":"9:16","size":"native","duration_seconds":5,"format":"video"}]}` |
| settings-mixed-portrait-count-r2 | Pass | Pass | `{"count":[1,2],"output":[{"aspect":"16:9","size":"native","duration_seconds":5,"format":"video"},{"aspect":"9:16","size":"native","duration_seconds":5,"format":"video"}]}` |
| settings-mixed-portrait-count-r3 | Pass | Pass | `{"count":[1,2],"output":[{"aspect":"16:9","size":"native","duration_seconds":5,"format":"video"},{"aspect":"9:16","size":"native","duration_seconds":5,"format":"video"}]}` |
| settings-mixed-random-r1 | Pass | Pass | `{"seed":["42","random"]}` |
| settings-mixed-random-r2 | Pass | Pass | `{"seed":["42","random"]}` |
| settings-mixed-random-r3 | Pass | Pass | `{"seed":["42","random"]}` |
| settings-mixed-seed-r1 | Pass | Pass | `{"seed":["42","876"]}` |
| settings-mixed-seed-r2 | Pass | Pass | `{"seed":["42","876"]}` |
| settings-mixed-seed-r3 | Pass | Pass | `{"seed":["42","876"]}` |
| settings-video-aspect-r1 | Pass | Pass | `{"output":[{"aspect":"16:9","size":"native","duration_seconds":5,"format":"video"},{"aspect":"9:16","size":"native","duration_seconds":5,"format":"video"}]}` |
| settings-video-aspect-r2 | Pass | Pass | `{"output":[{"aspect":"16:9","size":"native","duration_seconds":5,"format":"video"},{"aspect":"9:16","size":"native","duration_seconds":5,"format":"video"}]}` |
| settings-video-aspect-r3 | Pass | Pass | `{"output":[{"aspect":"16:9","size":"native","duration_seconds":5,"format":"video"},{"aspect":"9:16","size":"native","duration_seconds":5,"format":"video"}]}` |
| settings-video-combined-r1 | Pass | Pass | `{"count":[1,2],"seed":["42","99"]}` |
| settings-video-combined-r2 | Pass | Pass | `{"count":[1,2],"seed":["42","99"]}` |
| settings-video-combined-r3 | Pass | Pass | `{"count":[1,2],"seed":["42","99"]}` |
| settings-video-count-r1 | Pass | Pass | `{"count":[1,3]}` |
| settings-video-count-r2 | Pass | Pass | `{"count":[1,3]}` |
| settings-video-count-r3 | Pass | Pass | `{"count":[1,3]}` |
| settings-video-portrait-count-r1 | Pass | Pass | `{"count":[1,2],"output":[{"aspect":"16:9","size":"native","duration_seconds":5,"format":"video"},{"aspect":"9:16","size":"native","duration_seconds":5,"format":"video"}]}` |
| settings-video-portrait-count-r2 | Pass | Pass | `{"count":[1,2],"output":[{"aspect":"16:9","size":"native","duration_seconds":5,"format":"video"},{"aspect":"9:16","size":"native","duration_seconds":5,"format":"video"}]}` |
| settings-video-portrait-count-r3 | Pass | Pass | `{"count":[1,2],"output":[{"aspect":"16:9","size":"native","duration_seconds":5,"format":"video"},{"aspect":"9:16","size":"native","duration_seconds":5,"format":"video"}]}` |
| settings-video-random-r1 | Pass | Create retry | `{"seed":["42","random"]}` |
| settings-video-random-r2 | Pass | Pass | `{"seed":["42","random"]}` |
| settings-video-random-r3 | Pass | Pass | `{"seed":["42","random"]}` |
| settings-video-seed-r1 | Pass | Pass | `{"seed":["42","876"]}` |
| settings-video-seed-r2 | Pass | Pass | `{"seed":["42","876"]}` |
| settings-video-seed-r3 | Pass | Pass | `{"seed":["42","876"]}` |
