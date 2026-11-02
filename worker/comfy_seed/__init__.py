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

# Activity is transient and belongs to this engine session. Forward all native
# events unchanged; only retain the current job's phase and the sampler's latest
# completed step. Phases come from each node's class, never from fixed node IDs:
# loading (models, text, references, and the move onto the GPU until the first
# sampler step), generating (sampler steps), finishing (decode and save).
SAMPLERS = frozenset({'KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced'})
SAMPLING_PROGRESS = None
EXECUTION_ACTIVITY = None
_RUNNING = {'prompt_id': None, 'classes': {}, 'sampled': False}
_send_sync = PromptServer.instance.send_sync


def node_classes(prompt_id):
    """Map node IDs to class names for the running prompt. Reads ComfyUI's own queue copy."""
    try:
        running, _ = PromptServer.instance.prompt_queue.get_current_queue_volatile()
        for item in running:
            if item[1] == prompt_id and isinstance(item[2], dict):
                return {str(key): str(node.get('class_type', '')) for key, node in item[2].items() if isinstance(node, dict)}
    except Exception:
        pass
    return {}


def finishing_class(name):
    return 'Decode' in name or name.startswith('Save') or name in ('SeedVideoSave', 'CreateVideo')


def node_class(data):
    classes = _RUNNING['classes']
    for key in (data.get('node'), data.get('display_node')):
        if key is None:
            continue
        key = str(key)
        if key in classes:
            return classes[key]
        if key.split('.')[0] in classes:
            return classes[key.split('.')[0]]
    return ''


def send_with_progress(event, data, sid=None):
    global SAMPLING_PROGRESS, EXECUTION_ACTIVITY
    try:
        if event == 'execution_start' and isinstance(data, dict):
            prompt_id = data.get('prompt_id')
            _RUNNING.update(prompt_id=prompt_id, classes=node_classes(prompt_id), sampled=False)
            SAMPLING_PROGRESS = None
            EXECUTION_ACTIVITY = {'prompt_id': prompt_id, 'phase': 'loading'}
        elif event == 'executing' and isinstance(data, dict):
            prompt_id = data.get('prompt_id')
            if data.get('node') is None:
                EXECUTION_ACTIVITY = None
            else:
                if prompt_id != _RUNNING['prompt_id']:
                    _RUNNING.update(prompt_id=prompt_id, classes=node_classes(prompt_id), sampled=False)
                name = node_class(data)
                if name in SAMPLERS:
                    # Weights move onto the GPU after the sampler starts; that stays loading until step one.
                    phase = (EXECUTION_ACTIVITY or {}).get('phase') if (EXECUTION_ACTIVITY or {}).get('prompt_id') == prompt_id else None
                    phase = phase if phase == 'generating' else 'loading'
                elif finishing_class(name) or _RUNNING['sampled']:
                    phase = 'finishing'
                else:
                    phase = 'loading'
                EXECUTION_ACTIVITY = {'prompt_id': prompt_id, 'phase': phase}
        elif event == 'progress' and isinstance(data, dict):
            value, total = data.get('value'), data.get('max')
            if node_class(data) in SAMPLERS and isinstance(value, (int, float)) and isinstance(total, (int, float)) and math.isfinite(value) and math.isfinite(total) and total > 0 and 0 <= value <= total:
                _RUNNING['sampled'] = True
                EXECUTION_ACTIVITY = {'prompt_id': data.get('prompt_id'), 'phase': 'generating'}
                SAMPLING_PROGRESS = {'prompt_id': data.get('prompt_id'), 'node': str(data.get('node')), 'percent': int(100 * value / total)}
    except Exception:
        pass  # Progress is advisory; never interfere with ComfyUI's own events.
    return _send_sync(event, data, sid)

PromptServer.instance.send_sync = send_with_progress

@PromptServer.instance.routes.get('/studio/session')
async def studio_session(request):
    return web.json_response({'protocol_version': 2, 'workspace_id': WORKSPACE_ID, 'engine_session_id': ENGINE_SESSION_ID, 'sampling_progress': SAMPLING_PROGRESS, 'execution_activity': EXECUTION_ACTIVITY,
        'pid': os.getpid(), 'terminal_error': getattr(PromptServer.instance, 'seed_terminal_error', None)})

from .video import NODE_CLASS_MAPPINGS
from .image import NODE_CLASS_MAPPINGS as IMAGE_NODES
NODE_CLASS_MAPPINGS.update(IMAGE_NODES)
NODE_DISPLAY_NAME_MAPPINGS = {}

from .jobs import install
from .stop import install as install_stop
install(PromptServer.instance, os.environ['SEED_WORKSPACE'], WORKSPACE_ID, ENGINE_SESSION_ID)
install_stop(PromptServer.instance, os.environ['SEED_WORKSPACE'], WORKSPACE_ID, ENGINE_SESSION_ID)
