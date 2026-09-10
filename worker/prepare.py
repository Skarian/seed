"""Pinned Hugging Face preparation; only verified files enter Comfy's model tree."""
import hashlib
import json
import os
import re
import shutil
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


def prepare(workspace, manifest, token, report=lambda **status: None, fetch=hf_fetch):
    workspace = Path(workspace).resolve()
    model_root = workspace / 'ComfyUI/models'
    metadata = workspace / '.seed/models'
    for root in [model_root, metadata, workspace / '.seed/downloads']:
        if not root.resolve().is_relative_to(workspace):
            raise ValueError('Storage root leaves the workspace.')
    model_root.mkdir(parents=True, exist_ok=True)
    metadata.mkdir(parents=True, exist_ok=True)
    # Validate the complete manifest before any download or promotion.
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
            report(phase='verifying ' + item['path'], bytes_done=done, bytes_total=total, error=None)
            if not matches(target, item):
                # Keep a previous complete model until its replacement is verified.
                stage = workspace / '.seed/downloads' / item['sha256']
                if not stage.resolve().is_relative_to(workspace):
                    raise ValueError('Staging leaves the workspace.')
                stage.mkdir(parents=True, exist_ok=True)
                staged = stage / source(item)[2]
                if not staged.resolve().is_relative_to(stage.resolve()):
                    raise ValueError('Staged model leaves the staging directory.')
                if matches(staged, item):
                    downloaded = staged
                else:
                    # Existing partial bytes already occupy disk. Do not demand a
                    # second full file's space before the HF client can resume it.
                    if shutil.disk_usage(workspace).free < 1024**3:
                        raise OSError('Insufficient free model storage; retain one GiB of working space.')
                    report(phase='downloading ' + item['path'], bytes_done=done, bytes_total=total, error=None)
                    downloaded = Path(fetch(item, stage, token))
                if not downloaded.resolve().is_relative_to(stage.resolve()):
                    raise ValueError('Download must remain in staging.')
                report(phase='verifying ' + item['path'], bytes_done=done, bytes_total=total, error=None)
                if not matches(downloaded, item):
                    downloaded.unlink(missing_ok=True)
                    raise ValueError('Downloaded model failed integrity verification.')
                with downloaded.open('r+b') as handle:
                    os.fsync(handle.fileno())
                if not target.resolve().is_relative_to(workspace):
                    raise ValueError('Model destination leaves the workspace.')
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(downloaded, target)
            stat = target.stat()
            atomic_json(receipt, {'sha256': item['sha256'], 'size': stat.st_size, 'mtime_ns': stat.st_mtime_ns})
        done += item['size']
        report(phase='models ready' if done == total else 'checking models', bytes_done=done, bytes_total=total, error=None)
