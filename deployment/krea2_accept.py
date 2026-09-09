import json,pathlib,sys,time,urllib.request,urllib.parse,base64
import comfy,remote
p=pathlib.Path(__file__).parent
mode=sys.argv[1]
if mode=='install':
 files={f.name:json.loads(f.read_text()) for f in (p/'workflows').glob('0[67]*.json')}
 remote.execute('import pathlib,json\np=pathlib.Path("/workspace/ComfyUI/user/default/workflows/Neil Krea 2");p.mkdir(parents=True,exist_ok=True)\nfiles='+repr(files)+'\nfor n,d in files.items():(p/n).write_text(json.dumps(d,indent=2))\nprint("Saved",len(files),"workflows")')
elif mode in ['t2i','edit']:
 graph=json.loads((p/f'krea2-{mode}-api.json').read_text())
 r=comfy.api('/prompt',{'prompt':graph,'client_id':'neil-krea2-acceptance'})
 (p/f'krea2-{mode}-submitted.json').write_text(json.dumps(r,indent=2))
 print(r)
elif mode=='check':
 for kind in ['t2i','edit']:
  f=p/f'krea2-{kind}-submitted.json'
  if not f.exists():continue
  pid=json.loads(f.read_text())['prompt_id'];h=comfy.api('/history/'+pid)
  if not h:print(kind,'RUNNING OR QUEUED');continue
  (p/f'krea2-{kind}-history.json').write_text(json.dumps(h,indent=2))
  row=h[pid];print(kind,row['status'])
  if row['status']['status_str']!='success':continue
  for o in row['outputs'].values():
   for im in o.get('images',[]):
    url=comfy.ROOT+'/view?'+urllib.parse.urlencode(im)
    data=urllib.request.urlopen(urllib.request.Request(url,headers=comfy.HEADERS)).read()
    (p/'samples'/f'krea2-{kind}.png').write_bytes(data)
    if kind=='t2i':remote.api('/api/contents/ComfyUI/input/krea2-identity-reference.png','PUT',{'type':'file','format':'base64','content':base64.b64encode(data).decode()})
    print('SAVED',kind,len(data))
