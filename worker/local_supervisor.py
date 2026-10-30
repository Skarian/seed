"""Windows containment: the gateway and engine die with the coordinator.

The supervisor holds the only handle to a named kill-on-close Job Object and
reads the coordinator's pipe. When that pipe closes it exits, the handle closes
and Windows ends every member. Normal stops never come through here: the engine
exits by itself and this process follows once the Job is empty. The Job name
exists only while a supervisor lives, so it also keeps one GPU to one engine.
"""
import argparse
import ctypes
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time


if os.name == 'nt':
    import _winapi
    import msvcrt
    K = ctypes.WinDLL('kernel32', use_last_error=True)
    SIZE_T = ctypes.c_size_t

    class BasicLimits(ctypes.Structure):
        _fields_ = [('PerProcessUserTimeLimit', ctypes.c_longlong), ('PerJobUserTimeLimit', ctypes.c_longlong),
                    ('LimitFlags', W.DWORD), ('MinimumWorkingSetSize', SIZE_T), ('MaximumWorkingSetSize', SIZE_T),
                    ('ActiveProcessLimit', W.DWORD), ('Affinity', SIZE_T), ('PriorityClass', W.DWORD), ('SchedulingClass', W.DWORD)]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in ('ReadOperationCount','WriteOperationCount','OtherOperationCount','ReadTransferCount','WriteTransferCount','OtherTransferCount')]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [('BasicLimitInformation', BasicLimits), ('IoInfo', IoCounters),
                    ('ProcessMemoryLimit', SIZE_T), ('JobMemoryLimit', SIZE_T), ('PeakProcessMemoryUsed', SIZE_T), ('PeakJobMemoryUsed', SIZE_T)]

    class Accounting(ctypes.Structure):
        _fields_ = [('TotalUserTime', ctypes.c_longlong), ('TotalKernelTime', ctypes.c_longlong),
                    ('ThisPeriodTotalUserTime', ctypes.c_longlong), ('ThisPeriodTotalKernelTime', ctypes.c_longlong),
                    ('TotalPageFaultCount', W.DWORD), ('TotalProcesses', W.DWORD), ('ActiveProcesses', W.DWORD), ('TotalTerminatedProcesses', W.DWORD)]

    for name, restype, argtypes in [
        ('CreateJobObjectW', W.HANDLE, [ctypes.c_void_p, W.LPCWSTR]),
        ('SetInformationJobObject', W.BOOL, [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD]),
        ('QueryInformationJobObject', W.BOOL, [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD, ctypes.POINTER(W.DWORD)]),
        ('AssignProcessToJobObject', W.BOOL, [W.HANDLE, W.HANDLE]),
        ('ResumeThread', W.DWORD, [W.HANDLE]),
    ]:
        method = getattr(K, name); method.restype = restype; method.argtypes = argtypes


def checked(value):
    if not value: raise ctypes.WinError(ctypes.get_last_error())
    return value


def create_job(device_id):
    handle = checked(K.CreateJobObjectW(None, 'Local\\SeedGPU_' + device_id))
    if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        raise RuntimeError('This GPU already belongs to another Seed engine.')
    limits = ExtendedLimits(); limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE; no breakaway.
    checked(K.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
    return handle


def active_processes(job):
    info = Accounting()
    checked(K.QueryInformationJobObject(job, 1, ctypes.byref(info), ctypes.sizeof(info), None))
    return info.ActiveProcesses


def start(job, command, cwd, log, venv_python):
    environment = dict(os.environ)
    # Run the base executable directly with the venv identity. Windows' venv
    # redirector otherwise adds a launcher and console child.
    environment['__PYVENV_LAUNCHER__'] = str(venv_python)
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open('ab', buffering=0) as output, open(os.devnull, 'rb') as null:
        out_handle = msvcrt.get_osfhandle(output.fileno()); in_handle = msvcrt.get_osfhandle(null.fileno())
        os.set_handle_inheritable(out_handle, True); os.set_handle_inheritable(in_handle, True)
        startup = subprocess.STARTUPINFO()
        startup.dwFlags = subprocess.STARTF_USESTDHANDLES
        startup.hStdInput = in_handle; startup.hStdOutput = out_handle; startup.hStdError = out_handle
        startup.lpAttributeList = {'handle_list': [out_handle, in_handle]}
        process, thread, pid, _ = _winapi.CreateProcess(command[0], subprocess.list2cmdline(command), None, None, True,
            0x00000004 | 0x00000008 | 0x00000400, environment, str(cwd), startup)  # suspended, no console, Unicode env
        try:
            checked(K.AssignProcessToJobObject(job, process))
            if K.ResumeThread(thread) == 0xFFFFFFFF: raise ctypes.WinError(ctypes.get_last_error())
        finally:
            _winapi.CloseHandle(thread)
    return process, pid


class KeepAwake:
    """Holds the Windows idle-sleep request while Seed reports a job."""
    def __init__(self):
        self.request = None

    def set(self, wanted):
        from worker.local_power import SystemRequired
        if wanted and self.request is None:
            self.request = SystemRequired()
        elif not wanted and self.request is not None:
            self.request.close()
            self.request = None


def read_coordinator(awake):
    for line in sys.stdin:
        command = line.strip()
        if command in ('keep_awake on', 'keep_awake off'):
            try: awake.set(command.endswith('on'))
            except OSError: pass  # Sleep prevention must never stop a job.
    os._exit(0)  # The Job handle closes with this process and ends every member.


def emit(event, **fields):
    print(json.dumps({'event': event, **fields}), flush=True)


def main():
    if os.name != 'nt': raise RuntimeError('Native local supervision currently requires Windows.')
    parser = argparse.ArgumentParser()
    parser.add_argument('--cwd', type=Path, required=True)
    parser.add_argument('--log', type=Path, required=True)
    parser.add_argument('--venv-python', type=Path, required=True)
    parser.add_argument('--device-id', required=True)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command: raise ValueError('A command is required.')
    if not re.fullmatch(r'[a-zA-Z0-9-]{1,100}', args.device_id): raise ValueError('Invalid device identity.')
    job = create_job(args.device_id)
    threading.Thread(target=read_coordinator, args=(KeepAwake(),), daemon=True).start()
    gateway, pid = start(job, command, args.cwd.resolve(), args.log.resolve(), args.venv_python)
    emit('started', pid=pid)
    gateway_exited = False
    while active_processes(job):
        if not gateway_exited and _winapi.WaitForSingleObject(gateway, 0) == 0:
            gateway_exited = True
            emit('gateway_exit')
        time.sleep(0.25)


if __name__ == '__main__': main()
