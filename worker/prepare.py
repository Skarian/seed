"""Model verification and shared pinned-source helpers for the transfer receiver."""
import re
from pathlib import Path
from urllib.parse import urlsplit


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


