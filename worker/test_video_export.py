"""Exporter contract tests: inspect bytes handed to FFmpeg, without a GPU."""
import importlib.util
import io
import sys
import types
from pathlib import Path

import pytest


class Pixels:
    def __init__(self, count, height=768, width=1344):
        self.shape = (count, height, width, 3)

    def __len__(self): return self.shape[0]
    def __getitem__(self, key): return Pixels(min(key.stop, len(self)), *self.shape[1:3])
    def split(self, size): return [Pixels(min(size, len(self)-i), *self.shape[1:3]) for i in range(0, len(self), size)]
    def movedim(self, *args): return self
    def detach(self): return self
    def cpu(self): return self
    def clamp(self, *args): return self
    def mul(self, *args): return self
    def byte(self): return self
    def numpy(self): return self
    def tobytes(self): return b'original-pixels' * len(self)


class Audio(Pixels):
    shape = (2, 120)
    def __init__(self): self.shape = (2, 120)
    def __getitem__(self, key): return self
    def short(self): return self
    @property
    def T(self): return self
    def contiguous(self): return self
    def tobytes(self): return bytes(480)


@pytest.mark.parametrize('portrait', [False, True])
@pytest.mark.parametrize('native', [False, True])
def test_export_preserves_native_pixels_and_legacy_graph_behavior(tmp_path, monkeypatch, portrait, native):
    folders = types.SimpleNamespace(get_output_directory=lambda: str(tmp_path))
    resize_calls = []
    def resize(pixels, width, height, method, crop):
        resize_calls.append((width, height, method, crop))
        return pixels
    utils = types.ModuleType('comfy.utils')
    utils.common_upscale = resize
    comfy = types.ModuleType('comfy')
    comfy.utils = utils
    for name, value in {'folder_paths': folders, 'torch': types.ModuleType('torch'), 'numpy': types.ModuleType('numpy'), 'comfy': comfy, 'comfy.utils': utils}.items():
        monkeypatch.setitem(sys.modules, name, value)
    spec = importlib.util.spec_from_file_location('seed_video_export_test', Path(__file__).parent / 'comfy_seed/video.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    captured = {}
    class Input(io.BytesIO):
        def close(self):
            captured['pixels'] = self.getvalue()
            super().close()
    class Process:
        def __init__(self, args, **kwargs):
            captured['args'] = args
            self.stdin = Input()
            self.stderr = io.BytesIO()
            Path(args[-1]).write_bytes(b'encoded-mp4')
        def wait(self): return 0
        def poll(self): return 0
    monkeypatch.setattr(module.subprocess, 'Popen', Process)
    dimensions = (1344, 768) if portrait else (768, 1344)
    kwargs = {'export_version': 'native-v1'} if native else {}
    result = module.SeedVideoSave().save(Pixels(124, *dimensions), {'sample_rate': 24, 'waveform': Audio()}, 5, 'seed/job/video', 'generated', **kwargs)
    args = captured['args']
    expected_size = ('768x1344' if portrait else '1344x768') if native else ('720x1280' if portrait else '1280x720')
    assert args[args.index('-s')+1] == expected_size
    assert args[args.index('-frames:v')+1] == '120'
    assert args[args.index('-r')+1] == '24'
    assert args[args.index('-crf')+1] == ('16' if native else '18')
    assert args[args.index('-b:a')+1] == ('256k' if native else '192k')
    assert captured['pixels'] == b'original-pixels' * 120
    assert bool(resize_calls) is not native
    if native: assert args[args.index('-preset')+1] == 'medium'
    assert (tmp_path / 'seed/job/video.mp4').read_bytes() == b'encoded-mp4'
    assert not (tmp_path / 'seed/job/video.wav').exists()
    assert result['ui']['videos'][0]['filename'] == 'video.mp4'
