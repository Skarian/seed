"""Model verification and shared pinned-source helpers for the transfer receiver."""
import hashlib
import json
import re
import time
from pathlib import Path
from urllib.parse import urlsplit
from worker.app import atomic_json


def source(item):
    url = urlsplit(item['url'])
    parts = url.path.strip('/').split('/')
    if url.scheme != 'https' or url.netloc != 'huggingface.co' or url.query or url.fragment or len(parts) < 5 or parts[2] != 'resolve' or not re.fullmatch('[0-9a-f]{40}', parts[3]):
        raise ValueError('Models require a pinned Hugging Face source.')
    relative = Path(item['path'])
    if relative.is_absolute() or '..' in relative.parts or '\\' in item['path'] or ':' in item['path']:
        raise ValueError('Invalid model destination.')
    if not re.fullmatch('[0-9a-f]{64}', item['sha256']) or not isinstance(item['size'], int) or item['size'] < 1:
        raise ValueError('Model integrity metadata missing.')
    return '/'.join(parts[:2]), parts[3], '/'.join(parts[4:])


def hf_fetch(item, staging, token):
    from huggingface_hub import hf_hub_download
    repo, revision, filename = source(item)
    return Path(hf_hub_download(repo_id=repo, revision=revision, filename=filename, local_dir=staging, token=token, endpoint='https://huggingface.co'))


def matches(file, item):
    if not file.is_file() or file.stat().st_size != item['size']:
        return False
    with file.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest() == item['sha256']


def prepare(workspace, manifest, report=lambda **status: None):
    workspace = Path(workspace).resolve()
    model_root = workspace / 'ComfyUI/models'
    metadata = workspace / '.seed/models'
    for root in [model_root, metadata]:
        if not root.resolve().is_relative_to(workspace):
            raise ValueError('Storage root leaves the workspace.')
    model_root.mkdir(parents=True, exist_ok=True)
    metadata.mkdir(parents=True, exist_ok=True)
    for item in manifest:
        source(item)
        if not (model_root / item['path']).resolve().is_relative_to(model_root.resolve()):
            raise ValueError('Model destination leaves the model directory.')
    total = sum(item['size'] for item in manifest)
    done = 0
    for item in manifest:
        target = model_root / item['path']
        receipt = metadata / (hashlib.sha256(item['path'].encode()).hexdigest() + '.json')
        try:
            saved = json.loads(receipt.read_text())
            stat = target.stat()
            warm = saved == {'sha256': item['sha256'], 'size': stat.st_size, 'mtime_ns': stat.st_mtime_ns} and stat.st_size == item['size']
        except (OSError, ValueError):
            warm = False
        if not warm:
            report(phase='waiting for model preparation: ' + item['path'], bytes_done=done, bytes_total=total, error=None)
            while not target.is_file() or target.stat().st_size != item['size']:
                time.sleep(1)
            if not target.resolve().is_relative_to(model_root.resolve()):
                raise ValueError('Model destination leaves the model directory.')
            report(phase='verifying ' + item['path'], bytes_done=done, bytes_total=total, error=None)
            if not matches(target, item):
                raise ValueError('Transferred model failed integrity verification.')
            stat = target.stat()
            atomic_json(receipt, {'sha256': item['sha256'], 'size': stat.st_size, 'mtime_ns': stat.st_mtime_ns})
        done += item['size']
        report(phase='models ready' if done == total else 'checking models', bytes_done=done, bytes_total=total, error=None)
