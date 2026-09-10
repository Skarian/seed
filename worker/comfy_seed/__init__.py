"""Small ComfyUI hook: identity belongs to this engine process, not the proxy."""
import json
import os
import uuid
from pathlib import Path
from aiohttp import web
from server import PromptServer

ENGINE_SESSION_ID = str(uuid.uuid4())
WORKSPACE_ID = json.loads((Path(os.environ['SEED_WORKSPACE']) / '.seed/workspace.json').read_text())['workspace_id']

@PromptServer.instance.routes.get('/studio/session')
async def studio_session(request):
    return web.json_response({'protocol_version': 1, 'workspace_id': WORKSPACE_ID, 'engine_session_id': ENGINE_SESSION_ID})

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

from .jobs import install
install(PromptServer.instance, os.environ['SEED_WORKSPACE'], WORKSPACE_ID, ENGINE_SESSION_ID)
