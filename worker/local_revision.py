"""CPU-only revision checks for the local shutdown protocol. Never imports CUDA."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import sys


FILES = {'__main__': 'main.py', 'execution': 'execution.py', 'server': 'server.py',
         'comfy.model_management': 'comfy/model_management.py'}


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def constants(path):
    result = {}
    for node in ast.parse(Path(path).read_text(encoding='utf-8-sig')).body:
        if isinstance(node, ast.Assign):
            try: value = ast.literal_eval(node.value)
            except (ValueError, TypeError): continue
            for target in node.targets:
                if isinstance(target, ast.Name): result[target.id] = value
    return result


def inspect_disk(source, site):
    source, site = Path(source), Path(site)
    torch = constants(site/'torch/version.py')
    aimdo = constants(site/'comfy_aimdo/_version.py')
    return {'schema': 1, 'files': {file: digest(source/file) for file in FILES.values()},
            'torch': {'version': torch['__version__'], 'git_version': torch['git_version']},
            'aimdo': {'version': aimdo['__version__'], 'commit_id': aimdo['__commit_id__'],
                      'dll_sha256': digest(site/'comfy_aimdo/aimdo.dll')}}


def check(pins, source, site, modules=None):
    reasons = []
    pins_digest = hashlib.sha256(json.dumps(pins, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    try:
        actual = inspect_disk(source, site)
        if pins != actual: reasons.append('disk_revision_mismatch')
        if modules is not None:
            for name, file in FILES.items():
                module = modules.get(name)
                if not module or Path(module.__file__).resolve() != (Path(source)/file).resolve():
                    reasons.append('loaded_source_mismatch')
            torch = modules.get('torch')
            if not torch or torch.__version__ != pins['torch']['version'] or torch.version.git_version != pins['torch']['git_version']:
                reasons.append('loaded_torch_mismatch')
            elif Path(torch.__file__).resolve() != (Path(site)/'torch/__init__.py').resolve():
                reasons.append('loaded_torch_path_mismatch')
            version = modules.get('comfy_aimdo._version')
            if not version or version.__version__ != pins['aimdo']['version'] or version.__commit_id__ != pins['aimdo']['commit_id']:
                reasons.append('loaded_aimdo_mismatch')
            elif Path(version.__file__).resolve() != (Path(site)/'comfy_aimdo/_version.py').resolve():
                reasons.append('loaded_aimdo_path_mismatch')
            control = modules.get('comfy_aimdo.control')
            library = getattr(control, 'lib', None)
            if library and Path(library._name).resolve() != (Path(site)/'comfy_aimdo/aimdo.dll').resolve():
                reasons.append('loaded_aimdo_dll_mismatch')
    except Exception:
        reasons.append('revision_check_failed')
    return {'supported': not reasons, 'reasons': sorted(set(reasons)), 'pins_digest': pins_digest}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--site', required=True)
    parser.add_argument('--pins', type=Path, required=True)
    args = parser.parse_args()
    result = check(json.loads(args.pins.read_text(encoding='utf-8-sig')), args.source, args.site)
    print(json.dumps(result))
    sys.exit(0 if result['supported'] else 2)
