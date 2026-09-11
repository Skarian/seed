"""Compatibility launcher for the pinned Seed image; invoked over private SSH."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def prepare_entrypoint(source):
    changes = [
        ("os.environ['SEED_PAIRING_SECRET'], public)", "os.environ['SEED_PAIRING_SECRET'], public, development=True)"),
        ("host='0.0.0.0', port=8080", "host='127.0.0.1', port=8080"),
        ("'--ip=0.0.0.0'", "'--ip=127.0.0.1'"),
    ]
    for before, after in changes:
        if source.count(before) == 1:
            source = source.replace(before, after)
        elif source.count(after) != 1:
            raise ValueError('Pinned worker entrypoint is incompatible; inspect the image before booting.')
    return source


def preparation():
    manifest = json.loads(Path('/opt/seed/worker/models.json').read_text())
    stages = list(Path('/.seed/downloads').glob('*'))
    receipts = list(Path('/.seed/models').glob('*.json'))
    start = min((p.stat().st_ctime for p in stages), default=None)
    end = max((p.stat().st_mtime for p in receipts), default=None)
    total = sum(x['size'] for x in manifest)
    complete = len(receipts) == len(manifest)
    seconds = end - start if complete and start is not None else None
    return dict(observed_at=time.time(), first_stage_at=start, last_verified_at=end,
                verified_files=len(receipts), expected_files=len(manifest), total_bytes=total,
                verified_bytes=sum(json.loads(p.read_text())['size'] for p in receipts),
                preparation_seconds=seconds,
                effective_MBps=total / seconds / 1e6 if seconds and seconds > 0 else None,
                timing_scope='First staging directory to last verification receipt; warm restarts reuse historical timestamps.')


def boot():
    os.umask(0o077)
    config = Path('/root/.seed-agent-env.json')
    incoming = json.load(sys.stdin)
    allowed = {'HF_TOKEN', 'CIVITAI_API_TOKEN', 'JUPYTER_TOKEN', 'SEED_PAIRING_SECRET'}
    if set(incoming) - allowed or not incoming.get('HF_TOKEN'):
        raise ValueError('Unexpected or missing worker credential fields.')
    for name in ('JUPYTER_TOKEN', 'SEED_PAIRING_SECRET'):
        if len(incoming.get(name, '')) < 24:
            raise ValueError('Missing private worker secret.')
    pidfile = Path('/root/.seed-agent-worker.pid')
    try:
        cmd = (Path('/proc') / pidfile.read_text().strip() / 'cmdline').read_bytes()
        if b'worker.run' in cmd:
            if not config.exists() or json.loads(config.read_text()) != incoming:
                raise ValueError('Worker is running with a different configuration; stop it before replacing credentials.')
            return {'running': True, 'reused': True}
    except (FileNotFoundError, ProcessLookupError):
        pass
    entry = Path('/opt/seed/worker/run.py')
    entry.write_text(prepare_entrypoint(entry.read_text()))
    config.write_text(json.dumps(incoming))
    config.chmod(0o600)
    env = os.environ.copy()
    env.update(incoming)
    env.update(SEED_WORKSPACE='/', SEED_PUBLIC_URL='http://127.0.0.1:18080', HF_XET_CHUNK_CACHE_SIZE_BYTES='0')
    with open('/var/log/seed-worker.log', 'ab') as log:
        proc = subprocess.Popen(['/opt/venv/bin/python', '-m', 'worker.run'], cwd='/opt/seed', env=env,
                                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    pidfile.write_text(str(proc.pid))
    return {'running': True, 'pid': proc.pid, 'reused': False}


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['preparation']:
            print(json.dumps(preparation()))
        elif sys.argv[1:] == ['boot']:
            print(json.dumps(boot()))
        else:
            raise ValueError('Expected boot or preparation.')
    except Exception as exc:
        # Never echo raw network/configuration exceptions containing secrets.
        print(json.dumps({'error': type(exc).__name__, 'message': str(exc) if isinstance(exc, ValueError) else 'Worker operation failed; inspect its private state.'}))
        raise SystemExit(1)
