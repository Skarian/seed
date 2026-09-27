"""Small process-lifetime helpers shared by preparation and optional services."""
import asyncio
import os
import signal
import sys
from pathlib import Path


async def spawn_owned(*command, **options):
    if os.name == 'posix':
        command = (sys.executable, str(Path(__file__).with_name('owned_process.py').resolve()), str(os.getpid()), *command)
    return await asyncio.create_subprocess_exec(*command, **options, start_new_session=os.name == 'posix')


def child_environment():
    hidden = {'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'HUGGINGFACE_TOKEN',
              'CIVITAI_API_TOKEN', 'CIVITAI_API_KEY', 'CIVITAI_TOKEN', 'RUNPOD_API_KEY', 'VAST_API_KEY',
              # Keep retired credential names redacted in imported logs.
              'OPENROUTER_API_KEY', 'FAL_KEY',
              'SEED_PAIRING_SECRET', 'JUPYTER_TOKEN', 'JUPYTER_PASSWORD'}
    return {k: v for k, v in os.environ.items()
            if k not in hidden and not k.startswith(('TS_', 'TAILSCALE_'))}


async def stop_process(process):
    if process is None:
        return
    # Every owned Linux subprocess starts a new session. Kill descendants even
    # when the leader has already exited and its children remain.
    def send(hard=False):
        try:
            if os.name == 'posix': os.killpg(process.pid, signal.SIGKILL if hard else signal.SIGTERM)
            elif process.returncode is None: process.kill() if hard else process.terminate()
        except ProcessLookupError:
            pass
    send()
    try: await asyncio.wait_for(process.wait(), 5)
    except asyncio.TimeoutError: pass
    send(True)
    await process.wait()
