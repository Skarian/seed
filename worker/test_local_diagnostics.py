import json
import threading
from worker.local_diagnostics import Journal, EventWatcher


def test_event_watcher_deduplicates_records_and_omits_event_content(tmp_path):
    watcher = EventWatcher.__new__(EventWatcher)
    watcher.journal = Journal(tmp_path/'events.jsonl')
    watcher.started, watcher.cursor = 100, 0
    watcher.query = lambda since: [dict(RecordId=2, Id=153, ProviderName='nvlddmkm', Level=2, at='fixture', Message='PRIVATE_FIXTURE', Data='PRIVATE_FIXTURE')]
    watcher.collect(); watcher.collect()
    saved = (tmp_path/'events.jsonl').read_text()
    assert 'PRIVATE_FIXTURE' not in saved
    rows = [json.loads(line) for line in saved.splitlines()]
    assert len([row for row in rows if row['event'] == 'windows_event']) == 1
    assert len([row for row in rows if row['event'] == 'windows_event_poll']) == 2


def test_event_query_failure_is_distinct_from_no_faults(tmp_path):
    watcher = EventWatcher.__new__(EventWatcher)
    watcher.journal = Journal(tmp_path/'events.jsonl')
    watcher.started, watcher.cursor = 100, 0
    def failed(since): raise OSError('PRIVATE_FIXTURE')
    watcher.query = failed
    watcher.collect()
    record = json.loads((tmp_path/'events.jsonl').read_text())
    assert record['event'] == 'windows_event_query_unavailable'
    assert record['error_type'] == 'OSError' and 'PRIVATE_FIXTURE' not in str(record)


def test_diagnostic_disk_failure_cannot_terminate_engine(tmp_path):
    file = tmp_path/'not-directory'; file.write_text('fixture')
    assert Journal(file/'events.jsonl').write('start') is False
