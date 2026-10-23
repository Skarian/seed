"""Offline resolution guards: catalog gating, graph acceptance and loader bounds."""
import importlib.util
import math
import random
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from worker.resolution import resolution_preset, size_choices, validate_canvas, validate_edit_dimensions


def module_at(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / 'comfy_seed' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('flag', ['', '0', 'true', '1'])
def test_approved_and_historical_sizes_work_without_qualification(monkeypatch, flag):
    monkeypatch.setenv('SEED_QUALIFY_RESOLUTIONS', flag)
    assert [entry['id'] for entry in size_choices('image')] == ['image-480', 'image-768', '2mp', 'image-1440', '0.5mp', '1mp']
    assert [entry['id'] for entry in size_choices('video')] == ['480p', '768p']
    for family, size in [('image', 'bogus'), ('image', '768p'), ('video', '1mp'), ('image', None)]:
        with pytest.raises(ValueError):
            resolution_preset(family, size)


@pytest.mark.parametrize('family,width,height', [
    ('image', 896, 504), ('image', 1280, 720), ('image', 1920, 1080),
    ('image', 864, 480), ('image', 1344, 768), ('image', 2560, 1440),
    ('video', 864, 480), ('video', 1344, 768),
])
def test_catalog_canvases_and_transposes(monkeypatch, family, width, height):
    for flag in ('0', '1'):
        monkeypatch.setenv('SEED_QUALIFY_RESOLUTIONS', flag)
        for dimensions in ((width, height), (height, width)):
            validate_canvas(family, *dimensions)
    for dimensions in ((width + 32, height), (True, height), (float(width), height), (None, height)):
        with pytest.raises(ValueError):
            validate_canvas(family, *dimensions)


@pytest.mark.parametrize('size,width,height,accepted', [
    ('0.5mp', 832, 640, True), ('1mp', 1440, 736, True), ('2mp', 1664, 1280, True),
    ('1mp', 512, 512, True), ('1mp', 64, 96, True), ('1mp', 32, 192, True),
    ('0.5mp', 1440, 736, False), ('1mp', 1664, 1280, False), ('2mp', 2560, 2560, False),
    ('1mp', 1056, 1056, False), ('1mp', 32, 224, False), ('1mp', 16, 32, False),
    ('1mp', 513, 512, False), ('1mp', 512.0, 512, False), ('unknown', 512, 512, False),
])
def test_prepared_edit_guard_honors_rounding_without_enlarging_auxiliary_budget(monkeypatch, size, width, height, accepted):
    monkeypatch.setenv('SEED_QUALIFY_RESOLUTIONS', '1')
    for dimensions in ((width, height), (height, width)):
        if accepted:
            validate_edit_dimensions(*dimensions, size)
        else:
            with pytest.raises(ValueError):
                validate_edit_dimensions(*dimensions, size)


@pytest.mark.parametrize('size,area', [('0.5mp', 524288), ('1mp', 1048576), ('2mp', 2097152), ('image-480', 414720), ('image-768', 1032192), ('image-1440', 3686400)])
def test_source_geometry_probe_matches_javascript_rounding_at_all_targets(monkeypatch, size, area):
    monkeypatch.setenv('SEED_QUALIFY_RESOLUTIONS', '1')
    random_source = random.Random(20260928)
    sources = [(random_source.randint(32, 20000), random_source.randint(32, 20000)) for _ in range(20000)]
    # Cover short axes and rounding ties densely, then the maximum source area
    # and ratio limits. The target-area guard is independent of this resize rule.
    for width in range(32, 1025):
        sources.extend((width, height) for height in (32, width, width * 4, math.ceil(width / 4), width * 3 // 2))
    sources.extend([(47, 188), (48, 192), (10000, 10000), (20000, 5000), (5000, 20000)])
    checked = 0
    for width, height in sources:
        if width * height > 100_000_000 or width / height > 4 or height / width > 4:
            continue
        scale = min(1, math.sqrt(area / (width * height)))
        prepared_width = max(32, math.floor(width * scale / 32 + 0.5) * 32)
        prepared_height = max(32, math.floor(height * scale / 32 + 0.5) * 32)
        validate_edit_dimensions(prepared_width, prepared_height, size)
        checked += 1
    assert checked > 9000


def edit_graph(size='1mp'):
    return {
        '1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'qwen_image_2.1_int8_convrot.safetensors', 'weight_dtype': 'default'}},
        '2': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': 'qwen3vl_8b_int8_convrot.safetensors', 'type': 'qwen_image', 'device': 'default'}},
        '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': 'qwen_image_2.1_vae_bf16.safetensors'}},
        '4': {'class_type': 'TextEncodeQwenImage21', 'inputs': {'clip': ['2', 0], 'vae': ['3', 0], 'negative_prompt': '', 'resolution': 0, 'images.image_1': ['100', 0], 'images.image_2': ['101', 0]}},
        '6': {'class_type': 'QwenImage21Cache', 'inputs': {'model': ['1', 0], 'device': 'auto', 'dtype': 'default'}},
        '7': {'class_type': 'KSampler', 'inputs': {'model': ['6', 0], 'positive': ['4', 0], 'negative': ['4', 1], 'latent_image': ['4', 2], 'steps': 25, 'cfg': 1, 'sampler_name': 'euler', 'scheduler': 'simple', 'denoise': 1}},
        '8': {'class_type': 'VAEDecode', 'inputs': {'samples': ['7', 0], 'vae': ['3', 0]}},
        '9': {'class_type': 'SaveImage', 'inputs': {'images': ['8', 0]}},
        '100': {'class_type': 'SeedLoadEditImage', 'inputs': {'image': 'seed/job/source.png', 'size': size}},
        '101': {'class_type': 'SeedLoadEditImage', 'inputs': {'image': 'seed/job/auxiliary.png', 'size': '1mp'}},
    }


@pytest.mark.parametrize('size', ['0.5mp', '1mp', '2mp', 'image-480', 'image-768', 'image-1440'])
def test_edit_profile_selects_only_the_source_target(tmp_path, monkeypatch, size):
    adapters = module_at('seed_resolution_adapters', 'adapters.py')
    monkeypatch.setenv('SEED_WORKER_CLASS', '')
    monkeypatch.setenv('SEED_QUALIFY_RESOLUTIONS', '1')
    assert adapters.validate_adapters(tmp_path, edit_graph(size), [], 'image-edit') == ['6', 0]
    for auxiliary in ('0.5mp', '2mp', None):
        graph = edit_graph(size)
        graph['101']['inputs']['size'] = auxiliary
        with pytest.raises(ValueError):
            adapters.validate_adapters(tmp_path, graph, [], 'image-edit')
    graph = edit_graph(size)
    graph['4']['inputs']['images.image_1'] = ['101', 0]
    with pytest.raises(ValueError):
        adapters.validate_adapters(tmp_path, graph, [], 'image-edit')
    monkeypatch.setenv('SEED_QUALIFY_RESOLUTIONS', '0')
    assert adapters.validate_adapters(tmp_path, edit_graph(size), [], 'image-edit') == ['6', 0]


@pytest.mark.asyncio
@pytest.mark.parametrize('flag', ['', '1'])
@pytest.mark.parametrize('route,kind,width,height', [
    ('image', 'EmptyLatentImage', 1920, 1080),
    ('fl', 'MiniMaxH3ImageToVideo', 864, 480),
    ('ref', 'MiniMaxH3ReferenceToVideo', 480, 864),
])
async def test_worker_accepts_approved_but_rejects_arbitrary_canvases_before_acceptance(tmp_path, monkeypatch, route, kind, width, height, flag):
    import uuid
    from worker.test_engine_jobs import HEADERS, engine, high_graph, request_for
    from worker import spool
    monkeypatch.setenv('SEED_WORKER_CLASS', '')
    client, queue, _, _ = await engine(tmp_path, monkeypatch)
    try:
        for changed, accepted in [(True, False), (False, True)]:
            monkeypatch.setenv('SEED_QUALIFY_RESOLUTIONS', flag)
            job_id = str(uuid.uuid4())
            body = request_for(job_id) if route == 'image' else {'prompt_id': job_id, 'prompt': high_graph(job_id, []), 'video_profile': 'h3-high-v1'}
            body['route'] = route
            body['prompt']['6'] = {'class_type': kind, 'inputs': {'width': width + (32 if changed else 0), 'height': height}}
            response = await client.post('/studio/prompt', json=body, headers=HEADERS)
            assert response.status == (200 if accepted else 422)
            record = spool.read_record(spool.job_directory(tmp_path / 'volume', job_id))
            assert (record is not None) == accepted
        assert queue.put_count == 1
    finally:
        await client.close()


@pytest.mark.parametrize('size,accepted', [('2mp', True), ('1mp', False), ('unknown', False)])
def test_loader_enforces_selected_target_before_decoding_pixels(tmp_path, monkeypatch, size, accepted):
    monkeypatch.setenv('SEED_QUALIFY_RESOLUTIONS', '1')
    source = MagicMock(width=1664, height=1280)
    source.__enter__.return_value = source
    source.getbands.return_value = ('R', 'G', 'B', 'A')
    numpy = MagicMock()
    torch = MagicMock()
    image_ops = types.SimpleNamespace(exif_transpose=lambda image: image)
    for name, value in {
        'PIL': types.SimpleNamespace(Image=types.SimpleNamespace(open=lambda _: source), ImageOps=image_ops),
        'numpy': numpy, 'torch': torch,
        'folder_paths': types.SimpleNamespace(get_input_directory=lambda: str(tmp_path)),
    }.items():
        monkeypatch.setitem(sys.modules, name, value)
    directory = tmp_path / 'seed/job'
    directory.mkdir(parents=True)
    (directory / 'source.png').write_bytes(b'loader-path-fixture')
    module = module_at('seed_resolution_image', 'image.py')
    if accepted:
        module.SeedLoadEditImage().load('seed/job/source.png', size)
        source.convert.assert_called_once_with('RGBA')
        torch.from_numpy.assert_called_once()
    else:
        with pytest.raises(ValueError):
            module.SeedLoadEditImage().load('seed/job/source.png', size)
        numpy.array.assert_not_called()


@pytest.mark.parametrize('width,height,flag', [(1920, 1080, '0'), (2560, 1440, '0'), (1280, 720, '1'), (896, 480, '1')])
def test_native_export_rejects_image_only_and_unknown_dimensions(tmp_path, monkeypatch, width, height, flag):
    from worker.test_video_export import Pixels
    monkeypatch.setenv('SEED_QUALIFY_RESOLUTIONS', flag)
    utils = types.ModuleType('comfy.utils')
    for name, value in {
        'folder_paths': types.SimpleNamespace(get_output_directory=lambda: str(tmp_path)),
        'numpy': types.ModuleType('numpy'), 'torch': types.ModuleType('torch'),
        'comfy': types.SimpleNamespace(utils=utils), 'comfy.utils': utils,
    }.items():
        monkeypatch.setitem(sys.modules, name, value)
    module = module_at('seed_resolution_video', 'video.py')
    with pytest.raises(ValueError, match='canvas dimensions'):
        module.SeedVideoSave().save(Pixels(124, height, width), {}, 5, 'seed/job/video', 'silent', export_version='native-v1')
    assert not (tmp_path / 'seed').exists()
