"""Check tracked/candidate files without printing credential values.

Run before committing: python scripts/check_secrets.py
This checks known local credentials and common key formats, not every secret type.
"""
import base64
import json
import pathlib
import re
import subprocess
import sys
import urllib.parse

root = pathlib.Path(__file__).resolve().parents[1]
paths = subprocess.check_output(
    ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=root
).decode().split('\0')
patterns = {
    'private key': rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
    'GitHub token': rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b',
    'Hugging Face token': rb'\bhf_[A-Za-z0-9]{25,}\b',
    'Runpod API key': rb'\brpa_[A-Za-z0-9_-]{20,}\b',
    'AWS access key': rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
    'API secret': rb'\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{30,}\b',
}
known = []
# Ask the app's directory library rather than duplicating platform conventions.
config = pathlib.Path(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import envPaths from 'env-paths'; import path from 'node:path'; console.log(process.env.STUDIO_DEV_ROOT ? path.resolve(process.env.STUDIO_DEV_ROOT,'config') : envPaths('RunpodStudio',{suffix:''}).config)"
], cwd=root).decode().strip())
credential_files = [config/'credentials.json', config/'pod-deployment.json', config/'worker-connection.json']
credential_files.extend((config/'seed-vast').glob('worker-*.json'))
for credentials in credential_files:
    if not credentials.exists():
        continue
    for key, value in json.loads(credentials.read_text(encoding='utf-8')).items():
        if not re.search(r'key|token|secret|credential', key, re.I):
            continue
        if not isinstance(value, str) or len(value) < 16:
            continue
        known.extend([value.encode(), base64.b64encode(value.encode()), urllib.parse.quote(value).encode()])

issues = []
checked = 0
for name in sorted(set(paths) - {''}):
    path = root / name
    if not path.is_file():
        continue
    checked += 1
    data = path.read_bytes()
    for value in known:
        if value in data:
            issues.append((name, 'known local credential'))
            break
    for label, pattern in patterns.items():
        if re.search(pattern, data):
            issues.append((name, label))
for name, label in issues:
    print(f'{name}: {label}')
print(f'Checked {checked} files; {len(issues)} potential credential matches.')
sys.exit(bool(issues))
