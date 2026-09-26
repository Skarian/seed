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
