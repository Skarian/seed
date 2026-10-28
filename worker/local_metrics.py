"""Sample Windows host commit and engine-tree working sets for qualification.

These are interval samples, not allocator high-water marks. GPU usage is for
the whole card, including desktop and other applications.
"""
import ctypes
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import threading
import time


class PerformanceInformation(ctypes.Structure):
    _fields_ = [('cb', W.DWORD)] + [(name, ctypes.c_size_t) for name in (
        'CommitTotal', 'CommitLimit', 'CommitPeak', 'PhysicalTotal', 'PhysicalAvailable',
        'SystemCache', 'KernelTotal', 'KernelPaged', 'KernelNonpaged', 'PageSize')
    ] + [(name, W.DWORD) for name in ('HandleCount', 'ProcessCount', 'ThreadCount')]


def host_memory():
    info = PerformanceInformation(); info.cb = ctypes.sizeof(info)
    api = ctypes.WinDLL('psapi', use_last_error=True).GetPerformanceInfo
    api.argtypes = [ctypes.POINTER(PerformanceInformation), W.DWORD]; api.restype = W.BOOL
    if not api(ctypes.byref(info), info.cb): raise ctypes.WinError(ctypes.get_last_error())
    return {name: getattr(info, field) * info.PageSize for name, field in (
        ('commit_bytes', 'CommitTotal'), ('commit_limit_bytes', 'CommitLimit'),
        ('physical_bytes', 'PhysicalTotal'), ('available_bytes', 'PhysicalAvailable'))}


class GpuSampler:
    def __init__(self):
        self.api = ctypes.WinDLL('nvml.dll')
        for name, args in (
            ('nvmlInit_v2', []), ('nvmlShutdown', []),
            ('nvmlDeviceGetCount_v2', [ctypes.POINTER(ctypes.c_uint)]),
            ('nvmlDeviceGetHandleByIndex_v2', [ctypes.c_uint, ctypes.POINTER(ctypes.c_void_p)]),
            ('nvmlDeviceGetMemoryInfo', [ctypes.c_void_p, ctypes.c_void_p]),
            ('nvmlDeviceGetUtilizationRates', [ctypes.c_void_p, ctypes.c_void_p]),
        ):
            call = getattr(self.api, name); call.argtypes = args; call.restype = ctypes.c_int
        self.check(self.api.nvmlInit_v2())

    @staticmethod
    def check(code):
        if code: raise RuntimeError('NVML returned code ' + str(code))

    def sample(self):
        class Memory(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ('total', 'free', 'used')]
        class Utilization(ctypes.Structure):
            _fields_ = [('gpu', ctypes.c_uint), ('memory', ctypes.c_uint)]
        count = ctypes.c_uint(); self.check(self.api.nvmlDeviceGetCount_v2(ctypes.byref(count)))
        rows = []
        for index in range(count.value):
            handle = ctypes.c_void_p(); self.check(self.api.nvmlDeviceGetHandleByIndex_v2(index, ctypes.byref(handle)))
            memory, utilization = Memory(), Utilization()
            self.check(self.api.nvmlDeviceGetMemoryInfo(handle, ctypes.byref(memory)))
            self.check(self.api.nvmlDeviceGetUtilizationRates(handle, ctypes.byref(utilization)))
            rows.append({'index': index, 'total_mib': memory.total / 1024**2,
                         'used_mib': memory.used / 1024**2, 'utilization_percent': utilization.gpu})
        return rows

    def close(self): self.api.nvmlShutdown()


class Sampler:
    def __init__(self, pid, destination):
        self.pid, self.destination = pid, Path(destination)
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self):
        try: import psutil
        except ImportError: psutil = None
        try: gpu = GpuSampler()
        except (OSError, RuntimeError): gpu = None
        self.destination.parent.mkdir(parents=True, exist_ok=True)
        with self.destination.open('a', encoding='utf8') as out:
            last_sync = 0
            while not self.stop.is_set():
                row = {'at': time.time(), 'interval_seconds': 2}
                try:
                    row.update(host_memory())
                    root = psutil.Process(self.pid) if psutil else None
                    processes = [root, *root.children(recursive=True)] if root else []
                    rss = private = faults = 0
                    for process in processes:
                        try:
                            memory = process.memory_info()
                            rss += memory.rss; private += getattr(memory, 'private', 0)
                            faults += getattr(memory, 'num_page_faults', 0)
                        except psutil.NoSuchProcess: pass
                    if root: row.update(tree_working_set_bytes=rss, tree_private_bytes=private, tree_page_faults=faults)
                except Exception as error: row['error'] = str(error)
                if not psutil: row['process_metrics_unavailable'] = 'psutil not installed'
                try:
                    if gpu: row['gpus'] = gpu.sample()
                    else: row['gpu_metrics_unavailable'] = True
                except Exception as error: row['gpu_error'] = str(error)
                out.write(json.dumps(row) + '\n'); out.flush()
                if time.monotonic() - last_sync >= 10:
                    os.fsync(out.fileno()); last_sync = time.monotonic()
                self.stop.wait(2)
            out.flush(); os.fsync(out.fileno())
        if gpu: gpu.close()

    def close(self):
        self.stop.set(); self.thread.join(timeout=5)
