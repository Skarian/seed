"""Authenticated loopback worker in a coordinator-owned Windows Job Object.

Configuration is written by Seed, never supplied through an HTTP request.
The gateway can also run without the GPU engine to recover durable outputs.
"""
import argparse
import asyncio
from contextlib import suppress
import json
import os
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit
from aiohttp import web
from worker.app import PREPARATION, create_app
from worker.processes import child_environment
from worker.spool import atomic


def loopback(origin):
    parsed = urlsplit(origin)
    if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or
        parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password or not parsed.port):
        raise ValueError('Local workers require an explicit IPv4 loopback origin.')
    return parsed.port


def launch_config(config):
    role = config['role']
    if role not in ('image', 'video'): raise ValueError('Invalid local worker role.')
    workspace, runtime, models, source = (Path(config[key]).resolve() for key in ('workspace', 'runtime', 'models', 'source'))
    port = loopback(config['comfy_origin'])
    spool = workspace / '.seed/spool'
    for directory in (spool/'inputs', spool/'outputs', runtime/'comfy-user'):
        directory.mkdir(parents=True, exist_ok=True)
    paths = runtime/'model-paths.yaml'
    atomic(paths, {'seed': {'base_path': str(models), 'diffusion_models': 'diffusion_models',
                          'text_encoders': 'text_encoders', 'vae': 'vae', 'loras': 'loras'},
                   'seed_adapters': {'base_path': str(workspace / 'ComfyUI/models'), 'loras': 'loras'}})
    command = [config['python'], str(source/'main.py'), '--listen', '127.0.0.1', '--port', str(port),
               '--disable-auto-launch', '--extra-model-paths-config', str(paths),
               '--input-directory', str(spool/'inputs'), '--output-directory', str(spool/'outputs'),
               '--user-directory', str(runtime/'comfy-user'), '--disable-all-custom-nodes',
               '--whitelist-custom-nodes', 'comfy_seed']
    flags = config.get('flags', [])
    if not isinstance(flags, list) or any(flag not in ('--disable-comfy-compiler', '--fast-disk', '--disable-pinned-memory') for flag in flags):
        raise ValueError('Unrecognized local runtime flags.')
    command.extend(flags)
    return command


async def watch_engine(process, runtime, exit_process=os._exit):
    while process.poll() is None:
        await asyncio.sleep(0.2)
    try:
        atomic(runtime/'engine-exit.json', {'exit_code': process.returncode, 'at': time.time()})
    finally:
        exit_process(3)


def engine_context(config):
    runtime = Path(config['runtime']).resolve()
    async def engine(app):
        process = None
        log = None
        monitor = None
        if config.get('start_engine', True):
            command = launch_config(config)
            log = (runtime/'engine.log').open('ab', buffering=0)
            # Popen's destructor does not kill a live child. asyncio subprocess
            # transports do; that would bypass the supervisor during cleanup.
            process = subprocess.Popen(command, cwd=config['source'],
                env=child_environment(), stdout=log, stderr=asyncio.subprocess.STDOUT,
                creationflags=0x08000000)
            app[PREPARATION].update(phase='Starting generation engine', error=None)
            monitor = asyncio.create_task(watch_engine(process, runtime))
        else:
            app[PREPARATION].update(phase='Recovering saved output', error=None)
        try: yield
        finally:
            if monitor:
                monitor.cancel()
                with suppress(asyncio.CancelledError): await monitor
            # Only the supervisor terminates Job members. A failed gateway must
            # leave the engine alive and owned so the coordinator can drain it.
            if log: log.close()
    return engine


def main():
    if os.name != 'nt': raise RuntimeError('Native local workers currently require Windows.')
    parser = argparse.ArgumentParser(); parser.add_argument('--config', type=Path, required=True)
    config = json.loads(parser.parse_args().config.read_text(encoding='utf8'))
    port = loopback(config['origin'])
    loopback(config['comfy_origin'])
    if config['origin'] == config['comfy_origin']: raise ValueError('Engine and gateway ports must differ.')
    workspace, runtime = Path(config['workspace']).resolve(), Path(config['runtime']).resolve()
    os.environ.update(SEED_WORKSPACE=str(workspace), SEED_WORKER_CLASS=config['role'], SEED_COMFY_URL=config['comfy_origin'], SEED_EXECUTOR='local')
    if config.get('start_engine', True):
        os.environ.update(SEED_COMFY_ROOT=config['source'], SEED_SITE_ROOT=config['site'], SEED_QUIESCE_PINS=config['pins'])
    app = create_app(workspace, runtime, config['pairing_secret'], config['origin'],
                     comfy_url=config['comfy_origin'], development=True)
    app.cleanup_ctx.append(engine_context(config))
    web.run_app(app, host='127.0.0.1', port=port, access_log=None, print=None)


if __name__ == '__main__': main()
