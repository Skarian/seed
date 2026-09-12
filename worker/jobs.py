"""Authenticated spool streams and a narrow private Comfy adapter."""
import asyncio
import hashlib
import json
from pathlib import Path
from aiohttp import ClientSession, ClientTimeout, web
from worker.spool import job_directory, read_record, atomic
from worker.inputs import save_input


def install(app, workspace, comfy_url, authenticated, preparation=None):
    # Importing the spool package must not import ComfyUI's engine entry point.
    root = Path(workspace).resolve()
    locks = {}

    def authorize(request):
        if not authenticated(request): raise web.HTTPUnauthorized()

    def directory(request):
        authorize(request)
        return job_directory(root, request.match_info['job_id'])

    async def job(request):
        record = read_record(directory(request))
        if record is None: raise web.HTTPNotFound()
        return web.json_response(record)

    async def inventory(request):
        authorize(request)
        after = request.query.get('cursor', '')
        ids = sorted(p.name for p in (root / '.seed/spool/jobs').glob('*') if p.is_dir() and p.name > after)
        selected = ids[:50]
        return web.json_response({'items': [{'job_id': key, **(read_record(job_directory(root, key)) or {})} for key in selected], 'next_cursor': selected[-1] if len(ids) > 50 else None})

    def output_path(entry, job_id):
        output_root = root / '.seed/spool/outputs'
        target = (output_root / entry['path']).resolve()
        if not target.is_relative_to(output_root / 'seed' / job_id): raise ValueError('Output leaves job directory')
        return target

    async def output(request):
        folder = directory(request)
        record = read_record(folder)
        if not record or 'manifest' not in record: raise web.HTTPNotFound()
        entry = next((x for x in record['manifest']['outputs'] if x['id'] == request.match_info['output_id']), None)
        if entry is None: raise web.HTTPNotFound()
        target = output_path(entry, folder.name)
        if not target.is_file(): raise web.HTTPNotFound()
        return web.FileResponse(target, headers={'Content-Type': entry['mime_type'], 'ETag': '"' + entry['sha256'] + '"'})

    async def receipt(request):
        folder = directory(request)
        body = await request.json()
        async with locks.setdefault(folder.name, asyncio.Lock()):
            record = read_record(folder)
            if not record or 'manifest' not in record or not isinstance(record.get('manifest_digest'), str) or body != {'manifest_digest': record['manifest_digest']}: raise web.HTTPConflict()
            if record['manifest'].get('state') not in ('completed', 'failed', 'cancelled'):
                raise web.HTTPConflict()
            # Validate all named artifacts before any cleanup or acknowledgment.
            for entry in record['manifest']['outputs']:
                output_path(entry, folder.name)
            atomic(folder / 'receipt.json', body)
            try:
                # Exact flat per-job directories also contain interrupted encodes.
                # Never traverse a symlink or recursively delete an unknown tree.
                for category in ('inputs', 'outputs'):
                    owned = root / '.seed/spool' / category / 'seed' / folder.name
                    if owned.is_symlink() or owned.resolve() != owned:
                        raise OSError('Job directory is redirected')
                    if owned.exists():
                        entries = list(owned.iterdir())
                        if any(file.is_dir() and not file.is_symlink() for file in entries):
                            raise OSError('Unexpected nested job directory')
                        for file in entries:
                            file.unlink(missing_ok=True)
                        owned.rmdir()
                atomic(folder / 'cleaned.json', {'complete': True})
                return web.json_response({'cleanup_complete': True})
            except OSError:
                return web.json_response({'cleanup_complete': False, 'error': 'Saved locally; worker cleanup will retry.'})

    async def upload(request):
        authorize(request)
        return await save_input(request, root, locks)

    async def relay(request):
        authorize(request)
        route = request.match_info['route']
        allowed = {'session': ('GET', '/studio/session'), 'queue': ('GET', '/queue'), 'capabilities': ('GET', '/studio/capabilities'), 'prompt': ('POST', '/studio/prompt'), 'cancel': ('POST', '/studio/cancel')}
        if route not in allowed or request.method != allowed[route][0]: raise web.HTTPNotFound()
        payload = await request.read() if request.method == 'POST' else None
        # Ready is terminal for a preparation manifest: cancellation or mutation
        # cannot race a admitted generation; changing models needs worker restart.
        if route == 'prompt' and preparation and not preparation.ready.is_set():
            raise web.HTTPConflict()
        headers = {'Content-Type': 'application/json', 'X-Studio-Engine-Session': request.headers.get('X-Studio-Engine-Session', '')}
        async with ClientSession(timeout=ClientTimeout(total=60)) as client:
            async with client.request(request.method, comfy_url + allowed[route][1], data=payload, headers=headers, allow_redirects=False) as result:
                chunks = []; size = 0
                async for chunk in result.content.iter_chunked(65536):
                    size += len(chunk)
                    if size > 1024 * 1024: raise web.HTTPBadGateway()
                    chunks.append(chunk)
                raw = b''.join(chunks)
                return web.Response(body=raw, status=result.status, content_type='application/json')

    app.router.add_post('/comfy/upload', upload)
    app.router.add_get('/worker/v1/jobs', inventory)
    app.router.add_get('/worker/v1/jobs/{job_id}', job)
    app.router.add_get('/worker/v1/jobs/{job_id}/outputs/{output_id}', output)
    app.router.add_post('/worker/v1/jobs/{job_id}/receipt', receipt)
    app.router.add_route('*', '/comfy/{route}', relay)
