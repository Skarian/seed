"""Persist sampled native Comfy statistics; timing comes from native history."""
import json
import math
import threading
from urllib.request import urlopen
from .spool import atomic


def sample():
    with urlopen('http://127.0.0.1:8188/system_stats', timeout=2) as response:
        return json.load(response)


def used_mib(total, free):
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (total, free)):
        return None
    return max(0, total - free) / 1024**2


class Measurement:
    def __init__(self, directory, sampler=sample):
        self.directory, self.sampler = directory, sampler
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.data = dict(version=2, source='comfyui/system_stats+execution_history', complete=False,
                         sample_interval_seconds=2, sample_count=0, failed_samples=0, gpus=[], system_ram_peak_used_mib=None,
                         scope='Comfy total minus available memory; reclaimable PyTorch cache counts as available')
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def persist(self):
        try: atomic(self.directory / 'telemetry.json', self.data)
        except OSError: pass

    def collect(self):
        try:
            snapshot = self.sampler()
            system, devices = snapshot['system'], snapshot['devices']
            with self.lock:
                if self.stop.is_set(): return
                self.data['sample_count'] += 1
                self.data['software'] = {k: system[k] for k in ('comfyui_version', 'pytorch_version', 'python_version') if k in system}
                for gpu in devices:
                    if gpu.get('type') == 'cpu': continue
                    entry = next((g for g in self.data['gpus'] if (g['type'], g['index']) == (gpu['type'], gpu['index'])), None)
                    if entry is None:
                        entry = {k: gpu[k] for k in ('name', 'type', 'index')}
                        entry.update(total_mib=used_mib(gpu.get('vram_total'), 0), peak_used_mib=None)
                        self.data['gpus'].append(entry)
                    used = used_mib(gpu.get('vram_total'), gpu.get('vram_free'))
                    if used is not None: entry['peak_used_mib'] = max(entry['peak_used_mib'] or 0, used)
                ram = used_mib(system.get('ram_total'), system.get('ram_free'))
                if ram is not None: self.data['system_ram_peak_used_mib'] = max(self.data['system_ram_peak_used_mib'] or 0, ram)
                self.persist()
        except Exception:
            with self.lock:
                if self.stop.is_set(): return
                self.data['failed_samples'] += 1
                self.persist()

    def run(self):
        while not self.stop.is_set():
            self.collect()
            if self.stop.wait(2): break

    def finish(self, messages):
        self.stop.set()
        # Do not wait on Comfy's HTTP loop from its execution completion hook.
        # An in-flight sample is discarded once stopped.
        with self.lock:
            self.data['complete'] = True
            timestamps = {}
            for event, data in messages:
                timestamp = data.get('timestamp')
                if isinstance(timestamp, (int, float)) and not isinstance(timestamp, bool) and math.isfinite(timestamp):
                    if event == 'execution_start': timestamps['execution_start_ms'] = timestamp
                    elif event in ('execution_success', 'execution_error', 'execution_interrupted'): timestamps['execution_end_ms'] = timestamp
            self.data.update(timestamps)
            start, end = timestamps.get('execution_start_ms'), timestamps.get('execution_end_ms')
            self.data['execution_seconds'] = (end - start) / 1000 if start is not None and end is not None and end >= start else None
            self.persist()
