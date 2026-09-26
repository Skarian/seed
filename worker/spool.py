"""Small durable job records shared by the engine and authenticated worker."""
import hashlib
import json
import os
import uuid
from pathlib import Path


def job_directory(workspace, job_id):
    if str(uuid.UUID(job_id)) != job_id:
        raise ValueError('Invalid job ID')
    root = Path(workspace).resolve() / '.seed/spool/jobs'
    target = root / job_id
    if not target.resolve().is_relative_to(Path(workspace).resolve()):
        raise ValueError('Spool path leaves workspace')
    return target


def atomic(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix('.' + uuid.uuid4().hex + '.tmp')
    try:
        with open(temporary, 'x', encoding='utf8') as handle:
            json.dump(value, handle, sort_keys=True, separators=(',', ':'))
            handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, file)
        if os.name != 'nt':
            fd = os.open(file.parent, os.O_RDONLY)
            try: os.fsync(fd)
            finally: os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)


def read_record(directory):
    receipt = directory / 'submission.json'
    if not receipt.exists(): return None
    result = {'submission': json.loads(receipt.read_text())}
    manifest = directory / 'manifest.json'
    if manifest.exists():
        raw = manifest.read_bytes()
        result.update(manifest=json.loads(raw), manifest_bytes=raw.decode(), manifest_digest=hashlib.sha256(raw).hexdigest())
    telemetry = directory / 'telemetry.json'
    if telemetry.exists():
        try: result['telemetry'] = json.loads(telemetry.read_text())
        except (OSError, ValueError): pass
    ack = directory / 'receipt.json'
    result['acknowledged'] = ack.exists()
    result['cleanup_complete'] = (directory / 'cleaned.json').exists()
    return result
