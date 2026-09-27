"""Pinned-source downloads, file verification and installed adapter inventory."""
import hashlib
import json
import os
import re
import sys
from pathlib import Path


class AdapterValidationError(ValueError):
    pass


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


def validate_adapter(target):
    """Inspect bounded safetensors metadata without loading tensors or executing code."""
    with target.open('rb') as handle:
        prefix = handle.read(8)
        if len(prefix) != 8: raise ValueError('Adapter is not safetensors')
        length = int.from_bytes(prefix, 'little')
        if not 2 <= length <= 16 * 1024 * 1024 or 8 + length >= target.stat().st_size:
            raise ValueError('Invalid adapter header length')
        header = json.loads(handle.read(length))
    if not isinstance(header, dict): raise ValueError('Invalid adapter tensor header')
    tensors = {key: value for key, value in header.items() if key != '__metadata__'}
    body_size = target.stat().st_size - 8 - length
    widths = {'F64': 8, 'F32': 4, 'F16': 2, 'BF16': 2, 'F8_E4M3': 1, 'F8_E5M2': 1, 'I64': 8, 'I32': 4, 'I16': 2, 'I8': 1, 'U8': 1, 'BOOL': 1}
    spans = []
    for key, value in tensors.items():
        if not isinstance(key, str) or not isinstance(value, dict): raise ValueError('Invalid adapter tensor')
        shape, offsets, dtype = value.get('shape'), value.get('data_offsets'), value.get('dtype')
        if not isinstance(shape, list) or any(type(n) is not int or n < 0 for n in shape) or dtype not in widths:
            raise ValueError('Invalid adapter tensor shape or dtype')
        if not isinstance(offsets, list) or len(offsets) != 2 or any(type(n) is not int for n in offsets) or not 0 <= offsets[0] <= offsets[1] <= body_size:
            raise ValueError('Invalid adapter tensor range')
        count = 1
        for size in shape: count *= size
        if offsets[1] - offsets[0] != count * widths[dtype]: raise ValueError('Adapter tensor length mismatch')
        spans.append(offsets)
    end = 0
    for start, stop in sorted(spans):
        if start != end: raise ValueError('Adapter tensors overlap or have gaps')
        end = stop
    if end != body_size: raise ValueError('Unexpected adapter trailing data')
    keys = list(tensors)
    pairs = (('.lora_A.weight', '.lora_B.weight'), ('.lora_down.weight', '.lora_up.weight'), ('.lora_A', '.lora_B'))
    lora = any(any(key.endswith(down) and key[:-len(down)] + up in tensors for key in keys) for down, up in pairs)
    lokr = any('lokr_w1' in key for key in keys) and any('lokr_w2' in key for key in keys)
    if not (lora or lokr): raise ValueError('Unsupported adapter tensor layout')
    return 'lokr' if lokr else 'lora'


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
        if valid and item.get('routes'):
            try: validate_adapter(target)
            except (ValueError, OSError, json.JSONDecodeError): valid = False
        if valid: save_receipt(workspace,item,target)
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > item['size']:
            partial.unlink(); offset = 0
        result.append({'path': item['path'], 'ready': valid, 'offset': offset})
    return result


def direct_download(workspace, item, token, fetch=None, progress=None):
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
            downloaded = Path(fetch(item, stage, token) if fetch else hf_fetch(item, stage, token, progress))
        elif url.netloc == 'civitai.com':
            query = parse_qs(url.query)
            if not re.fullmatch(r'/api/download/models/[0-9]+', url.path) or set(query) != {'fileId'} or len(query['fileId']) != 1 or not query['fileId'][0].isdigit():
                raise ValueError('Unpinned Civitai source')
            downloaded = Path(fetch(item, stage, token) if fetch else civitai_fetch(item, stage, token, progress))
        else:
            raise ValueError('Unsupported source')
        if not downloaded.resolve().is_relative_to(stage.resolve()):
            raise ValueError('Download leaves staging')
        if progress: progress(item['size'], 'verifying')
        if not verified(downloaded, item):
            downloaded.unlink(missing_ok=True)
            raise ValueError('Integrity check failed')
        if item.get('routes'):
            try: validate_adapter(downloaded)
            except (ValueError, OSError): raise AdapterValidationError('Unsupported adapter tensor layout') from None
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(downloaded, target)
        partial.unlink(missing_ok=True)
        save_receipt(workspace, item, target)
        return {'ready': True, 'seconds': round(time.monotonic()-started, 2)}
    except Exception as exc:
        from worker.diagnostics import error_details
        # Keep useful causes, but never persist credentials or signed URL queries.
        code = getattr(exc, 'code', None) or getattr(getattr(exc, 'response', None), 'status_code', None)
        return {'ready': False, 'error': 'Downloaded adapter is not a supported LoRA/LoKR safetensors file' if isinstance(exc, AdapterValidationError) else 'Direct download or verification failed',
                'diagnostic_error': error_details(exc, [token]),
                'error_type': type(exc).__name__,
                'http_status': code if isinstance(code, int) and 100 <= code <= 599 else None,
                'errno': getattr(exc, 'errno', None) if isinstance(getattr(exc, 'errno', None), int) else None,
                'seconds': round(time.monotonic()-started, 2)}


def civitai_fetch(item, stage, token, progress=None):
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
        if progress: progress(size)
        with partial.open('ab' if append else 'wb') as handle:
            while chunk := response.read(1024*1024):
                size += len(chunk)
                if size > item['size']: raise ValueError('Response exceeds pinned size')
                handle.write(chunk)
                if progress: progress(size)
            handle.flush(); os.fsync(handle.fileno())
    return partial


def activate(workspace, entries):
    """Record the complete boot-time adapter inventory after verification."""
    from worker.spool import atomic
    root = Path(workspace).resolve()
    directory = root / '.seed/adapters'
    if not directory.resolve().is_relative_to(root):
        raise ValueError('Adapter inventory leaves workspace')
    installed = []
    for item in entries:
        routes = item.get('routes')
        if not routes: continue
        target, _ = locations(workspace, item)
        if item['path'] != 'loras/seed-' + item['sha256'] + '.safetensors' or not verified(target, item):
            raise ValueError('Adapter is not verified')
        validate_adapter(target)
        s = target.stat()
        atomic(directory / 'assets' / (item['sha256'] + '.json'),
               {'sha256': item['sha256'], 'size': s.st_size, 'mtime_ns': s.st_mtime_ns})
        installed.append({'filename': target.name, 'sha256': item['sha256'], 'routes': sorted(routes)})
    atomic(directory / 'installed.json', installed)
    return {'adapters': len(installed)}
