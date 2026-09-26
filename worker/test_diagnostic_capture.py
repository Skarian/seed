import asyncio
import json
import urllib.error
import pytest
from worker.diagnostics import capture_stderr, error_details, write_event


@pytest.mark.asyncio
async def test_download_stderr_survives_chunking_without_credentials(tmp_path):
    stream = asyncio.StreamReader()
    task = asyncio.create_task(capture_stderr(stream, tmp_path, ['private-download-token']))
    stream.feed_data(b'Retry 503 with Bearer private-down')
    stream.feed_data(b'load-token at https://files.example/file?Signature=do-not-save\n')
    stream.feed_data(b'Connection reset by peer\n')
    stream.feed_eof()
    await task
    text = (tmp_path/'diagnostics.jsonl').read_text()
    assert 'private-download-token' not in text
    assert 'do-not-save' not in text
    assert 'Retry 503' in text and 'Connection reset by peer' in text
    assert len(text.splitlines()) == 2


def test_exception_keeps_cause_and_rotates_private_evidence(tmp_path):
    try:
        raise urllib.error.HTTPError('https://files.example/file?token=secret-value', 403, 'Access denied', {}, None)
    except Exception as exc:
        details = error_details(exc, ['secret-value'])
    (tmp_path/'diagnostics.jsonl').write_bytes(b'x'*(2*1024*1024))
    assert write_event(tmp_path, 'download.failed', details)
    assert (tmp_path/'diagnostics.previous.jsonl').stat().st_size == 2*1024*1024
    text = (tmp_path/'diagnostics.jsonl').read_text()
    assert 'secret-value' not in text
    assert 'HTTPError' in text and '403' in text and 'Access denied' in text


@pytest.mark.asyncio
async def test_oversized_stderr_is_explicitly_bounded_and_does_not_block_next_error(tmp_path):
    stream = asyncio.StreamReader()
    stream.feed_data(b'x'*100000 + b'\nActual error after oversized line\n')
    stream.feed_eof()
    await capture_stderr(stream, tmp_path, [])
    events = [json.loads(line) for line in (tmp_path/'diagnostics.jsonl').read_text().splitlines()]
    assert any(e['operation'] == 'download.stderr.truncated' for e in events)
    assert any('Actual error' in e['data']['message'] for e in events)
