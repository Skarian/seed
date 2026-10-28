import ctypes
import types
import pytest
from worker.local_power import SystemRequired, ReasonContext


def api_fixture(set_ok=True):
    calls = []
    def create(pointer):
        context = ctypes.cast(pointer, ctypes.POINTER(ReasonContext)).contents
        assert context.version == 0 and context.flags == 1
        assert 'Seed' in context.reason.simple
        calls.append('create'); return 42
    return calls, types.SimpleNamespace(PowerCreateRequest=create,
        PowerSetRequest=lambda handle, kind: calls.append(('set', handle, kind)) or set_ok,
        PowerClearRequest=lambda handle, kind: calls.append(('clear', handle, kind)) or True,
        CloseHandle=lambda handle: calls.append(('close', handle)) or True)


def test_system_request_is_balanced_and_never_keeps_the_display_on():
    calls, api = api_fixture()
    request = SystemRequired(api)
    request.close(); request.close()
    assert calls == ['create', ('set', 42, 1), ('clear', 42, 1), ('close', 42)]


def test_failed_request_releases_handle():
    calls, api = api_fixture(False)
    with pytest.raises(OSError): SystemRequired(api)
    assert calls == ['create', ('set', 42, 1), ('close', 42)]
