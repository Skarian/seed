"""Install engine.json and its Linux lockfile into the worker image at build time."""
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys

COMFY = '/ComfyUI'


def main():
    here = Path(__file__).parent
    spec = json.loads((here/'engine.json').read_text())
    revision = spec['comfyui']['revision']
    subprocess.run(['git', '-C', COMFY, 'fetch', '--depth', '1', 'origin', revision], check=True)
    subprocess.run(['git', '-C', COMFY, 'checkout', '--detach', revision], check=True)
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-cache-dir', '--require-hashes', '--no-deps',
                    '--extra-index-url', spec['torch_index'], '-r', str(here/'requirements-linux.lock')], check=True)
    installed = subprocess.run(['git', '-C', COMFY, 'rev-parse', 'HEAD'], check=True, capture_output=True, text=True).stdout.strip()
    if installed != revision:
        raise SystemExit('ComfyUI revision does not match engine.json')
    for name, version in spec['packages'].items():
        if importlib.metadata.version(name) != version:
            raise SystemExit(name + ' does not match engine.json')


if __name__ == '__main__':
    main()
