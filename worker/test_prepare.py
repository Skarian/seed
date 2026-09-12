import hashlib
import pytest
from worker.prepare import prepare


def item(data):
    return {'path':'diffusion_models/example.safetensors', 'url':'https://huggingface.co/test/model/resolve/'+'a'*40+'/example.safetensors', 'sha256':hashlib.sha256(data).hexdigest(), 'size':len(data)}


def test_cold_warm_and_changed_cache(tmp_path, monkeypatch):
    import worker.prepare as module
    asset=item(b'model'); target=tmp_path/'ComfyUI/models'/asset['path']
    target.parent.mkdir(parents=True); target.write_bytes(b'model')
    prepare(tmp_path,[asset])
    original=module.matches
    monkeypatch.setattr(module,'matches',lambda *a:pytest.fail('Warm cache rehashed'))
    prepare(tmp_path,[asset])
    monkeypatch.setattr(module,'matches',original)
    target.write_bytes(b'wrong')
    with pytest.raises(ValueError,match='integrity'):prepare(tmp_path,[asset])
    assert target.read_bytes()==b'wrong'


def test_waits_for_atomic_delivery_without_downloading(tmp_path, monkeypatch):
    import worker.prepare as module
    asset=item(b'model'); target=tmp_path/'ComfyUI/models'/asset['path']
    monkeypatch.setattr(module,'hf_fetch',lambda *a:pytest.fail('Supervisor downloaded'))
    def deliver(_):
        target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(b'model')
    monkeypatch.setattr(module.time,'sleep',deliver)
    events=[];prepare(tmp_path,[asset],report=lambda **s:events.append(s))
    assert events[-1]['phase']=='models ready'
    assert len(list((tmp_path/'.seed/models').glob('*.json')))==1


def test_rejects_invalid_manifest_before_waiting(tmp_path, monkeypatch):
    import worker.prepare as module
    monkeypatch.setattr(module.time,'sleep',lambda _:pytest.fail('Invalid manifest waited'))
    for change in [{'path':'../outside'},{'url':'https://huggingface.co/test/model/resolve/main/file'}]:
        asset=item(b'model');asset.update(change)
        with pytest.raises(ValueError):prepare(tmp_path,[item(b'model'),asset])


def test_symlink_escape_is_rejected(tmp_path):
    outside=tmp_path/'outside';outside.mkdir()
    workspace=tmp_path/'workspace';workspace.mkdir()
    try:(workspace/'.seed').symlink_to(outside,target_is_directory=True)
    except OSError:pytest.skip('Symlink creation requires OS permission')
    with pytest.raises(ValueError,match='root'):prepare(workspace,[item(b'model')])
    assert list(outside.iterdir())==[]
