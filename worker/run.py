"""Container supervisor: early pairing, model preparation, then private ComfyUI."""
import asyncio
import errno
import json
import multiprocessing
import os
import queue
import tempfile
from pathlib import Path
from aiohttp import web
from worker.app import HTTP, PREPARATION, atomic_json, create_app
from worker.prepare import prepare


def preparation_failure(exc):
    status, number = None, None
    cause = exc
    for _ in range(8):
        status = status or getattr(getattr(cause, 'response', None), 'status_code', None)
        number = number or getattr(cause, 'errno', None)
        cause = cause.__cause__ or cause.__context__
        if cause is None: break
    if number in (errno.ENOSPC, errno.EDQUOT):
        message = 'Model storage is full or its volume quota was reached. Increase the volume capacity or remove unused models, then restart to resume.'
    elif status in (401, 403):
        message = 'Hugging Face denied this model download. Check HF_TOKEN and your account access to the model, then restart to resume.'
    elif status == 404:
        message = 'A pinned model file is unavailable at Hugging Face. Check the model manifest before retrying.'
    elif status == 429:
        message = 'Hugging Face rate-limited this download. Wait before restarting to resume.'
    elif isinstance(exc, (TimeoutError, ConnectionError)) or 'timeout' in type(exc).__name__.lower() or 'connect' in type(exc).__name__.lower():
        message = 'The model download connection was interrupted. Restart the pod to resume the staged download.'
    else:
        message = f'Model preparation failed ({type(exc).__name__}). Inspect the private preparation-error.json record through Jupyter before retrying.'
    return message, {'exception': type(exc).__name__, 'http_status': status if isinstance(status, int) else None, 'errno': number if isinstance(number, int) else None}


def prepare_process(workspace, manifest, token, messages, diagnostics=None):
    current = {}
    def report(**value):
        current.update(value)
        messages.put(value)
    try:
        prepare(workspace, manifest, token, report=report)
    except Exception as exc:
        message, details = preparation_failure(exc)
        # Never persist raw exception strings: provider errors can contain signed
        # URLs or credentials. Keep safe codes and the last manifest phase only.
        if diagnostics:
            try: atomic_json(diagnostics, {**details, 'phase': current.get('phase'), 'message': message})
            except OSError: pass
        messages.put({'phase': current.get('phase', 'preparation failed'), 'error': {'message': message}})
        raise SystemExit(1)


