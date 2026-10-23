"""The checked-in resolution catalog and bounds for prepared worker inputs."""
import json
import os
from pathlib import Path


CATALOG = json.loads(Path(__file__).with_name('resolutions.json').read_text())


def size_choices(family):
    candidates = os.environ.get('SEED_QUALIFY_RESOLUTIONS') == '1'
    return [entry for entry in CATALOG[family] if entry['released'] or candidates]


def resolution_preset(family, size):
    for entry in size_choices(family):
        if entry['id'] == size:
            return entry
    raise ValueError('Unsupported resolution size')


def validate_canvas(family, width, height):
    if type(width) is int and type(height) is int:
        for entry in size_choices(family):
            if (width, height) in ((entry['width'], entry['height']), (entry['height'], entry['width'])):
                return
    raise ValueError('Unsupported canvas dimensions')


def validate_edit_dimensions(width, height, size):
    area = resolution_preset('image', size)['area']
    if type(width) is not int or type(height) is not int or min(width, height) < 32 or width % 32 or height % 32:
        raise ValueError('Prepared image dimensions are invalid')
    # Each prepared axis can round up by 16 pixels. Test the feasible original
    # rectangle, including the existing 1:4..4:1 source bound, not a pixel cap
    # that would reject correctly rounded sources just above the target area.
    low_width, low_height = max(32, width - 16), max(32, height - 16)
    feasible_width = max(low_width, low_height / 4)
    feasible_height = max(low_height, low_width / 4)
    if (feasible_width >= width + 16 or feasible_height >= height + 16
            or feasible_width * feasible_height > area
            or (size == '1mp' and width * height > 1_100_000)):
        raise ValueError('Prepared image dimensions exceed the selected target')
