import pathlib, subprocess, json, urllib.request
print(subprocess.check_output(['du','-sb','/workspace'],text=True))
print(pathlib.Path('/ComfyUI/extra_model_paths.yaml').read_text())
print('CHECKPOINTS',list(pathlib.Path('/workspace/ComfyUI/models/checkpoints').glob('*')))
print('QUEUE',urllib.request.urlopen('http://127.0.0.1:8188/queue').read().decode())
