"""Validate ordered job adapters against the immutable boot inventory."""
import json
import math
from pathlib import Path
from worker.profile import installed_loras, worker_class


def validate_adapters(workspace, graph, selections, route):
    if route not in ('image', 'image-edit', 'fl', 'ref'):
        raise ValueError('Unknown workflow route')
    role = worker_class()
    if role and (role == 'image') != (route in ('image','image-edit')):
        raise ValueError('Workflow does not belong to this worker class')
    if not isinstance(selections, list) or len(selections) > 3:
        raise ValueError('Select up to three installed adapters')
    if route == 'image-edit':
        if selections or any(n.get('class_type', '').startswith('LoraLoader') for n in graph.values()):
            raise ValueError('Qwen editing does not support adapters in this release')
        validate_edit_profile(graph)
        return ['6', 0]
    inventory = {entry['sha256']: entry for entry in installed_loras(workspace)}
    root = Path(workspace).resolve()
    selected, previous = set(), ['1' if route == 'image' else '16', 0]
    expected_nodes = set()
    for index, selection in enumerate(selections):
        digest = selection.get('sha256')
        entry = inventory.get(digest)
        strength = selection.get('strength_model')
        if (not entry or digest in selected or route not in entry['routes'] or selection.get('filename') != entry['filename']
                or type(strength) not in (int, float) or not math.isfinite(strength) or not 0 <= strength <= 4):
            raise ValueError('Adapter selection does not match this worker inventory')
        selected.add(digest)
        file = root / 'ComfyUI/models/loras' / entry['filename']
        if file.is_symlink() or not file.resolve().is_relative_to(root / 'ComfyUI/models/loras'):
            raise ValueError('Adapter path changed')
        stat = file.stat()
        proof = json.loads((root / '.seed/adapters/assets' / (digest + '.json')).read_text())
        if proof != {'sha256': digest, 'size': stat.st_size, 'mtime_ns': stat.st_mtime_ns}:
            raise ValueError('Adapter file changed')
        key = str(30 + index)
        expected_nodes.add(key)
        node = graph.get(key, {})
        if node != {'class_type': 'LoraLoaderModelOnly', 'inputs': {
                'model': previous, 'lora_name': entry['filename'], 'strength_model': strength}}:
            raise ValueError('Adapter chain does not match selected adapters')
        previous = [key, 0]
    actual_nodes = {key for key, node in graph.items() if node.get('class_type', '').startswith('LoraLoader')}
    if actual_nodes != expected_nodes:
        raise ValueError('Unselected adapter in graph')
    return previous


def validate_edit_profile(graph):
    expected = {
        '1': ('UNETLoader', {'unet_name': 'qwen_image_2.1_int8_convrot.safetensors', 'weight_dtype': 'default'}),
        '2': ('CLIPLoader', {'clip_name': 'qwen3vl_8b_int8_convrot.safetensors', 'type': 'qwen_image', 'device': 'default'}),
        '3': ('VAELoader', {'vae_name': 'qwen_image_2.1_vae_bf16.safetensors'}),
        '4': ('TextEncodeQwenImage21', {'clip': ['2', 0], 'vae': ['3', 0], 'negative_prompt': '', 'resolution': 0}),
        '6': ('QwenImage21Cache', {'model': ['1', 0], 'device': 'auto', 'dtype': 'default'}),
        '7': ('KSampler', {'model': ['6', 0], 'positive': ['4', 0], 'negative': ['4', 1], 'latent_image': ['4', 2], 'steps': 25, 'cfg': 1, 'sampler_name': 'euler', 'scheduler': 'simple', 'denoise': 1}),
        '8': ('VAEDecode', {'samples': ['7', 0], 'vae': ['3', 0]}),
        '9': ('SaveImage', {'images': ['8', 0]}),
    }
    for key, (kind, fields) in expected.items():
        node = graph.get(key, {})
        if node.get('class_type') != kind or any(node.get('inputs', {}).get(k) != v for k, v in fields.items()):
            raise ValueError('Invalid Qwen edit profile')
    refs = [key for key in graph if key not in expected]
    if not 1 <= len(refs) <= 10 or set(refs) != {str(100+i) for i in range(len(refs))}:
        raise ValueError('Choose one to ten input images')
    for i in range(len(refs)):
        key = str(100+i)
        if graph[key].get('class_type') != 'SeedLoadEditImage' or graph['4']['inputs'].get('images.image_'+str(i+1)) != [key, 0]:
            raise ValueError('Image input ordering changed')


def validate_video_profile(graph, profile, model):
    if profile != 'h3-high-v1':
        raise ValueError('Unknown video profile')
    expected = {
        '7': ('BasicGuider', {'model': ['19', 0]}),
        '9': ('KSamplerSelect', {'sampler_name': 'res_multistep'}),
        '10': ('BasicScheduler', {'model': ['19', 0], 'scheduler': 'simple', 'steps': 30, 'denoise': 1}),
        '16': ('MiniMaxH3SigmaShift', {'model': ['1', 0], 'shift_video': 12, 'shift_audio': 3}),
        '17': ('ModelAttentionBackend', {'model': model, 'attention': 'comfy kitchen attention'}),
        '19': ('BlockSparseAttention', {'model': ['17', 0], 'selection': 'sol-attn', 'selection.tau': 1.3,
              'start_percent': 0.2, 'end_percent': 1, 'dense_blocks': '', 'min_tokens': 12288,
              'extra_tokens': 256, 'sink_conditioning': 'exact_kv_and_rows'}),
    }
    if '5' in graph or '14' not in graph:
        raise ValueError('Invalid video profile graph')
    for key, (kind, values) in expected.items():
        node = graph.get(key, {})
        if node.get('class_type') != kind or any(node.get('inputs', {}).get(k) != v for k, v in values.items()):
            raise ValueError('Invalid video profile graph')
    output = graph['14']
    if output.get('class_type') != 'SeedVideoSave' or output.get('inputs', {}).get('export_version') != 'native-v1':
        raise ValueError('Video requires native export')
