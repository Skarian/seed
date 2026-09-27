"""One durable preparation intent, one owned writer process, no token journal."""
import asyncio
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from aiohttp import web
from worker.app import atomic_json, PREPARATION
from worker.model_files import locations
from worker.prepare import source
from worker.processes import child_environment, stop_process, spawn_owned
from worker.profile import validate_role_manifest, installed_loras
from worker.diagnostics import capture_stderr, error_details, write_event

MANAGER = web.AppKey('preparation_manager', object)


def manifest(workspace, entries):
    if not isinstance(entries, list) or not 0 < len(entries) <= 256:
        raise ValueError('Supply a nonempty model manifest')
    clean, paths = [], set()
    for item in entries:
        if not isinstance(item, dict) or set(item) - {'path', 'url', 'sha256', 'size', 'routes'}:
            raise ValueError('Unsupported manifest fields')
        locations(workspace, item)
        if item['path'] in paths: raise ValueError('Duplicate model destination')
        paths.add(item['path'])
        url = urlsplit(item['url'])
        if url.netloc == 'huggingface.co': source(item)
        elif url.scheme == 'https' and url.netloc == 'civitai.com' and not url.fragment:
            query = parse_qs(url.query)
            if not re.fullmatch(r'/api/download/models/[0-9]+', url.path) or set(query) != {'fileId'} or len(query['fileId']) != 1 or not query['fileId'][0].isdigit():
                raise ValueError('Civitai source must identify one file')
        else: raise ValueError('Unsupported model source')
        routes = item.get('routes')
        if routes is not None:
            if not isinstance(routes, list) or not routes or len(routes) != len(set(routes)) or any(route not in ('image', 'fl', 'ref') for route in routes):
                raise ValueError('Invalid adapter mappings')
            if item['path'] != 'loras/seed-' + item['sha256'] + '.safetensors' or url.netloc != 'civitai.com':
                raise ValueError('Adapters require an immutable Civitai source and destination')
        elif item['path'].startswith('loras/'):
            raise ValueError('Adapter mapping is required')
        clean.append(dict(item))
    clean.sort(key=lambda x: x['path'])
    validate_role_manifest(clean)
    return clean, hashlib.sha256(json.dumps(clean, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class Preparation:
    def __init__(self, workspace, runtime, status, spawn=spawn_owned):
        self.workspace, self.runtime, self.status = Path(workspace), Path(runtime), status
        self.file = self.runtime / 'preparation.json'
        self.intent = json.loads(self.file.read_text()) if self.file.exists() else None
        self.lock, self.ready = asyncio.Lock(), asyncio.Event()
        self.task = self.process = None
        self.upload_task = None
        self.spawn = spawn
        files = self.runtime/'preparation-files.json'
        self.files = json.loads(files.read_text()) if files.exists() else {}
        self.state = 'cancelled' if self.intent and self.intent['cancelled'] else 'waiting'
        self.refresh()

    def refresh(self):
        active = self.entries()
        total = sum(x['size'] for x in active)
        files = [self.files.get(x['path'], {}) for x in active]
        done = sum(x['size'] if f.get('ready') else min(x['size'], max(0, f.get('bytes_done', 0))) for x, f in zip(active, files))
        downloading = [f for f in files if f.get('state') == 'downloading']
        recent = [f for f in downloading if time.time() - f.get('updated_at', 0) < 15]
        rate = sum(f.get('bytes_per_second', 0) for f in recent)
        stage = 'downloading' if downloading else 'verifying' if any(f.get('state') in ('checking', 'verifying') for f in files) else 'pending'
        self.status.update(bytes_total=total, bytes_done=done, stage=stage,
                           bytes_per_second=rate, eta_seconds=round((total-done)/rate) if rate > 0 and done < total else None,
                           stalled=bool(downloading) and not recent)
        if self.state != 'ready':
            self.status['phase'] = {'waiting': 'Waiting for preparation', 'preparing': 'Downloading models' if downloading else 'Checking model files' if stage == 'verifying' else 'Preparing models', 'needs_source': 'Model download needs attention', 'cancelled': 'Preparation cancelled'}.get(self.state, self.state)
        return {'state': self.state, 'revision': self.intent['revision'] if self.intent else 0,
                'digest': self.intent['digest'] if self.intent else None,
                'files': list(self.files.values()),
                'omitted_paths': self.intent.get('omitted_paths', []) if self.intent else [],
                'installed_loras': installed_loras(self.workspace) if self.ready.is_set() else [], **self.status}

    def entries(self):
        if not self.intent: return []
        omitted = set(self.intent.get('omitted_paths', []))
        return [item for item in self.intent['entries'] if item['path'] not in omitted]

    async def ensure(self, entries, credentials, revision):
        entries, digest = manifest(self.workspace, entries)
        if type(revision) is not int or revision < 0:
            raise ValueError('Invalid preparation revision')
        if not isinstance(credentials, dict) or set(credentials) - {'huggingFaceToken', 'civitaiApiToken'} or any(not isinstance(x, str) for x in credentials.values()):
            raise ValueError('Invalid credentials')
        async with self.lock:
            if self.intent and (self.intent['digest'] is not None and digest != self.intent['digest'] or revision != self.intent['revision']):
                raise web.HTTPConflict()
            if not self.intent:
                if revision != 0: raise web.HTTPConflict()
                self.intent = {'entries': entries, 'digest': digest, 'revision': 0, 'cancelled': False, 'omitted_paths': []}
            elif self.intent['digest'] is None:
                self.intent.update(entries=entries, digest=digest)
            if self.ready.is_set(): return {**self.refresh(), 'credentials_accepted': False}
            if self.upload_task and not self.upload_task.done(): return {**self.refresh(), 'credentials_accepted': False}
            if self.task and not self.task.done(): return {**self.refresh(), 'credentials_accepted': False}
            self.intent['cancelled'] = False
            atomic_json(self.file, self.intent)
            # A retry starts a new attempt. Stale errors from later files must
            # not make the UI report failure while the first file downloads.
            self.files = {item['path']: self.files[item['path']]
                          if self.files.get(item['path'], {}).get('ready')
                          else {'path': item['path'], 'state': 'pending'}
                          for item in self.entries()}
            atomic_json(self.runtime/'preparation-files.json', self.files)
            self.state = 'preparing'
            self.status['error'] = None
            self.task = asyncio.create_task(self.run(dict(credentials)))
            return {**self.refresh(), 'credentials_accepted': True}

    async def run(self, credentials):
        secrets = list(credentials.values())
        stderr_task = None
        try:
            self.process = await self.spawn(sys.executable, '-m', 'worker.download_process',
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE, env=child_environment())
            stderr_task = asyncio.create_task(capture_stderr(self.process.stderr, self.runtime, secrets))
            payload = json.dumps({'workspace': str(self.workspace), 'entries': self.entries(), 'credentials': credentials}).encode() + b'\n'
            self.process.stdin.write(payload)
            await self.process.stdin.drain()
            self.process.stdin.close()
            del payload
            credentials.clear()
            complete = False
            async for line in self.process.stdout:
                value = json.loads(line)
                if 'path' in value:
                    self.files[value['path']] = value
                    atomic_json(self.runtime/'preparation-files.json', self.files)
                if value.get('error'):
                    atomic_json(self.runtime/'preparation-error.json', value)
                    write_event(self.runtime, 'download.failed', value, secrets)
                complete = complete or value.get('complete') is True
                if 'error' in value and 'path' not in value:
                    self.status['error'] = {'message': 'Model preparation failed (' + str(value['error']) + ').'}
                self.refresh()
            code = await self.process.wait()
            self.state = 'ready' if complete and code == 0 else 'needs_source'
            if self.state == 'ready': self.ready.set()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            write_event(self.runtime, 'preparation.failed', error_details(exc, secrets), secrets)
            self.state = 'needs_source'
            self.status['error'] = {'message': 'Model preparation stopped (' + type(exc).__name__ + ').'}
        finally:
            credentials.clear()
            await stop_process(self.process)
            if stderr_task:
                results = await asyncio.gather(stderr_task, return_exceptions=True)
                for result in results:
                    if isinstance(result, Exception):
                        write_event(self.runtime, 'download.stderr.capture_failed', error_details(result, secrets), secrets)
            secrets.clear()
            self.process = None
            self.refresh()

    async def omit(self, paths, revision):
        async with self.lock:
            if (not self.intent or revision != self.intent['revision'] or self.ready.is_set()
                    or self.state != 'needs_source' or self.task and not self.task.done()
                    or self.upload_task and not self.upload_task.done()):
                raise web.HTTPConflict()
            if not isinstance(paths, list) or not paths or any(not isinstance(p, str) for p in paths) or len(set(paths)) != len(paths):
                raise ValueError('Choose failed adapters to omit')
            candidates = {item['path']: item for item in self.entries()}
            if any(p not in candidates or not candidates[p].get('routes') or self.files.get(p, {}).get('state') != 'needs_source' for p in paths):
                raise ValueError('Only failed optional adapters may be omitted')
            self.intent['omitted_paths'] = sorted(set(self.intent.get('omitted_paths', [])) | set(paths))
            self.intent['revision'] += 1
            atomic_json(self.file, self.intent)
            self.state = 'preparing'
            self.status['error'] = None
            # Credentials are never retained. Already verified assets resume without them.
            self.task = asyncio.create_task(self.run({}))
            return self.refresh()

    async def halt(self):
        if self.task and not self.task.done():
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        if self.upload_task and not self.upload_task.done():
            self.upload_task.cancel()
            await asyncio.gather(self.upload_task, return_exceptions=True)

    async def cancel(self):
        async with self.lock:
            if self.ready.is_set(): raise web.HTTPConflict()
            if self.intent is None:
                self.intent = {'entries': [], 'digest': None, 'revision': 0, 'cancelled': False}
            if self.intent and not self.intent['cancelled']:
                self.intent['cancelled'] = True
                self.intent['revision'] += 1
                atomic_json(self.file, self.intent)
            await self.halt()
            self.state = 'cancelled'
            return {**self.refresh(), 'unused_worker': self.unused_worker()}

    def unused_worker(self):
        # This exception is only for a new rental that never admitted an engine.
        # Older/malformed metadata and any spool content require normal recovery.
        try:
            identity = json.loads((self.runtime/'identity.json').read_text())
            if identity.get('engine_ever_started') is not False or not self.intent or not self.intent['cancelled'] or self.ready.is_set(): return None
            if any(task and not task.done() for task in (self.task, self.upload_task)): return None
            spool = self.workspace/'.seed/spool'
            if spool.is_symlink() or spool.exists() and (not spool.is_dir() or any(spool.iterdir())): return None
            return {'worker_instance_id': identity['worker_instance_id'], 'workspace_id': json.loads((self.workspace/'.seed/workspace.json').read_text())['workspace_id']}
        except (OSError, ValueError, KeyError):
            return None


def install(app, workspace, runtime, authenticated):
    manager = Preparation(workspace, runtime, app[PREPARATION])
    app[MANAGER] = manager
    async def get(request):
        if not authenticated(request): raise web.HTTPUnauthorized()
        return web.json_response(manager.refresh())
    async def put(request):
        if not authenticated(request): raise web.HTTPUnauthorized()
        body = await request.json()
        return web.json_response(await manager.ensure(body['entries'], body.get('credentials', {}), body.get('revision', 0)))
    async def cancel(request):
        if not authenticated(request): raise web.HTTPUnauthorized()
        return web.json_response(await manager.cancel())
    async def omit(request):
        if not authenticated(request): raise web.HTTPUnauthorized()
        body = await request.json()
        return web.json_response(await manager.omit(body.get('paths'), body.get('revision')))
    async def lifetime(app):
        if manager.intent and not manager.intent['cancelled']:
            await manager.ensure(manager.intent['entries'], {}, manager.intent['revision'])
        yield
        await manager.halt()
    app.cleanup_ctx.append(lifetime)
    app.router.add_get('/worker/v1/preparation', get)
    app.router.add_put('/worker/v1/preparation', put)
    app.router.add_post('/worker/v1/preparation/cancel', cancel)
    app.router.add_post('/worker/v1/preparation/omit', omit)
    return manager
