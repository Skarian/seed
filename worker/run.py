"""Early authenticated API, optional administration, then a prepared engine."""
import asyncio
import json
import os
from pathlib import Path
from aiohttp import web
from worker.app import PREPARATION, create_app
from worker.spool import atomic
from worker.preparation import MANAGER
from worker.processes import child_environment, stop_process, spawn_owned
from worker.profile import worker_class


def launch_config(workspace, runtime):
    workspace, runtime = Path(workspace).resolve(), Path(runtime).resolve()
    model_root = workspace / 'ComfyUI/models'
    spool = workspace / '.seed/spool'
    for directory in [spool/'inputs', spool/'outputs', runtime/'comfy-user']:
        if directory != runtime/'comfy-user' and not directory.resolve().is_relative_to(workspace):
            raise ValueError('Spool leaves the workspace.')
        directory.mkdir(parents=True, exist_ok=True)
    config = runtime/'extra-model-paths.yaml'
    paths = {'seed': {'base_path': str(model_root), 'diffusion_models': 'diffusion_models', 'text_encoders': 'text_encoders', 'vae': 'vae', 'loras': 'loras'}}
    if worker_class() == 'image':
        paths['qwen'] = {'base_path': '/opt/models/qwen-image-2.1', 'diffusion_models': 'diffusion_models', 'text_encoders': 'text_encoders', 'vae': 'vae'}
    config.write_text(json.dumps(paths))
    return ['/opt/venv/bin/python', '/ComfyUI/main.py', '--listen', '127.0.0.1', '--port', '8188', '--disable-auto-launch', '--extra-model-paths-config', str(config), '--input-directory', str(spool/'inputs'), '--output-directory', str(spool/'outputs'), '--user-directory', str(runtime/'comfy-user'), '--disable-all-custom-nodes', '--whitelist-custom-nodes', 'comfy_seed']


def startup_config(env):
    workspace = Path(env.get('SEED_WORKSPACE', '/workspace'))
    if not workspace.is_absolute(): raise ValueError('SEED_WORKSPACE must be absolute.')
    if env.get('SEED_TRANSPORT', 'ssh') != 'ssh':
        raise ValueError('Use the private SSH bootstrap; the HTTPS proxy is retired.')
    public = env.get('SEED_PUBLIC_URL', 'http://127.0.0.1:18080')
    if public != 'http://127.0.0.1:18080': raise ValueError('Use the Seed loopback bootstrap URL.')
    return str(workspace), public, '127.0.0.1', True


def main():
    os.umask(0o077)
    if worker_class() not in ('image', 'video'):
        raise ValueError('Start the Image or Video worker role image')
    workspace, public, bind, local_http = startup_config(os.environ)
    os.environ['SEED_WORKSPACE'] = workspace
    # This directory belongs to the disposable rental, not the process invocation.
    runtime = Path(os.environ.get('SEED_RUNTIME_DIR', '/var/lib/seed'))
    runtime.mkdir(parents=True, exist_ok=True)
    app = create_app(workspace, runtime, os.environ['SEED_PAIRING_SECRET'], public,
                     development=local_http, managed_preparation=True)

    async def services(app):
        children, handles = [], []
        async def admin():
            token = os.environ.get('JUPYTER_TOKEN', '')
            if len(token) < 24: return
            config = runtime/'jupyter_config.py'
            config.write_text('c.IdentityProvider.token = '+repr(token)+'\n')
            try:
                log = open(runtime/'jupyter.log', 'ab'); handles.append(log)
                process = await spawn_owned('/opt/venv/bin/jupyter-lab',
                    '--ip=127.0.0.1', '--port=8888', '--ServerApp.port_retries=0', '--allow-root',
                    '--no-browser', '--ServerApp.root_dir='+workspace, '--config='+str(config),
                    env=child_environment(), stdout=log, stderr=asyncio.subprocess.STDOUT)
                children.append(process)
                await process.wait()
            except OSError:
                pass  # Optional administration must not gate preparation or generation.
        async def engine():
            await app[MANAGER].ready.wait()
            identity_file = runtime/'identity.json'
            identity = json.loads(identity_file.read_text())
            identity['engine_ever_started'] = True
            atomic(identity_file, identity)
            try:
                log = open(runtime/'comfy.log', 'ab'); handles.append(log)
                process = await spawn_owned(*launch_config(workspace, runtime),
                    cwd='/ComfyUI', env=child_environment(), stdout=log, stderr=asyncio.subprocess.STDOUT)
                children.append(process)
                app[PREPARATION].update(phase='starting engine', error=None)
                await process.wait()
                app[PREPARATION].update(phase='engine stopped', error={'message': 'ComfyUI stopped. Inspect the private engine log.'})
            except OSError as exc:
                app[PREPARATION].update(phase='engine stopped', error={'message': 'Engine startup failed ('+type(exc).__name__+').'})
        tasks = [asyncio.create_task(admin()), asyncio.create_task(engine())]
        yield
        for task in tasks: task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for child in children: await stop_process(child)
        for handle in handles: handle.close()
    app.cleanup_ctx.append(services)
    web.run_app(app, host=bind, port=8080, access_log=None, print=None)


if __name__ == '__main__': main()