def child_environment():
    hidden = {'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'HUGGINGFACE_TOKEN', 'CIVITAI_API_TOKEN', 'CIVITAI_TOKEN', 'RUNPOD_API_KEY', 'SEED_PAIRING_SECRET', 'JUPYTER_TOKEN', 'JUPYTER_PASSWORD'}
    return {key: value for key, value in os.environ.items() if key not in hidden}


def launch_config(workspace, runtime):
    workspace, runtime = Path(workspace).resolve(), Path(runtime).resolve()
    model_root = workspace / 'ComfyUI/models'
    spool = workspace / '.seed/spool'
    for directory in [spool/'inputs', spool/'outputs', runtime/'comfy-user']:
        if directory != runtime/'comfy-user' and not directory.resolve().is_relative_to(workspace):
            raise ValueError('Spool leaves the workspace.')
        directory.mkdir(parents=True, exist_ok=True)
    config = runtime/'extra-model-paths.yaml'
    config.write_text(json.dumps({'seed': {'base_path': str(model_root), 'diffusion_models': 'diffusion_models', 'text_encoders': 'text_encoders', 'vae': 'vae', 'loras': 'loras'}}))
    return ['/opt/venv/bin/python', '/ComfyUI/main.py', '--listen', '127.0.0.1', '--port', '8188', '--disable-auto-launch', '--extra-model-paths-config', str(config), '--input-directory', str(spool/'inputs'), '--output-directory', str(spool/'outputs'), '--user-directory', str(runtime/'comfy-user'), '--disable-all-custom-nodes', '--whitelist-custom-nodes', 'comfy_seed']


def main():
    os.umask(0o077)
    workspace = os.environ.get('SEED_WORKSPACE', '/workspace')
    os.environ['SEED_WORKSPACE'] = workspace
    # Created afresh for each container invocation, outside reusable model storage.
    runtime = Path(tempfile.mkdtemp(prefix='seed-runtime-'))
    public = os.environ.get('SEED_PUBLIC_URL') or f"https://{os.environ['RUNPOD_POD_ID']}-8080.proxy.runpod.net"
    app = create_app(workspace, runtime, os.environ['SEED_PAIRING_SECRET'], public)

    async def services(app):
        children, handles = [], []
        preparation_process = None
        messages = None
        async def start():
            nonlocal preparation_process, messages
            try:
                if not Path(workspace).is_mount():
                    raise ValueError('Attach your network volume at ' + workspace + ', then restart the pod.')
                jupyter_token = os.environ.get('JUPYTER_TOKEN', '')
                if len(jupyter_token) < 24:
                    raise ValueError('Set a private JUPYTER_TOKEN of at least 24 characters.')
                token = os.environ.get('HF_TOKEN', '')
                if not token:
                    raise ValueError('Set HF_TOKEN using your Hugging Face credential.')
                config = runtime/'jupyter_config.py'
                config.write_text('c.IdentityProvider.token = ' + repr(jupyter_token) + '\n')
                jupyter_log = open(runtime/'jupyter.log', 'ab'); handles.append(jupyter_log)
                children.append(await asyncio.create_subprocess_exec('/opt/venv/bin/jupyter-lab', '--ip=0.0.0.0', '--port=8888', '--ServerApp.port_retries=0', '--allow-root', '--no-browser', '--ServerApp.root_dir='+workspace, '--ServerApp.allow_remote_access=True', '--config='+str(config), env=child_environment(), stdout=jupyter_log, stderr=asyncio.subprocess.STDOUT))
                app[PREPARATION].update(phase='starting administration', error=None)
                jupyter = children[-1]
                for attempt in range(60):
                    if jupyter.returncode is not None:
                        raise ValueError('Jupyter failed to start. Inspect ' + str(runtime/'jupyter.log'))
                    try:
                        async with app[HTTP].get('http://127.0.0.1:8888/api/status', headers={'Authorization': 'token ' + jupyter_token}, allow_redirects=False) as response:
                            if response.status == 200: break
                    except Exception:
                        pass
                    await asyncio.sleep(0.5)
                else:
                    raise ValueError('Jupyter did not become ready. Inspect ' + str(runtime/'jupyter.log'))
                command = launch_config(workspace, runtime)
                manifest = json.loads((Path(__file__).parent/'models.json').read_text())
                context = multiprocessing.get_context('spawn')
                messages = context.Queue()
                preparation_process = context.Process(target=prepare_process, args=(workspace, manifest, token, messages, runtime/'preparation-error.json'), daemon=True)
                preparation_process.start()
                while True:
                    if jupyter.returncode is not None:
                        raise ValueError('Jupyter stopped during preparation. Inspect ' + str(runtime/'jupyter.log'))
                    try:
                        while True: app[PREPARATION].update(messages.get_nowait())
                    except queue.Empty:
                        pass
                    if not preparation_process.is_alive():
                        preparation_process.join()
                        break
                    await asyncio.sleep(0.5)
                try:
                    while True: app[PREPARATION].update(messages.get_nowait())
                except queue.Empty:
                    pass
                if preparation_process.exitcode != 0:
                    if not app[PREPARATION].get('error'):
                        app[PREPARATION].update(phase='preparation failed', error={'message': 'Model preparation stopped. Restart the pod to resume.'})
                    return
                app[PREPARATION].update(phase='starting engine', error=None)
                engine_log = open(runtime/'comfy.log', 'ab'); handles.append(engine_log)
                engine = await asyncio.create_subprocess_exec(*command, cwd='/ComfyUI', env=child_environment(), stdout=engine_log, stderr=asyncio.subprocess.STDOUT)
                children.append(engine)
                engine_wait = asyncio.create_task(engine.wait())
                admin_wait = asyncio.create_task(jupyter.wait())
                try:
                    done, _ = await asyncio.wait([engine_wait, admin_wait], return_when=asyncio.FIRST_COMPLETED)
                    if admin_wait in done and engine.returncode is None:
                        app[PREPARATION].update(error={'message': 'Jupyter stopped. Inspect ' + str(runtime/'jupyter.log')})
                    await engine_wait
                finally:
                    engine_wait.cancel(); admin_wait.cancel()
                    await asyncio.gather(engine_wait, admin_wait, return_exceptions=True)
                app[PREPARATION].update(phase='engine stopped', error={'message': 'ComfyUI stopped. Inspect the private runtime log through Jupyter, then restart the pod.'})
            except ValueError as exc:
                app[PREPARATION].update(phase='setup required', error={'message': str(exc)})
            except Exception as exc:
                app[PREPARATION].update(phase='startup failed', error={'message': f'Worker startup failed ({type(exc).__name__}). Check the container configuration.'})
            finally:
                if preparation_process and preparation_process.is_alive():
                    preparation_process.terminate()
                    await asyncio.to_thread(preparation_process.join, 5)
        task = asyncio.create_task(start())
        yield
        task.cancel()
        try: await task
        except asyncio.CancelledError: pass
        if preparation_process and preparation_process.is_alive():
            preparation_process.terminate()
            await asyncio.to_thread(preparation_process.join, 5)
            if preparation_process.is_alive(): preparation_process.kill()
        for child in children:
            if child.returncode is None: child.terminate()
        for child in children:
            try: await asyncio.wait_for(child.wait(), 5)
            except asyncio.TimeoutError: child.kill(); await child.wait()
        if messages: messages.close()
        for handle in handles: handle.close()
    app.cleanup_ctx.append(services)
    web.run_app(app, host='0.0.0.0', port=8080, access_log=None, print=None)


if __name__ == '__main__': main()
