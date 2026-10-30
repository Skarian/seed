"""One worker entry point: authenticated gateway, then the ComfyUI engine.

A cloud container configures it from its environment. Seed configures a local
worker through a launch file it writes; nothing comes from an HTTP request.
"""
import argparse
import asyncio
import json
import os
from contextlib import suppress
from pathlib import Path
from urllib.parse import urlsplit
from aiohttp import web
from worker.app import PREPARATION, create_app
from worker.spool import atomic
from worker.preparation import MANAGER
from worker.processes import child_environment, stop_process, spawn_owned
from worker.profile import engine_spec, worker_class


def loopback(origin):
    parsed = urlsplit(origin)
    if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or
        parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password or not parsed.port):
        raise ValueError('Workers require an explicit IPv4 loopback origin.')
    return parsed.port


def launch_config(config):
    workspace, runtime = Path(config['workspace']).resolve(), Path(config['runtime']).resolve()
    spool = workspace / '.seed/spool'
    for directory in (spool/'inputs', spool/'outputs', runtime/'comfy-user'):
        directory.mkdir(parents=True, exist_ok=True)
    folders = {'diffusion_models': 'diffusion_models', 'text_encoders': 'text_encoders', 'vae': 'vae'}
    paths = {'seed': {'base_path': str(config['models']), **folders, 'loras': 'loras'},
             'seed_adapters': {'base_path': str(workspace/'ComfyUI/models'), 'loras': 'loras'}}
    if config.get('qwen_models'):
        paths['qwen'] = {'base_path': config['qwen_models'], **folders}
    file = runtime/'extra-model-paths.yaml'
    atomic(file, paths)
    return [config['python'], str(Path(config['source'])/'main.py'), '--listen', '127.0.0.1', '--port', str(loopback(config['comfy_origin'])),
            '--disable-auto-launch', '--extra-model-paths-config', str(file),
            '--input-directory', str(spool/'inputs'), '--output-directory', str(spool/'outputs'),
            '--user-directory', str(runtime/'comfy-user'), '--disable-all-custom-nodes',
            '--whitelist-custom-nodes', 'comfy_seed', *engine_spec()['flags']]


def startup_config(env):
    workspace = Path(env.get('SEED_WORKSPACE', '/workspace'))
    if not workspace.is_absolute(): raise ValueError('SEED_WORKSPACE must be absolute.')
    if env.get('SEED_TRANSPORT', 'ssh') != 'ssh':
        raise ValueError('Use the private SSH bootstrap; the HTTPS proxy is retired.')
    public = env.get('SEED_PUBLIC_URL', 'http://127.0.0.1:18080')
    if public != 'http://127.0.0.1:18080': raise ValueError('Use the Seed loopback bootstrap URL.')
    return str(workspace), public, '127.0.0.1', True


def cloud_config(env):
    if worker_class() not in ('image', 'video'):
        raise ValueError('Start the Image or Video worker role image')
    workspace, public, _, _ = startup_config(env)
    return {'workspace': workspace, 'runtime': env.get('SEED_RUNTIME_DIR', '/var/lib/seed'),
            'models': str(Path(workspace)/'ComfyUI/models'), 'source': '/ComfyUI', 'python': '/opt/venv/bin/python',
            'origin': public, 'comfy_origin': 'http://127.0.0.1:8188', 'pairing_secret': env['SEED_PAIRING_SECRET'],
            'port': 8080, 'prepare_models': True, 'administration': True,
            'qwen_models': '/opt/models/qwen-image-2.1' if worker_class() == 'image' else None}


def local_config(file):
    config = json.loads(Path(file).read_text(encoding='utf8'))
    if loopback(config['origin']) == loopback(config['comfy_origin']):
        raise ValueError('Engine and gateway ports must differ.')
    return {**config, 'port': loopback(config['origin'])}


def services(config):
    workspace, runtime = str(config['workspace']), Path(config['runtime'])

    async def context(app):
        children, handles = [], []

        def log(name):
            handle = open(runtime/name, 'ab')
            handles.append(handle)
            return handle

        async def admin():
            token = os.environ.get('JUPYTER_TOKEN', '')
            if len(token) < 24: return
            settings = runtime/'jupyter_config.py'
            settings.write_text('c.IdentityProvider.token = '+repr(token)+'\n')
            try:
                process = await spawn_owned('/opt/venv/bin/jupyter-lab',
                    '--ip=127.0.0.1', '--port=8888', '--ServerApp.port_retries=0', '--allow-root',
                    '--no-browser', '--ServerApp.root_dir='+workspace, '--config='+str(settings),
                    env=child_environment(), stdout=log('jupyter.log'), stderr=asyncio.subprocess.STDOUT)
                children.append(process)
                await process.wait()
            except OSError:
                pass  # Optional administration must not gate preparation or generation.

        async def engine():
            if config.get('prepare_models'):
                await app[MANAGER].ready.wait()
                identity_file = runtime/'identity.json'
                identity = json.loads(identity_file.read_text())
                identity['engine_ever_started'] = True
                atomic(identity_file, identity)
            token = config.get('engine_token')
            try:
                process = await spawn_owned(*launch_config(config), cwd=config['source'],
                    env={**child_environment(), **({'SEED_ENGINE_TOKEN': token} if token else {})},
                    stdout=log('engine.log'), stderr=asyncio.subprocess.STDOUT)
                children.append(process)
                app[PREPARATION].update(phase='starting engine', error=None)
                code = await process.wait()
                app[PREPARATION].update(phase='engine stopped', error={'message': 'ComfyUI stopped. Inspect the private engine log.'})
                atomic(runtime/'engine-exit.json', {'exit_code': code})
            except OSError as exc:
                app[PREPARATION].update(phase='engine stopped', error={'message': 'Engine startup failed ('+type(exc).__name__+').'})
            # A local gateway serves one engine; Seed starts a new pair for the next job.
            if not config.get('prepare_models'): raise web.GracefulExit()

        tasks = []
        if config.get('administration'): tasks.append(asyncio.create_task(admin()))
        if config.get('start_engine', True): tasks.append(asyncio.create_task(engine()))
        else: app[PREPARATION].update(phase='recovering saved output', error=None)
        yield
        for task in tasks: task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for child in children:
            with suppress(ProcessLookupError): await stop_process(child)
        for handle in handles: handle.close()
    return context


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path)
    file = parser.parse_args().config
    config = local_config(file) if file else cloud_config(os.environ)
    workspace, runtime = Path(config['workspace']), Path(config['runtime'])
    runtime.mkdir(parents=True, exist_ok=True)
    os.environ.update(SEED_WORKSPACE=str(workspace), SEED_COMFY_URL=config['comfy_origin'])
    if file: os.environ['SEED_WORKER_CLASS'] = 'all'
    app = create_app(workspace, runtime, config['pairing_secret'], config['origin'], comfy_url=config['comfy_origin'],
                     development=True, managed_preparation=bool(config.get('prepare_models')))
    app.cleanup_ctx.append(services(config))
    web.run_app(app, host='127.0.0.1', port=config['port'], access_log=None, print=None, shutdown_timeout=1)


if __name__ == '__main__': main()
