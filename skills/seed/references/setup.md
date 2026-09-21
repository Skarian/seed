# Setup

Use Node 26.8.2+ within the 26.x line. Check `node --version` and `seed help`.
The package is not published to npm; use the project's built package archive,
not the unrelated unscoped `seed` package. Run `npm ci` and `npm pack` to build it.
Installation scripts are needed for FFmpeg dependencies.

Run `seed setup` to configure FAL_KEY and the optional chat key. Use a masked
prompt or a local ignored .env file; never print the key. Setup can read FAL_KEY
from the environment or local .env. `node --env-file=.env.fal ...` also works.
No other generation-provider credentials or model downloads are needed.

`seed start` returns the app URL. `seed status` reports its local process;
`seed stop` stops it. Closing a browser tab does not cancel fal requests.

Import adapters using `seed loras add FILE image|fl|ref NAME` and inspect them
with `seed loras list`. Selecting one in a generation uploads a private copy to
fal, unless a reusable copy is already recorded. `seed loras upload ID` preloads
it. Keep local masters: remote retention is finite.

For an isolated development instance, set STUDIO_DEV_ROOT and choose a free port
with `seed setup --port PORT`. Preserve all existing media and history when
installing or upgrading. Editable chat prompts live in the config directory.
