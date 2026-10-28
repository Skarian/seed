"""Real Windows CPU process startup failure; no engine or power request."""
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
import pytest


@pytest.mark.skipif(os.name != 'nt', reason='Windows Job Objects')
def test_failed_gateway_launch_records_failure_and_never_runs_a_member(tmp_path):
    repo = Path(__file__).resolve().parents[1]
    diag = tmp_path / 'diagnostics'
    result = subprocess.run([
        getattr(sys, '_base_executable', sys.executable), '-B', '-m', 'worker.local_supervisor',
        '--parent-pid', str(os.getpid()), '--cwd', str(repo), '--log', str(tmp_path/'gateway.log'),
        '--diagnostics', str(diag), '--await-owner', '--gateway-only',
        '--device-id', 'test-' + uuid.uuid4().hex, '--', str(tmp_path/'missing.exe')],
        cwd=repo, env={**os.environ, 'PYTHONPATH': str(repo)}, input='launch\n',
        capture_output=True, text=True, timeout=20)
    assert result.returncode != 0
    events = [json.loads(line) for line in result.stdout.splitlines()]
    assert [event['event'] for event in events] == ['supervisor_start', 'contained', 'launch_failed']
    assert events[-1]['error_type'] == 'FileNotFoundError'
    assert events[1]['owner_created'].isdecimal() and events[1]['supervisor_created'].isdecimal()
    assert json.loads((diag/'members.json').read_text()) == []
    assert (diag/'launch-authorized.json').exists()
