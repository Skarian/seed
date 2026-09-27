"""Manifest-bound model fallback using tusd's offsets, storage and locking."""
import asyncio
import base64
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit
from aiohttp import ClientSession, ClientTimeout, web
from worker.model_files import locations, verified, save_receipt, probe, activate
from worker.processes import child_environment, stop_process, spawn_owned


class ModelUploads:
    def __init__(self, manager, origin='http://127.0.0.1:1080'):
        self.manager, self.origin = manager, origin
        self.directory = manager.workspace/'.seed/tus'
        self.lock = asyncio.Lock()

    def item(self, sha):
        if not self.manager.intent or self.manager.state not in ('needs_source', 'ready') or self.manager.task and not self.manager.task.done():
            raise web.HTTPConflict()
        # LoRAs are acquired directly by this worker, never relayed from the app.
        return next((x for x in self.manager.entries() if not x.get('routes') and hashlib.sha256(x['path'].encode()).hexdigest() == sha), None)

    def existing(self, sha):
        # tusd's file store owns this metadata. Reading only ID/creation metadata
        # reconciles a lost POST response; byte offsets always come from HEAD.
        for file in self.directory.glob('*.info'):
            value = json.loads(file.read_text())
            metadata = value.get('MetaData', {})
            if metadata.get('asset') == sha and metadata.get('manifest') == self.manager.intent['digest']:
                identifier = value['ID']
                if not re.fullmatch(r'[A-Za-z0-9_-]+', identifier): raise ValueError('Invalid tus upload ID')
                return identifier
        return None

    async def promote(self, client, identifier, item):
        async with client.head(self.origin+'/files/'+identifier, headers={'Tus-Resumable': '1.0.0'}, allow_redirects=False) as head:
            if head.status != 200 or head.headers.get('Upload-Offset') != str(item['size']): return
        uploaded = self.directory/identifier
        if not await asyncio.to_thread(verified, uploaded, item):
            # Let tusd remove its own upload and metadata so the next create starts fresh.
            async with client.delete(self.origin+'/files/'+identifier, headers={'Tus-Resumable': '1.0.0'}, allow_redirects=False) as deleted:
                if deleted.status != 204: raise web.HTTPBadGateway()
            raise ValueError('Uploaded model failed integrity verification; retry from zero')
        target, _ = locations(self.manager.workspace, item)
        target.parent.mkdir(parents=True, exist_ok=True)
        # Keep tusd's backing file intact until its own DELETE removes metadata.
        staged = target.with_name(target.name + '.upload')
        staged.unlink(missing_ok=True)
        os.link(uploaded, staged)
        os.replace(staged, target)
        save_receipt(self.manager.workspace, item, target)
        async with client.delete(self.origin+'/files/'+identifier, headers={'Tus-Resumable': '1.0.0'}, allow_redirects=False) as deleted:
            if deleted.status != 204: raise web.HTTPBadGateway()
        self.manager.files[item['path']] = {'path': item['path'], 'state': 'ready', 'ready': True}
        ready = await asyncio.to_thread(probe, self.manager.workspace, self.manager.entries())
        if all(x['ready'] for x in ready):
            await asyncio.to_thread(activate, self.manager.workspace, self.manager.entries())
            if not self.manager.intent['cancelled']:
                self.manager.state = 'ready'
                self.manager.ready.set()
        self.manager.refresh()

    async def finish(self, client, identifier, item):
        # Streaming remains cancellable; once verification/promotion starts, join
        # it before releasing ownership so filesystem threads cannot outlive us.
        task = asyncio.create_task(self.promote(client, identifier, item))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            await asyncio.gather(task, return_exceptions=True)
            raise

    async def handle(self, request):
        async with self.lock:
            async with self.manager.lock:
                self.item(request.match_info['sha'])
                self.manager.upload_task = asyncio.current_task()
            try:
                return await self.transfer(request)
            finally:
                self.manager.upload_task = None

    async def transfer(self, request):
        sha = request.match_info['sha']
        item = self.item(sha)
        if item is None: raise web.HTTPNotFound()
        target, _ = locations(self.manager.workspace, item)
        if (await asyncio.to_thread(probe, self.manager.workspace, [item]))[0]['ready']:
            return web.json_response({'ready': True}) if request.method == 'POST' else web.Response(status=200 if request.method == 'HEAD' else 204, headers={'Tus-Resumable': '1.0.0', 'Upload-Offset': str(item['size']), 'Upload-Length': str(item['size'])})
        if self.manager.state == 'ready': raise web.HTTPConflict()
        identifier = self.existing(sha)
        async with ClientSession(timeout=ClientTimeout(total=None, sock_connect=5, sock_read=120)) as client:
            if identifier and not (self.directory/identifier).exists():
                async with client.delete(self.origin+'/files/'+identifier, headers={'Tus-Resumable':'1.0.0'}, allow_redirects=False) as deleted:
                    if deleted.status not in (204, 404): raise web.HTTPBadGateway()
                identifier = None
            if request.method == 'POST':
                if not identifier:
                    metadata = ','.join(k+' '+base64.b64encode(v.encode()).decode() for k, v in {'asset': sha, 'manifest': self.manager.intent['digest']}.items())
                    async with client.post(self.origin+'/files/', headers={'Tus-Resumable':'1.0.0', 'Upload-Length':str(item['size']), 'Upload-Metadata':metadata}, allow_redirects=False) as created:
                        if created.status != 201: raise web.HTTPBadGateway()
                        identifier = urlsplit(created.headers['Location']).path.rsplit('/',1)[-1]
                        if not re.fullmatch(r'[A-Za-z0-9_-]+', identifier): raise ValueError('Invalid tus upload ID')
                # A previous completed PATCH might have lost its response.
                await self.finish(client, identifier, item)
                return web.json_response({'upload_path': '/worker/v1/model-uploads/'+sha, 'ready': self.manager.files.get(item['path'], {}).get('ready', False)})
            if not identifier: raise web.HTTPNotFound()
            headers = {k: request.headers[k] for k in ('Tus-Resumable', 'Upload-Offset', 'Content-Type', 'Content-Length') if k in request.headers}
            async with client.request(request.method, self.origin+'/files/'+identifier, headers=headers,
                data=request.content if request.method == 'PATCH' else None, allow_redirects=False) as response:
                status = response.status
                returned = {k:v for k,v in response.headers.items() if k.lower() in ('tus-resumable', 'upload-offset', 'upload-length', 'tus-version', 'tus-extension')}
                await response.read()
            if request.method == 'PATCH' and status == 204: await self.finish(client, identifier, item)
            return web.Response(status=status, headers=returned)


def install(app, manager, authenticated):
    uploads = ModelUploads(manager)
    async def handle(request):
        if not authenticated(request): raise web.HTTPUnauthorized()
        if request.method not in ('POST', 'HEAD', 'PATCH'): raise web.HTTPMethodNotAllowed(request.method, ['POST','HEAD','PATCH'])
        return await uploads.handle(request)
    async def lifetime(app):
        uploads.directory.mkdir(parents=True, exist_ok=True)
        process = None
        try:
            with open(manager.runtime/'tusd.log', 'ab') as log:
                process = await spawn_owned('/usr/local/bin/tusd', '-host', '127.0.0.1', '-port', '1080',
                    '-upload-dir', str(uploads.directory), env=child_environment(), stdout=log,
                    stderr=asyncio.subprocess.STDOUT)
                yield
        finally:
            await stop_process(process)
    app.cleanup_ctx.append(lifetime)
    app.router.add_route('*', '/worker/v1/model-uploads/{sha:[a-f0-9]{64}}', handle)
