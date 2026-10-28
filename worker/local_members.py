"""Windows Job member identities and exit confirmation. No GPU imports or calls."""
import argparse
import ctypes
from ctypes import wintypes as W
import json
import os
import time
from pathlib import Path

SYNCHRONIZE = 0x100000
QUERY_LIMITED = 0x1000


def filetime_now():
    return str(time.time_ns() // 100 + 116444736000000000)


if os.name == 'nt':
    K = ctypes.WinDLL('kernel32', use_last_error=True)
    for name, result, args in [
        ('OpenProcess', W.HANDLE, [W.DWORD, W.BOOL, W.DWORD]),
        ('CloseHandle', W.BOOL, [W.HANDLE]),
        ('WaitForSingleObject', W.DWORD, [W.HANDLE, W.DWORD]),
        ('IsProcessInJob', W.BOOL, [W.HANDLE, W.HANDLE, ctypes.POINTER(W.BOOL)]),
        ('QueryInformationJobObject', W.BOOL, [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD, ctypes.c_void_p]),
        ('GetProcessTimes', W.BOOL, [W.HANDLE, ctypes.POINTER(W.FILETIME), ctypes.POINTER(W.FILETIME), ctypes.POINTER(W.FILETIME), ctypes.POINTER(W.FILETIME)]),
    ]:
        method = getattr(K, name)
        method.restype, method.argtypes = result, args


def checked(value):
    if not value:
        raise ctypes.WinError(ctypes.get_last_error())
    return value


class Windows:
    def boot_id(self):
        # Microsoft documents BootId as incrementing on each successful boot.
        # Unlike wall time minus uptime, this proof survives clock adjustments.
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                    r'SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management\PrefetchParameters') as key:
                value, kind = winreg.QueryValueEx(key, 'BootId')
                return value if kind == winreg.REG_DWORD and type(value) is int else None
        except OSError:
            return None

    def open(self, pid):
        handle = K.OpenProcess(SYNCHRONIZE | QUERY_LIMITED, False, pid)
        if not handle and ctypes.get_last_error() == 87:
            return None  # The original process object is gone.
        return checked(handle)

    def close(self, handle):
        checked(K.CloseHandle(handle))

    def signaled(self, handle, timeout=0):
        result = K.WaitForSingleObject(handle, timeout)
        if result == 0:
            return True
        if result == 258:
            return False
        raise ctypes.WinError(ctypes.get_last_error())

    def created(self, handle):
        values = [W.FILETIME() for _ in range(4)]
        checked(K.GetProcessTimes(handle, *(ctypes.byref(value) for value in values)))
        return str((values[0].dwHighDateTime << 32) | values[0].dwLowDateTime)

    def contains(self, job, handle):
        result = W.BOOL()
        checked(K.IsProcessInJob(handle, job, ctypes.byref(result)))
        return bool(result.value)

    def pids(self, job):
        capacity = 64
        while capacity <= 65536:
            class ProcessList(ctypes.Structure):
                _fields_ = [('assigned', W.DWORD), ('listed', W.DWORD),
                            ('pids', ctypes.c_size_t * capacity)]
            value = ProcessList()
            success = K.QueryInformationJobObject(job, 3, ctypes.byref(value), ctypes.sizeof(value), None)
            if not success and ctypes.get_last_error() != 234:
                raise ctypes.WinError(ctypes.get_last_error())
            if success and value.listed >= value.assigned:
                return list(value.pids[:value.listed])
            capacity = max(capacity * 2, value.assigned)
        raise OSError('Job member list exceeds its supported size')


