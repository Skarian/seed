"""Content-free engine lifecycle and Windows fault-event diagnostics."""
import json
import os
from pathlib import Path
import subprocess
import threading
import time


class Journal:
    def __init__(self, file):
        self.file = Path(file)
        self.lock = threading.Lock()

    def write(self, event, **fields):
        # Callers supply only fixed lifecycle fields, never prompts or logs.
        try:
            with self.lock:
                self.file.parent.mkdir(parents=True, exist_ok=True)
                with self.file.open('a', encoding='utf8') as handle:
                    handle.write(json.dumps({'at': time.time(), 'event': event, **fields}) + '\n')
                    handle.flush(); os.fsync(handle.fileno())
            return True
        except OSError:
            # Diagnostics must never crash the GPU supervisor.
            return False


def windows_events(since):
    # Event text and event data are deliberately omitted. A record ID identifies
    # the retained Windows evidence without collecting application content.
    epoch = int(since)
    script = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new();" + (
        f"$since=[DateTimeOffset]::FromUnixTimeSeconds({epoch}).LocalDateTime;"
        "try{$events=@(Get-WinEvent -FilterHashtable @{LogName='System';StartTime=$since} -ErrorAction Stop)}"
        "catch{if($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*'){$events=@()}else{throw}};"
        "$rows=@($events | "
        "Where-Object {$_.ProviderName -in @('nvlddmkm','Display','Microsoft-Windows-WHEA-Logger','Microsoft-Windows-Kernel-PnP','Microsoft-Windows-Kernel-Power')} | "
        "Select-Object RecordId,Id,ProviderName,Level,@{n='at';e={$_.TimeCreated.ToUniversalTime().ToString('o')}});"
        "ConvertTo-Json -InputObject $rows -Compress")
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
        capture_output=True, timeout=8, creationflags=0x08000000, encoding='utf-8')
    if result.returncode: raise OSError('Windows event query failed')
    value = json.loads(result.stdout.lstrip('\ufeff') or '[]')
    if not isinstance(value, list): raise ValueError('Invalid Windows event response')
    return value


class EventWatcher:
    def __init__(self, file, query=windows_events):
        self.journal, self.query = Journal(file), query
        self.stop = threading.Event()
        self.started = time.time()
        self.cursor = 0
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def collect(self):
        try:
            rows = sorted(self.query(self.started - 2), key=lambda row: row['RecordId'])
            for row in rows:
                if row['RecordId'] <= self.cursor: continue
                self.journal.write('windows_event', record_id=row['RecordId'], event_id=row['Id'],
                    provider=row['ProviderName'], level=row['Level'], observed_at=row['at'])
                self.cursor = row['RecordId']
            self.journal.write('windows_event_poll', newest_record_id=self.cursor)
        except Exception as error:
            self.journal.write('windows_event_query_unavailable', error_type=type(error).__name__)

    def run(self):
        while not self.stop.is_set():
            self.collect()
            self.stop.wait(10)

    def close(self):
        self.stop.set(); self.thread.join(timeout=9)
