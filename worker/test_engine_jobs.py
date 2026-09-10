import hashlib
import importlib.util
import sys
import threading
import types
import uuid
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
import worker.spool as spool


class NativeQueue:
    def __init__(self):
        self.mutex = threading.RLock()
        self.currently_running = {}
        self.pending = []
        self.put_count = 0
        self.interrupted = []

    def put(self, item):
        self.pending.append(item)
        self.put_count += 1

    def get_current_queue(self):
        return list(self.currently_running.values()), list(self.pending)

    def task_done(self, item_id, history_result, status, process_item=None):
        self.currently_running.pop(item_id)

    def delete_queue_item(self, predicate):
        for index, item in enumerate(self.pending):
            if predicate(item):
                self.pending.pop(index)
                return True
        return False

    def interrupt_if_running(self, prompt_id):
        self.interrupted.append(prompt_id)
        return any(item[1] == prompt_id for item in self.currently_running.values())


async def engine(tmp_path, monkeypatch, valid=True):
    calls = []
    async def validate(job_id, graph, partial):
        calls.append(job_id)
        return (valid, None, ['9'], {})
    execution = types.ModuleType('execution')
    execution.validate_prompt = validate
    folders = types.ModuleType('folder_paths')
    output = tmp_path / 'volume/.seed/spool/outputs'
    output.mkdir(parents=True)
    folders.get_output_directory = lambda: str(output)
    folders.get_filename_list = lambda category: []
    folders.get_full_path = lambda category, name: str(tmp_path / name)
    monkeypatch.setitem(sys.modules, 'execution', execution)
    monkeypatch.setitem(sys.modules, 'folder_paths', folders)
    package = types.ModuleType('seed_engine_test_package')
    package.__path__ = []
    monkeypatch.setitem(sys.modules, package.__name__, package)
    monkeypatch.setitem(sys.modules, package.__name__ + '.spool', spool)
    spec = importlib.util.spec_from_file_location(package.__name__ + '.jobs', Path(__file__).parent / 'comfy_seed/jobs.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    server = types.SimpleNamespace(routes=web.RouteTableDef(), prompt_queue=NativeQueue(), number=0)
    module.install(server, tmp_path / 'volume', 'workspace', 'current-engine')
    app = web.Application()
    app.add_routes(server.routes)
    client = TestClient(TestServer(app))
    await client.start_server()
    return client, server.prompt_queue, calls, output


def request_for(job_id):
    return {'prompt_id': job_id, 'prompt': {'9': {'class_type': 'SaveImage', 'inputs': {'filename_prefix': f'seed/{job_id}/image'}}}}


HEADERS = {'X-Studio-Engine-Session': 'current-engine'}


@pytest.mark.asyncio
async def test_engine_stale_session_cannot_record_or_enqueue(tmp_path, monkeypatch):
    client, queue, calls, _ = await engine(tmp_path, monkeypatch)
    try:
        job_id = str(uuid.uuid4())
        response = await client.post('/studio/prompt', json=request_for(job_id), headers={'X-Studio-Engine-Session': 'old-engine'})
        assert response.status == 409
        assert (await response.json())['accepted'] is False
        assert not calls and queue.put_count == 0
        assert spool.read_record(spool.job_directory(tmp_path / 'volume', job_id)) is None
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_engine_duplicate_submission_and_queued_cancel(tmp_path, monkeypatch):
    client, queue, calls, _ = await engine(tmp_path, monkeypatch)
    try:
        job_id = str(uuid.uuid4())
        body = request_for(job_id)
        assert (await client.post('/studio/prompt', json=body, headers=HEADERS)).status == 200
        repeat = await client.post('/studio/prompt', json=body, headers=HEADERS)
        assert repeat.status == 200 and (await repeat.json())['already_recorded'] is True
        assert queue.put_count == 1 and calls == [job_id]
        changed = request_for(job_id)
        changed['prompt']['9']['inputs']['other'] = True
        assert (await client.post('/studio/prompt', json=changed, headers=HEADERS)).status == 409
        assert queue.put_count == 1
        assert (await client.post('/studio/cancel', json={'job_id': job_id}, headers=HEADERS)).status == 200
        record = spool.read_record(spool.job_directory(tmp_path / 'volume', job_id))
        assert record['manifest']['state'] == 'cancelled'
        assert record['manifest']['outputs'] == []
        assert not queue.pending and not queue.interrupted
        assert (await client.post('/studio/cancel', json={'job_id': job_id}, headers=HEADERS)).status == 200
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_engine_invalid_graph_not_accepted_or_recorded(tmp_path, monkeypatch):
    client, queue, _, _ = await engine(tmp_path, monkeypatch, valid=False)
    try:
        job_id = str(uuid.uuid4())
        response = await client.post('/studio/prompt', json=request_for(job_id), headers=HEADERS)
        assert response.status == 422
        assert (await response.json())['accepted'] is False
        assert queue.put_count == 0
        assert spool.read_record(spool.job_directory(tmp_path / 'volume', job_id)) is None
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('result', ['success', 'failure', 'missing', 'outside'])
async def test_engine_terminal_manifest_requires_success_and_owned_output(tmp_path, monkeypatch, result):
    client, queue, _, output = await engine(tmp_path, monkeypatch)
    try:
        job_id = str(uuid.uuid4())
        assert (await client.post('/studio/prompt', json=request_for(job_id), headers=HEADERS)).status == 200
        queue.currently_running[0] = queue.pending.pop()
        subfolder = 'seed/' + (job_id if result != 'outside' else str(uuid.uuid4()))
        file = output / subfolder / 'image.png'
        file.parent.mkdir(parents=True)
        payload = b'closed-image-fixture'
        file.write_bytes(payload)
        images = [] if result == 'missing' else [{'subfolder': subfolder, 'filename': 'image.png', 'type': 'output'}]
        status = types.SimpleNamespace(status_str='error' if result == 'failure' else 'success', completed=result != 'failure')
        queue.task_done(0, {'outputs': {'9': {'images': images}}}, status)
        record = spool.read_record(spool.job_directory(tmp_path / 'volume', job_id))
        if result == 'success':
            assert record['manifest']['state'] == 'completed'
            artifact = record['manifest']['outputs'][0]
            assert artifact['sha256'] == hashlib.sha256(payload).hexdigest()
            assert artifact['size'] == len(payload)
        elif result == 'failure':
            assert record['manifest']['state'] == 'failed'
            assert record['manifest']['outputs'] == []
        else:
            assert 'manifest' not in record
        assert file.read_bytes() == payload
    finally:
        await client.close()
