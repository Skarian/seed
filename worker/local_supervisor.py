"""Windows process containment anchored to both the coordinator and supervisor.

The coordinator owns the outer kill-on-close Job handle; this supervisor owns
an inner Job handle. Either process dying terminates the engine descendants.
Only trusted local code supplies the command. No HTTP command execution exists.
"""
import argparse
import ctypes
from ctypes import wintypes as W
import json
import os
import queue
import re
from pathlib import Path
import subprocess
import sys
import threading
import time
from worker.local_members import Members, prior_members
from worker.spool import atomic


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

    for name, restype, argtypes in [
        ('CreateJobObjectW', W.HANDLE, [ctypes.c_void_p, W.LPCWSTR]),
        ('SetInformationJobObject', W.BOOL, [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD]),
        ('AssignProcessToJobObject', W.BOOL, [W.HANDLE, W.HANDLE]),
        ('OpenProcess', W.HANDLE, [W.DWORD, W.BOOL, W.DWORD]),
        ('GetCurrentProcess', W.HANDLE, []),
        ('DuplicateHandle', W.BOOL, [W.HANDLE,W.HANDLE,W.HANDLE,ctypes.POINTER(W.HANDLE),W.DWORD,W.BOOL,W.DWORD]),
        ('CloseHandle', W.BOOL, [W.HANDLE]),
        ('ResumeThread', W.DWORD, [W.HANDLE]),
        ('TerminateJobObject', W.BOOL, [W.HANDLE, W.UINT]),
    ]:
        method = getattr(K, name); method.restype = restype; method.argtypes = argtypes


def checked(value):
    if not value: raise ctypes.WinError(ctypes.get_last_error())
    return value


