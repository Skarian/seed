"""Small H3 file adapters; model conditioning remains in native Comfy nodes."""
import os
import subprocess
import wave
from pathlib import Path
import numpy as np
import torch
import folder_paths

class SeedLoadVideo:
    @classmethod
    def INPUT_TYPES(cls): return {'required': {'filename': ('STRING',)}}
    RETURN_TYPES = ('IMAGE',)
    FUNCTION = 'load'
    CATEGORY = 'seed'
    def load(self, filename):
        import av
        root = Path(folder_paths.get_input_directory()).resolve()
        file = (root / filename).resolve()
        if not file.is_relative_to(root / 'seed'): raise ValueError('Invalid input')
        with av.open(str(file)) as container:
            frames = [frame.to_ndarray(format='rgb24') for frame in container.decode(video=0)]
        if not frames or len(frames) > 362: raise ValueError('Invalid prepared reference duration')
        return (torch.from_numpy(np.stack(frames)).float().div_(255),)

class SeedVideoSave:
    @classmethod
    def INPUT_TYPES(cls): return {'required': {'images': ('IMAGE',), 'audio': ('AUDIO',), 'seconds': ('INT', {'default':5,'min':5,'max':15}), 'filename_prefix': ('STRING',), 'audio_mode': (['generated','silent'],)}, 'optional': {'export_version': (['legacy-v1', 'native-v1'], {'default': 'legacy-v1'})}}
    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = 'save'
    CATEGORY = 'seed'
    def save(self, images, audio, seconds, filename_prefix, audio_mode, export_version='legacy-v1'):
        import comfy.utils
        root = Path(folder_paths.get_output_directory()).resolve()
        target = (root / (filename_prefix + '.mp4')).resolve()
        if not target.is_relative_to(root / 'seed') or (not isinstance(seconds, int) or isinstance(seconds, bool) or not 5 <= seconds <= 15) or len(images)<seconds*24 or export_version not in ('legacy-v1', 'native-v1') or audio_mode not in ('generated', 'silent'): raise ValueError('Invalid video export')
        native = export_version == 'native-v1'
        if len(images.shape) != 4 or images.shape[-1] != 3: raise ValueError('Invalid video frames')
        if native and (int(images.shape[2]), int(images.shape[1])) not in ((1344, 768), (768, 1344)): raise ValueError('Invalid native video dimensions')
        target.parent.mkdir(parents=True,exist_ok=True)
        width,height=(int(images.shape[2]), int(images.shape[1])) if native else ((720,1280) if images.shape[1]>images.shape[2] else (1280,720))
        sample_rate=audio['sample_rate']; waveform=audio['waveform'][0,...,:seconds*sample_rate].detach().cpu()
        if waveform.shape[-1]<seconds*sample_rate: raise ValueError('Incomplete generated audio')
        wav=target.with_suffix('.wav')
        with wave.open(str(wav),'wb') as handle:
            handle.setnchannels(waveform.shape[0]);handle.setsampwidth(2);handle.setframerate(sample_rate)
            handle.writeframes(waveform.clamp(-1,1).mul(32767).short().T.contiguous().numpy().tobytes())
        partial=target.with_suffix('.part.mp4')
        args=['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{width}x{height}','-r','24','-i','pipe:0']
        if audio_mode=='generated': args+=['-i',str(wav),'-c:a','aac','-b:a','256k' if native else '192k']
        args+=['-frames:v',str(seconds*24),'-c:v','libx264','-crf','16' if native else '18']
        if native: args+=['-preset','medium']
        args+=['-pix_fmt','yuv420p','-movflags','+faststart',str(partial)]
        process=subprocess.Popen(args,stdin=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            for chunk in images[:seconds*24].split(8):
                resized=chunk if native else comfy.utils.common_upscale(chunk.movedim(-1,1),width,height,'bilinear','center').movedim(1,-1)
                process.stdin.write(resized.detach().cpu().clamp(0,1).mul(255).byte().numpy().tobytes())
            process.stdin.close();error=process.stderr.read();code=process.wait()
            if code: raise RuntimeError('Video export failed')
            os.replace(partial,target)
        finally:
            if process.poll() is None:process.kill();process.wait()
            wav.unlink(missing_ok=True)
        return {'ui': {'videos': [{'filename':target.name,'subfolder':str(target.parent.relative_to(root)),'type':'output'}]}}

NODE_CLASS_MAPPINGS={'SeedLoadVideo':SeedLoadVideo,'SeedVideoSave':SeedVideoSave}
