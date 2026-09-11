"""Optional direct SSH followed by the normal worker supervisor."""
import os
from pathlib import Path
import subprocess
import sys


def start_ssh(public_key, root=Path('/'), run=subprocess.run):
    keys = [line.strip() for line in public_key.splitlines() if line.strip()]
    if not keys or any(not line.startswith(('ssh-ed25519 ', 'ssh-rsa ', 'ecdsa-sha2-')) for line in keys):
        raise ValueError('A valid public SSH key is required.')
    folder = root / 'root/.ssh'
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    folder.chmod(0o700)
    target = folder / 'authorized_keys'
    target.write_text('\n'.join(keys) + '\n')
    target.chmod(0o600)
    (root / 'run/sshd').mkdir(parents=True, exist_ok=True)
    run(['ssh-keygen', '-A'], check=True)
    run(['/usr/sbin/sshd', '-o', 'PasswordAuthentication=no', '-o', 'PermitRootLogin=prohibit-password'], check=True)


if __name__ == '__main__':
    if os.environ.get('SEED_START_SSH') == '1':
        start_ssh(os.environ.get('PUBLIC_KEY', ''))
    os.execv(sys.executable, [sys.executable, '-m', 'worker.run'])
