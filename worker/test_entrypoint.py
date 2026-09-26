import pytest
from worker.entrypoint import start_ssh


def test_direct_ssh_sets_key_and_disables_password_auth(tmp_path):
    calls = []
    start_ssh('ssh-ed25519 Zml4dHVyZS1wdWJsaWMta2V5 test', tmp_path,
              lambda args, **kwargs: calls.append((args, kwargs)))
    assert (tmp_path / 'run/seed-ssh/authorized_keys').read_text() == 'ssh-ed25519 Zml4dHVyZS1wdWJsaWMta2V5 test\n'
    assert calls[0] == (['chown', '0:0', str(tmp_path / 'run/seed-ssh'),
                         str(tmp_path / 'run/seed-ssh/authorized_keys')], {'check': True})
    assert calls[1][0] == ['ssh-keygen', '-A']
    assert 'PasswordAuthentication=no' in calls[2][0]
    assert 'AuthorizedKeysFile='+str(tmp_path / 'run/seed-ssh/authorized_keys') in calls[2][0]
    assert '/proc/1/fd/2' in calls[2][0]
    assert calls[2][1]['check'] is True


def test_direct_ssh_rejects_missing_key_before_running_commands(tmp_path):
    with pytest.raises(ValueError):
        start_ssh('', tmp_path, lambda *args, **kwargs: pytest.fail('must not execute'))
