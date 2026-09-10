"""Best-effort, bounded per-job measurements; no monitoring service required."""
import csv
import io
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from .spool import atomic


def sample():
    result = subprocess.run(['nvidia-smi', '--query-gpu=uuid,name,memory.total,memory.used,utilization.gpu,driver_version',
                             '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=3, check=True)
    gpus = []
    for row in csv.reader(io.StringIO(result.stdout)):
        uuid, name, total, used, utilization, driver = (v.strip() for v in row)
        def number(value):
            try: return float(value)
            except ValueError: return None
        gpus.append(dict(uuid=uuid, name=name, total_mib=number(total), used_mib=number(used), utilization_percent=number(utilization), driver=driver))
    ram = None
    try:
        values = {line.split(':')[0]: int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith(('MemTotal:', 'MemAvailable:'))}
        ram = (values['MemTotal'] - values['MemAvailable']) / 1024
    except (OSError, ValueError, KeyError): pass
    return gpus, ram


class Measurement:
    def __init__(self, directory, sampler=sample):
        self.directory, self.sampler = directory, sampler
        self.started = time.monotonic()
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.data = dict(version=1, started_at=datetime.now(timezone.utc).isoformat(), complete=False,
                         sample_interval_seconds=2, sample_count=0, failed_samples=0, gpus=[], system_ram_peak_used_mib=None,
                         scope='device-wide sampled usage, including cached models and other processes')
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def persist(self):
        try: atomic(self.directory / 'telemetry.json', self.data)
        except OSError: pass

    def collect(self):
        try:
            gpus, ram = self.sampler()
            with self.lock:
                self.data['sample_count'] += 1
                for gpu in gpus:
                    entry = next((g for g in self.data['gpus'] if g['uuid'] == gpu['uuid']), None)
                    if entry is None:
                        entry = {k: gpu[k] for k in ('uuid', 'name', 'total_mib', 'driver')}
                        entry.update(peak_used_mib=None, utilization_samples=0, mean_utilization_percent=None)
                        self.data['gpus'].append(entry)
                    if gpu['used_mib'] is not None:
                        entry['peak_used_mib'] = max(entry['peak_used_mib'] or 0, gpu['used_mib'])
                    if gpu['utilization_percent'] is not None:
                        n = entry['utilization_samples']
                        entry['mean_utilization_percent'] = ((entry['mean_utilization_percent'] or 0) * n + gpu['utilization_percent']) / (n + 1)
                        entry['utilization_samples'] = n + 1
                if ram is not None: self.data['system_ram_peak_used_mib'] = max(self.data['system_ram_peak_used_mib'] or 0, ram)
                self.persist()
        except Exception:
            with self.lock:
                self.data['failed_samples'] += 1
                self.persist()

    def run(self):
        while not self.stop.is_set():
            self.collect()
            if self.stop.wait(2): break

    def finish(self):
        elapsed = time.monotonic() - self.started
        self.stop.set()
        self.thread.join(timeout=4)
        with self.lock:
            self.data.update(complete=True, execution_seconds=elapsed, finished_at=datetime.now(timezone.utc).isoformat())
            self.persist()
