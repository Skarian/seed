import asyncio
import hashlib
import json
from pathlib import Path
import pytest
from aiohttp import web
from worker.preparation import Preparation, manifest
from worker.model_files import activate, locations
from worker.profile import hardware_capabilities, identity, role_models, installed_loras
from worker.download_process import prepare


def adapter_bytes(data=b'adapter'):
    import struct
    header = json.dumps({'__metadata__': {'fixture': data.decode()},
        'layer.lora_A.weight': {'dtype': 'F32', 'shape': [1, 1], 'data_offsets': [0, 4]},
        'layer.lora_B.weight': {'dtype': 'F32', 'shape': [1, 1], 'data_offsets': [4, 8]}}).encode()
    return len(header).to_bytes(8, 'little') + header + struct.pack('<ff', 1.0, 1.0)


def adapter(data=b'adapter', routes=None):
    data = adapter_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    return {'path': 'loras/seed-' + digest + '.safetensors', 'url': 'https://civitai.com/api/download/models/42?fileId=99',
            'sha256': digest, 'size': len(data), 'routes': routes or ['image']}


def test_roles_have_disjoint_pinned_base_assets(monkeypatch, tmp_path):
    image, video = role_models('image'), role_models('video')
    assert not set(x['path'] for x in image) & set(x['path'] for x in video)
    assert len(image) == 3 and len(video) == 5
    assert all(not item['path'].startswith('loras/') for item in image + video)
    monkeypatch.setenv('SEED_WORKER_CLASS', 'image')
    assert identity()['worker_class'] == 'image' and identity()['protocol_version'] == 2
    manifest(tmp_path, image + [adapter()])
    for bad in (video, image[:-1], image + [adapter(routes=['ref'])]):
        with pytest.raises(ValueError): manifest(tmp_path, bad)
    monkeypatch.setenv('SEED_WORKER_CLASS', 'video')
    manifest(tmp_path, video + [adapter(routes=['fl', 'ref'])])


def test_public_direct_download_needs_no_credentials(monkeypatch, tmp_path):
    item = adapter()
    calls = []
    def download(workspace, entry, token, progress=None):
        calls.append((entry['url'], token))
        file, _ = locations(workspace, entry)
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(adapter_bytes())
        return {'ready': True}
    monkeypatch.setattr('worker.download_process.direct_download', download)
    events = []
    prepare(tmp_path, [item], {}, events.append)
    assert calls == [(item['url'], '')]
    assert events[-1] == {'complete': True}
    assert installed_loras(tmp_path) == [{'filename': Path(item['path']).name, 'sha256': item['sha256'], 'routes': ['image']}]


@pytest.mark.asyncio
async def test_omission_is_explicit_failed_optional_only_and_revision_fenced(tmp_path, monkeypatch):
    base = {'path': 'vae/base.bin', 'url': 'https://huggingface.co/test/base/resolve/' + 'a'*40 + '/base.bin',
            'sha256': hashlib.sha256(b'base').hexdigest(), 'size': 4}
    item = adapter()
    manager = Preparation(tmp_path/'workspace', tmp_path/'runtime', {})
    entries, digest = manifest(manager.workspace, [base, item])
    manager.intent = {'entries': entries, 'digest': digest, 'revision': 0, 'cancelled': False, 'omitted_paths': []}
    manager.state = 'needs_source'
    manager.files = {base['path']: {'path': base['path'], 'state': 'ready', 'ready': True},
                     item['path']: {'path': item['path'], 'state': 'needs_source', 'ready': False}}
    resumed = []
    async def run(credentials):
        resumed.extend(manager.entries())
        activate(manager.workspace, [])
        manager.state = 'ready'
        manager.ready.set()
    monkeypatch.setattr(manager, 'run', run)
    with pytest.raises(ValueError): await manager.omit([base['path']], 0)
    with pytest.raises(web.HTTPConflict): await manager.omit([item['path']], 9)
    state = await manager.omit([item['path']], 0)
    await manager.task
    assert state['revision'] == 1 and state['digest'] == digest
    assert resumed == [base]
    assert manager.refresh()['installed_loras'] == []
    saved = json.loads(manager.file.read_text())
    assert saved['entries'] == entries and saved['omitted_paths'] == [item['path']]
    with pytest.raises(web.HTTPConflict): await manager.omit([item['path']], 1)
    with pytest.raises(web.HTTPConflict): await manager.ensure(entries, {}, 0)


def test_boot_inventory_contains_every_verified_adapter_without_strengths(tmp_path):
    entries = [adapter(b'one'), adapter(b'two')]
    for entry, data in zip(entries, [b'one', b'two']):
        file, _ = locations(tmp_path, entry)
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(adapter_bytes(data))
    activate(tmp_path, entries)
    assert len(installed_loras(tmp_path)) == 2
    assert all('strength_model' not in item for item in installed_loras(tmp_path))
    assert not (tmp_path/'.seed/presets/active.json').exists()


def test_download_rejects_non_adapter_even_with_matching_hash(tmp_path):
    from worker.model_files import direct_download
    payload = b'not-safetensors'
    item = adapter()
    item.update(sha256=hashlib.sha256(payload).hexdigest(), size=len(payload))
    item['path'] = 'loras/seed-' + item['sha256'] + '.safetensors'
    def download(entry, stage, token):
        file = stage/'download'
        file.write_bytes(payload)
        return file
    result = direct_download(tmp_path, item, '', download)
    assert result['ready'] is False and result['error_type'] == 'AdapterValidationError'
    assert 'LoRA/LoKR' in result['error']
    assert not locations(tmp_path, item)[0].exists()


def test_qwen_lock_has_real_complete_weights_and_no_floating_revision():
    value = json.loads(Path(__file__).with_name('qwen-model.json').read_text())
    assert len(value['revision']) == 40 and len(value['comfy_revision']) == 40
    assert value['total_bytes'] == sum(item['size'] for item in value['files'])
    assert 17_000_000_000 < value['total_bytes'] < 18_000_000_000
    for component in ('diffusion_models', 'text_encoders', 'vae'):
        assert any(item['path'].startswith(component + '/') and item['path'].endswith('.safetensors') and item['size'] > 1_000_000 for item in value['files'])


@pytest.mark.parametrize('role,name,gib,count,ready', [
    ('image', 'NVIDIA GeForce RTX 5090', 31, 1, True),
    ('image', 'NVIDIA GeForce RTX 4090', 24, 1, False),
    ('image', 'NVIDIA RTX PRO 6000 Blackwell', 96, 2, False),
    ('video', 'NVIDIA RTX PRO 6000 Blackwell Server Edition', 92, 1, True),
    ('video', 'NVIDIA RTX PRO 6000 Blackwell', 90, 1, False),
    ('video', 'NVIDIA A100', 96, 1, False),
    ('image', '', 0, 0, False),
])
def test_reported_gpu_gates_role_readiness(role, name, gib, count, ready):
    from types import SimpleNamespace
    cuda = SimpleNamespace(is_available=lambda: count > 0, device_count=lambda: count,
        get_device_properties=lambda index: SimpleNamespace(name=name, total_memory=gib * 1024**3))
    result = hardware_capabilities(role, cuda)
    assert result['ready'] is ready
    assert bool(result['error']) is not ready
    assert len(result['devices']) == count


def test_cuda_initialization_error_is_safe_not_ready():
    from types import SimpleNamespace
    def unavailable(): raise RuntimeError('private driver internals')
    result = hardware_capabilities('video', SimpleNamespace(is_available=unavailable))
    assert not result['ready'] and 'private' not in result['error']
