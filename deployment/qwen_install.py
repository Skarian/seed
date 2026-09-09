import pathlib,json,remote
p=pathlib.Path(__file__).parent
src=p.parent/'research/qwen-rapid'
rev=(src/'revision.txt').read_text().strip()
a={'name':'Qwen-Rapid-AIO-NSFW-v19.safetensors','size':28431843583,'sha256':'ba71575515709c9912560d1176b2386eaa49294fedc6ce57b9734aa57e91e5ac','revision':rev}
a['url']='https://huggingface.co/Phr00t/Qwen-Image-Edit-Rapid-AIO/resolve/'+rev+'/v19/'+a['name']
(p/'qwen-asset.json').write_text(json.dumps(a,indent=2))
c=json.loads((p/'configuration.json').read_text());c['networkVolumeGB']=150
(p/'configuration.json').write_text(json.dumps(c,indent=2)+'\n')
for name in ['qwen-asset.json','qwen_download.py','qwen_rapid_nodes.py']:
 remote.api('/api/contents/h3-deployment/'+name,'PUT',{'type':'file','format':'text','content':(p/name).read_text()})
remote.execute('''import pathlib,subprocess
p=pathlib.Path('/workspace/ComfyUI/custom_nodes/phr00t_qwen_rapid')
p.mkdir(parents=True,exist_ok=True)
data=pathlib.Path('/workspace/h3-deployment/qwen_rapid_nodes.py').read_text()
compile(data,'phr00t_qwen_rapid','exec')
(p/'__init__.py').write_text(data)
log=open('/workspace/h3-deployment/qwen-download.log','w')
proc=subprocess.Popen(['python3','/workspace/h3-deployment/qwen_download.py'],stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
print('DOWNLOAD PID',proc.pid)
''')
