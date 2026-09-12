"""Run inside the Linux worker image; no keys, network or GPU needed."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

python = sys.executable
launcher = '/opt/seed/worker/owned_process.py'


def alive(pid):
    try: return Path(f'/proc/{pid}/stat').read_text().split()[2] != 'Z'
    except FileNotFoundError: return False


def wait(check):
    for _ in range(100):
        if check(): return
        time.sleep(0.05)
    raise AssertionError('Child ownership condition did not become true')


with tempfile.TemporaryDirectory() as directory:
    marker = str(Path(directory)/'children.json')
    sibling = subprocess.Popen([python, '-c', 'import time; time.sleep(600)'])
    try:
        command = "import subprocess,sys,os,json,time; from pathlib import Path; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(600)']); Path(sys.argv[1]).write_text(json.dumps([os.getpid(),p.pid])); time.sleep(600)"
        arguments = [python, '-c', command, marker]
        supervisor_code = "import os,subprocess,sys,time; subprocess.Popen([sys.executable,sys.argv[1],str(os.getpid()),*sys.argv[2:]],start_new_session=True); time.sleep(600)"
        supervisor = subprocess.Popen([python, '-c', supervisor_code, launcher, *arguments])
        wait(lambda: Path(marker).exists())
        children = json.loads(Path(marker).read_text())
        supervisor.kill(); supervisor.wait()
        wait(lambda: all(not alive(pid) for pid in children))
        assert alive(sibling.pid)
        Path(marker).unlink()
        # A main command exiting must also close its leftover descendant.
        command = command.replace('time.sleep(600)', 'time.sleep(600)', 1)
        command = command.rsplit('; time.sleep(600)', 1)[0]
        finished = subprocess.run([python, launcher, str(os.getpid()), python, '-c', command, marker], timeout=10)
        assert finished.returncode == 0
        children = json.loads(Path(marker).read_text())
        wait(lambda: all(not alive(pid) for pid in children))
        result = subprocess.run([python, launcher, str(os.getpid()), python, '-c', 'import sys; print(sys.stdin.read()); sys.exit(7)'], input='roundtrip', text=True, capture_output=True, timeout=10)
        assert result.returncode == 7 and result.stdout.strip() == 'roundtrip'
        # Parent died before registration: never launch a command under another parent.
        result = subprocess.run([python, launcher, '99999999', python, '-c', 'raise Exception("must not run")'], capture_output=True, timeout=10)
        assert result.returncode == 1 and not result.stderr
        assert alive(sibling.pid)
        print('PASS: parent death, leftover grandchild, unrelated sibling, expected parent, exit status and stdin/stdout')
    finally:
        sibling.kill(); sibling.wait()
