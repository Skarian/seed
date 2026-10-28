import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from worker.jobs import install


@pytest.mark.asyncio
async def test_quiesce_relay_requires_bearer_and_forwards_session(tmp_path):
    seen=[]
    async def quiesce(request):
        seen.append((request.headers.get('X-Studio-Engine-Session'),await request.json()))
        return web.json_response({'state':'draining'})
    engine=web.Application();engine.router.add_post('/studio/quiesce',quiesce)
    upstream=TestServer(engine);await upstream.start_server()
    gateway=web.Application()
    install(gateway,tmp_path,str(upstream.make_url('')).rstrip('/'),lambda r:r.headers.get('Authorization')=='Bearer fixture')
    client=TestClient(TestServer(gateway));await client.start_server()
    try:
        assert (await client.post('/comfy/quiesce',json={'stop_id':'stop'})).status==401
        assert not seen
        response=await client.post('/comfy/quiesce',json={'stop_id':'stop'},headers={
            'Authorization':'Bearer fixture','X-Studio-Engine-Session':'session'})
        assert response.status==200 and (await response.json())['state']=='draining'
        assert seen==[('session',{'stop_id':'stop'})]
    finally: await client.close();await upstream.close()
