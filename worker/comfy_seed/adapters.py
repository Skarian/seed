"""Validate job inputs that come from outside the graph builder."""
import json
import math
from pathlib import Path
from worker.profile import installed_loras, worker_class
from worker.resolution import resolution_preset, validate_canvas


def validate_adapters(workspace, graph, selections, route):
    if route not in ('image', 'image-edit', 'fl', 'ref'):
        raise ValueError('Unknown workflow route')
    role = worker_class()
    if role in ('image', 'video') and (role == 'image') != (route in ('image', 'image-edit')):
        raise ValueError('Workflow does not belong to this worker class')
    if not isinstance(selections, list) or len(selections) > 3:
        raise ValueError('Select up to three installed adapters')
    chain = {node['inputs'].get('lora_name'): node['inputs'].get('strength_model') for node in graph.values()
             if node.get('class_type', '').startswith('LoraLoader')}
    if route == 'image-edit':
        if selections or chain:
            raise ValueError('Qwen editing does not support adapters in this release')
        validate_edit_inputs(graph)
        return
    canvas = graph.get('6', {})
    kind = {'image': 'EmptyLatentImage', 'fl': 'MiniMaxH3ImageToVideo', 'ref': 'MiniMaxH3ReferenceToVideo'}[route]
    if canvas.get('class_type') != kind:
        raise ValueError('Invalid workflow canvas node')
    inputs = canvas.get('inputs', {})
    validate_canvas('image' if route == 'image' else 'video', inputs.get('width'), inputs.get('height'))
    inventory = {entry['sha256']: entry for entry in installed_loras(workspace)}
    root = Path(workspace).resolve()
    selected = {}
    for selection in selections:
        digest = selection.get('sha256')
        entry = inventory.get(digest)
        strength = selection.get('strength_model')
        if (not entry or entry['filename'] in selected or route not in entry['routes'] or selection.get('filename') != entry['filename']
                or type(strength) not in (int, float) or not math.isfinite(strength) or not 0 <= strength <= 4):
            raise ValueError('Adapter selection does not match this worker inventory')
        file = root / 'ComfyUI/models/loras' / entry['filename']
        if file.is_symlink() or not file.resolve().is_relative_to(root / 'ComfyUI/models/loras'):
            raise ValueError('Adapter path changed')
        stat = file.stat()
        proof = json.loads((root / '.seed/adapters/assets' / (digest + '.json')).read_text())
        if proof != {'sha256': digest, 'size': stat.st_size, 'mtime_ns': stat.st_mtime_ns}:
            raise ValueError('Adapter file changed')
        selected[entry['filename']] = strength
    if chain != selected:
        raise ValueError('Adapter chain does not match selected adapters')


def validate_edit_inputs(graph):
    images = {key: node for key, node in graph.items() if node.get('class_type') == 'SeedLoadEditImage'}
    if not 1 <= len(images) <= 10 or set(images) != {str(100+i) for i in range(len(images))}:
        raise ValueError('Choose one to ten input images')
    for key, node in images.items():
        size = node.get('inputs', {}).get('size')
        resolution_preset('image', size)
        if key != '100' and size != '1mp':
            raise ValueError('Auxiliary images require the baseline target')
