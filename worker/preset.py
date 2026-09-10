"""Operator-only pinned Civitai acquisition. No browser download endpoint."""
import argparse
import hashlib
import json
import os
import urllib.request
import urllib.error
from pathlib import Path
from worker.spool import atomic


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None


def install(workspace, version, file_id, expected, strength, route='image'):
    if route not in ('image', 'fl', 'ref'): raise ValueError('Choose image, fl or ref.')
    if len(expected) != 64 or any(c not in '0123456789abcdef' for c in expected) or not 0 < strength <= 2:
        raise ValueError('Provide the pinned SHA256 and a strength above zero and at most two.')
    root = Path(workspace).resolve()
    directory = root / '.seed/presets'
    target = root / 'ComfyUI/models/loras' / ('seed-' + expected + '.safetensors')
    partial = root / '.seed/downloads' / (expected + '.part')
    for file in [target, partial, directory / 'active.json']:
        if not file.resolve().is_relative_to(root): raise ValueError('Preset path leaves workspace')
        file.parent.mkdir(parents=True, exist_ok=True)
    valid = False
    if target.exists():
        with target.open('rb') as handle: valid = hashlib.file_digest(handle, 'sha256').hexdigest() == expected
    if not valid:
        if target.exists(): raise ValueError('An immutable preset file changed; inspect it before proceeding.')
        token = os.environ.get('CIVITAI_API_TOKEN', '')
        request = urllib.request.Request(f'https://civitai.com/api/download/models/{int(version)}?fileId={int(file_id)}', headers={'Authorization': 'Bearer ' + token} if token else {})
        opener = urllib.request.build_opener(NoRedirect)
        try: response = opener.open(request, timeout=60)
        except urllib.error.HTTPError as exc:
            if exc.code not in (301, 302, 303, 307, 308): raise RuntimeError(f'Civitai returned HTTP {exc.code}.') from None
            location = exc.headers.get('Location', ''); exc.close()
            if not location.startswith('https://'): raise ValueError('Invalid download redirect')
            # Never forward the Civitai bearer to the signed CDN destination.
            offset = partial.stat().st_size if partial.exists() else 0
            response = urllib.request.urlopen(urllib.request.Request(location, headers={'Range': f'bytes={offset}-'} if offset else {}), timeout=120)
        with response:
            append = response.status == 206 and partial.exists()
            if append and not response.headers.get('Content-Range', '').startswith(f'bytes {partial.stat().st_size}-'): raise ValueError('Invalid resumed download')
            with partial.open('ab' if append else 'wb') as handle:
                while chunk := response.read(1024 * 1024): handle.write(chunk)
                handle.flush(); os.fsync(handle.fileno())
        with partial.open('rb') as handle:
            if hashlib.file_digest(handle, 'sha256').hexdigest() != expected: raise ValueError('Preset integrity verification failed; staged file retained for inspection.')
        os.replace(partial, target)
    # Do not activate while an operator or seed job is using the engine.
    with urllib.request.urlopen('http://127.0.0.1:8188/queue', timeout=10) as response: queue = json.load(response)
    if queue['queue_running'] or queue['queue_pending']: raise ValueError('Wait for the engine to become idle, then rerun to activate the staged preset.')
    stat = target.stat()
    atomic(directory / 'assets' / (expected + '.json'), {'sha256': expected, 'size': stat.st_size, 'mtime_ns': stat.st_mtime_ns})
    revision = expected[:16] + '-' + str(strength)
    active = json.loads((directory / 'active.json').read_text()) if (directory / 'active.json').exists() else {}
    preset = {'filename': target.name, 'sha256': expected, 'strength_model': strength}
    if route == 'image': active.update(revision=revision, nsfw=preset)
    else: active['video_' + route] = {**preset, 'revision': revision}
    atomic(directory / 'active.json', active)
    return {'revision': revision, 'bytes': stat.st_size, 'activated': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', type=int, required=True); parser.add_argument('--file-id', type=int, required=True)
    parser.add_argument('--sha256', required=True); parser.add_argument('--strength', type=float, default=1.0)
    parser.add_argument('--route', choices=['image', 'fl', 'ref'], default='image')
    args = parser.parse_args()
    print(json.dumps(install(os.environ.get('SEED_WORKSPACE', '/workspace'), args.version, args.file_id, args.sha256.lower(), args.strength, args.route)))
