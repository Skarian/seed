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
    monkeypatch.setitem(sys.modules, 'test_comfy_seed_hook.stop', SimpleNamespace(install=lambda *args: None))
    def load():
        spec = importlib.util.spec_from_file_location('test_comfy_seed_hook', Path(__file__).parent/'comfy_seed/__init__.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    first, second = load(), load()
    assert first.ENGINE_SESSION_ID != second.ENGINE_SESSION_ID
    response = await first.studio_session(None)
    assert json.loads(response.text) == {'protocol_version': 2, 'workspace_id': 'volume-one', 'engine_session_id': first.ENGINE_SESSION_ID, 'sampling_progress': None, 'execution_activity': None, 'terminal_error': None, 'pid': os.getpid()}
    assert second.WORKSPACE_ID == first.WORKSPACE_ID


def load_hook(tmp_path, monkeypatch, running):
    """Loads the hook against a fake ComfyUI whose queue holds one synthetic running prompt."""
    identity = tmp_path / '.seed/workspace.json'
    identity.parent.mkdir(exist_ok=True)
    identity.write_text(json.dumps({'workspace_id': 'volume-one'}))
    monkeypatch.setenv('SEED_WORKSPACE', str(tmp_path))
    sent = []
    queue = SimpleNamespace(get_current_queue_volatile=lambda: (running, []))
    monkeypatch.setitem(sys.modules, 'server', SimpleNamespace(PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=web.RouteTableDef(), prompt_queue=queue, send_sync=lambda *args: sent.append(args)))))
    for name in ('video', 'image'):
        monkeypatch.setitem(sys.modules, f'test_comfy_seed_phase.{name}', SimpleNamespace(NODE_CLASS_MAPPINGS={}))
    for name in ('jobs', 'stop'):
        monkeypatch.setitem(sys.modules, f'test_comfy_seed_phase.{name}', SimpleNamespace(install=lambda *args: None))
    spec = importlib.util.spec_from_file_location('test_comfy_seed_phase', Path(__file__).parent/'comfy_seed/__init__.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, sent


def phases(module, events):
    seen = []
    for event, data in events:
        module.send_with_progress(event, data)
        activity = module.EXECUTION_ACTIVITY
        progress = module.SAMPLING_PROGRESS
        seen.append(None if activity is None else (activity['phase'], progress['percent'] if activity['phase'] == 'generating' else None))
    return seen


def test_image_phases_follow_node_classes_not_node_ids(tmp_path, monkeypatch):
    graph = {'1': {'class_type': 'UNETLoader'}, '2': {'class_type': 'CLIPLoader'}, '4': {'class_type': 'CLIPTextEncode'},
             '7': {'class_type': 'KSampler'}, '8': {'class_type': 'VAEDecode'}, '9': {'class_type': 'SaveImage'}}
    module, sent = load_hook(tmp_path, monkeypatch, [(0, 'job', graph, {}, [])])
    run = lambda node: ('executing', {'node': node, 'prompt_id': 'job'})
    step = lambda value: ('progress', {'node': '7', 'prompt_id': 'job', 'value': value, 'max': 8})
    assert phases(module, [('execution_start', {'prompt_id': 'job'}), run('1'), run('2'), run('4'), run('7'), step(2), step(4), run('8'), run('9'), ('executing', {'node': None, 'prompt_id': 'job'})]) == [
        ('loading', None), ('loading', None), ('loading', None), ('loading', None), ('loading', None),
        ('generating', 25), ('generating', 50), ('finishing', None), ('finishing', None), None]
    assert len(sent) == 10  # Every native event is still forwarded.


def test_video_phases_ignore_sampler_settings_and_find_the_save_node(tmp_path, monkeypatch):
    graph = {'1': {'class_type': 'UNETLoader'}, '9': {'class_type': 'KSamplerSelect'}, '11': {'class_type': 'SamplerCustomAdvanced'},
             '12': {'class_type': 'VAEDecode'}, '13': {'class_type': 'VAEDecodeAudio'}, '14': {'class_type': 'SeedVideoSave'}}
    module, _ = load_hook(tmp_path, monkeypatch, [(0, 'clip', graph, {}, [])])
    run = lambda node: ('executing', {'node': node, 'prompt_id': 'clip'})
    assert phases(module, [('execution_start', {'prompt_id': 'clip'}), run('9'), run('11'), ('progress', {'node': '11', 'prompt_id': 'clip', 'value': 3, 'max': 4}),
                           ('progress', {'node': '12', 'prompt_id': 'clip', 'value': 1, 'max': 2}), run('12'), run('13'), run('14')]) == [
        ('loading', None), ('loading', None), ('loading', None), ('generating', 75), ('generating', 75), ('finishing', None), ('finishing', None), ('finishing', None)]


def test_unknown_events_never_break_forwarding(tmp_path, monkeypatch):
    module, sent = load_hook(tmp_path, monkeypatch, [])
    module.send_with_progress('executing', {'node': '5', 'prompt_id': 'missing'})
    module.send_with_progress('progress', {'node': '5', 'prompt_id': 'missing', 'value': float('nan'), 'max': 1})
    module.send_with_progress('status', 'not-a-dict')
    assert module.EXECUTION_ACTIVITY == {'prompt_id': 'missing', 'phase': 'loading'} and module.SAMPLING_PROGRESS is None
    assert len(sent) == 3
