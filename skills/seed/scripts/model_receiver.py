"""Receive verified model files over SSH; no model-source credentials or network calls."""
import hashlib
import json
import os
import re
import sys
from pathlib import Path


def locations(workspace, item):
    root = Path(workspace).resolve()
    name = item['path']
    if not re.fullmatch(r'[A-Za-z0-9_./-]+', name) or any(p in ('', '.', '..') for p in name.split('/')) or name.startswith('/'):
        raise ValueError('Invalid model path')
    if not re.fullmatch('[a-f0-9]{64}', item['sha256']) or type(item['size']) is not int or item['size'] < 1:
        raise ValueError('Invalid integrity metadata')
    target = root / 'ComfyUI/models' / name
    partial = root / '.seed/transfers' / (item['sha256'] + '.part')
    if not target.resolve().is_relative_to(root) or not partial.resolve().is_relative_to(root):
        raise ValueError('Model path leaves workspace')
    return target, partial


def verified(target, item):
    if not target.is_file() or target.stat().st_size != item['size']:
        return False
    with target.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest() == item['sha256']


def probe(workspace, entries):
    result = []
    for item in entries:
        target, partial = locations(workspace, item)
        valid = verified(target, item)
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > item['size']:
            partial.unlink(); offset = 0
        result.append({'path': item['path'], 'ready': valid, 'offset': offset})
    return result


def receive(workspace, item, offset, stream):
    target, partial = locations(workspace, item)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial.parent.mkdir(parents=True, exist_ok=True)
    actual = partial.stat().st_size if partial.exists() else 0
    if type(offset) is not int or offset < 0 or offset > item['size'] or actual != offset:
        raise ValueError('Transfer offset changed; probe again')
    remaining = item['size'] - offset
    with partial.open('ab' if offset else 'wb') as f:
        while remaining:
            chunk = stream.read(min(4 * 1024 * 1024, remaining))
            if not chunk:
                raise ValueError('Interrupted transfer; partial retained')
            f.write(chunk); remaining -= len(chunk)
        f.flush(); os.fsync(f.fileno())
    if stream.read(1):
        raise ValueError('Unexpected extra transfer bytes')
    if not verified(partial, item):
        partial.unlink()
        raise ValueError('Transfer hash mismatch; rerun from zero')
    os.replace(partial, target)
    return {'path':item['path'], 'ready':True, 'bytes':item['size']}


def activate(workspace, entries):
    # Only preset files already verified on this VM can become active.
    sys.path.insert(0, '/opt/seed')
    from worker.spool import atomic
    root = Path(workspace).resolve()
    directory = root / '.seed/presets'
    if not directory.resolve().is_relative_to(root):
        raise ValueError('Preset path leaves workspace')
    active = {}
    for item in entries:
        route = item.get('route')
        if not route: continue
        if route not in ('image','fl','ref') or not 0 < float(item.get('strength',1)) <= 2:
            raise ValueError('Invalid preset')
        target, _ = locations(workspace,item)
        if not item['path'].startswith('loras/') or not verified(target,item):
            raise ValueError('Preset not verified')
        s=target.stat()
        atomic(directory/'assets'/(item['sha256']+'.json'),{'sha256':item['sha256'],'size':s.st_size,'mtime_ns':s.st_mtime_ns})
        revision=item['sha256'][:16]+'-'+str(item.get('strength',1))
        preset={'filename':item['path'][len('loras/'):],'sha256':item['sha256'],'strength_model':item.get('strength',1)}
        if route=='image': active.update(revision=revision,nsfw=preset)
        else: active['video_'+route]={**preset,'revision':revision}
    atomic(directory/'active.json',active)
    return {'presets':len([x for x in entries if x.get('route')])}


if __name__ == '__main__':
    try:
        incoming=json.loads(sys.stdin.buffer.readline(1024*1024))
        action=incoming['action']; workspace=incoming['workspace']
        if action=='probe': result=probe(workspace,incoming['entries'])
        elif action=='receive': result=receive(workspace,incoming['item'],incoming['offset'],sys.stdin.buffer)
        elif action=='activate': result=activate(workspace,incoming['entries'])
        else: raise ValueError('Unknown action')
        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({'error':type(exc).__name__, 'message':str(exc) if isinstance(exc,ValueError) else 'Model transfer failed'}))
        sys.exit(1)
