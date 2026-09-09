import pathlib,json,subprocess,urllib.request
for name in ['models','input','output','user','custom_nodes']:
 p=pathlib.Path('/ComfyUI')/name
 print(name, 'realpath',p.resolve())
 if name in ['input','output','user']:assert str(p.resolve()).startswith('/workspace/'),str(p)
v=json.loads(pathlib.Path('/workspace/h3-deployment/asset-validation.json').read_text())
assert len(v)==10 and all(x['ok'] for x in v)
for p in pathlib.Path('/workspace/ComfyUI/models').rglob('*.safetensors'):assert not p.is_symlink()
print('verified persistent model bytes',sum(x['bytes'] for x in v))
print('outputs',[(str(p),p.stat().st_size) for p in pathlib.Path('/workspace/ComfyUI/output').rglob('*.mp4')])
print('ready workflows',len(list(pathlib.Path('/workspace/ComfyUI/user/default/workflows/Neil H3').glob('*.json'))))
q=json.load(urllib.request.urlopen('http://127.0.0.1:8188/queue'))
assert not q['queue_running'] and not q['queue_pending'];print('queue empty')
print('Persistent mount',subprocess.check_output(['findmnt','-n','-o','TARGET,SOURCE','/workspace'],text=True))
