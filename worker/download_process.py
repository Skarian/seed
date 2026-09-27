"""Isolated download writers; credentials arrive on stdin and never enter journals."""
import concurrent.futures
import json
import sys
import threading
import time
from urllib.parse import urlsplit
from worker.model_files import direct_download, probe, activate
from worker.download_progress import DownloadProgress


def prepare(workspace, entries, credentials, report):
    lock = threading.Lock()
    def send(value):
        with lock: report(value)
    def lane(items):
        for item in items:
            send({'path': item['path'], 'state': 'checking'})
            if probe(workspace, [item])[0]['ready']:
                result = {'ready': True, 'seconds': 0}
            else:
                provider = 'huggingFaceToken' if urlsplit(item['url']).hostname == 'huggingface.co' else 'civitaiApiToken'
                token = credentials.get(provider, '')
                progress = DownloadProgress(item, send)
                # A resumed SDK transfer starts with an existing prefix. Announce
                # the connection without counting that prefix as newly received.
                send({'path': item['path'], 'state': 'downloading', 'bytes_done': 0,
                      'bytes_per_second': 0, 'updated_at': time.time()})
                # Public files do not require a token; authorization failures remain retryable.
                result = direct_download(workspace, item, token, progress=progress.update)
            send({'path': item['path'], 'state': 'ready' if result['ready'] else 'needs_source', **result})
    bases = [x for x in entries if not x.get('routes')]
    adapters = [x for x in entries if x.get('routes')]
    # Hash-addressed source staging cannot have two writers for a shared asset.
    lanes = [entries] if {x['sha256'] for x in bases} & {x['sha256'] for x in adapters} else [bases, adapters]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(lane, lanes): pass
    if all(x['ready'] for x in probe(workspace, entries)):
        activate(workspace, entries)
        send({'complete': True})


if __name__ == '__main__':
    body = {}
    try:
        body = json.loads(sys.stdin.buffer.readline(1024 * 1024))
        prepare(body['workspace'], body['entries'], body.get('credentials', {}),
                lambda value: print(json.dumps(value), flush=True))
    except Exception as exc:
        from worker.diagnostics import error_details
        secrets = body.get('credentials', {}).values() if isinstance(body, dict) else ()
        print(json.dumps({'error': type(exc).__name__, 'diagnostic_error': error_details(exc, secrets)}), flush=True)
        raise SystemExit(1)
