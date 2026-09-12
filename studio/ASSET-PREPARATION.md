# Media handling

Permanent originals, prepared derivatives and saved results live on the PC.
The browser checks supported kinds, decodeability, reference counts and ranges
before transfer. Avoid arbitrary image-resolution or byte caps; real free disk and
model conditioning budgets still constrain requests. Server validation remains
necessary for corrupt/untrusted files and integrity, despite browser checks.

## UI and uploads

Uploads and Library selection share thumbnail trays and the reusable
web/media-preview.tsx overlay. Metadata and limits sit behind Info. Preview offers
download, confirmed deletion and supported role/range controls. Desktop/mobile
layout has owner acceptance. A media selection is not ready until upload and
server preparation finish; jobs use asset IDs, never transient browser object URLs.

Tus uploads stream to PC disk with resumable offsets. Completed originals are
probed with sharp/FFmpeg/ffprobe, assigned canonical media types and prepared as
needed. Partial uploads expire separately from completed Library assets. Preserve
originals; orientation fixes, resizing and clip conversion create derivatives.

## Model inputs

Role/count/range validation and native conditioning limits live in shared media
rules and server/media.ts/server/video.ts. Reference-to-video supports image,
video and audio. First/last anchors are distinct from general references. Paired
video audio consumes audio conditioning capacity. Do not silently drop media,
change roles, loop audio or reduce requested output to make a request pass.

Reference videos are prepared on the native 17k+5 frame grid. The preview exposes
the effective range rather than promising all selected source frames are used.
Transfer only job-required derivatives under generated names. Prepared hashes,
ranges and roles are frozen with the job. Long/max-count combinations still need
live capacity and visual-influence validation.

## Results and deletion

Use authenticated streaming and Range playback. Download/verify results to local
disk and persist database records before acknowledging worker cleanup. Retrying
receipt must not duplicate Library entries. Destroying a disposable worker loses
anything not yet saved locally; neither provider offers recovery after deletion.

Library and generated-result deletion ask confirmation. Job history is retained.
A cleanup error after durable saving is distinct from an unsaved result. The PC's
persistent Library is not a backup; back up media and a consistent SQLite snapshot
using the owner's chosen backup system.
