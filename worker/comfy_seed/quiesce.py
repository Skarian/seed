"""One-way local admission fence and prompt-worker cleanup barrier."""
import asyncio
import gc
import os
import re
import threading
import time
from pathlib import Path
from aiohttp import web
from .spool import atomic, job_directory


class AdmissionClosed(RuntimeError):
    pass


class Drain:
    def __init__(self, server, workspace, workspace_id, session, revision, cuda, interrupt,
                 collect=gc.collect, writer=atomic, wait_forever=None):
        self.server, self.queue = server, server.prompt_queue
        self.workspace, self.workspace_id, self.session = Path(workspace), workspace_id, session
        self.revision, self.cuda, self.interrupt = revision, cuda, interrupt
        self.collect, self.writer = collect, writer
        self.wait_forever = wait_forever or threading.Event().wait
        self.state = 'open' if revision['supported'] else 'unsupported'
        self.stop_id = None
        self.worker = None
        self.prepared = threading.Event()
        self.phases, self.faults = {}, []
        self.sync = {'result': 'pending'}
        self.ack_durable = False
        self.running_job_id = None
        self.cancel_running = False
        self.task = None
        if revision['supported']:
            native_get, native_put, native_flag = self.queue.get, self.queue.put, self.queue.set_flag
            def get(timeout=None):
                with self.queue.mutex:
                    self.worker = self.worker or threading.current_thread()
                    if self.state == 'open':
                        # A drain notify returns native None. The caller finishes
                        # its own flags/GC, and parks on the NEXT get entry.
                        return native_get(timeout)
                self.park()
            def put(item):
                with self.queue.mutex:
                    self.assert_open()
                    return native_put(item)
            def set_flag(*args, **kwargs):
                with self.queue.mutex:
                    if self.state == 'open': return native_flag(*args, **kwargs)
            self.queue.get, self.queue.put, self.queue.set_flag = get, put, set_flag

    def assert_open(self):
        if self.state != 'open': raise AdmissionClosed('Local engine is stopping')

    @staticmethod
    def job_id(item):
        value = item[3].get('seed_job_id')
        return value if isinstance(value, str) and re.fullmatch(r'[a-fA-F0-9-]{36}', value) else None

    def phase(self, state):
        with self.queue.mutex:
            self.state = state
            self.phases[state] = time.time()

    def snapshot(self):
        with self.queue.mutex:
            state = self.state
            alive = bool(self.worker and self.worker.is_alive())
            if self.worker and not alive and state not in ('open', 'unsupported'): state = 'worker_dead'
            return {'engine_session_id': self.session, 'stop_id': self.stop_id, 'pid': os.getpid(),
                    'state': state, 'phases': dict(self.phases), 'worker_alive': alive,
                    'running_job_id': self.running_job_id, 'sync': dict(self.sync),
                    'cancel_running': self.cancel_running,
                    'prepared': self.prepared.is_set(), 'faults': list(self.faults),
                    'ack_durable': self.ack_durable, 'revision': self.revision}

    def begin(self, stop_id, cancel_running=False):
        if not isinstance(stop_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,100}', stop_id):
            raise web.HTTPBadRequest()
        if type(cancel_running) is not bool:
            raise web.HTTPBadRequest()
        with self.queue.mutex:
            if self.stop_id and stop_id != self.stop_id: raise web.HTTPConflict()
            self.stop_id = stop_id
            if self.state != 'open':
                # Explicit cancellation can escalate an earlier service drain.
                # Once native cleanup has begun there is no execution to cancel.
                if self.state != 'draining' or not cancel_running or self.cancel_running: return
                self.cancel_running = True
                self.prepared.clear()
                pending, running = [], list(self.queue.currently_running.values())
            else:
                self.cancel_running = cancel_running
                self.phase('draining')
                pending = list(self.queue.queue)
                running = list(self.queue.currently_running.values())
                self.running_job_id = next((self.job_id(item) for item in running if self.job_id(item)), None)
                self.queue.wipe_queue()
                self.queue.not_empty.notify_all()
        try:
            for item in pending + (running if cancel_running else []):
                job = self.job_id(item)
                if not job: continue
                try:
                    directory = job_directory(self.workspace, job)
                    self.writer(directory/'cancel.json', {'requested': True})
                    if item in pending:
                        self.writer(directory/'manifest.json', {'job_id': job, 'workspace_id': self.workspace_id,
                            'engine_session_id': self.session, 'prompt_id': job, 'state': 'cancelled',
                            'outputs': [], 'error': None})
                except Exception:
                    self.faults.append({'kind': 'cancel_persistence', 'job_id': job})
        finally:
            self.prepared.set()

    async def interrupt_until_parked(self):
        if not self.cancel_running:
            return  # Service/gateway loss drains the accepted prompt to completion.
        while self.state not in ('parked', 'sync_failed', 'unsupported'):
            with self.queue.mutex:
                if self.queue.currently_running:
                    self.interrupt()
            await asyncio.sleep(0.25)

    def park(self):
        self.phase('collecting')
        try:
            self.collect()
            self.phase('synchronizing')
            if not self.cuda.is_initialized(): result = 'not_initialized'
            else:
                for device in range(self.cuda.device_count()): self.cuda.synchronize(device)
                result = 'ok'
            sync = {'result': result}
        except Exception as error:
            sync = {'result': 'failed', 'error_class': type(error).__name__}
        self.prepared.wait()
        with self.queue.mutex:
            self.sync = sync
            if getattr(self.server, 'seed_terminal_error', None):
                self.faults.append({'kind': 'terminal_persistence'})
            state = 'parked' if sync['result'] in ('ok', 'not_initialized') else 'sync_failed'
            self.phases[state] = time.time()
            ack = {**self.snapshot(), 'state': state, 'ack_durable': True}
        try:
            self.writer(self.workspace/'.seed/engine'/self.session/'stop-ack.json', ack)
            durable = True
        except Exception:
            durable = False
        with self.queue.mutex:
            self.ack_durable, self.state = durable, state
        self.wait_forever()
        raise RuntimeError('A parked worker must never resume')

    def install_routes(self):
        @web.middleware
        async def fence(request, handler):
            route = request.path[4:] if request.path.startswith('/api/') else request.path
            blocked = (request.method == 'POST' and route in ('/prompt', '/free', '/studio/prompt') or
                       request.method in ('GET', 'HEAD') and route in ('/system_stats', '/studio/capabilities'))
            if blocked and self.state != 'open':
                return web.json_response({'ready': False, 'accepted': False, 'error': 'Local engine is stopping or unsupported',
                                          'revision': self.revision}, status=409)
            return await handler(request)
        self.server.app.middlewares.append(fence)

        @self.server.routes.post('/studio/quiesce')
        async def quiesce(request):
            if request.headers.get('X-Studio-Engine-Session') != self.session: raise web.HTTPConflict()
            body = await request.json()
            self.begin(body.get('stop_id'), body.get('cancel_running', False))
            if self.state != 'unsupported' and (self.task is None or self.task.done()):
                self.task = asyncio.create_task(self.interrupt_until_parked())
            return web.json_response(self.snapshot())

        async def cleanup(app):
            if self.task:
                self.task.cancel()
                try: await self.task
                except asyncio.CancelledError: pass
        self.server.app.on_cleanup.append(cleanup)


def install(server, workspace, workspace_id, session, revision):
    import torch
    import nodes
    drain = Drain(server, workspace, workspace_id, session, revision, torch.cuda, nodes.interrupt_processing)
    server.seed_drain = drain
    drain.install_routes()
    return drain
