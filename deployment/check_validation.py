import pathlib,json,subprocess
p=pathlib.Path('/workspace/h3-deployment/asset-validation.json')
v=json.loads(p.read_text()) if p.exists() else []
print('Verified',len(v),'of 10; all okay:',all(x['ok'] for x in v))
print(pathlib.Path('/workspace/h3-deployment/validation.log').read_text()[-1500:])
print(subprocess.check_output(['du','-sb','/workspace/ComfyUI'],text=True))
print(subprocess.check_output(['tail','-n','8','/workspace/comfyui_nl9k16upk37kt7_nohup.log'],text=True))
