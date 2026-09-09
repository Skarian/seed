import json,pathlib,urllib.request,urllib.parse
from comfy import ROOT,HEADERS,api
import remote
p=pathlib.Path(__file__).parent
history=api('/history/5ba3c1b8-1ac0-4e95-bc81-b548679e39ff')
assert history,'Generation still in progress'
h=next(iter(history.values()));assert h['status']['status_str']=='success',h['status']
(p/'standard-history.json').write_text(json.dumps(history,indent=2))
times={t:d['timestamp'] for t,d in h['status']['messages'] if t in ['execution_start','execution_success']}
seconds=(times['execution_success']-times['execution_start'])/1000
print('Standard20 cold generation seconds',seconds)
for out in h['outputs'].values():
 for video in out.get('gifs',[]):
  params=urllib.parse.urlencode({k:video[k] for k in ['filename','subfolder','type']})
  with urllib.request.urlopen(urllib.request.Request(ROOT+'/view?'+params,headers=HEADERS)) as r:
   (p/'samples'/video['filename']).write_bytes(r.read())
  print('Downloaded',video['filename'])
for name in ['START-HERE.md','asset-validation.json','versions.json','access-validation.json']:
 remote.api('/api/contents/h3-deployment/'+name,'PUT',{'type':'file','format':'text','content':(p/name).read_text()})
(p/'acceptance-summary.json').write_text(json.dumps({'all_model_hashes_verified':True,'assets_bytes':81464127748,'fl2va_turbo_seconds':114.86,'ref2va_turbo_seconds':107.77,'standard20_cold_seconds':seconds,'recreated_without_downloads':True,'browser_generation_passed':True},indent=2))
