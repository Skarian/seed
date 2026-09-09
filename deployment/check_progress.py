import pathlib,subprocess,json
print(subprocess.check_output(['tail','-n','25','/workspace/comfyui_nl9k16upk37kt7_nohup.log'],text=True))
root=pathlib.Path('/workspace/ComfyUI/models')
print('persistent:',sum(1 for p in root.rglob('*.safetensors') if not p.is_symlink()),'of10')
print('remaining symlinks:',[p.name for p in root.rglob('*.safetensors') if p.is_symlink()])
print(subprocess.check_output(['nvidia-smi','--query-gpu=utilization.gpu,memory.used','--format=csv'],text=True))
