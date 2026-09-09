import pathlib,json,subprocess,urllib.request,importlib.metadata
root=pathlib.Path('/workspace/h3-deployment')
result={}
for name in ['/start_script.sh','/workspace/additional_params.sh']:
 p=pathlib.Path(name);result[name]=p.read_text() if p.exists() else None
for name in ['/comfyui-runtime','/comfyui-minimax','/opt/comfyui-runtime','/opt/comfyui-template','/ComfyUI']:
 p=pathlib.Path(name)
 if (p/'.git').exists():result[name]=subprocess.check_output(['git','-C',name,'rev-parse','HEAD'],text=True).strip()
result['packages']={d.metadata['Name']:d.version for d in importlib.metadata.distributions()}
result['nodes']={}
for base in ['/ComfyUI/custom_nodes','/workspace/ComfyUI/custom_nodes']:
 for p in pathlib.Path(base).glob('*'):
  if not p.is_dir():continue
  d={'resolved':str(p.resolve())}
  if (p/'.git').exists():d['commit']=subprocess.check_output(['git','-C',str(p),'rev-parse','HEAD'],text=True).strip()
  if (p/'requirements.txt').exists():d['requirements']=(p/'requirements.txt').read_text()
  result['nodes'][str(p)]=d
(root/'lean-audit.json').write_text(json.dumps(result,indent=2))
print('START SCRIPT',result['/start_script.sh'])
print('ADDITIONAL',result['/workspace/additional_params.sh'])
print('REVISIONS',{k:v for k,v in result.items() if k.startswith('/') and k not in ['/start_script.sh','/workspace/additional_params.sh']})
print('PERSISTENT NODES',{k:v for k,v in result['nodes'].items() if k.startswith('/workspace')})
try:
 info=json.load(urllib.request.urlopen('http://127.0.0.1:8188/object_info'))
 print('COMFY',len(info),'nodes')
except Exception as e:print(type(e).__name__)
