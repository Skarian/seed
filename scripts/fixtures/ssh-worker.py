"""Local test container only: real Comfy CPU queue with no downloaded weights."""
import asyncio
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, '/opt/seed')
from aiohttp import web
from worker.app import create_app
from worker.entrypoint import start_ssh
from worker.run import launch_config

workspace = Path(os.environ.get('SEED_TEST_WORKSPACE', '/workspace'))
runtime = Path(os.environ.get('SEED_TEST_RUNTIME', '/var/lib/seed'))
engine_port = os.environ.get('SEED_TEST_ENGINE_PORT', '8188')
runtime.mkdir(parents=True, exist_ok=True)
os.environ['SEED_WORKSPACE'] = str(workspace)
if not os.environ.get('SEED_TEST_NO_SSH'):
    start_ssh(os.environ['PUBLIC_KEY'])
app = create_app(workspace, runtime, os.environ['SEED_PAIRING_SECRET'], 'http://127.0.0.1:18080', comfy_url='http://127.0.0.1:'+engine_port, development=True)
# Capabilities inspect filenames; this fixture never constructs a model loader.
for category, name in {'diffusion_models': 'krea2_turbo_int8_convrot.safetensors', 'text_encoders': 'qwen3vl_4b_fp8_scaled.safetensors', 'vae': 'qwen_image_vae.safetensors'}.items():
    file = workspace / 'ComfyUI/models' / category / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.touch()
hook = Path('/ComfyUI/custom_nodes/comfy_seed/__init__.py')
hook.write_text(hook.read_text().split('\n# Test instrumentation only:')[0] + '''
# Test instrumentation only: observe native queue insertions, never fake them.
import time
class SeedTestDelay:
    @classmethod
    def INPUT_TYPES(cls): return {'required': {'images': ('IMAGE',)}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'run'
    CATEGORY = 'test'
    def run(self, images):
        time.sleep(5)
        return (images,)
NODE_CLASS_MAPPINGS['SeedTestDelay'] = SeedTestDelay
_test_put = PromptServer.instance.prompt_queue.put
def _count_put(item):
    with open(os.environ.get('SEED_TEST_RUNTIME', '/var/lib/seed') + '/queue-insertions.jsonl', 'a') as file:
        file.write(json.dumps({'job_id': item[1]}) + '\\n')
    return _test_put(item)
PromptServer.instance.prompt_queue.put = _count_put
_test_done = PromptServer.instance.prompt_queue.task_done
def _count_done(item_id, *args, **kwargs):
    job_id = PromptServer.instance.prompt_queue.currently_running[item_id][1]
    result = _test_done(item_id, *args, **kwargs)
    with open(os.environ.get('SEED_TEST_RUNTIME', '/var/lib/seed') + '/completions.jsonl', 'a') as file:
        file.write(json.dumps({'job_id': job_id, 'at_ms': int(time.time()*1000)}) + '\\n')
    return result
PromptServer.instance.prompt_queue.task_done = _count_done
''')

async def engine(app):
    log = open(runtime / 'comfy.log', 'ab')
    arguments = launch_config(workspace, runtime)
    arguments[arguments.index('--port') + 1] = engine_port
    process = await asyncio.create_subprocess_exec(*arguments, '--cpu', cwd='/ComfyUI', stdout=log, stderr=log)
    yield
    process.terminate()
    await process.wait()
    log.close()

app.cleanup_ctx.append(engine)
web.run_app(app, host='127.0.0.1', port=int(os.environ.get('SEED_TEST_WORKER_PORT', '8080')), print=None)
