import hashlib
import pytest
from worker.model_files import probe
from worker.preparation import manifest


@pytest.mark.parametrize('token,expected', [('', False), ('fixture-token', 'fixture-token')])
def test_hub_download_uses_explicit_anonymous_auth(tmp_path, monkeypatch, token, expected):
    import sys
    from types import SimpleNamespace
    from worker.prepare import hf_fetch
    calls = []
    def download(**kwargs):
        calls.append(kwargs)
        return str(tmp_path / 'model')
    monkeypatch.setitem(sys.modules, 'huggingface_hub', SimpleNamespace(hf_hub_download=download))
    hf_fetch(item(b'model'), tmp_path, token)
    assert calls[0]['token'] == expected


def item(data):
    return {'path':'diffusion_models/example.safetensors', 'url':'https://huggingface.co/test/model/resolve/'+'a'*40+'/example.safetensors', 'sha256':hashlib.sha256(data).hexdigest(), 'size':len(data)}


def test_cold_warm_and_changed_cache(tmp_path, monkeypatch):
    import worker.model_files as module
    asset=item(b'model'); target=tmp_path/'ComfyUI/models'/asset['path']
    target.parent.mkdir(parents=True); target.write_bytes(b'model')
    probe(tmp_path,[asset])
    original=module.verified
    monkeypatch.setattr(module,'verified',lambda *a:pytest.fail('Warm cache rehashed'))
    probe(tmp_path,[asset])
    monkeypatch.setattr(module,'verified',original)
    target.write_bytes(b'wrong')
    assert not probe(tmp_path,[asset])[0]['ready']
    assert target.read_bytes()==b'wrong'


def test_symlink_escape_is_rejected(tmp_path):
    outside=tmp_path/'outside';outside.mkdir()
    workspace=tmp_path/'workspace';workspace.mkdir()
    try:(workspace/'.seed').symlink_to(outside,target_is_directory=True)
    except OSError:pytest.skip('Symlink creation requires OS permission')
    with pytest.raises(ValueError):manifest(workspace,[item(b'model')])
    assert list(outside.iterdir())==[]
