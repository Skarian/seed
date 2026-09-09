import pathlib,subprocess
p=pathlib.Path('/workspace/h3-deployment/krea2-comfy.log')
print(p.read_text(errors='replace')[-1600:])
print(subprocess.check_output(['nvidia-smi','--query-gpu=memory.used,utilization.gpu','--format=csv,noheader'],text=True))
