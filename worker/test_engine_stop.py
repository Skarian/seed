"""The stop route with a fake prompt worker. No GPU, no process exit."""
import asyncio
import importlib.util
import sys
import threading
import types
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
import worker.spool as spool

TOKEN = 'synthetic-engine-token'
HEADERS = {'X-Studio-Engine-Token': TOKEN}


class Queue:
    """Consumes flags in the order ComfyUI's prompt worker does, one pass at a time."""
    def __init__(self):
        self.mutex = threading.RLock()
        self.not_empty = threading.Condition(self.mutex)
        self.flags, self.running, self.pending, self.passes = {}, [], [], []

    def get_current_queue_volatile(self):
        return list(self.running), list(self.pending)

    def wipe_queue(self):
        self.pending = []

    def set_flag(self, name, value):
        self.flags[name] = value

    def get_flags(self, reset=True):
        return dict(self.flags)

    def worker_pass(self):
        if self.flags:
            self.passes.append(sorted(self.flags))
            self.flags = {}


async def engine(tmp_path, monkeypatch, token=TOKEN):
    if token: monkeypatch.setenv('SEED_ENGINE_TOKEN', token)
    else: monkeypatch.delenv('SEED_ENGINE_TOKEN', raising=False)
    interrupts = []
    server = types.SimpleNamespace(routes=web.RouteTableDef(), prompt_queue=Queue())
    def interrupt():
        interrupts.append(True)
        if len(interrupts) == 2: server.prompt_queue.running.clear()
    monkeypatch.setitem(sys.modules, 'nodes', types.SimpleNamespace(interrupt_processing=interrupt))
    package = types.ModuleType('seed_stop_test_package')
    package.__path__ = []
    monkeypatch.setitem(sys.modules, package.__name__, package)
    monkeypatch.setitem(sys.modules, package.__name__ + '.spool', spool)
    spec = importlib.util.spec_from_file_location(package.__name__ + '.stop', Path(__file__).parent / 'comfy_seed/stop.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    left = []
    module.leave = lambda: left.append(True)
    server.left = left
    module.install(server, tmp_path, 'workspace', 'engine')
    app = web.Application()
    app.add_routes(server.routes)
    client = TestClient(TestServer(app))
    await client.start_server()
    return client, server, interrupts


async def worker_loop(queue, stop):
    while not stop.is_set():
        queue.worker_pass()
        await asyncio.sleep(0.01)


@pytest.mark.asyncio
@pytest.mark.parametrize('headers', [{}, {'X-Studio-Engine-Token': 'wrong'}])
async def test_stop_requires_the_engine_token(tmp_path, monkeypatch, headers):
    client, server, interrupts = await engine(tmp_path, monkeypatch)
    try:
        assert (await client.post('/studio/stop', headers=headers)).status == 401
        assert server.seed_stopping is False and interrupts == []
    finally: await client.close()


@pytest.mark.asyncio
async def test_cloud_engine_has_no_stop_route_without_a_token(tmp_path, monkeypatch):
    client, server, _ = await engine(tmp_path, monkeypatch, token=None)
    try:
        assert (await client.post('/studio/stop', headers=HEADERS)).status == 401
        assert server.seed_stopping is False
    finally: await client.close()


@pytest.mark.asyncio
async def test_stop_ends_the_job_then_unloads_then_exits_through_comfyui(tmp_path, monkeypatch):
    client, server, interrupts = await engine(tmp_path, monkeypatch)
    queue = server.prompt_queue
    running, pending = '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
    queue.running.append((1, running, {}, {'seed_job_id': running}))
    queue.pending.append((2, pending, {}, {'seed_job_id': pending}))
    done = asyncio.Event()
    pump = asyncio.create_task(worker_loop(queue, done))
    try:
        response = await client.post('/studio/stop', headers=HEADERS)
        assert response.status == 200 and server.seed_stopping is True
        second = await client.post('/studio/stop', headers=HEADERS)
        assert second.status == 200
        for _ in range(200):
            if server.left: break
            await asyncio.sleep(0.01)
        assert queue.passes == [['free_memory', 'unload_models'], ['seed_stop']]
        assert len(interrupts) == 2 and queue.pending == []
        assert server.left == [True]
        assert spool.job_directory(tmp_path, running).joinpath('cancel.json').exists()
        assert not spool.job_directory(tmp_path, running).joinpath('manifest.json').exists()
        assert spool.job_directory(tmp_path, pending).joinpath('manifest.json').exists()
    finally:
        done.set(); await pump; await client.close()