class Members:
    """Retain process handles until every observed member has signaled exit."""
    def __init__(self, job, on_member=lambda member: None, api=None, on_unresolved=lambda pids: None):
        self.job, self.on_member, self.api = job, on_member, api or Windows()
        self.handles = {}  # (pid, creation FILETIME) -> handle
        self.latest = {}
        self.pending = {}
        self.unresolved_pids = set()
        self.first_seen = {}
        self.on_unresolved, self.persisted_unresolved = on_unresolved, set()

    def remember(self, pid, handle):
        """Takes ownership of handle, including on failure."""
        try:
            created = self.api.created(handle)
            key = (pid, created)
            if key in self.handles:
                self.api.close(handle)
                return key
            self.handles[key] = handle
            self.latest[pid] = key
            self.pending[key] = {'pid': pid, 'created': created}
            self.report()
            return key
        except BaseException:
            if handle not in self.handles.values():
                self.api.close(handle)
            raise

    def snapshot(self):
        return [{'pid': pid, 'created': created} for pid, created in self.handles]

    def report(self):
        for key, member in list(self.pending.items()):
            self.on_member(member)
            del self.pending[key]

    def observe(self):
        unresolved, alive, listed = False, [], []
        # A parent can spawn and exit after enumeration. Completion requires
        # both a dead pre-scan and a subsequent list containing only identities
        # already known dead in that pre-scan. A vanished/new PID forces retry.
        pre_signaled = {}
        for key, handle in list(self.handles.items()):
            try:
                pre_signaled[key] = self.api.signaled(handle)
            except OSError:
                pre_signaled[key] = False
                unresolved = True
        try:
            self.report()
            listed = self.api.pids(self.job)
        except OSError:
            unresolved = True
        # An access-denied PID must not disappear from our proof obligations
        # merely because a later Job list omits it during process teardown.
        clean = True
        in_listing = set(listed)
        observed_at = filetime_now()
        for pid in in_listing | self.unresolved_pids.copy():
            listed_now = pid in in_listing
            try:
                handle = self.api.open(pid)
                if handle is None:
                    self.unresolved_pids.discard(pid)
                    clean = clean and not listed_now
                    continue
                try:
                    if not self.api.contains(self.job, handle):
                        self.api.close(handle)  # A reused PID is outside this Job.
                        self.unresolved_pids.discard(pid)
                        clean = clean and not listed_now
                        continue
                    key = (pid, self.api.created(handle))
                except BaseException:
                    self.api.close(handle)
                    raise
                if pre_signaled.get(key):
                    self.api.close(handle)
                else:
                    self.remember(pid, handle)
                    clean = clean and not listed_now
                self.unresolved_pids.discard(pid)
            except OSError:
                self.unresolved_pids.add(pid)
                self.first_seen.setdefault(pid, observed_at)
                unresolved = True
                clean = False
        for key, handle in self.handles.items():
            try:
                if not self.api.signaled(handle):
                    alive.append({'pid': key[0], 'created': key[1]})
            except OSError:
                unresolved = True
        if self.persisted_unresolved != self.unresolved_pids:
            try:
                self.on_unresolved([{'pid': pid, 'created': None, 'first_seen': self.first_seen[pid]}
                                    for pid in sorted(self.unresolved_pids)])
                self.persisted_unresolved = self.unresolved_pids.copy()
            except OSError:
                unresolved = True
        return {'complete': all(pre_signaled.values()) and clean and not unresolved and not alive, 'unresolved': unresolved,
                'alive': alive, 'listed': listed}

    def wait_one(self, timeout=1000):
        for handle in self.handles.values():
            if not self.api.signaled(handle):
                return self.api.signaled(handle, timeout)
        return True

    def close(self):
        for handle in self.handles.values():
            self.api.close(handle)
        self.handles.clear()
        self.latest.clear()


def prior_members(members, api=None, prior_boot=None):
    api = api or Windows()
    results = []
    if not isinstance(members, list):
        raise ValueError('Invalid member list')
    boot = api.boot_id() if hasattr(api, 'boot_id') else None
    if prior_boot is not None and (type(prior_boot) is not int or not 0 <= prior_boot <= 0xFFFFFFFF):
        raise ValueError('Invalid boot identity')
    rebooted = prior_boot is not None and boot is not None and boot > prior_boot
    for member in members:
        pid, created = member.get('pid'), member.get('created')
        first_seen = member.get('first_seen')
        if type(pid) is not int or pid <= 0 or (created is not None and (not isinstance(created, str) or not created.isdecimal() or len(created) > 20)):
            raise ValueError('Invalid member identity')
        if first_seen is not None and (not isinstance(first_seen, str) or not first_seen.isdecimal() or len(first_seen) > 20):
            raise ValueError('Invalid observation time')
        handle, state = None, 'unknown'
        try:
            handle = api.open(pid)
            # first_seen is diagnostic wall time, not an identity proof: a
            # clock correction can put this same live process after it.
            if handle is None or api.signaled(handle) or created is not None and api.created(handle) != created:
                state = 'gone'
            elif created is not None:
                state = 'alive'
            elif rebooted:
                state = 'gone'
        except OSError:
            if rebooted:
                state = 'gone'
        finally:
            if handle is not None:
                api.close(handle)
        results.append({'pid': pid, 'created': created, 'state': state})
    return {'gone': all(value['state'] == 'gone' for value in results), 'members': results,
            'boot_id': boot, 'rebooted': rebooted}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--prior', type=Path, required=True)
    parser.add_argument('--boot-file', type=Path)
    options = parser.parse_args()
    prior_boot = None
    if options.boot_file and options.boot_file.exists():
        prior_boot = json.loads(options.boot_file.read_text())['boot_id']
    result = prior_members(json.loads(options.prior.read_text(encoding='utf-8-sig')), prior_boot=prior_boot)
    if options.boot_file and prior_boot is None and result['boot_id'] is not None:
        from worker.spool import atomic
        atomic(options.boot_file, {'boot_id': result['boot_id']})
    print(json.dumps(result))
