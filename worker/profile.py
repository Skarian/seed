"""Release identity, engine spec and hardware profiles; no inference imports at startup."""
import json
import os
import re
from pathlib import Path

PROTOCOL_VERSION = 2
RUNTIME_REVISION = 'seed-pool-v1'


def read_json(name):
    return json.loads(Path(__file__).with_name(name).read_text())


def engine_spec():
    return read_json('engine.json')


def hardware_profile(gpu):
    """The profile for a detected GPU name, or None when the GPU has no video profile."""
    return next((item for item in read_json('hardware.json') if re.search(item['gpu'], gpu, re.I)), None)


def worker_class():
    role = os.environ.get('SEED_WORKER_CLASS') or None
    if role not in (None, 'image', 'video', 'all'):
        raise ValueError('SEED_WORKER_CLASS must be image, video or all')
    return role


def identity():
    return {'protocol_version': PROTOCOL_VERSION, 'runtime_revision': RUNTIME_REVISION,
            'worker_class': worker_class(), 'image_revision': os.environ.get('SEED_IMAGE_REVISION', 'development')}


def hardware_capabilities(role=None, cuda=None):
    """Verify the device actually assigned by the provider, after engine startup."""
    role = role or worker_class()
    devices = []
    result = {'ready': False, 'devices': devices, 'profile': None, 'error': None}
    if role not in ('image', 'video', 'all'):
        return {**result, 'error': 'The worker role is not configured.'}
    try:
        if cuda is None:
            import torch
            cuda = torch.cuda
        if not cuda.is_available():
            return {**result, 'error': 'No usable CUDA GPU was assigned to this worker.'}
        count = cuda.device_count()
        for index in range(count):
            device = cuda.get_device_properties(index)
            devices.append({'name': device.name, 'vram_bytes': int(device.total_memory)})
        if count != 1:
            return {**result, 'error': 'This worker requires exactly one visible GPU.'}
        profile = hardware_profile(devices[0]['name'])
        if role == 'video' and profile is None:
            return {**result, 'error': 'Video workers require an RTX 5090 or RTX PRO 6000.'}
        nominal_gib = profile['vram_gb'] if role == 'video' else 32
        # Drivers reserve some physical memory; check capacity rather than free VRAM.
        if devices[0]['vram_bytes'] < nominal_gib * 1024**3 * 0.95:
            return {**result, 'error': f'This worker requires a GPU with at least {nominal_gib} GB of VRAM.'}
        return {**result, 'ready': True, 'profile': profile and profile['id']}
    except (ImportError, AttributeError, RuntimeError, AssertionError):
        return {**result, 'error': 'The worker could not verify its CUDA GPU. Quit it and check the worker image and provider hardware.'}


def role_manifests(role):
    if role == 'image':
        return [read_json('models-image.json')]
    if role != 'video':
        raise ValueError('A worker class is required')
    names = dict.fromkeys(item['manifest'] for item in read_json('hardware.json'))
    return [read_json(name) for name in names]


def role_models(role=None):
    return role_manifests(role or worker_class())[0]


def validate_role_manifest(entries):
    role = worker_class()
    if role is None:  # Unit fixtures may exercise the common protocol without production assets.
        return
    actual = {item['path']: item for item in entries if not item.get('routes')}
    if not any(actual == {item['path']: item for item in manifest} for manifest in role_manifests(role)):
        raise ValueError('Manifest must contain exactly the pinned base assets for this worker class')
    allowed = {'image'} if role == 'image' else {'fl', 'ref'}
    if any(not set(item.get('routes', [])).issubset(allowed) for item in entries):
        raise ValueError('Adapter mapping does not match this worker class')


def installed_loras(workspace):
    file = Path(workspace) / '.seed/adapters/installed.json'
    if not file.exists():
        return []
    value = json.loads(file.read_text())
    if not isinstance(value, list):
        raise ValueError('Invalid adapter inventory')
    return value
