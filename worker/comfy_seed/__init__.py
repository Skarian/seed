"""Small ComfyUI hook: identity belongs to this engine process, not the proxy."""
import json
import math
import os
import sys
import uuid
from pathlib import Path
from aiohttp import web
from server import PromptServer

ENGINE_SESSION_ID = str(uuid.uuid4())
WORKSPACE_ID = json.loads((Path(os.environ['SEED_WORKSPACE']) / '.seed/workspace.json').read_text())['workspace_id']

if os.environ.get('SEED_EXECUTOR') == 'local':
    # Install a minimal fallback before importing the richer protocol. ComfyUI
    # may continue loading other nodes after any custom-node import failure.
    local_shutdown_ready = False
    @web.middleware
    async def unsupported_fence(request, handler):
        route = request.path[4:] if request.path.startswith('/api/') else request.path
        blocked = (request.method == 'POST' and route in ('/prompt', '/free', '/studio/prompt') or
                   request.method in ('GET', 'HEAD') and route in ('/system_stats', '/studio/capabilities'))
        if blocked and not local_shutdown_ready:
            return web.json_response({'ready': False, 'accepted': False,
                'error': 'Local shutdown support is unavailable. Run setup again.'}, status=409)
        return await handler(request)
    PromptServer.instance.app.middlewares.append(unsupported_fence)
    try:
        from worker.local_revision import check
        from .quiesce import install as install_quiesce
        # aimdo is a namespace package; normal engine startup imports control
        # without importing this constants-only version module.
        from comfy_aimdo import _version
        pins = json.loads(Path(os.environ['SEED_QUIESCE_PINS']).read_text(encoding='utf-8-sig'))
        revision = check(pins, os.environ['SEED_COMFY_ROOT'], os.environ['SEED_SITE_ROOT'], sys.modules)
        install_quiesce(PromptServer.instance, os.environ['SEED_WORKSPACE'], WORKSPACE_ID, ENGINE_SESSION_ID, revision)
        local_shutdown_ready = True
    except Exception:
        # The fallback keeps admission closed even if install partially failed.
        pass

# Sampling progress is transient and belongs to this engine session. Forward all
# native events unchanged; only retain the sampler's latest completed step.
SAMPLING_PROGRESS = None
EXECUTION_ACTIVITY = None
_send_sync = PromptServer.instance.send_sync

def send_with_progress(event, data, sid=None):
    global SAMPLING_PROGRESS, EXECUTION_ACTIVITY
    if event == 'execution_start':
        SAMPLING_PROGRESS = None
        EXECUTION_ACTIVITY = {'prompt_id': data.get('prompt_id'), 'phase': 'loading'}
    elif event == 'executing' and isinstance(data, dict):
        node = str(data.get('node'))
        EXECUTION_ACTIVITY = {'prompt_id': data.get('prompt_id'), 'phase': 'saving' if node in ('8', '9') else 'loading'} if data.get('node') else None
    elif event == 'progress' and isinstance(data, dict):
        value, total = data.get('value'), data.get('max')
        if str(data.get('node')) in ('7', '11') and isinstance(value, (int, float)) and isinstance(total, (int, float)) and math.isfinite(value) and math.isfinite(total) and total > 0 and 0 <= value <= total:
            EXECUTION_ACTIVITY = {'prompt_id': data.get('prompt_id'), 'phase': 'editing'}
            SAMPLING_PROGRESS = {'prompt_id': data.get('prompt_id'), 'node': str(data.get('node')), 'percent': int(100 * value / total)}
    return _send_sync(event, data, sid)

PromptServer.instance.send_sync = send_with_progress

@PromptServer.instance.routes.get('/studio/session')
async def studio_session(request):
    return web.json_response({'protocol_version': 2, 'workspace_id': WORKSPACE_ID, 'engine_session_id': ENGINE_SESSION_ID, 'sampling_progress': SAMPLING_PROGRESS, 'execution_activity': EXECUTION_ACTIVITY,
        'pid': os.getpid(), 'terminal_error': getattr(PromptServer.instance, 'seed_terminal_error', None),
        'quiesce': getattr(PromptServer.instance, 'seed_drain', None).snapshot() if hasattr(PromptServer.instance, 'seed_drain') else None})

from .video import NODE_CLASS_MAPPINGS
from .image import NODE_CLASS_MAPPINGS as IMAGE_NODES
NODE_CLASS_MAPPINGS.update(IMAGE_NODES)
NODE_DISPLAY_NAME_MAPPINGS = {}

from .jobs import install
install(PromptServer.instance, os.environ['SEED_WORKSPACE'], WORKSPACE_ID, ENGINE_SESSION_ID)
