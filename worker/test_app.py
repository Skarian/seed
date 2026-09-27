import asyncio
import base64
import json

import pytest
from aiohttp import CookieJar
from aiohttp.test_utils import TestClient, TestServer
from worker.app import create_app

SECRET = 'test-only-secret-' * 3
ORIGIN = 'http://127.0.0.1:8080'

def test_managed_worker_exposes_preparation_without_network_enrollment(tmp_path):
    app = create_app(tmp_path/'volume', tmp_path/'runtime', SECRET, ORIGIN,
                     development=True, managed_preparation=True)
    routes = {route.resource.canonical for route in app.router.routes()}
    assert '/worker/v1/preparation' in routes
    assert '/worker/v1/network' not in routes

async def client_for(tmp_path, now):
    app = create_app(tmp_path / 'volume', tmp_path / 'runtime', SECRET, ORIGIN, development=True, clock=lambda: now[0])
    client = TestClient(TestServer(app), cookie_jar=CookieJar(unsafe=True))
    await client.start_server()
    return client

async def mint(client):
    response = await client.post('/worker/v1/unlock', json={'pairing_secret': SECRET}, headers={'Origin': ORIGIN})
    assert response.status == 200
    response = await client.post('/worker/v1/pairing-codes', json={}, headers={'Origin': ORIGIN})
    assert response.status == 200
    encoded = (await response.json())['connection_code'][8:]
    return json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))['exchange_token']

@pytest.mark.asyncio
async def test_exchange_single_use_rotation_and_restart(tmp_path):
    now = [1000]
    client = await client_for(tmp_path, now)
    try:
        assert (await client.get('/worker/v1/status')).status == 401
        token = await mint(client)
        responses = await asyncio.gather(*[client.post('/worker/v1/exchange', json={'exchange_token': token}) for _ in range(2)])
        assert sorted(r.status for r in responses) == [200, 401]
        first = await next(r for r in responses if r.status == 200).json()
        next_token = await mint(client)
        second = await (await client.post('/worker/v1/exchange', json={'exchange_token': next_token})).json()
        client.session.cookie_jar.clear()
        assert (await client.get('/worker/v1/status', headers={'Authorization': 'Bearer ' + first['worker_credential']})).status == 401
        response = await client.get('/worker/v1/status', headers={'Authorization': 'Bearer ' + second['worker_credential']})
        assert response.status == 200
        status = await response.json()
        assert status['pending_output_count'] is None
        assert 'networking_version' not in status
        assert second['worker_credential'] not in (tmp_path / 'runtime/credential.json').read_text()
    finally:
        await client.close()
    client = await client_for(tmp_path, now)
    try:
        response = await client.get('/worker/v1/status', headers={'Authorization': 'Bearer ' + second['worker_credential']})
        assert response.status == 200
        assert (await response.json())['worker_instance_id'] == second['worker_instance_id']
    finally:
        await client.close()

@pytest.mark.asyncio
async def test_expiry_origin_and_latest_code(tmp_path):
    now = [1000]
    client = await client_for(tmp_path, now)
    try:
        assert (await client.post('/worker/v1/unlock', json={'pairing_secret': SECRET})).status == 403
        old = await mint(client)
        current = await mint(client)
        assert (await client.post('/worker/v1/exchange', json={'exchange_token': old})).status == 401
        now[0] += 301
        assert (await client.post('/worker/v1/exchange', json={'exchange_token': current})).status == 401
        now[0] += 600
        assert (await client.post('/worker/v1/pairing-codes', json={}, headers={'Origin': ORIGIN})).status == 401
        for _ in range(5):
            assert (await client.post('/worker/v1/unlock', json={'pairing_secret': 'wrong'}, headers={'Origin': ORIGIN})).status == 401
        assert (await client.post('/worker/v1/unlock', json={'pairing_secret': SECRET}, headers={'Origin': ORIGIN})).status == 429
    finally:
        await client.close()

@pytest.mark.asyncio
async def test_engine_restart_during_probe_never_reports_ready(tmp_path):
    import uuid
    from aiohttp import web
    workspace_id = str(uuid.uuid4())
    identity = tmp_path / 'volume/.seed/workspace.json'
    identity.parent.mkdir(parents=True)
    identity.write_text(json.dumps({'workspace_id': workspace_id}))
    sessions = [str(uuid.uuid4()), str(uuid.uuid4())]
    changing = [False]
    count = [0]
    async def session(request):
        count[0] += 1
        return web.json_response({'workspace_id': workspace_id, 'protocol_version': 2, 'engine_session_id': sessions[count[0] % 2 if changing[0] else 0]})
    async def queue(request):
        return web.json_response({'queue_running': [], 'queue_pending': []})
    engine = web.Application()
    engine.router.add_get('/studio/session', session)
    engine.router.add_get('/queue', queue)
    backend = TestServer(engine)
    await backend.start_server()
    app = create_app(tmp_path / 'volume', tmp_path / 'runtime', SECRET, ORIGIN, comfy_url=str(backend.make_url('')).rstrip('/'), development=True)
    client = TestClient(TestServer(app), cookie_jar=CookieJar(unsafe=True))
    await client.start_server()
    try:
        await mint(client)
        assert (await (await client.get('/worker/v1/status')).json())['state'] == 'ready'
        changing[0] = True
        result = await (await client.get('/worker/v1/status')).json()
        assert result['state'] == 'preparing'
        assert result['engine_session_id'] is None
    finally:
        await client.close()
        await backend.close()
