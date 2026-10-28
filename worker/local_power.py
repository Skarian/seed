"""Engine-scoped idle-sleep request. Never requests display or away mode."""
import ctypes
from ctypes import wintypes as W
import os


class DetailedReason(ctypes.Structure):
    _fields_ = [('module', W.HMODULE), ('identifier', W.ULONG), ('count', W.ULONG), ('strings', ctypes.POINTER(W.LPWSTR))]


class Reason(ctypes.Union):
    _fields_ = [('detailed', DetailedReason), ('simple', W.LPWSTR)]


class ReasonContext(ctypes.Structure):
    _fields_ = [('version', W.ULONG), ('flags', W.DWORD), ('reason', Reason)]


class SystemRequired:
    def __init__(self, api=None):
        if api is None:
            if os.name != 'nt': raise OSError('Windows power requests require Windows')
            api = ctypes.WinDLL('kernel32', use_last_error=True)
            for name, result, args in (
                ('PowerCreateRequest', W.HANDLE, [ctypes.POINTER(ReasonContext)]),
                ('PowerSetRequest', W.BOOL, [W.HANDLE, ctypes.c_int]),
                ('PowerClearRequest', W.BOOL, [W.HANDLE, ctypes.c_int]),
                ('CloseHandle', W.BOOL, [W.HANDLE]),
            ):
                call = getattr(api, name); call.restype = result; call.argtypes = args
        self.api, self.handle = api, None
        context = ReasonContext(version=0, flags=1, reason=Reason(simple='Seed local image/video engine is active'))
        handle = api.PowerCreateRequest(ctypes.byref(context))
        if not handle or handle == ctypes.c_void_p(-1).value:
            raise OSError('Could not create the Seed system power request')
        # POWER_REQUEST_TYPE: Display=0, System=1, AwayMode=2, Execution=3.
        if not api.PowerSetRequest(handle, 1):
            api.CloseHandle(handle)
            raise OSError('Could not enable the Seed system power request')
        self.handle = handle

    def close(self):
        if self.handle is None: return
        handle, self.handle = self.handle, None
        try:
            if not self.api.PowerClearRequest(handle, 1):
                raise OSError('Could not clear the Seed system power request')
        finally:
            self.api.CloseHandle(handle)
