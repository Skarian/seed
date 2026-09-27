"""Small ComfyUI hook: identity belongs to this engine process, not the proxy."""
import json
import math
import os
import uuid
from pathlib import Path
from aiohttp import web
from server import PromptServer

ENGINE_SESSION_ID = str(uuid.uuid4())
WORKSPACE_ID = json.loads((Path(os.environ['SEED_WORKSPACE']) / '.seed/workspace.json').read_text())['workspace_id']

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
    return web.json_response({'protocol_version': 2, 'workspace_id': WORKSPACE_ID, 'engine_session_id': ENGINE_SESSION_ID, 'sampling_progress': SAMPLING_PROGRESS, 'execution_activity': EXECUTION_ACTIVITY})

from .video import NODE_CLASS_MAPPINGS
from .image import NODE_CLASS_MAPPINGS as IMAGE_NODES
NODE_CLASS_MAPPINGS.update(IMAGE_NODES)
NODE_DISPLAY_NAME_MAPPINGS = {}

from .jobs import install
install(PromptServer.instance, os.environ['SEED_WORKSPACE'], WORKSPACE_ID, ENGINE_SESSION_ID)
