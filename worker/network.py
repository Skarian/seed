"""Optional private TCP route, supervised using the official containerboot binary."""
import asyncio
import ipaddress
import json
import os
import re
from pathlib import Path
from aiohttp import web
from worker.app import atomic_json
from worker.processes import stop_process, spawn_owned

NETWORK = web.AppKey('network', object)


def environment(runtime, hostname, key=''):
    root = Path(runtime)/'tailscale'
    root.mkdir(parents=True, exist_ok=True)
    serve = root/'serve.json'
    atomic_json(serve, {'TCP': {'8080': {'TCPForward': '127.0.0.1:8080'}}})
    return {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(root),
            'TS_USERSPACE': 'true', 'TS_AUTH_ONCE': 'true', 'TS_AUTHKEY': key,
            'TS_STATE_DIR': str(root), 'TS_SOCKET': str(root/'tailscaled.sock'),
            'TS_KUBE_SECRET': '', 'TS_ACCEPT_DNS': 'false', 'TS_EXTRA_ARGS': '--accept-routes=false',
            'TS_HOSTNAME': hostname, 'TS_SERVE_CONFIG': str(serve)}


class Network:
    def __init__(self, runtime, instance_id):
        self.runtime, self.hostname = Path(runtime), 'seed-'+instance_id[:12]
        self.task = self.process = None
        self.lock = asyncio.Lock()
        self.error = None

    async def status(self):
        if not self.task: return {'state': 'disabled'}
        command = None
        try:
            command = await asyncio.create_subprocess_exec('/usr/local/bin/tailscale',
                '--socket='+str(self.runtime/'tailscale/tailscaled.sock'), 'status', '--json',
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                env={'PATH': '/usr/local/bin:/usr/bin:/bin'}, start_new_session=True)
            raw, _ = await asyncio.wait_for(command.communicate(), 5)
            status = json.loads(raw)
            peer = status.get('Self') or {}
            address = next((ip for ip in peer.get('TailscaleIPs', []) if ipaddress.ip_address(ip).version == 4), None)
            if command.returncode == 0 and status.get('BackendState') == 'Running' and address:
                return {'state': 'ready', 'peer_id': peer['ID'], 'address': address}
        except Exception:
            pass
        finally:
            if command: await stop_process(command)
        return {'state': 'starting' if self.task and not self.task.done() else 'needs_enrollment', 'error': self.error}

    async def start(self, key=''):
        if key and not re.fullmatch(r'tskey-auth-[A-Za-z0-9_-]+', key): raise ValueError('Expected a one-use auth key')
        async with self.lock:
            if self.task and not self.task.done(): return
            self.task = asyncio.create_task(self.run(key))

    async def run(self, key):
        env = environment(self.runtime, self.hostname, key)
        key = ''
        try:
            with open(self.runtime/'tailscale.log', 'ab') as log:
                self.process = await spawn_owned('/usr/local/bin/containerboot',
                    env=env, stdout=log, stderr=asyncio.subprocess.STDOUT)
                env.clear()
                await self.process.wait()
                self.error = 'Tailscale stopped; inspect its private log, then reconnect.'
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.error = 'Tailscale startup failed ('+type(exc).__name__+').'
        finally:
            env.clear()
            await stop_process(self.process)
            self.process = None

    async def close(self):
        if self.task and not self.task.done(): self.task.cancel()
        if self.task: await asyncio.gather(self.task, return_exceptions=True)


def install(app, runtime, instance_id, authenticated):
    network = Network(runtime, instance_id)
    app[NETWORK] = network
    async def get(request):
        if not authenticated(request): raise web.HTTPUnauthorized()
        return web.json_response(await network.status())
    async def post(request):
        if not authenticated(request): raise web.HTTPUnauthorized()
        body = await request.json()
        if set(body) != {'auth_key'}: raise ValueError('Expected enrollment key')
        await network.start(body['auth_key'])
        return web.json_response({'state': 'starting'}, status=202)
    async def lifetime(app):
        if (Path(runtime)/'tailscale/tailscaled.state').exists(): await network.start()
        yield
        await network.close()
    app.cleanup_ctx.append(lifetime)
    app.router.add_get('/worker/v1/network', get)
    app.router.add_post('/worker/v1/network', post)
