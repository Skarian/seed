"""Pin the upstream startup code instead of following its moving master branch."""
import json, pathlib, subprocess

base = pathlib.Path(__file__).resolve().parent
pins = json.loads((base / 'pins.json').read_text())
for folder, config in pins['startup'].items():
    path = pathlib.Path(folder)
    if not (path / '.git').is_dir():
        subprocess.run(['git', 'clone', config['url'], str(path)], check=True)
    present = subprocess.run(['git', '-C', str(path), 'cat-file', '-e', config['commit'] + '^{commit}'], capture_output=True)
    if present.returncode:
        subprocess.run(['git', '-C', str(path), 'fetch', '--depth=1', 'origin', config['commit']], check=True)
    subprocess.run(['git', '-C', str(path), 'checkout', '--detach', config['commit']], check=True)

# Upstream accepts URL|commit entries. Pin its container-local node list too.
# User additions on /workspace are discovered normally and are not reset here.
def pinned(entry):
    url = entry.split('|', 1)[0]
    name = url.rsplit('/', 1)[-1].removesuffix('.git')
    commit = pins['bundled_nodes'].get(name)
    if not commit:
        raise RuntimeError('Missing bundled-node pin: ' + name)
    return url + '|' + commit

runtime = pathlib.Path('/comfyui-runtime/src/runtime_nodes.json')
runtime.write_text(json.dumps([pinned(x) for x in json.loads(runtime.read_text())], indent=2))
template = pathlib.Path('/comfyui-minimax/template.json')
data = json.loads(template.read_text())
data['custom_nodes']['repos'] = [pinned(x) for x in data['custom_nodes']['repos']]
template.write_text(json.dumps(data, indent=2))
print('Using saved startup and bundled-node versions.', flush=True)
