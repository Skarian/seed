"""Read prepared images without dropping their alpha channel."""
from pathlib import Path
import hashlib
import numpy as np
from PIL import Image, ImageOps
import torch
import folder_paths


class SeedLoadEditImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'image': ('STRING',)}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'load'
    CATEGORY = 'seed'

    @staticmethod
    def path(image):
        root = Path(folder_paths.get_input_directory()).resolve()
        file = (root / image).resolve()
        if not file.is_relative_to(root / 'seed') or file.suffix != '.png' or not file.is_file():
            raise ValueError('Choose a prepared image in this job workspace.')
        return file

    @classmethod
    def IS_CHANGED(cls, image):
        with cls.path(image).open('rb') as handle:
            return hashlib.file_digest(handle, 'sha256').hexdigest()

    def load(self, image):
        with Image.open(self.path(image)) as source:
            if source.width * source.height > 1_100_000 or min(source.size) < 32:
                raise ValueError('Prepared image dimensions are invalid.')
            source = ImageOps.exif_transpose(source)
            source = source.convert('RGBA' if 'A' in source.getbands() else 'RGB')
            pixels = np.array(source).astype(np.float32) / 255.0
        return (torch.from_numpy(pixels)[None,],)


NODE_CLASS_MAPPINGS = {'SeedLoadEditImage': SeedLoadEditImage}
