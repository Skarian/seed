import pathlib,json,remote,urllib.parse
p=pathlib.Path(__file__).parent
a=json.loads((p/'lean-audit.json').read_text())
pins={'startup':{'/comfyui-runtime':{'url':'https://github.com/Hearmeman24/comfyui-runtime.git','commit':a['/comfyui-runtime']},'/comfyui-minimax':{'url':'https://github.com/Hearmeman24/comfyui-minimax.git','commit':a['/comfyui-minimax']}},'bundled_nodes':{pathlib.Path(k).name:v['commit'] for k,v in a['nodes'].items() if k.startswith('/ComfyUI/') and 'commit' in v}}
(p/'lean/pins.json').write_text(json.dumps(pins,indent=2)+'\n')
(p/'lean/nginx.conf').write_text((p/'nginx.conf').read_text())
remote.execute('''import pathlib,tarfile
base=pathlib.Path('/workspace/h3-deployment')
backup=base/'before-lean-startup.tar.gz'
if not backup.exists():
 with tarfile.open(backup,'w:gz') as out:
  out.add('/workspace/ComfyUI/user',arcname='ComfyUI/user')
  out.add('/workspace/ComfyUI/custom_nodes',arcname='ComfyUI/custom_nodes')
print('BACKUP',backup.stat().st_size)
''')
backup=remote.api('/api/contents/h3-deployment/before-lean-startup.tar.gz?format=base64')
import base64
(p/'before-lean-startup.private.tar.gz').write_bytes(base64.b64decode(backup['content']))
remote.api('/api/contents/h3-deployment/lean-v1','PUT',{'type':'directory'})
for f in (p/'lean').iterdir():
 remote.api('/api/contents/h3-deployment/lean-v1/'+f.name,'PUT',{'type':'file','format':'text','content':f.read_text()})
remote.execute("import subprocess; subprocess.run(['bash','-n','/workspace/h3-deployment/lean-v1/start.sh'],check=True); print('Shell syntax OK')")
print('Staged lean-v1 and local backup')
