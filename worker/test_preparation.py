import asyncio
import hashlib
import json
import pytest
from aiohttp import web
from worker.preparation import Preparation, manifest


def item(data=b'seed-model'):
    return {'path': 'diffusion_models/test.bin', 'url': 'https://huggingface.co/test/model/resolve/' + 'a'*40 + '/test.bin',
            'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


async def finished(manager):
    await asyncio.wait_for(manager.task, 15)


@pytest.mark.asyncio
async def test_retry_clears_stale_download_errors_before_reporting_progress(tmp_path):
    entry = item()
    target = tmp_path/'workspace/ComfyUI/models'/entry['path']
    target.parent.mkdir(parents=True)
    target.write_bytes(b'seed-model')
    manager = Preparation(tmp_path/'workspace', tmp_path/'runtime', {})
    manager.files = {entry['path']: {'path': entry['path'], 'ready': False,
                                  'error': 'Previous download failed', 'state': 'needs_source'}}
    state = await manager.ensure([entry], {}, 0)
    assert state['state'] == 'preparing'
    assert state['files'] == [{'path': entry['path'], 'state': 'pending'}]
    await finished(manager)
    assert manager.state == 'ready'


@pytest.mark.asyncio
async def test_prepare_verified_files_and_restart_without_credentials(tmp_path):
    entry = item()
    target = tmp_path/'workspace/ComfyUI/models'/entry['path']
    target.parent.mkdir(parents=True)
    target.write_bytes(b'seed-model')
    manager = Preparation(tmp_path/'workspace', tmp_path/'runtime', {})
    state = await manager.ensure([entry], {'huggingFaceToken': 'must-not-be-journaled'}, 0)
    assert state['credentials_accepted'] is True
    task = manager.task
    duplicate = await manager.ensure([entry], {}, 0)
    assert duplicate['credentials_accepted'] is False
    assert manager.task is task
    await finished(manager)
    assert manager.state == 'ready', manager.refresh()
    no_op = await manager.ensure([entry], {}, 0)
    assert no_op['credentials_accepted'] is False
    assert 'must-not-be-journaled' not in manager.file.read_text()
    restarted = Preparation(tmp_path/'workspace', tmp_path/'runtime', {})
    await restarted.ensure([entry], {}, 0)
    await finished(restarted)
    assert restarted.ready.is_set()
    with pytest.raises(web.HTTPConflict): await restarted.cancel()


@pytest.mark.asyncio
async def test_cancel_is_persistent_and_stale_ensure_cannot_undo_it(tmp_path):
    manager = Preparation(tmp_path/'workspace', tmp_path/'runtime', {})
    await manager.ensure([item()], {}, 0)
    await manager.cancel()
    assert manager.state == 'cancelled'
    assert manager.process is None
    saved = json.loads(manager.file.read_text())
    assert saved['cancelled'] and saved['revision'] == 1
    restarted = Preparation(tmp_path/'workspace', tmp_path/'runtime', {})
    assert restarted.state == 'cancelled'
    with pytest.raises(web.HTTPConflict): await restarted.ensure([item()], {}, 0)
    assert restarted.state == 'cancelled'
    await restarted.ensure([item()], {}, 1)
    await finished(restarted)
    assert restarted.state == 'needs_source'
    assert not json.loads(manager.file.read_text())['cancelled']


@pytest.mark.asyncio
async def test_changed_manifest_and_corrupt_cache_do_not_become_ready(tmp_path):
    entry = item()
    target = tmp_path/'workspace/ComfyUI/models'/entry['path']
    target.parent.mkdir(parents=True)
    target.write_bytes(b'wrong-hash')
    manager = Preparation(tmp_path/'workspace', tmp_path/'runtime', {})
    await manager.ensure([entry], {}, 0)
    await finished(manager)
    assert manager.state == 'needs_source'
    assert not manager.ready.is_set()
    with pytest.raises(web.HTTPConflict): await manager.ensure([item(b'new')], {}, 0)


def test_manifest_rejects_unknown_fields_and_unpinned_sources(tmp_path):
    for changed in [{'token': 'secret'}, {'url': 'https://huggingface.co/a/b/resolve/main/file'},
                    {'path': '../escape'}, {'url': 'http://127.0.0.1/private'}, {'size': True}]:
        with pytest.raises(ValueError): manifest(tmp_path, [{**item(), **changed}])

@pytest.mark.asyncio
async def test_unused_cleanup_requires_new_identity_cancel_and_empty_spool(tmp_path):
    from worker.app import atomic_json
    workspace, runtime = tmp_path/'workspace', tmp_path/'runtime'
    atomic_json(workspace/'.seed/workspace.json', {'workspace_id': 'workspace'})
    identity = {'worker_instance_id': 'worker', 'engine_ever_started': False}
    atomic_json(runtime/'identity.json', identity)
    manager = Preparation(workspace, runtime, {})
    await manager.ensure([item()], {}, 0)
    await finished(manager)
    assert manager.unused_worker() is None
    cancelled = await manager.cancel()
    assert cancelled['unused_worker'] == {'worker_instance_id': 'worker', 'workspace_id': 'workspace'}
    spool = workspace/'.seed/spool'
    spool.mkdir(parents=True)
    orphan = spool/'orphan-output'
    orphan.write_text('preserve')
    assert manager.unused_worker() is None
    orphan.unlink()
    for value in [True, None]:
        atomic_json(runtime/'identity.json', {**identity, 'engine_ever_started': value})
        assert manager.unused_worker() is None

@pytest.mark.asyncio
async def test_cancel_before_manifest_fences_delayed_first_ensure(tmp_path):
    from worker.app import atomic_json
    workspace, runtime = tmp_path/'workspace', tmp_path/'runtime'
    atomic_json(workspace/'.seed/workspace.json', {'workspace_id': 'workspace'})
    atomic_json(runtime/'identity.json', {'worker_instance_id': 'worker', 'engine_ever_started': False})
    manager = Preparation(workspace, runtime, {})
    cancelled = await manager.cancel()
    assert cancelled['unused_worker']['worker_instance_id'] == 'worker'
    restarted = Preparation(workspace, runtime, {})
    with pytest.raises(web.HTTPConflict): await restarted.ensure([item()], {}, 0)
    await restarted.ensure([item()], {}, cancelled['revision'])
    await finished(restarted)
    assert restarted.state == 'needs_source'
