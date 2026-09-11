import hashlib
import pytest
from worker.prepare import prepare

def item(data):
    return {'path': 'diffusion_models/example.safetensors', 'url': 'https://huggingface.co/test/model/resolve/' + 'a'*40 + '/example.safetensors', 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}

def test_cold_warm_and_changed_cache(tmp_path):
    calls = []
    def fetch(asset, stage, token):
        calls.append(asset)
        file = stage / 'example.safetensors'
        file.write_bytes(b'model')
        return file
    prepare(tmp_path, [item(b'model')], 'test-only', fetch=fetch)
    assert len(calls) == 1
    prepare(tmp_path, [item(b'model')], 'test-only', fetch=lambda *args: pytest.fail('Warm startup downloaded a model'))
    target = tmp_path / 'ComfyUI/models/diffusion_models/example.safetensors'
    target.write_bytes(b'wrong')
    prepare(tmp_path, [item(b'model')], 'test-only', fetch=fetch)
    assert target.read_bytes() == b'model'
    assert len(calls) == 2

def test_failed_download_preserves_existing_model(tmp_path):
    target = tmp_path / 'ComfyUI/models/diffusion_models/example.safetensors'
    target.parent.mkdir(parents=True)
    target.write_bytes(b'previous')
    def fetch(asset, stage, token):
        file = stage / 'bad'; file.write_bytes(b'wrong'); return file
    with pytest.raises(ValueError, match='integrity'):
        prepare(tmp_path, [item(b'model')], 'test-only', fetch=fetch)
    assert target.read_bytes() == b'previous'
    assert not list((tmp_path / '.seed/models').glob('*.json'))

def test_manifest_rejects_paths_and_mutable_sources(tmp_path):
    invalid = item(b'model'); invalid['path'] = '../outside'
    with pytest.raises(ValueError): prepare(tmp_path, [invalid], 'test-only')
    invalid = item(b'model'); invalid['url'] = invalid['url'].replace('a'*40, 'main')
    with pytest.raises(ValueError): prepare(tmp_path, [invalid], 'test-only')

def test_resume_does_not_require_duplicate_full_file_capacity(tmp_path, monkeypatch):
    from types import SimpleNamespace
    import worker.prepare as module
    asset = item(b'model')
    asset['size'] = 27 * 1024**3
    monkeypatch.setattr(module.shutil, 'disk_usage', lambda _: SimpleNamespace(free=15 * 1024**3))
    called = []
    def resume(asset, stage, token):
        called.append(True)
        raise ConnectionError('simulated interrupted resume')
    with pytest.raises(ConnectionError): prepare(tmp_path, [asset], 'test-only', fetch=resume)
    assert called == [True]

def test_storage_symlink_escape_rejected(tmp_path):
    outside = tmp_path / 'outside'; outside.mkdir()
    workspace = tmp_path / 'volume'; workspace.mkdir()
    try: (workspace / '.seed').symlink_to(outside, target_is_directory=True)
    except OSError: pytest.skip('Symlink creation requires OS permission')
    with pytest.raises(ValueError, match='root'):
        prepare(workspace, [item(b'model')], 'test-only')
    assert list(outside.iterdir()) == []

def test_complete_staging_recovers_without_duplicate_disk_space(tmp_path, monkeypatch):
    from types import SimpleNamespace
    import worker.prepare as module
    asset = item(b'model')
    stage = tmp_path / '.seed/downloads' / asset['sha256']
    stage.mkdir(parents=True)
    (stage / 'example.safetensors').write_bytes(b'model')
    monkeypatch.setattr(module.shutil, 'disk_usage', lambda _: SimpleNamespace(free=100))
    prepare(tmp_path, [asset], 'test-only', fetch=lambda *args: pytest.fail('Complete stage downloaded again'))
    assert (tmp_path / 'ComfyUI/models' / asset['path']).read_bytes() == b'model'


def test_pc_transfer_preparation_never_downloads(tmp_path):
    asset = item(b'model')
    target=tmp_path/'ComfyUI/models'/asset['path']
    target.parent.mkdir(parents=True); target.write_bytes(b'model')
    prepare(tmp_path,[asset],'',fetch=lambda *args:pytest.fail('Offline preparation contacted model source'))
    assert len(list((tmp_path/'.seed/models').glob('*.json')))==1


def test_waits_for_atomic_pc_delivery(tmp_path, monkeypatch):
    import worker.prepare as module
    asset=item(b'model'); target=tmp_path/'ComfyUI/models'/asset['path']
    def deliver(_):
        target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(b'model')
    monkeypatch.setattr(module.time,'sleep',deliver)
    prepare(tmp_path,[asset],'',fetch=lambda *args:pytest.fail('Offline download'))
    assert target.read_bytes()==b'model'
