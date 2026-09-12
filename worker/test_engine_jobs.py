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
    telemetry_spec = importlib.util.spec_from_file_location(package.__name__ + '.telemetry', Path(__file__).parent / 'comfy_seed/telemetry.py')
    telemetry = importlib.util.module_from_spec(telemetry_spec)
    telemetry_spec.loader.exec_module(telemetry)
    monkeypatch.setitem(sys.modules, package.__name__ + '.telemetry', telemetry)
    spec = importlib.util.spec_from_file_location(package.__name__ + '.jobs', Path(__file__).parent / 'comfy_seed/jobs.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setitem(sys.modules, spec.name, module)
    server = types.SimpleNamespace(routes=web.RouteTableDef(), prompt_queue=NativeQueue(), number=0, send_sync=lambda *args: None)
    queue_server = server
    server.prompt_queue.server = queue_server
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
@pytest.mark.parametrize('invalid', [None, 'missing', 'duplicate', 'outside'])
async def test_frame_set_manifest(tmp_path, monkeypatch, invalid):
    client, queue, _, output = await engine(tmp_path, monkeypatch)
    try:
        job_id = str(uuid.uuid4())
        graph = {'14': {'class_type': 'SaveImage', 'inputs': {'images': ['15', 0], 'filename_prefix': f'seed/{job_id}/frames'}},
                 '15': {'class_type': 'ImageFromBatch', 'inputs': {'image': ['12', 0], 'batch_index': 0, 'length': 120}}}
        assert (await client.post('/studio/prompt', json={'prompt_id': job_id, 'prompt': graph}, headers=HEADERS)).status == 200
        queue.currently_running[0] = queue.pending.pop()
        folder = output / 'seed' / job_id
        folder.mkdir(parents=True)
        entries = []
        for index in range(120):
            file = folder / f'frame_{index:05}.png'
            file.write_bytes(b'closed-frame')
            entries.append({'filename': file.name, 'subfolder': f'seed/{job_id}', 'type': 'output'})
        if invalid == 'missing': entries.pop()
        if invalid == 'duplicate': entries[1] = entries[0]
        if invalid == 'outside': entries[0]['subfolder'] = 'seed/other'
        queue.task_done(0, {'outputs': {'14': {'images': entries}}}, types.SimpleNamespace(status_str='success', completed=True))
        record = spool.read_record(spool.job_directory(tmp_path / 'volume', job_id))
        if invalid: assert 'manifest' not in record
        else:
            assert len(record['manifest']['outputs']) == 120
            assert record['manifest']['outputs'][-1]['id'] == '119'
            assert record['manifest']['outputs'][0]['mime_type'] == 'image/png'
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_quality_readiness_does_not_require_turbo_for_high(tmp_path, monkeypatch):
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
        monkeypatch.setitem(sys.modules, 'torch', types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True), device=lambda value: value))
        ck = types.SimpleNamespace(sol_attn_is_available=lambda device: True)
        monkeypatch.setitem(sys.modules, 'comfy_kitchen', ck)
        monkeypatch.setitem(sys.modules, 'comfy.ldm.modules', types.SimpleNamespace(attention=types.SimpleNamespace(COMFY_KITCHEN_INT8_ATTENTION_IS_AVAILABLE=True)))
        video = (await (await client.get('/studio/capabilities')).json())['video']
        assert video['ready'] and video['quality'] == {'high': True, 'fast': False}
        assert video['native_export'] and video['profile_revision'] == 'h3-quality-v1'
        models['loras'] = [f'minimax_h3_{route}2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors' for route in ('fl', 'ref')]
        ck.sol_attn_is_available = lambda device: False
        video = (await (await client.get('/studio/capabilities')).json())['video']
        assert video['quality'] == {'high': False, 'fast': True}
        models['vae'] = []
        video = (await (await client.get('/studio/capabilities')).json())['video']
        assert not video['ready'] and not any(video['quality'].values())
    finally:
        await client.close()


def high_graph(job_id, preset):
    return {
        '7': {'class_type': 'BasicGuider', 'inputs': {'model': ['19', 0]}},
        '9': {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': 'res_multistep'}},
        '10': {'class_type': 'BasicScheduler', 'inputs': {'model': ['19', 0], 'scheduler': 'simple', 'steps': 30, 'denoise': 1}},
        '14': {'class_type': 'SeedVideoSave', 'inputs': {'filename_prefix': f'seed/{job_id}/video', 'export_version': 'native-v1'}},
        '16': {'class_type': 'MiniMaxH3SigmaShift', 'inputs': {'model': ['1', 0], 'shift_video': 12, 'shift_audio': 3}},
        '17': {'class_type': 'ModelAttentionBackend', 'inputs': {'model': ['18', 0], 'attention': 'comfy kitchen attention'}},
        '18': {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['16', 0], 'lora_name': preset['filename'], 'strength_model': 0.8}},
        '19': {'class_type': 'BlockSparseAttention', 'inputs': {'model': ['17', 0], 'selection': 'sol-attn', 'selection.tau': 1.3, 'start_percent': 0.2, 'end_percent': 1, 'dense_blocks': '', 'min_tokens': 12288, 'extra_tokens': 256, 'sink_conditioning': 'exact_kv_and_rows'}},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize('change', [None, 'no-profile', 'wrong-profile', 'strength', 'steps', 'turbo', 'filename', 'audio-protection'])
async def test_high_quality_effective_preset_strength_is_bound_to_profile(tmp_path, monkeypatch, change):
    client, queue, _, _ = await engine(tmp_path, monkeypatch)
    try:
        digest = hashlib.sha256(b'preset').hexdigest()
        preset = {'sha256': digest, 'filename': f'seed-{digest}.safetensors', 'strength_model': 1}
        asset = tmp_path / preset['filename']
        asset.write_bytes(b'preset')
        receipt = tmp_path / 'volume/.seed/presets/assets' / (digest + '.json')
        spool.atomic(receipt, {'sha256': digest, 'size': asset.stat().st_size, 'mtime_ns': asset.stat().st_mtime_ns})
        job_id = str(uuid.uuid4())
        graph = high_graph(job_id, preset)
        body = {'prompt_id': job_id, 'prompt': graph, 'preset': preset, 'video_profile': 'h3-high-v1'}
        if change == 'no-profile': del body['video_profile']
        if change == 'wrong-profile': body['video_profile'] = 'anything'
        if change == 'strength': graph['18']['inputs']['strength_model'] = 0.7
        if change == 'steps': graph['10']['inputs']['steps'] = 8
        if change == 'turbo': graph['5'] = {'class_type': 'LoraLoaderModelOnly'}
        if change == 'filename': graph['18']['inputs']['lora_name'] = 'different.safetensors'
        if change == 'audio-protection': graph['19']['inputs']['sink_conditioning'] = 'off'
        response = await client.post('/studio/prompt', json=body, headers=HEADERS)
        assert response.status == (422 if change else 200)
        assert queue.put_count == (0 if change else 1)
        assert preset['strength_model'] == 1
        if not change:
            record = spool.read_record(spool.job_directory(tmp_path / 'volume', job_id))
            assert record['submission']['video_profile'] == 'h3-high-v1'
    finally:
        await client.close()
