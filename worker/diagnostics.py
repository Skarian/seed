"""Bounded private evidence. Redact before writing; diagnostics never gate cleanup."""
import datetime
import json
import re
import sys
import threading
import traceback
from pathlib import Path
from urllib.parse import quote

_lock = threading.Lock()
_secret_field = re.compile(r'authorization|cookie|password|secret|token|credential|api.?key|(?:^|_)env$|environment', re.I)


def sanitize(value, secrets=(), depth=0):
    if depth > 8:
        return '[depth limit]'
    if isinstance(value, str):
        for secret in sorted((s for s in secrets if isinstance(s, str) and len(s) >= 4), key=len, reverse=True):
            value = value.replace(secret, '[REDACTED]').replace(quote(secret, safe=''), '[REDACTED]')
        value = re.sub(r'\bBearer\s+[^\s\"\',;]+', 'Bearer [REDACTED]', value, flags=re.I)
        value = re.sub(r'\b(?:hf_|sk-|rpa_)[A-Za-z0-9_-]{8,}', '[REDACTED]', value)
        value = re.sub(r'(https?://[^\s\"\'<>?#]+)[?#][^\s\"\'<>]*', r'\1?[REDACTED]', value)
        value = re.sub(r'((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)([\"\'])(.*?)\2', r'\1\2[REDACTED]\2', value, flags=re.I)
        return value[:8192]
    if isinstance(value, dict):
        return {str(k): '[REDACTED]' if _secret_field.search(str(k)) else sanitize(v, secrets, depth+1)
                for k, v in list(value.items())[:100]}
    if isinstance(value, (list, tuple)):
        return [sanitize(v, secrets, depth+1) for v in value[:50]]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return sanitize(str(value), secrets, depth+1)


def error_details(error, secrets=()):
    return sanitize({'type': type(error).__name__, 'message': str(error),
                     'traceback': ''.join(traceback.format_exception(error))}, secrets)


def write_event(runtime, operation, data, secrets=()):
    event = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
             'operation': operation, 'data': sanitize(data, secrets)}
    try:
        directory = Path(runtime)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        file = directory/'diagnostics.jsonl'
        encoded = json.dumps(event, ensure_ascii=True) + '\n'
        with _lock:
            if file.exists() and file.stat().st_size + len(encoded) > 2*1024*1024:
                file.replace(directory/'diagnostics.previous.jsonl')
            with file.open('a', encoding='utf-8') as handle:
                handle.write(encoded)
        return True
    except (OSError, ValueError):
        print('Seed could not persist worker diagnostics. Check worker storage.', file=sys.stderr, flush=True)
        return False


async def capture_stderr(stream, runtime, secrets):
    if stream is None:
        return
    buffer = b''
    dropping = False
    while True:
        chunk = await stream.read(4096)
        if not chunk:
            break
        buffer += chunk
        while b'\n' in buffer:
            line, buffer = buffer.split(b'\n', 1)
            if not dropping and line.strip():
                write_event(runtime, 'download.stderr', {'message': line.decode('utf-8', errors='replace')}, secrets)
            dropping = False
        if len(buffer) > 65536:
            if not dropping:
                write_event(runtime, 'download.stderr.truncated', {'message': 'A downloader diagnostic line exceeded 64 KB.'})
            buffer = b''
            dropping = True
    if buffer.strip() and not dropping:
        write_event(runtime, 'download.stderr', {'message': buffer.decode('utf-8', errors='replace')}, secrets)
