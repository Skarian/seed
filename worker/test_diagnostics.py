import errno
import json
import queue
import pytest
from worker import run


def test_preparation_failure_keeps_context_without_provider_secrets(tmp_path, monkeypatch):
    def failing(*args, report):
        report(phase='downloading vae/example.safetensors')
        raise OSError(errno.EDQUOT, 'signed-url-and-secret-must-not-be-logged')
    monkeypatch.setattr(run, 'prepare', failing)
    messages = queue.SimpleQueue()
    file = tmp_path/'preparation-error.json'
    with pytest.raises(SystemExit): run.prepare_process(tmp_path, [], messages, file)
    record = json.loads(file.read_text())
    assert record['phase'] == 'downloading vae/example.safetensors'
    assert 'quota' in record['message']
    assert 'signed-url' not in file.read_text() and 'private-token' not in file.read_text()


@pytest.mark.parametrize('mode,public,bind,local', [
    ('ssh','http://127.0.0.1:18080','127.0.0.1',True),
    ('https','https://abc-8080.proxy.runpod.net','0.0.0.0',False),
])
def test_supported_startup(mode, public, bind, local, tmp_path):
    assert run.startup_config({'SEED_TRANSPORT':mode,'SEED_WORKSPACE':str(tmp_path),'RUNPOD_POD_ID':'abc'}) == (str(tmp_path),public,bind,local)


@pytest.mark.parametrize('env', [
    {'SEED_TRANSPORT':'other'},
    {'SEED_TRANSPORT':'ssh','SEED_PUBLIC_URL':'http://0.0.0.0:18080'},
    {'SEED_TRANSPORT':'https','SEED_PUBLIC_URL':'http://127.0.0.1:18080'},
    {'SEED_TRANSPORT':'ssh','SEED_WORKSPACE':'relative'},
])
def test_invalid_startup(env):
    with pytest.raises(ValueError): run.startup_config(env)
