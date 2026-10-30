"""Stop this engine: end any job, free the GPU, then leave ComfyUI normally."""
import asyncio
import hmac
import os
from aiohttp import web
import nodes
from .spool import atomic, job_directory


async def settle(queue, interrupt):
    """Interrupt until the prompt worker has no job."""
    while queue.get_current_queue_volatile()[0]:
        interrupt()
        await asyncio.sleep(0.25)


async def consume_flags(queue, *flags):
    for flag in flags: queue.set_flag(flag, True)
    while queue.get_flags(reset=False):
        # A notify is lost if the worker has not reached its wait yet.
        with queue.mutex: queue.not_empty.notify()
        await asyncio.sleep(0.05)


async def free_memory(queue):
    # Model teardown belongs to the prompt worker thread. ComfyUI's flags run it
    # there; the worker takes the second flag only after that pass has finished.
    await consume_flags(queue, 'unload_models', 'free_memory')
    await consume_flags(queue, 'seed_stop')


def leave():
    # ComfyUI's own Ctrl-C path: run_until_complete ends and main.py cleans up.
    raise KeyboardInterrupt


def install(server, workspace, workspace_id, engine_id):
    token = os.environ.get('SEED_ENGINE_TOKEN', '')
    server.seed_stopping = False
    tasks = []

    def mark_cancelled(item, finished):
        job_id = item[3].get('seed_job_id')
        if not job_id: return
        directory = job_directory(workspace, job_id)
        atomic(directory / 'cancel.json', {'requested': True})
        if finished:
            atomic(directory / 'manifest.json', {'job_id': job_id, 'workspace_id': workspace_id, 'engine_session_id': engine_id,
                                                 'prompt_id': job_id, 'state': 'cancelled', 'outputs': [], 'error': None})

    async def finish():
        queue = server.prompt_queue
        running, pending = queue.get_current_queue_volatile()
        queue.wipe_queue()
        for item in pending: mark_cancelled(item, True)
        for item in running: mark_cancelled(item, False)
        await settle(queue, nodes.interrupt_processing)
        await free_memory(queue)
        leave()

    @server.routes.post('/studio/stop')
    async def stop(request):
        if not token or not hmac.compare_digest(request.headers.get('X-Studio-Engine-Token', ''), token):
            raise web.HTTPUnauthorized()
        if not server.seed_stopping:
            server.seed_stopping = True
            tasks.append(asyncio.create_task(finish()))
        return web.json_response({'stopping': True})
