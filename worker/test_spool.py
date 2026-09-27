import hashlib
import uuid

import pytest
from aiohttp import CookieJar
from aiohttp.test_utils import TestClient, TestServer

from worker.app import create_app
from worker.spool import atomic, job_directory, read_record
from worker.test_app import SECRET, ORIGIN, mint


async def paired_client(tmp_path):
    volume = tmp_path / 'volume'
    app = create_app(volume, tmp_path / 'runtime', SECRET, ORIGIN, development=True)
    client = TestClient(TestServer(app), cookie_jar=CookieJar(unsafe=True))
    await client.start_server()
    # A bearer is required for media; unlock cookies alone must not grant access.
    token = await mint(client)
    result = await (await client.post('/worker/v1/exchange', json={'exchange_token': token})).json()
    return client, volume, {'Authorization': 'Bearer ' + result['worker_credential']}


def completed(volume, artifact_path=None):
    job_id = str(uuid.uuid4())
    directory = job_directory(volume, job_id)
    payload = b'closed-image-fixture-0123456789'
    relative = artifact_path or f'seed/{job_id}/image.png'
    target = volume / '.seed/spool/outputs' / relative
    if artifact_path is None:
        target.parent.mkdir(parents=True)
        target.write_bytes(payload)
    atomic(directory / 'submission.json', {'job_id': job_id, 'engine_session_id': 'engine', 'workspace_id': 'workspace'})
    atomic(directory / 'manifest.json', {'job_id': job_id, 'state': 'completed', 'outputs': [
        {'id': '0', 'path': relative, 'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(), 'mime_type': 'image/png'}
    ]})
    return job_id, directory, target, payload


@pytest.mark.asyncio
async def test_spool_auth_range_and_exact_repeatable_receipt(tmp_path):
    client, volume, headers = await paired_client(tmp_path)
    try:
        job_id, directory, target, payload = completed(volume)
        base = '/worker/v1/jobs/' + job_id
        for endpoint in ['/worker/v1/jobs', base, base + '/outputs/0']:
            assert (await client.get(endpoint)).status == 401
        assert (await client.post(base + '/receipt', json={})).status == 401
        response = await client.get(base + '/outputs/0', headers={**headers, 'Range': 'bytes=7-14'})
        assert response.status == 206
        assert response.headers['Content-Range'] == f'bytes 7-14/{len(payload)}'
        assert await response.read() == payload[7:15]
        record = await (await client.get(base, headers=headers)).json()
        assert hashlib.sha256(record['manifest_bytes'].encode()).hexdigest() == record['manifest_digest']
        for body in [{'manifest_digest': '0' * 64}, {'manifest_digest': record['manifest_digest'], 'extra': True}]:
            assert (await client.post(base + '/receipt', headers=headers, json=body)).status == 409
            assert target.exists()
            assert not (directory / 'receipt.json').exists()
        neighbor = target.parent.parent / 'unrelated.png'
        neighbor.write_bytes(b'keep')
        for _ in range(2):
            response = await client.post(base + '/receipt', headers=headers, json={'manifest_digest': record['manifest_digest']})
            assert response.status == 200
            assert (await response.json())['cleanup_complete'] is True
        assert not target.exists()
        assert neighbor.read_bytes() == b'keep'
        saved = read_record(directory)
        assert saved['acknowledged'] and saved['cleanup_complete']
        assert saved['manifest_digest'] == record['manifest_digest']
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_spool_rejects_escape_without_deleting_outside_file(tmp_path):
    client, volume, headers = await paired_client(tmp_path)
    try:
        outside = volume / '.seed/outside.png'
        outside.write_bytes(b'keep')
        job_id, directory, _, _ = completed(volume, '../../outside.png')
        base = '/worker/v1/jobs/' + job_id
        assert (await client.get(base + '/outputs/0', headers=headers)).status == 400
        record = read_record(directory)
        response = await client.post(base + '/receipt', headers=headers, json={'manifest_digest': record['manifest_digest']})
        assert response.status >= 400
        assert outside.read_bytes() == b'keep'
        assert not (directory / 'cleaned.json').exists()
        assert (await client.get('/worker/v1/jobs/not-a-uuid', headers=headers)).status == 400
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_spool_cannot_acknowledge_missing_manifest(tmp_path):
    client, volume, headers = await paired_client(tmp_path)
    try:
        job_id = str(uuid.uuid4())
        directory = job_directory(volume, job_id)
        atomic(directory / 'submission.json', {'job_id': job_id})
        response = await client.post('/worker/v1/jobs/' + job_id + '/receipt', headers=headers, json={'manifest_digest': None})
        assert response.status == 409
        assert not (directory / 'receipt.json').exists()
    finally:
        await client.close()


def test_spool_rejects_path_ids_and_atomic_failure_retains_record(tmp_path, monkeypatch):
    for invalid in ['../outside', 'not-a-uuid', str(uuid.uuid4()).upper()]:
        with pytest.raises(ValueError):
            job_directory(tmp_path, invalid)
    target = tmp_path / 'record.json'
    atomic(target, {'old': True})
    import worker.spool as spool
    def fail_replace(*args):
        raise OSError('simulated interrupted promotion')
    monkeypatch.setattr(spool.os, 'replace', fail_replace)
    with pytest.raises(OSError):
        atomic(target, {'new': True})
    assert target.read_text() == '{"old":true}'
    assert not list(tmp_path.glob('*.tmp'))


@pytest.mark.asyncio
@pytest.mark.parametrize('state', ['failed', 'cancelled'])
async def test_terminal_failure_receipt_cleans_inputs_and_partial_outputs(tmp_path, state):
    client, volume, headers = await paired_client(tmp_path)
    try:
        job_id, directory, output, _ = completed(volume)
        atomic(directory / 'manifest.json', {'job_id': job_id, 'state': state, 'outputs': []})
        partial = output.with_suffix('.part.mp4')
        partial.write_bytes(b'incomplete')
        inputs = volume / '.seed/spool/inputs/seed' / job_id
        inputs.mkdir(parents=True)
        (inputs / 'reference.mp4').write_bytes(b'input')
        unrelated = inputs.parent / 'keep.txt'
        unrelated.write_bytes(b'keep')
        record = read_record(directory)
        for _ in range(2):
            response = await client.post('/worker/v1/jobs/' + job_id + '/receipt', headers=headers,
                                         json={'manifest_digest': record['manifest_digest']})
            assert response.status == 200
            assert (await response.json())['cleanup_complete'] is True
        assert not inputs.exists() and not output.parent.exists()
        assert unrelated.read_bytes() == b'keep'
        assert read_record(directory)['manifest']['state'] == state
    finally:
        await client.close()
