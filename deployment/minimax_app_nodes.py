"""Small, dependency-free controls for the personal H3 apps (uses Comfy's torch)."""
FORMATS = ['TikTok - Portrait 9:16 (720p)', 'Cinema - Landscape 16:9 (720p)']
DURATIONS = ['5 seconds', '10 seconds', '15 seconds']

class NeilH3Presets:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'format': (FORMATS,), 'duration': (DURATIONS,)}}
    RETURN_TYPES = ('INT', 'INT', 'INT', 'INT')
    RETURN_NAMES = ('width', 'height', 'length', 'seconds')
    FUNCTION = 'resolve'
    CATEGORY = 'Neil/Video'
    def resolve(self, format, duration):
        if format not in FORMATS or duration not in DURATIONS:
            raise ValueError('Choose a supported H3 preset')
        seconds = int(duration.split()[0])
        width, height = (768, 1344) if format == FORMATS[0] else (1344, 768)
        return width, height, {5:124, 10:243, 15:362}[seconds], seconds

class NeilH3Finish:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images': ('IMAGE',), 'audio': ('AUDIO',),
                             'seconds': ('INT', {'default':5, 'min':5, 'max':15})}}
    RETURN_TYPES = ('IMAGE', 'AUDIO')
    FUNCTION = 'finish'
    CATEGORY = 'Neil/Video'
    def finish(self, images, audio, seconds):
        import torch
        import comfy.utils
        if seconds not in (5, 10, 15) or len(images) < seconds * 24:
            raise ValueError('H3 returned too few frames for the requested duration')
        width, height = (720, 1280) if images.shape[1] > images.shape[2] else (1280, 720)
        # Small batches bound resize memory; preserve aspect ratio with center crop.
        frames = images[:seconds * 24]
        result = torch.cat([comfy.utils.common_upscale(chunk.movedim(-1,1), width, height,
                    'bilinear', 'center').movedim(1,-1) for chunk in frames.split(8)])
        samples = seconds * audio['sample_rate']
        if audio['waveform'].shape[-1] < samples:
            raise ValueError('H3 returned too little audio for the requested duration')
        return result, {**audio, 'waveform':audio['waveform'][..., :samples]}

NODE_CLASS_MAPPINGS = {'NeilH3Presets':NeilH3Presets, 'NeilH3Finish':NeilH3Finish}
NODE_DISPLAY_NAME_MAPPINGS = {'NeilH3Presets':'Video format and duration', 'NeilH3Finish':'720p video export'}