def job(name=None):
    handle = checked(K.CreateJobObjectW(None, name))
    if name and ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        K.CloseHandle(handle)
        raise RuntimeError('This GPU already belongs to another Seed engine.')
    try:
        limits = ExtendedLimits(); limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE; no breakaway.
        checked(K.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
        return handle
    except BaseException:
        K.CloseHandle(handle); raise


class Containment:
    def __init__(self, parent_pid, device_id=None, on_member=lambda member: None, on_unresolved=lambda pids: None):
        # The name lasts only while a handle remains open. Keep this handle
        # until every member has signaled exit; the file lease spans sessions.
        self.inner = job('Local\\SeedGPU_' + device_id if device_id else None)
        self.members = Members(self.inner, on_member, on_unresolved=on_unresolved)
        self.parent = checked(K.OpenProcess(0x40 | 0x100000 | 0x1000, False, parent_pid))  # DUP_HANDLE | SYNCHRONIZE | QUERY_LIMITED
        self.owner_created = self.members.api.created(self.parent)
        self.supervisor_created = self.members.api.created(K.GetCurrentProcess())
        self.remote = W.HANDLE()
        outer = job()
        try:
            checked(K.AssignProcessToJobObject(outer, K.GetCurrentProcess()))
            checked(K.DuplicateHandle(K.GetCurrentProcess(), outer, self.parent, ctypes.byref(self.remote), 0, False, 2))
        finally:
            # Once duplicated, the coordinator holds the sole outer handle.
            K.CloseHandle(outer)
        self.process = None
        self.pid = None

    def start(self, command, cwd, log, venv_python=None):
        from worker.processes import child_environment
        child_env = child_environment()
        if venv_python:
            # Run the base executable directly with the venv identity. Windows'
            # venv redirector otherwise adds a launcher and console child, so a
            # recovery-only gateway would not be the sole Job member.
            child_env['__PYVENV_LAUNCHER__'] = str(venv_python)
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open('ab', buffering=0) as output, open(os.devnull, 'rb') as null:
            out_handle = msvcrt.get_osfhandle(output.fileno()); in_handle = msvcrt.get_osfhandle(null.fileno())
            os.set_handle_inheritable(out_handle, True); os.set_handle_inheritable(in_handle, True)
            startup = subprocess.STARTUPINFO()
            startup.dwFlags = subprocess.STARTF_USESTDHANDLES
            startup.hStdInput = in_handle; startup.hStdOutput = out_handle; startup.hStdError = out_handle
            startup.lpAttributeList = {'handle_list': [out_handle, in_handle]}
            process, thread, pid, _ = _winapi.CreateProcess(command[0], subprocess.list2cmdline(command), None, None, True,
                0x00000004 | 0x00000008 | 0x00000400, child_env, str(cwd), startup)  # suspended, no console, Unicode env
            self.process = process
            self.pid = pid
            try:
                checked(K.AssignProcessToJobObject(self.inner, process))
                member_handle = self.members.api.open(pid)
                if member_handle is None: raise RuntimeError('Suspended gateway disappeared')
                self.members.remember(pid, member_handle)
                if K.ResumeThread(thread) == 0xFFFFFFFF: raise ctypes.WinError(ctypes.get_last_error())
            except BaseException:
                _winapi.TerminateProcess(process, 1)
                _winapi.WaitForSingleObject(process, 5000)
                raise
            finally:
                _winapi.CloseHandle(thread)
        return pid

    def exit_code(self):
        if self.process is None: return None
        if _winapi.WaitForSingleObject(self.process, 0) == 0: return _winapi.GetExitCodeProcess(self.process)
        return None

    def terminate_round(self, exit_code):
        before = self.members.observe()
        requested = bool(K.TerminateJobObject(self.inner, exit_code))
        wait_failed = False
        try:
            self.members.wait_one(100)
        except OSError:
            wait_failed = True
        after = self.members.observe()
        after['complete'] = after['complete'] and not before['unresolved'] and not wait_failed
        return {**after, 'termination_requested': requested}

    def release_members(self):
        self.members.close()
        if self.process:
            _winapi.CloseHandle(self.process)
            self.process = None
        if self.inner:
            K.CloseHandle(self.inner)
            self.inner = None

    def release_owner(self):
        # Move the outer handle back out of the coordinator. Closing the final
        # local handle ends this supervisor too, so all reporting precedes this.
        local = W.HANDLE()
        if K.DuplicateHandle(self.parent, self.remote, K.GetCurrentProcess(), ctypes.byref(local), 0, False, 3):
            K.CloseHandle(self.parent)
            K.CloseHandle(local)


def parse_command(line):
    if line.strip() == 'launch':
        return {'op': 'launch'}
    if line.strip() == 'stop':
        return {'op': 'terminate', 'stop_id': None, 'mode': 'forced', 'reason': 'legacy_stop'}
    value = json.loads(line)
    if not isinstance(value, dict) or value.get('op') != 'terminate' or value.get('mode') not in ('quiesced', 'forced', 'no_engine'):
        raise ValueError('Invalid supervisor command')
    stop_id, reason = value.get('stop_id'), value.get('reason')
    if not isinstance(stop_id, str) or not re.fullmatch(r'[a-zA-Z0-9-]{1,100}', stop_id):
        raise ValueError('Invalid stop identity')
    if not isinstance(reason, str) or not re.fullmatch(r'[a-z_]{1,80}', reason):
        raise ValueError('Invalid stop reason')
    return {'op': 'terminate', 'stop_id': stop_id, 'mode': value['mode'], 'reason': reason}


def main():
    if os.name != 'nt': raise RuntimeError('Native local supervision currently requires Windows.')
    parser = argparse.ArgumentParser()
    parser.add_argument('--parent-pid', type=int, required=True)
    parser.add_argument('--cwd', type=Path, required=True)
    parser.add_argument('--log', type=Path, required=True)
    parser.add_argument('--metrics', type=Path)
    parser.add_argument('--diagnostics', type=Path)
    parser.add_argument('--prior', type=Path)
    parser.add_argument('--gateway-only', action='store_true')
    parser.add_argument('--venv-python', type=Path)
    parser.add_argument('--await-owner', action='store_true')
    parser.add_argument('--system-required', action='store_true')
    parser.add_argument('--device-id')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or args.parent_pid != os.getppid(): raise ValueError('The direct coordinator parent and command are required.')
    if args.device_id and not re.fullmatch(r'[a-zA-Z0-9-]{1,100}', args.device_id): raise ValueError('Invalid device identity.')
    from worker.local_diagnostics import Journal, EventWatcher
    directory = args.diagnostics or args.log.parent / (args.log.stem + '-supervisor')
    journal = Journal(directory/'lifecycle.jsonl')

    def emit(event, **fields):
        if not journal.write(event, **fields):
            return False
        print(json.dumps({'event': event, **fields}), flush=True)
        return True

    if args.prior:
        prior = prior_members(json.loads(args.prior.read_text(encoding='utf-8-sig')))
        if not prior['gone']:
            emit('prior_members_alive', members=prior['members'])
            return
    if not emit('supervisor_start', supervisor_pid=os.getpid(), owner_pid=args.parent_pid, device_id=args.device_id):
        raise OSError('Cannot persist supervisor startup')
    commands = queue.Queue()
    def input_loop():
        for line in sys.stdin:
            try:
                if len(line) > 2048: raise ValueError()
                commands.put(parse_command(line))
            except (ValueError, TypeError):
                commands.put({'op': 'invalid'})
        commands.put({'op': 'terminate', 'stop_id': None, 'mode': 'forced', 'reason': 'coordinator_pipe_closed'})
    threading.Thread(target=input_loop, daemon=True).start()
    def member_added(member):
        atomic(directory/'members.json', containment.members.snapshot())
        if not emit('member', **member):
            raise OSError('Cannot persist member identity')
    containment = Containment(args.parent_pid, args.device_id, member_added,
        lambda pids: atomic(directory/'unresolved-members.json', pids))
    atomic(directory/'boot.json', {'boot_id': containment.members.api.boot_id()})
    if args.await_owner:
        # No child can run before the coordinator commits this incarnation and
        # explicitly acknowledges it. Recovery can locate members.json even if
        # the owner dies before the first gateway/engine member is announced.
        atomic(directory/'members.json', [])
        while not emit('contained', supervisor_pid=os.getpid(), owner_created=containment.owner_created,
                       supervisor_created=containment.supervisor_created, containment='windows-nested-jobs-v2'):
            time.sleep(0.25)
        while True:
            incoming = commands.get()
            if incoming['op'] == 'launch':
                atomic(directory/'launch-authorized.json', {'at': time.time()})
                break
            if incoming['op'] != 'terminate':
                emit('rejected', reason='invalid_command'); continue
            receipt = {'stop_id': incoming['stop_id'], 'mode': 'no_engine', 'reason': incoming['reason'],
                       'terminated': True, 'members': [], 'at': time.time()}
            atomic(directory/'termination.json', receipt)
            if not emit('terminated', **receipt): continue
            containment.release_members(); containment.release_owner(); return
    sampler = power = events = None
    try:
        pid = containment.start(command, args.cwd.resolve(), args.log.resolve(), args.venv_python)
    except BaseException as error:
        emit('launch_failed', error_type=type(error).__name__)
        raise
    if args.system_required:
        try:
            from worker.local_power import SystemRequired
            power = SystemRequired()
            emit('system_required_acquired')
        except Exception:
            emit('system_required_unavailable')
    if args.diagnostics:
        try:
            events = EventWatcher(directory/'windows-events.jsonl')
        except Exception:
            emit('event_watcher_unavailable')
    if args.metrics:
        try:
            from worker.local_metrics import Sampler
            sampler = Sampler(pid, args.metrics)
        except Exception:
            emit('metrics_unavailable')
    emit('started', pid=pid, supervisor_pid=os.getpid(), owner_created=containment.owner_created,
         supervisor_created=containment.supervisor_created, containment='windows-nested-jobs-v2')
    terminating = None
    terminated = False
    gateway_exited = False
    next_warning = 0
    try:
        while not terminated:
            observation = containment.members.observe()
            code = containment.exit_code()
            if code is not None and not gateway_exited:
                gateway_exited = True
                emit('gateway_exit', code=code)
            if gateway_exited and observation['complete'] and terminating is None:
                terminating = {'op': 'terminate', 'stop_id': None, 'mode': 'forced', 'reason': 'engine_exited'}
            try:
                incoming = commands.get(timeout=0.1 if terminating else 0.25)
                if incoming['op'] != 'terminate':
                    emit('rejected', reason='invalid_command')
                elif incoming['mode'] == 'no_engine' and (not args.gateway_only or observation['unresolved'] or
                        any(member['pid'] != pid for member in observation['alive'])):
                    # The CPU-only gateway imports platform helpers (cmd /c
                    # ver on Windows). Exited helpers remain in the identity
                    # journal; their history must not prevent a no-engine stop.
                    emit('rejected', reason='engine_member_present', stop_id=incoming['stop_id'])
                elif terminating is None or (incoming['mode'] == 'forced' and incoming['reason'] != 'coordinator_pipe_closed'):
                    terminating = incoming
            except queue.Empty:
                pass
            if terminating is None:
                continue
            if 'began' not in terminating:
                if not emit('terminating', stop_id=terminating['stop_id'], mode=terminating['mode'], reason=terminating['reason']):
                    continue  # No irreversible action without a durable intent.
                terminating['began'] = time.monotonic()
                next_warning = terminating['began'] + 30
            outcome = containment.terminate_round({'quiesced': 90, 'forced': 91, 'no_engine': 92}[terminating['mode']])
            if outcome['complete']:
                receipt = {'stop_id': terminating['stop_id'], 'mode': terminating['mode'], 'reason': terminating['reason'],
                           'terminated': True, 'members': containment.members.snapshot(), 'at': time.time()}
                try:
                    atomic(directory/'termination.json', receipt)
                    if emit('terminated', **receipt):
                        terminated = True
                except OSError:
                    pass
            if not terminated and time.monotonic() >= next_warning:
                emit('termination_unconfirmed', stop_id=terminating['stop_id'], unresolved=outcome['unresolved'])
                next_warning = time.monotonic() + 10
        # No live member and a durable termination receipt precede releasing the
        # named Job and power request. An external handle does not block this.
        containment.release_members()
    finally:
        if sampler: sampler.close()
        if events: events.close()
        if power:
            try:
                power.close()
                emit('system_required_released')
            except OSError:
                emit('system_required_release_error')
        if not terminated:
            emit('supervisor_failure', result='forced_unconfirmed')
    containment.release_owner()


if __name__ == '__main__': main()


