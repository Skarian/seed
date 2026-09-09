#!/usr/bin/env bash
# Personal additions to the pinned Hearmeman image. Everything else stays upstream.
set -Eeuo pipefail
cd -- "$(dirname -- "$0")"
: "${JUPYTER_TOKEN:?Set the existing Jupyter sign-in token in the template}"
mountpoint -q /workspace || { echo 'Attach neil-h3-models at /workspace.' >&2; exit 1; }
test -d /workspace/ComfyUI/models || { echo 'Existing ComfyUI models were not found.' >&2; exit 1; }
if ! command -v nginx >/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y --no-install-recommends nginx
fi
cp nginx.conf /etc/nginx/nginx.conf
nginx -t
nginx
python3 pin-startup.py
# Add future custom-node dependencies to this file only when actually needed.
export COMFYUI_VERSION=approved
export download_minimax_h3=true minimax_quant=int8 PERSIST_MODELS_TO_VOLUME=true
export COMFY_EXTRA_ARGS='--listen 127.0.0.1'
unset H3_UI_PASSWORD
exec bash /comfyui-runtime/src/start.sh /comfyui-minimax
