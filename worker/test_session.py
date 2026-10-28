import importlib.util
import json
import sys
import os
from pathlib import Path
from types import SimpleNamespace
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
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
    assert json.loads(response.text) == {'protocol_version': 2, 'workspace_id': 'volume-one', 'engine_session_id': first.ENGINE_SESSION_ID, 'sampling_progress': None, 'execution_activity': None, 'terminal_error': None, 'pid': os.getpid(), 'quiesce': None}
    assert second.WORKSPACE_ID == first.WORKSPACE_ID


@pytest.mark.asyncio
@pytest.mark.parametrize('failure',['revision_import','quiesce_import','revision_check','partial_install'])
async def test_local_protocol_import_failure_keeps_native_admission_fenced(tmp_path,monkeypatch,failure):
    identity=tmp_path/'.seed/workspace.json';identity.parent.mkdir();identity.write_text('{"workspace_id":"fixture"}')
    pins=tmp_path/'pins.json';pins.write_text('{}')
    for key,value in {'SEED_WORKSPACE':str(tmp_path),'SEED_EXECUTOR':'local','SEED_QUIESCE_PINS':str(pins),
                      'SEED_COMFY_ROOT':str(tmp_path),'SEED_SITE_ROOT':str(tmp_path)}.items():monkeypatch.setenv(key,value)
    server=SimpleNamespace(app=web.Application(),routes=web.RouteTableDef(),send_sync=lambda *args:None)
    monkeypatch.setitem(sys.modules,'server',SimpleNamespace(PromptServer=SimpleNamespace(instance=server)))
    package='test_local_hook_failure'
    for role in ['video','image']:monkeypatch.setitem(sys.modules,package+'.'+role,SimpleNamespace(NODE_CLASS_MAPPINGS={}))
    monkeypatch.setitem(sys.modules,package+'.jobs',SimpleNamespace(install=lambda *args:None))
    monkeypatch.setitem(sys.modules,'comfy_aimdo',SimpleNamespace(_version=SimpleNamespace()))
    def check(*args):
        if failure=='revision_check':raise RuntimeError('synthetic failure')
        return {'supported':True}
    def install(*args):
        server.seed_drain=SimpleNamespace(snapshot=lambda:{'state':'open'})
        raise RuntimeError('synthetic partial install')
    monkeypatch.setitem(sys.modules,'worker.local_revision',None if failure=='revision_import' else SimpleNamespace(check=check))
    monkeypatch.setitem(sys.modules,package+'.quiesce',None if failure=='quiesce_import' else SimpleNamespace(install=install))
    spec=importlib.util.spec_from_file_location(package,Path(__file__).parent/'comfy_seed/__init__.py')
    module=importlib.util.module_from_spec(spec);monkeypatch.setitem(sys.modules,package,module);spec.loader.exec_module(module)
    async def accepted(request):return web.json_response({'accepted':True})
    for route in ('/prompt','/free','/studio/prompt','/system_stats','/studio/capabilities'):
        for prefix in ('','/api'):
            if route in ('/system_stats','/studio/capabilities'):server.app.router.add_get(prefix+route,accepted)
            else:server.app.router.add_post(prefix+route,accepted)
    client=TestClient(TestServer(server.app));await client.start_server()
    try:
        for route in ('/prompt','/free','/studio/prompt','/system_stats','/studio/capabilities'):
            for prefix in ('','/api'):
                response=await client.request('GET' if route in ('/system_stats','/studio/capabilities') else 'POST',prefix+route)
                assert response.status==409 and (await response.json())['accepted'] is False
                if route in ('/system_stats','/studio/capabilities'):
                    assert (await client.head(prefix+route)).status==409
    finally:await client.close()
