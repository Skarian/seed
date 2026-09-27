import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from aiohttp import web
import pytest

@pytest.mark.asyncio
async def test_session_hook_changes_on_engine_reload_preserving_workspace(tmp_path, monkeypatch):
    identity = tmp_path / '.seed/workspace.json'
    identity.parent.mkdir()
    identity.write_text(json.dumps({'workspace_id': 'volume-one'}))
    monkeypatch.setenv('SEED_WORKSPACE', str(tmp_path))
    monkeypatch.setitem(sys.modules, 'server', SimpleNamespace(PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=web.RouteTableDef(), send_sync=lambda *args: None))))
    monkeypatch.setitem(sys.modules, 'test_comfy_seed_hook.video', SimpleNamespace(NODE_CLASS_MAPPINGS={}))
    monkeypatch.setitem(sys.modules, 'test_comfy_seed_hook.image', SimpleNamespace(NODE_CLASS_MAPPINGS={}))
    monkeypatch.setitem(sys.modules, 'test_comfy_seed_hook.jobs', SimpleNamespace(install=lambda *args: None))
    def load():
        spec = importlib.util.spec_from_file_location('test_comfy_seed_hook', Path(__file__).parent/'comfy_seed/__init__.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    first, second = load(), load()
    assert first.ENGINE_SESSION_ID != second.ENGINE_SESSION_ID
    response = await first.studio_session(None)
    assert json.loads(response.text) == {'protocol_version': 2, 'workspace_id': 'volume-one', 'engine_session_id': first.ENGINE_SESSION_ID, 'sampling_progress': None, 'execution_activity': None}
    assert second.WORKSPACE_ID == first.WORKSPACE_ID
