import time
from worker.download_progress import DownloadProgress, hub_progress_class
from worker.preparation import Preparation


def test_download_process_uses_sdk_resume_prefix_as_rate_baseline(monkeypatch):
    from worker import download_process
    now, events, completed = [0.0], [], [False]
    item = {'path': 'fixture.bin', 'size': 1000, 'sha256': 'a' * 64,
            'url': 'https://huggingface.co/fixture/model/resolve/revision/file'}
    monkeypatch.setattr(download_process, 'DownloadProgress',
                        lambda item, report: DownloadProgress(item, report, lambda: now[0]))
    monkeypatch.setattr(download_process, 'probe',
                        lambda workspace, entries: [{'ready': completed[0]}])
    monkeypatch.setattr(download_process, 'activate', lambda *args: None)

    def download(workspace, entry, token, progress):
        progress(400)  # SDK reports the cached prefix before receiving data.
        now[0] = 2
        progress(600)
        progress(1000, 'verifying')
        completed[0] = True
        return {'ready': True}

    monkeypatch.setattr(download_process, 'direct_download', download)
    download_process.prepare('unused-fixture', [item], {}, events.append)
    transfer = [event for event in events if event.get('state') == 'downloading']
    assert transfer[0]['bytes_done'] == 0
    assert transfer[1]['bytes_done'] == 400 and transfer[1]['bytes_per_second'] == 0
    assert transfer[2]['bytes_done'] == 600 and transfer[2]['bytes_per_second'] == 100
    assert events[-1] == {'complete': True}


def test_progress_rate_resume_restart_and_verification():
    now = [0.0]
    events = []
    progress = DownloadProgress({'path': 'model.bin', 'size': 1000}, events.append, lambda: now[0])
    progress.update(400)  # A resumed prefix is not new transfer throughput.
    assert events[-1]['bytes_per_second'] == 0
    now[0] = .1
    progress.update(410)
    assert len(events) == 1
    now[0] = 2
    progress.update(600)
    assert events[-1]['bytes_per_second'] == 100
    now[0] = 4
    progress.update(200)  # Resume rejected; start over.
    assert events[-1]['bytes_per_second'] == 0
    progress.update(1000, 'verifying')
    assert events[-1]['state'] == 'verifying'
    assert events[-1]['bytes_per_second'] == 0


def test_hub_progress_tracks_http_and_xet_file_bytes_without_transfer_double_counting(capsys):
    events = []
    bar_type = hub_progress_class(lambda done: events.append(done))
    with bar_type(total=100, initial=20, disable=True, name='huggingface_hub.http_get') as bar:
        bar.update(10)
    assert events[-1] == 30
    events.clear()
    with bar_type(total=100, name='huggingface_hub.xet_get', desc='file: reconstructing file') as bar:
        bar.update(40)
    with bar_type(total=100, name='huggingface_hub.xet_get.transfer', desc='file: downloading bytes') as bar:
        bar.update(60)
    assert events == [0, 40]
    assert capsys.readouterr().out == ''


def test_partial_downloads_eta_stalls_and_verification_are_reported(tmp_path):
    manager = Preparation(tmp_path/'workspace', tmp_path/'runtime', {})
    manager.intent = {'entries': [{'path': 'a', 'size': 1000}, {'path': 'b', 'size': 1000}], 'revision': 0, 'digest': 'fixture'}
    manager.state = 'preparing'
    manager.files = {'a': {'ready': True}, 'b': {'path': 'b', 'state': 'downloading', 'bytes_done': 400, 'bytes_per_second': 100, 'updated_at': time.time()}}
    state = manager.refresh()
    assert state['bytes_done'] == 1400 and state['eta_seconds'] == 6
    assert state['stage'] == 'downloading' and not state['stalled']
    manager.files['b']['updated_at'] -= 20
    state = manager.refresh()
    assert state['stalled'] and state['bytes_per_second'] == 0 and state['eta_seconds'] is None
    manager.files['b'].update(state='verifying', bytes_done=1000)
    state = manager.refresh()
    assert state['stage'] == 'verifying' and state['bytes_done'] == 2000
    assert state['eta_seconds'] is None and not state['stalled']
