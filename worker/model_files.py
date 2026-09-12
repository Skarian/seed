"""Pinned-source downloads, file verification and preset activation."""
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


def receipt_path(workspace, item):
    root=Path(workspace).resolve()
    result=root/'.seed/models'/(hashlib.sha256(item['path'].encode()).hexdigest()+'.json')
    if not result.resolve().is_relative_to(root): raise ValueError('Receipt path leaves workspace')
    return result


def save_receipt(workspace, item, target):
    receipt=receipt_path(workspace,item); receipt.parent.mkdir(parents=True,exist_ok=True)
    s=target.stat(); temporary=receipt.with_suffix('.tmp')
    temporary.write_text(json.dumps({'sha256':item['sha256'],'size':s.st_size,'mtime_ns':s.st_mtime_ns}))
    os.replace(temporary,receipt)


def probe(workspace, entries):
    result = []
    for item in entries:
        target, partial = locations(workspace, item)
        try:
            saved=json.loads(receipt_path(workspace,item).read_text()); stat=target.stat()
            valid=stat.st_size==item['size'] and saved=={'sha256':item['sha256'],'size':stat.st_size,'mtime_ns':stat.st_mtime_ns}
        except (OSError,ValueError): valid=False
        if not valid: valid=verified(target,item)
        if valid: save_receipt(workspace,item,target)
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > item['size']:
            partial.unlink(); offset = 0
        result.append({'path': item['path'], 'ready': valid, 'offset': offset})
    return result


def direct_download(workspace, item, token, fetch=None):
    """Download one pinned asset; never persist or echo the supplied token."""
    import time
    from urllib.parse import urlsplit, parse_qs
    target, partial = locations(workspace, item)
    if probe(workspace, [item])[0]['ready']:
        return {'ready': True, 'seconds': 0}
    url = urlsplit(item['url'])
    stage = Path(workspace).resolve() / '.seed/downloads' / item['sha256']
    if not stage.resolve().is_relative_to(Path(workspace).resolve()):
        raise ValueError('Staging leaves workspace')
    stage.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    try:
        if url.scheme != 'https' or url.username or url.password or url.fragment:
            raise ValueError('Invalid source')
        if url.netloc == 'huggingface.co':
            os.environ['HF_XET_CHUNK_CACHE_SIZE_BYTES'] = '0'
            os.environ['HF_DEBUG'] = '0'
            os.environ['HF_HUB_DISABLE_PROGRESS_BARS'] = '1'
            sys.path.insert(0, '/opt/seed')
            from worker.prepare import hf_fetch, source
            _, _, filename = source(item)
            if any(not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', p) or p in ('.','..') for p in filename.split('/')):
                raise ValueError('Invalid source filename')
            # No login() or token file. The library receives the token as an argument.
            downloaded = Path((fetch or hf_fetch)(item, stage, token))
        elif url.netloc == 'civitai.com':
            query = parse_qs(url.query)
            if not re.fullmatch(r'/api/download/models/[0-9]+', url.path) or set(query) != {'fileId'} or len(query['fileId']) != 1 or not query['fileId'][0].isdigit():
                raise ValueError('Unpinned Civitai source')
            downloaded = Path((fetch or civitai_fetch)(item, stage, token))
        else:
            raise ValueError('Unsupported source')
        if not downloaded.resolve().is_relative_to(stage.resolve()):
            raise ValueError('Download leaves staging')
        if not verified(downloaded, item):
            downloaded.unlink(missing_ok=True)
            raise ValueError('Integrity check failed')
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(downloaded, target)
        partial.unlink(missing_ok=True)
        save_receipt(workspace, item, target)
        return {'ready': True, 'seconds': round(time.monotonic()-started, 2)}
    except Exception as exc:
        # Upstream exception strings can contain signed URLs; never return them.
        code = getattr(exc, 'code', None) or getattr(getattr(exc, 'response', None), 'status_code', None)
        return {'ready': False, 'error': 'Direct download or verification failed',
                'error_type': type(exc).__name__,
                'http_status': code if isinstance(code, int) and 100 <= code <= 599 else None,
                'errno': getattr(exc, 'errno', None) if isinstance(getattr(exc, 'errno', None), int) else None,
                'seconds': round(time.monotonic()-started, 2)}


def civitai_fetch(item, stage, token):
    import urllib.request
    import urllib.error
    from urllib.parse import urlsplit, urljoin
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    opener = urllib.request.build_opener(NoRedirect)
    partial = stage / 'civitai.part'
    offset = partial.stat().st_size if partial.exists() else 0
    if offset >= item['size']:
        if verified(partial, item): return partial
        partial.unlink(); offset = 0
    url = item['url']
    for attempt in range(6):
        # Civitai rejects urllib's default User-Agent even with a valid API key.
        headers = {'User-Agent': 'Seed/0.1'}
        if offset: headers['Range'] = f'bytes={offset}-'
        if attempt == 0 and token: headers['Authorization'] = 'Bearer ' + token
        try:
            response = opener.open(urllib.request.Request(url, headers=headers), timeout=120)
            break
        except urllib.error.HTTPError as exc:
            if exc.code not in (301,302,303,307,308): raise
            location = exc.headers.get('Location'); exc.close()
            if not location: raise ValueError('Missing redirect')
            url = urljoin(url, location); parsed = urlsplit(url)
            if parsed.scheme != 'https' or parsed.username or parsed.password: raise ValueError('Invalid redirect')
    else: raise ValueError('Too many redirects')
    with response:
        append = offset > 0 and response.status == 206
        if response.status == 206 and response.headers.get('Content-Range') != f"bytes {offset}-{item['size']-1}/{item['size']}":
            raise ValueError('Invalid resumed response')
        size = offset if append else 0
        with partial.open('ab' if append else 'wb') as handle:
            while chunk := response.read(1024*1024):
                size += len(chunk)
                if size > item['size']: raise ValueError('Response exceeds pinned size')
                handle.write(chunk)
            handle.flush(); os.fsync(handle.fileno())
    return partial


def activate(workspace, entries):
    # Only preset files already verified on this VM can become active.
    import urllib.request
    import urllib.error
    try:
        with urllib.request.urlopen('http://127.0.0.1:8188/queue', timeout=5) as response:
            queue=json.load(response)
        if queue['queue_running'] or queue['queue_pending']:
            raise ValueError('Engine has active work; activate presets after it finishes')
    except urllib.error.URLError as exc:
        if not isinstance(exc.reason, ConnectionRefusedError):
            raise ValueError('Cannot verify engine state') from None

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


