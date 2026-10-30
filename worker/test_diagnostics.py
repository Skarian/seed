import json
import pytest
from worker import run


def test_child_environment_excludes_enrollment_and_source_credentials(monkeypatch):
    for key in ['HF_TOKEN', 'CIVITAI_API_TOKEN', 'TS_AUTHKEY', 'TAILSCALE_CLIENT_SECRET']:
        monkeypatch.setenv(key, 'must-not-reach-engine')
    assert 'must-not-reach-engine' not in run.child_environment().values()


@pytest.mark.parametrize('mode,public,bind,local', [
    ('ssh','http://127.0.0.1:18080','127.0.0.1',True),
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


def config(tmp_path, **values):
    return {'workspace': str(tmp_path/'workspace'), 'runtime': str(tmp_path/'runtime'), 'models': str(tmp_path/'models'), 'source': str(tmp_path/'ComfyUI'),
            'python': 'python', 'origin': 'http://127.0.0.1:9001', 'comfy_origin': 'http://127.0.0.1:9002', 'pairing_secret': 'x'*32, **values}


def test_cloud_and_local_share_one_launch_with_one_flag_list(tmp_path, monkeypatch):
    monkeypatch.setenv('SEED_WORKER_CLASS', 'image')
    cloud = run.cloud_config({'SEED_WORKSPACE': str(tmp_path/'workspace'), 'SEED_RUNTIME_DIR': str(tmp_path/'runtime'), 'SEED_PAIRING_SECRET': 'x'*32})
    assert cloud['prepare_models'] and cloud['qwen_models'] and cloud['port'] == 8080
    command = run.launch_config(cloud)
    assert command[-1] == '--disable-comfy-compiler' and command.count('--disable-comfy-compiler') == 1
    assert '--fast-disk' not in command and '--disable-pinned-memory' not in command
    file = tmp_path/'launch.json'
    file.write_text(json.dumps(config(tmp_path)))
    local = run.local_config(file)
    assert local['port'] == 9001
    assert run.launch_config(local)[-3:] == command[-3:]
    paths = json.loads((tmp_path/'runtime/extra-model-paths.yaml').read_text())
    assert paths['seed']['base_path'] == str(tmp_path/'models') and paths['seed_adapters']['loras'] == 'loras' and 'qwen' not in paths


@pytest.mark.parametrize('values', [{'origin': 'http://127.0.0.1:9002'}, {'origin': 'http://0.0.0.0:9001'}, {'comfy_origin': 'https://127.0.0.1:9002'}])
def test_local_config_rejects_unsafe_origins(tmp_path, values):
    file = tmp_path/'launch.json'
    file.write_text(json.dumps(config(tmp_path, **values)))
    with pytest.raises(ValueError): run.local_config(file)
