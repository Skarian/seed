import pathlib,subprocess,json,sys
result={}
for p in [pathlib.Path('/ComfyUI'),pathlib.Path('/opt/comfyui-runtime'),pathlib.Path('/opt/comfyui-template')]+list(pathlib.Path('/ComfyUI/custom_nodes').iterdir()):
 if not (p/'.git').exists():continue
 result[str(p)]={'commit':subprocess.check_output(['git','-C',str(p),'rev-parse','HEAD'],text=True).strip()}
result['gpu']=subprocess.check_output(['nvidia-smi','--query-gpu=name,driver_version,memory.total','--format=csv'],text=True)
result['python']=sys.version
pathlib.Path('/workspace/h3-deployment/versions.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
