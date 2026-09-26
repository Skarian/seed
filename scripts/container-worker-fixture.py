"""CPU-only transport QA for the built images. Not shipped in worker images.

Real SSH bootstrap, gateway, auth, preparation manifest validation, input upload,
engine admission/spool, output serving and receipt cleanup. Only large model
downloads, GPU readiness and inference are substituted with local fixtures.
"""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import types
import uuid
from aiohttp import web
from worker.app import create_app, atomic_json
from worker.entrypoint import start_ssh
from worker.preparation import MANAGER
import worker.spool as spool

workspace = Path('/qa-workspace')
runtime = Path('/qa-runtime')
output = workspace / '.seed/spool/outputs'
output.mkdir(parents=True, exist_ok=True)
audit = []


def record(event, **details):
    audit.append({'event': event, **details})
    atomic_json(workspace / 'qa-audit.json', audit)


async def validate(job_id, graph, partial):
    # The CPU substitute still checks every submitted reference was uploaded.
    for node in graph.values():
        kind, inputs = node['class_type'], node['inputs']
        field = {'LoadImage': 'image', 'SeedLoadEditImage': 'image', 'LoadAudio': 'audio', 'SeedLoadVideo': 'filename'}.get(kind)
        if field:
            file = workspace / '.seed/spool/inputs' / inputs[field]
            if not file.is_file():
                return (False, None, [], {'fixture': 'Reference missing'})
    return (True, None, ['14' if '14' in graph else '9'], {})


execution = types.ModuleType('execution')
execution.validate_prompt = validate
sys.modules['execution'] = execution
folders = types.ModuleType('folder_paths')
folders.get_output_directory = lambda: str(output)
folders.get_filename_list = lambda category: {
    'diffusion_models': ['krea2_turbo_int8_convrot.safetensors','qwen_image_2.1_int8_convrot.safetensors'],
    'text_encoders': ['qwen3vl_4b_fp8_scaled.safetensors','qwen3vl_8b_int8_convrot.safetensors'],
    'vae': ['qwen_image_vae.safetensors','qwen_image_2.1_vae_bf16.safetensors'],
}.get(category, [])
sys.modules['folder_paths'] = folders
sys.modules['nodes'] = types.SimpleNamespace(NODE_CLASS_MAPPINGS={name:None for name in ('TextEncodeQwenImage21','QwenImage21Cache','SeedLoadEditImage')})
package = types.ModuleType('seed_qa_engine')
package.__path__ = []
sys.modules[package.__name__] = package
sys.modules[package.__name__ + '.spool'] = spool
for name in ('telemetry', 'adapters', 'jobs'):
    spec = importlib.util.spec_from_file_location(package.__name__ + '.' + name, f'/ComfyUI/custom_nodes/comfy_seed/{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    sys.modules[spec.name] = module
engine_jobs = sys.modules[package.__name__ + '.jobs']
engine_jobs.hardware_capabilities = lambda role: {'ready': True, 'devices': [], 'fixture': True}
engine_jobs.video_capabilities = lambda: {'ready': True, 'quality': {'high': True}, 'native_export': True}


class Queue:
    def __init__(self):
        self.mutex = threading.RLock()
        self.currently_running, self.pending = {}, []

    def get_current_queue(self):
        return list(self.currently_running.values()), list(self.pending)

    def put(self, item):
        self.pending.append(item)
        record('enqueue', job_id=item[1])
        asyncio.create_task(self.complete(item))

    async def complete(self, item):
        await asyncio.sleep(1)
        if item not in self.pending:
            return
        self.pending.remove(item)
        self.currently_running[item[0]] = item
        video = '14' in item[2]
        filename = 'video.mp4' if video else 'image.png'
        folder = output / 'seed' / item[1]
        folder.mkdir(parents=True, exist_ok=True)
        (folder / filename).write_bytes((Path('/qa-assets') / filename).read_bytes())
        history = {'outputs': {'14' if video else '9': {'videos' if video else 'images': [
            {'filename': filename, 'subfolder': 'seed/' + item[1], 'type': 'output'}]}}}
        self.task_done(item[0], history, types.SimpleNamespace(status_str='success', completed=True))
        record('complete', job_id=item[1])

    def task_done(self, item_id, history_result, status, process_item=None):
        self.currently_running.pop(item_id)

    def delete_queue_item(self, predicate):
        for index, item in enumerate(self.pending):
            if predicate(item):
                self.pending.pop(index)
                return True
        return False

    def interrupt_if_running(self, job_id):
        return any(item[1] == job_id for item in self.currently_running.values())


async def main():
    start_ssh(os.environ['PUBLIC_KEY'])
    gateway = create_app(workspace, runtime, os.environ['SEED_PAIRING_SECRET'],
                         'http://127.0.0.1:18080', development=True, managed_preparation=True)
    manager = gateway[MANAGER]

    async def fixture_download(credentials):
        # ensure() still validates the entire pinned role manifest. No actual
        # weight files or provider credentials are used by this CPU-only test.
        credentials.clear()
        for entry in manager.entries():
            manager.files[entry['path']] = {'path': entry['path'], 'ready': True,
                'bytes_done': entry['size'], 'state': 'ready'}
        manager.state = 'ready'
        manager.ready.set()
        manager.refresh()
        record('fixture-model-preparation', paths=[entry['path'] for entry in manager.entries()])

    manager.run = fixture_download
    workspace_id = json.loads((workspace / '.seed/workspace.json').read_text())['workspace_id']
    session_id = str(uuid.uuid4())
    server = types.SimpleNamespace(routes=web.RouteTableDef(), prompt_queue=Queue(), number=0, send_sync=lambda *args: None)
    engine_jobs.install(server, workspace, workspace_id, session_id)

    @server.routes.get('/studio/session')
    async def session(request):
        return web.json_response({'workspace_id': workspace_id, 'engine_session_id': session_id, 'protocol_version': 2})

    @server.routes.get('/queue')
    async def queue(request):
        running, pending = server.prompt_queue.get_current_queue()
        return web.json_response({'queue_running': running, 'queue_pending': pending})

    engine = web.Application()
    engine.add_routes(server.routes)
    for app, port in ((engine, 8188), (gateway, 8080)):
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, '127.0.0.1', port).start()
    print('SEED_QA_READY', flush=True)
    await asyncio.Event().wait()


asyncio.run(main())
