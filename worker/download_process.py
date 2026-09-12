"""Isolated download writers; credentials arrive on stdin and never enter journals."""
import concurrent.futures
import json
import sys
import threading
from urllib.parse import urlsplit
from worker.model_files import direct_download, probe, activate


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
                send({'path': item['path'], 'state': 'downloading'})
                result = direct_download(workspace, item, token) if token else {'ready': False, 'error': 'Source credential required'}
            send({'path': item['path'], 'state': 'ready' if result['ready'] else 'needs_source', **result})
    bases = [x for x in entries if not x.get('route')]
    presets = [x for x in entries if x.get('route')]
    # Hash-addressed source staging cannot have two writers for a shared asset.
    lanes = [entries] if {x['sha256'] for x in bases} & {x['sha256'] for x in presets} else [bases, presets]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(lane, lanes): pass
    if all(x['ready'] for x in probe(workspace, entries)):
        activate(workspace, entries)
        send({'complete': True})


if __name__ == '__main__':
    try:
        body = json.loads(sys.stdin.buffer.readline(1024 * 1024))
        prepare(body['workspace'], body['entries'], body.get('credentials', {}),
                lambda value: print(json.dumps(value), flush=True))
    except Exception as exc:
        print(json.dumps({'error': type(exc).__name__}), flush=True)
        raise SystemExit(1)
