import asyncio
import errno
import hashlib
import uuid

import pytest
from aiohttp import FormData

from worker import inputs
from worker.test_spool import paired_client
from worker.spool import atomic


def upload(payload, job, filename='image.png', **fields):
    form = FormData()
    form.add_field('image', payload, filename=filename, content_type='application/octet-stream')
    for key, value in {'subfolder': 'seed/' + job, 'type': 'input', 'overwrite': 'true', **fields}.items():
        form.add_field(key, value)
    return form


def proof(payload):
    return {'X-Seed-Input-Size': str(len(payload)), 'X-Seed-Input-SHA256': hashlib.sha256(payload).hexdigest()}


@pytest.mark.asyncio
async def test_input_publication_retries_do_not_replace_or_corrupt(tmp_path):
    client, volume, auth = await paired_client(tmp_path)
    job, payload = str(uuid.uuid4()), b'frame-data' * 30000
    try:
        headers = {**auth, **proof(payload)}
        results = await asyncio.gather(*[client.post('/comfy/upload', data=upload(payload, job), headers=headers) for _ in range(2)])
        assert [r.status for r in results] == [200, 200]
        target = volume / '.seed/spool/inputs/seed' / job / 'image.png'
        original = target.stat()
        # Keep an open reader as inference would, while a late retry completes.
        with target.open('rb') as reader:
            response = await client.post('/comfy/upload', data=upload(payload, job), headers=headers)
            assert response.status == 200
            assert await response.json() == {'name': 'image.png', 'subfolder': 'seed/' + job, 'type': 'input', 'size': len(payload), 'sha256': proof(payload)['X-Seed-Input-SHA256']}
            assert reader.read() == payload
        assert target.stat().st_ino == original.st_ino
        assert target.stat().st_mtime_ns == original.st_mtime_ns
        changed = b'different'
        response = await client.post('/comfy/upload', data=upload(changed, job), headers={**auth, **proof(changed)})
        assert response.status == 409
        assert target.read_bytes() == payload
        assert not list((volume / '.seed/spool/inputs').glob('.upload-*'))
        atomic(volume / '.seed/spool/jobs' / job / 'receipt.json', {'saved': True})
        target.unlink()
        target.parent.rmdir()
        response = await client.post('/comfy/upload', data=upload(payload, job), headers=headers)
        assert response.status == 409
        assert (await response.json())['code'] == 'input_retired'
        assert not target.parent.exists()
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_input_rejects_integrity_destination_and_maps_disk_full(tmp_path, monkeypatch):
    client, volume, auth = await paired_client(tmp_path)
    job, payload = str(uuid.uuid4()), b'soundtrack'
    try:
        assert (await client.post('/comfy/upload', data=upload(payload, job), headers=proof(payload))).status == 401
        response = await client.post('/comfy/upload', data=upload(payload, job), headers={**auth, **proof(b'wrong')})
        assert response.status == 422
        for filename, subfolder in [('../escape.png', 'seed/' + job), ('image.png', 'seed/../outside')]:
            response = await client.post('/comfy/upload', data=upload(payload, job, filename, subfolder=subfolder), headers={**auth, **proof(payload)})
            assert response.status == 400
        response = await client.post('/comfy/upload', data=upload(payload, job, 'clip-audio.wav'), headers={**auth, **proof(payload)})
        assert response.status == 200
        assert (await response.json())['sha256'] == proof(payload)['X-Seed-Input-SHA256']
        def full(*args):
            raise OSError(errno.ENOSPC, 'full')
        monkeypatch.setattr(inputs, 'publish', full)
        response = await client.post('/comfy/upload', data=upload(payload, job, 'other.wav'), headers={**auth, **proof(payload)})
        assert response.status == 507
        assert (await response.json())['code'] == 'storage_full'
        assert not list((volume / '.seed/spool/inputs').rglob('other.wav'))
        assert not list((volume / '.seed/spool/inputs').glob('.upload-*'))
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_conflicting_concurrent_inputs_publish_exactly_one(tmp_path):
    client, volume, auth = await paired_client(tmp_path)
    job = str(uuid.uuid4())
    try:
        payloads = [b'first' * 20000, b'second' * 20000]
        responses = await asyncio.gather(*[client.post('/comfy/upload', data=upload(payload, job), headers={**auth, **proof(payload)}) for payload in payloads])
        assert sorted(response.status for response in responses) == [200, 409]
        winning = payloads[next(i for i, response in enumerate(responses) if response.status == 200)]
        assert (volume / '.seed/spool/inputs/seed' / job / 'image.png').read_bytes() == winning
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_stalled_input_expires_without_publishing(tmp_path, monkeypatch):
    monkeypatch.setattr(inputs, 'IDLE_SECONDS', .05)
    client, volume, auth = await paired_client(tmp_path)
    try:
        reader, writer = await asyncio.open_connection(client.server.host, client.server.port)
        headers = {**auth, **proof(b'pending'), 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': '10000'}
        writer.write(('POST /comfy/upload HTTP/1.1\r\nHost: localhost\r\n' + ''.join(f'{k}: {v}\r\n' for k, v in headers.items()) + '\r\n').encode())
        await writer.drain()
        status = await asyncio.wait_for(reader.readline(), 2)
        assert b'408' in status
        writer.close()
        await writer.wait_closed()
        assert not list((volume / '.seed/spool/inputs').glob('.upload-*'))
        assert not list((volume / '.seed/spool/inputs').rglob('*.png'))
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_half_open_input_does_not_publish_and_recovers_after_abort(tmp_path):
    client, volume, auth = await paired_client(tmp_path)
    job, payload = str(uuid.uuid4()), b'partial-upload' * 10000
    try:
        reader, writer = await asyncio.open_connection(client.server.host, client.server.port)
        headers = {**auth, **proof(payload), 'Content-Type': 'multipart/form-data; boundary=test-boundary', 'Content-Length': str(len(payload) + 1000)}
        writer.write(('POST /comfy/upload HTTP/1.1\r\nHost: localhost\r\n' + ''.join(f'{k}: {v}\r\n' for k, v in headers.items()) + '\r\n').encode())
        writer.write(b'--test-boundary\r\nContent-Disposition: form-data; name="image"; filename="image.png"\r\nContent-Type: application/octet-stream\r\n\r\n' + payload[:70000])
        await writer.drain()
        for _ in range(100):
            if list((volume / '.seed/spool/inputs').glob('.upload-*')):
                break
            await asyncio.sleep(.01)
        assert list((volume / '.seed/spool/inputs').glob('.upload-*'))
        # A second attempt can complete even while the original socket is open.
        response = await client.post('/comfy/upload', data=upload(payload, job), headers={**auth, **proof(payload)})
        assert response.status == 200
        target = volume / '.seed/spool/inputs/seed' / job / 'image.png'
        assert target.read_bytes() == payload
        writer.close()
        await writer.wait_closed()
        for _ in range(100):
            if not list((volume / '.seed/spool/inputs').glob('.upload-*')):
                break
            await asyncio.sleep(.01)
        assert not list((volume / '.seed/spool/inputs').glob('.upload-*'))
        assert target.read_bytes() == payload
    finally:
        await client.close()
