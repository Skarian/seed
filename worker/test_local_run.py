"""Local configuration must preserve the private gateway and cloud defaults."""
import json
import os
import subprocess
import sys
from types import SimpleNamespace
import pytest
from worker.local_run import launch_config, loopback
from worker import local_run


@pytest.mark.parametrize('origin', ['http://0.0.0.0:9000', 'http://localhost:9000', 'https://127.0.0.1:9000',
    'http://127.0.0.1:9000/path', 'http://user@127.0.0.1:9000', 'http://127.0.0.1:9000?x=1'])
def test_private_origin(origin):
    with pytest.raises(ValueError): loopback(origin)


def test_role_configuration(tmp_path):
    config = {key: str(tmp_path/key) for key in ('workspace', 'runtime', 'models', 'source')}
    config.update(role='video', python='python.exe', comfy_origin='http://127.0.0.1:45891', flags=['--disable-comfy-compiler'])
    command = launch_config(config)
    assert command[command.index('--listen')+1] == '127.0.0.1'
    assert command[command.index('--port')+1] == '45891'
    assert '--disable-comfy-compiler' in command
    paths = json.loads((tmp_path/'runtime/model-paths.yaml').read_text())
    assert paths['seed']['base_path'] == str(tmp_path/'models')
    assert paths['seed']['text_encoders'] == 'text_encoders'
    assert paths['seed_adapters'] == {'base_path': str(tmp_path/'workspace/ComfyUI/models'), 'loras': 'loras'}
    config['flags'] = ['--listen=0.0.0.0']
    with pytest.raises(ValueError): launch_config(config)


@pytest.mark.asyncio
async def test_exit_record_precedes_gateway_exit(tmp_path):
    calls = []
    def exit_process(code):
        record = json.loads((tmp_path/'engine-exit.json').read_text())
        calls.append((code, record['exit_code']))
    await local_run.watch_engine(SimpleNamespace(poll=lambda: 7, returncode=7), tmp_path, exit_process)
    assert calls == [(3, 7)]


@pytest.mark.asyncio
@pytest.mark.skipif(os.name != 'nt', reason='Windows process ownership')
async def test_gateway_cleanup_leaves_its_cpu_dummy_engine_alive(tmp_path, monkeypatch):
    processes = []
    native = subprocess.Popen
    def start(*args, **kwargs):
        process = native(*args, **kwargs)
        processes.append(process)
        return process
    monkeypatch.setattr(local_run.subprocess, 'Popen', start)
    monkeypatch.setattr(local_run, 'launch_config', lambda config: [sys.executable, '-c', 'import time; time.sleep(60)'])
    context = local_run.engine_context({'runtime': str(tmp_path), 'source': str(tmp_path)})({local_run.PREPARATION: {}})
    try:
        await anext(context)
        await context.aclose()
        assert len(processes) == 1 and processes[0].poll() is None
    finally:
        for process in processes:
            if process.poll() is None: process.terminate()
            process.wait(timeout=5)
