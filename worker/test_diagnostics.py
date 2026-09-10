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
    with pytest.raises(SystemExit): run.prepare_process(tmp_path, [], 'private-token', messages, file)
    record = json.loads(file.read_text())
    assert record['phase'] == 'downloading vae/example.safetensors'
    assert 'quota' in record['message']
    assert 'signed-url' not in file.read_text() and 'private-token' not in file.read_text()


def test_access_denial_and_connection_failure_are_actionable():
    class Denied(Exception):
        response = type('Response', (), {'status_code': 403})()
    assert 'account access' in run.preparation_failure(Denied('secret'))[0]
    assert 'resume' in run.preparation_failure(TimeoutError('secret'))[0]
    wrapper = RuntimeError('private provider wrapper')
    wrapper.__cause__ = Denied('private inner exception')
    assert 'account access' in run.preparation_failure(wrapper)[0]
