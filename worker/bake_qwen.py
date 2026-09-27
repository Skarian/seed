"""Acquire and verify the pinned, complete Qwen image/editing model at build time."""
import argparse
import hashlib
import json
import os
from pathlib import Path


def check(directory, manifest):
    directory = Path(directory)
    for item in manifest['files']:
        file = directory / item['path']
        if not file.is_file() or file.stat().st_size != item['size']:
            raise ValueError('Missing or truncated Qwen asset: ' + item['path'])
        with file.open('rb') as handle:
            if hashlib.file_digest(handle, 'sha256').hexdigest() != item['sha256']:
                raise ValueError('Qwen asset checksum mismatch: ' + item['path'])
    for component in ('diffusion_models', 'text_encoders', 'vae'):
        if not any(item['path'].startswith(component + '/') and item['path'].endswith('.safetensors') for item in manifest['files']):
            raise ValueError('Missing Qwen weight component: ' + component)
    return {'repository': manifest['repository'], 'revision': manifest['revision'],
            'verified_files': len(manifest['files']), 'bytes': manifest['total_bytes']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', default='/opt/models/qwen-image-2.1')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(Path(__file__).with_name('qwen-model.json').read_text())
    # The Docker dependency layer checks pipeline imports in a separate process.
    # Keep Torch out of the download process so small local builders retain RAM.
    if not args.verify_only:
        from huggingface_hub import hf_hub_download
        for item in manifest['files']:
            print(json.dumps({'acquiring': item['path'], 'bytes': item['size']}), flush=True)
            hf_hub_download(repo_id=manifest['repository'], revision=manifest['revision'],
                            filename=item['path'], local_dir=args.directory, token=False,
                            endpoint='https://huggingface.co')
    result = check(args.directory, manifest)
    os.environ['HF_HUB_OFFLINE'] = '1'
    print(json.dumps(result))


if __name__ == '__main__':
    main()
