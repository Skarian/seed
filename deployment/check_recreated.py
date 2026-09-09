import pathlib,subprocess,json,urllib.request
log=pathlib.Path('/workspace/comfyui_l9mwstucse5fmd_nohup.log')
print(subprocess.check_output(['tail','-n','10',str(log)],text=True))
print(subprocess.check_output(['nvidia-smi','--query-gpu=utilization.gpu,memory.used','--format=csv'],text=True))
print(subprocess.check_output(['du','-sb','/workspace/ComfyUI'],text=True))
