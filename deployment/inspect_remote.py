import subprocess, pathlib, json, shutil
for cmd in [['nvidia-smi','--query-gpu=name,memory.total,driver_version','--format=csv'],['df','-h','/workspace','/'],['ss','-lntp']]:
 print(subprocess.check_output(cmd,text=True))
root=pathlib.Path('/workspace/ComfyUI')
for name in ['models','input','output','user']:
 p=root/name; print(name, 'exists', p.exists(), 'resolved',p.resolve())
print('Models')
for p in root.glob('models/**/*.safetensors'):
 print(p.name, p.stat().st_size, 'link',p.is_symlink(),str(p.resolve()))
print('Other workspace files', [str(p) for p in pathlib.Path('/workspace').iterdir()])
