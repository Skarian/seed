import asyncio
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


async def engine(tmp_path, monkeypatch, valid=True, observe_request=None):
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
    monkeypatch.setitem(sys.modules, 'nodes', types.SimpleNamespace(NODE_CLASS_MAPPINGS={}))
    package = types.ModuleType('seed_engine_test_package')
    package.__path__ = []
    monkeypatch.setitem(sys.modules, package.__name__, package)
    monkeypatch.setitem(sys.modules, package.__name__ + '.spool', spool)
    telemetry_spec = importlib.util.spec_from_file_location(package.__name__ + '.telemetry', Path(__file__).parent / 'comfy_seed/telemetry.py')
    telemetry = importlib.util.module_from_spec(telemetry_spec)
    telemetry_spec.loader.exec_module(telemetry)
    monkeypatch.setitem(sys.modules, package.__name__ + '.telemetry', telemetry)
    adapter_spec = importlib.util.spec_from_file_location(package.__name__ + '.adapters', Path(__file__).parent / 'comfy_seed/adapters.py')
    adapters = importlib.util.module_from_spec(adapter_spec)
    adapter_spec.loader.exec_module(adapters)
    monkeypatch.setitem(sys.modules, adapter_spec.name, adapters)
    spec = importlib.util.spec_from_file_location(package.__name__ + '.jobs', Path(__file__).parent / 'comfy_seed/jobs.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setitem(sys.modules, spec.name, module)
    server = types.SimpleNamespace(routes=web.RouteTableDef(), prompt_queue=NativeQueue(), number=0, send_sync=lambda *args: None)
    queue_server = server
    server.prompt_queue.server = queue_server
    module.install(server, tmp_path / 'volume', 'workspace', 'current-engine')
    @web.middleware
    async def observed(request, handler):
        if observe_request:
            observe_request(request)
        return await handler(request)
    app = web.Application(middlewares=[observed])
    app.add_routes(server.routes)
    client = TestClient(TestServer(app))
    await client.start_server()
    return client, server.prompt_queue, calls, output


def request_for(job_id):
    return {'prompt_id': job_id, 'prompt': {'9': {'class_type': 'SaveImage', 'inputs': {'filename_prefix': f'seed/{job_id}/image'}}}}


HEADERS = {'X-Studio-Engine-Session': 'current-engine'}


@pytest.mark.asyncio
async def test_capabilities_cannot_be_ready_with_models_but_wrong_hardware(tmp_path, monkeypatch):
    monkeypatch.setenv('SEED_WORKER_CLASS', 'image')
    cuda = types.SimpleNamespace(is_available=lambda: True, device_count=lambda: 1,
        get_device_properties=lambda index: types.SimpleNamespace(name='NVIDIA GeForce RTX 4090', total_memory=24 * 1024**3))
    monkeypatch.setitem(sys.modules, 'torch', types.SimpleNamespace(cuda=cuda))
    client, _, _, _ = await engine(tmp_path, monkeypatch)
    names = {'diffusion_models': ['krea2_turbo_int8_convrot.safetensors'],
        'text_encoders': ['qwen3vl_4b_fp8_scaled.safetensors'], 'vae': ['qwen_image_vae.safetensors']}
    monkeypatch.setattr(sys.modules['folder_paths'], 'get_filename_list', lambda category: names[category])
    try:
        response = await client.get('/studio/capabilities')
        value = await response.json()
        assert response.status == 200 and value['ready'] is False
        assert value['hardware']['ready'] is False and '32 GB' in value['hardware']['error']
        assert value['hardware']['devices'][0]['vram_bytes'] == 24 * 1024**3
    finally:
        await client.close()


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
        # Native Comfy only emits execution_start for jobs carrying client_id.
        assert queue.pending[0][3]['client_id'] == job_id
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
async def test_same_id_retry_during_original_validation_enqueues_only_once(tmp_path, monkeypatch):
    validating, finish_validation, retry_arrived = asyncio.Event(), asyncio.Event(), asyncio.Event()
    arrivals = 0
    def observe(request):
        nonlocal arrivals
        if request.path == '/studio/prompt':
            arrivals += 1
            if arrivals == 2:
                retry_arrived.set()
    client, queue, calls, _ = await engine(tmp_path, monkeypatch, observe_request=observe)
    validate = sys.modules['execution'].validate_prompt
    async def held_validation(*args):
        validating.set()
        await finish_validation.wait()
        return await validate(*args)
    monkeypatch.setattr(sys.modules['execution'], 'validate_prompt', held_validation)
    tasks = []
    try:
        job_id = str(uuid.uuid4())
        body = request_for(job_id)
        directory = spool.job_directory(tmp_path / 'volume', job_id)
        tasks.append(asyncio.create_task(client.post('/studio/prompt', json=body, headers=HEADERS)))
        await asyncio.wait_for(validating.wait(), 3)
        # The original HTTP request is still alive, yet a receipt lookup finds nothing.
        assert spool.read_record(directory) is None and queue.put_count == 0
        tasks.append(asyncio.create_task(client.post('/studio/prompt', json=body, headers=HEADERS)))
        await asyncio.wait_for(retry_arrived.wait(), 3)
        assert not tasks[1].done() and queue.put_count == 0
        finish_validation.set()
        original, retry = await asyncio.wait_for(asyncio.gather(*tasks), 3)
        assert original.status == retry.status == 200
        assert (await retry.json())['already_recorded'] is True
        assert queue.put_count == 1 and calls == [job_id]
        assert len(queue.pending) == 1 and queue.pending[0][1] == job_id
        assert spool.read_record(directory)['submission']['graph'] == body['prompt']
    finally:
        finish_validation.set()
        await asyncio.gather(*tasks, return_exceptions=True)
        await client.close()


@pytest.mark.asyncio
async def test_existing_acceptance_without_queue_entry_is_not_silently_reenqueued(tmp_path, monkeypatch):
    client, queue, calls, _ = await engine(tmp_path, monkeypatch)
    put = queue.put
    def failed_handoff(_item):
        raise RuntimeError('Synthetic failure after durable acceptance')
    monkeypatch.setattr(queue, 'put', failed_handoff)
    try:
        job_id = str(uuid.uuid4())
        body = request_for(job_id)
        response = await client.post('/studio/prompt', json=body, headers=HEADERS)
        assert response.status == 500
        directory = spool.job_directory(tmp_path / 'volume', job_id)
        before = (directory / 'submission.json').read_bytes()
        assert spool.read_record(directory)['submission']['job_id'] == job_id
        assert queue.put_count == 0 and not queue.pending
        monkeypatch.setattr(queue, 'put', put)
        retry = await client.post('/studio/prompt', json=body, headers=HEADERS)
        assert retry.status == 200 and (await retry.json())['already_recorded'] is True
        assert queue.put_count == 0 and calls == [job_id]
        assert (directory / 'submission.json').read_bytes() == before
        assert 'manifest' not in spool.read_record(directory)
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
@pytest.mark.parametrize('result', ['success', 'failure', 'missing', 'outside', 'cancelled-late'])
async def test_engine_terminal_manifest_requires_success_and_owned_output(tmp_path, monkeypatch, result):
    client, queue, _, output = await engine(tmp_path, monkeypatch)
    try:
        job_id = str(uuid.uuid4())
        assert (await client.post('/studio/prompt', json=request_for(job_id), headers=HEADERS)).status == 200
        queue.currently_running[0] = queue.pending.pop()
        if result == 'cancelled-late':
            assert (await client.post('/studio/cancel', json={'job_id': job_id}, headers=HEADERS)).status == 200
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
        elif result == 'cancelled-late':
            assert record['manifest']['state'] == 'cancelled' and not record['manifest']['outputs']
        elif result == 'failure':
            assert record['manifest']['state'] == 'failed'
            assert record['manifest']['outputs'] == []
        else:
            assert 'manifest' not in record
        assert file.read_bytes() == payload
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_measurement_aggregates_and_persists_missing_values(tmp_path, monkeypatch):
    client, _, _, _ = await engine(tmp_path, monkeypatch)
    try:
        module = sys.modules['seed_engine_test_package.telemetry']
        monkeypatch.setattr(module.threading.Thread, 'start', lambda self: None)
        monkeypatch.setattr(module.threading.Thread, 'join', lambda self, **kwargs: None)
        def snapshot(used, ram):
            return {'system': {'ram_total': 8000 * 1024**2, 'ram_free': (8000-ram)*1024**2, 'comfyui_version': 'test', 'argv': ['private']}, 'devices': [{'name': 'Test GPU', 'type': 'cuda', 'index': 0, 'vram_total': 96000 * 1024**2, 'vram_free': (96000-used)*1024**2 if used is not None else None}]}
        samples = iter([snapshot(20000, 1000), snapshot(30000, 2000), snapshot(None, 1000)])
        measurement = module.Measurement(tmp_path, lambda: next(samples))
        for _ in range(4): measurement.collect()
        measurement.finish([('execution_start', {'timestamp': 1000}), ('execution_success', {'timestamp': 4500})])
        import json
        result = json.loads((tmp_path / 'telemetry.json').read_text())
        assert result['gpus'][0]['peak_used_mib'] == 30000
        assert 'mean_utilization_percent' not in result['gpus'][0]
        assert result['software'] == {'comfyui_version': 'test'}
        assert result['system_ram_peak_used_mib'] == 2000
        assert result['failed_samples'] == 1 and result['sample_count'] == 3
        assert result['complete'] and result['execution_seconds'] == 3.5
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_execution_event_starts_measurement_and_failure_finishes_it(tmp_path, monkeypatch):
    client, queue, _, _ = await engine(tmp_path, monkeypatch)
    try:
        module = sys.modules['seed_engine_test_package.telemetry']
        monkeypatch.setattr(module.threading.Thread, 'start', lambda self: None)
        monkeypatch.setattr(module.threading.Thread, 'join', lambda self, **kwargs: None)
        job_id = str(uuid.uuid4())
        assert (await client.post('/studio/prompt', json=request_for(job_id), headers=HEADERS)).status == 200
        queue.currently_running[0] = queue.pending.pop()
        queue.server.send_sync('execution_start', {'prompt_id': job_id})
        queue.task_done(0, {}, types.SimpleNamespace(status_str='error', completed=False))
        record = spool.read_record(spool.job_directory(tmp_path / 'volume', job_id))
        assert record['manifest']['state'] == 'failed'
        assert record['telemetry']['complete']
        assert record['telemetry']['sample_count'] == 0
        assert record['telemetry']['gpus'] == []
        assert record['telemetry']['execution_seconds'] is None
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_quality_readiness_does_not_require_turbo_for_high(tmp_path, monkeypatch):
    monkeypatch.setenv('SEED_WORKER_CLASS', 'video')
    client, _, _, _ = await engine(tmp_path, monkeypatch)
    try:
        models = {
            'diffusion_models': ['minimax_h3_fl2va_pruned_int8_convrot.safetensors', 'minimax_h3_ref2va_pruned_int8_convrot.safetensors'],
            'text_encoders': ['qwen3vl_32b_minimax_h3_int8_convrot.safetensors'],
            'vae': ['minimax_h3_video_vae_fp16.safetensors', 'minimax_h3_audio_vae_fp32.safetensors'],
            'loras': [],
        }
        monkeypatch.setattr(sys.modules['folder_paths'], 'get_filename_list', lambda category: models.get(category, []))
        monkeypatch.setitem(sys.modules, 'nodes', types.SimpleNamespace(NODE_CLASS_MAPPINGS=dict.fromkeys(['ModelAttentionBackend', 'BlockSparseAttention', 'MiniMaxH3SigmaShift'])))
        cuda = types.SimpleNamespace(is_available=lambda: True, device_count=lambda: 1,
            get_device_properties=lambda index: types.SimpleNamespace(name='NVIDIA RTX PRO 6000 Blackwell', total_memory=96 * 1024**3))
        monkeypatch.setitem(sys.modules, 'torch', types.SimpleNamespace(cuda=cuda, device=lambda value: value))
        ck = types.SimpleNamespace(sol_attn_is_available=lambda device: True)
        monkeypatch.setitem(sys.modules, 'comfy_kitchen', ck)
        monkeypatch.setitem(sys.modules, 'comfy.ldm.modules', types.SimpleNamespace(attention=types.SimpleNamespace(COMFY_KITCHEN_INT8_ATTENTION_IS_AVAILABLE=True)))
        video = (await (await client.get('/studio/capabilities')).json())['video']
        assert video['ready'] and video['quality'] == {'high': True}
        assert video['native_export'] and video['profile_revision'] == 'h3-quality-v1'
        models['loras'] = [f'minimax_h3_{route}2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors' for route in ('fl', 'ref')]
        ck.sol_attn_is_available = lambda device: False
        video = (await (await client.get('/studio/capabilities')).json())['video']
        assert video['quality'] == {'high': False}
        models['vae'] = []
        video = (await (await client.get('/studio/capabilities')).json())['video']
        assert not video['ready'] and not any(video['quality'].values())
    finally:
        await client.close()


def high_graph(job_id, adapters):
    graph = {
        '7': {'class_type': 'BasicGuider', 'inputs': {'model': ['19', 0]}},
        '9': {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': 'res_multistep'}},
        '10': {'class_type': 'BasicScheduler', 'inputs': {'model': ['19', 0], 'scheduler': 'simple', 'steps': 30, 'denoise': 1}},
        '14': {'class_type': 'SeedVideoSave', 'inputs': {'filename_prefix': f'seed/{job_id}/video', 'export_version': 'native-v1'}},
        '16': {'class_type': 'MiniMaxH3SigmaShift', 'inputs': {'model': ['1', 0], 'shift_video': 12, 'shift_audio': 3}},
        '17': {'class_type': 'ModelAttentionBackend', 'inputs': {'model': [str(29 + len(adapters)), 0] if adapters else ['16', 0], 'attention': 'comfy kitchen attention'}},
        '19': {'class_type': 'BlockSparseAttention', 'inputs': {'model': ['17', 0], 'selection': 'sol-attn', 'selection.tau': 1.3, 'start_percent': 0.2, 'end_percent': 1, 'dense_blocks': '', 'min_tokens': 12288, 'extra_tokens': 256, 'sink_conditioning': 'exact_kv_and_rows'}},
    }
    for index, item in enumerate(adapters):
        graph[str(30 + index)] = {'class_type': 'LoraLoaderModelOnly', 'inputs': {
            'model': [str(29 + index), 0] if index else ['16', 0], 'lora_name': item['filename'], 'strength_model': item['strength_model']}}
    return graph


def install_adapters(tmp_path, count=1):
    from worker.model_files import activate
    from worker.test_worker_roles import adapter_bytes
    entries, selections = [], []
    for index in range(count):
        payload = adapter_bytes(('adapter-' + str(index)).encode())
        digest = hashlib.sha256(payload).hexdigest()
        entry = {'path': f'loras/seed-{digest}.safetensors', 'sha256': digest, 'size': len(payload), 'routes': ['fl', 'ref']}
        file = tmp_path / 'volume/ComfyUI/models' / entry['path']
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(payload)
        entries.append(entry)
        selections.append({'filename': file.name, 'sha256': digest, 'strength_model': [0, 1.5, 4][index % 3]})
    activate(tmp_path / 'volume', entries)
    return selections


@pytest.mark.asyncio
@pytest.mark.parametrize('change', [None, 'no-profile', 'wrong-profile', 'strength', 'steps', 'turbo', 'filename', 'audio-protection', 'route', 'chain', 'unselected', 'changed-file', 'too-many', 'nan'])
async def test_selected_loras_and_quality_profile_are_verified(tmp_path, monkeypatch, change):
    client, queue, _, _ = await engine(tmp_path, monkeypatch)
    try:
        adapters = install_adapters(tmp_path, 4 if change == 'too-many' else 3)
        job_id = str(uuid.uuid4())
        graph = high_graph(job_id, adapters)
        body = {'prompt_id': job_id, 'prompt': graph, 'loras': adapters, 'route': 'fl', 'video_profile': 'h3-high-v1'}
        if change == 'no-profile': del body['video_profile']
        if change == 'wrong-profile': body['video_profile'] = 'anything'
        if change == 'strength': graph['30']['inputs']['strength_model'] = 0.7
        if change == 'steps': graph['10']['inputs']['steps'] = 8
        if change == 'turbo': graph['5'] = {'class_type': 'LoraLoaderModelOnly'}
        if change == 'filename': graph['30']['inputs']['lora_name'] = 'different.safetensors'
        if change == 'audio-protection': graph['19']['inputs']['sink_conditioning'] = 'off'
        if change == 'route': body['route'] = 'image'
        if change == 'chain': graph['31']['inputs']['model'] = ['16', 0]
        if change == 'unselected': body['loras'] = adapters[:2]
        if change == 'changed-file': (tmp_path / 'volume/ComfyUI/models/loras' / adapters[0]['filename']).write_bytes(b'changed')
        if change == 'nan': body['loras'][0]['strength_model'] = float('nan')
        response = await client.post('/studio/prompt', json=body, headers=HEADERS)
        assert response.status == (422 if change else 200)
        assert queue.put_count == (0 if change else 1)
        if not change:
            record = spool.read_record(spool.job_directory(tmp_path / 'volume', job_id))
            assert record['submission']['video_profile'] == 'h3-high-v1'
            assert [x['strength_model'] for x in record['submission']['loras']] == [0, 1.5, 4]
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_worker_class_fences_video_on_image_worker(tmp_path, monkeypatch):
    monkeypatch.setenv('SEED_WORKER_CLASS', 'image')
    client, queue, _, _ = await engine(tmp_path, monkeypatch)
    try:
        job_id = str(uuid.uuid4())
        response = await client.post('/studio/prompt', json={'prompt_id': job_id, 'prompt': high_graph(job_id, []), 'loras': [], 'route': 'fl', 'video_profile': 'h3-high-v1'}, headers=HEADERS)
        assert response.status == 422 and queue.put_count == 0
    finally:
        await client.close()
