import json,pathlib,sys,urllib.request,urllib.parse
import comfy,remote
p=pathlib.Path(__file__).parent
if sys.argv[1]=='submit':
 info=comfy.api('/object_info')
 assert 'Phr00tTextEncodeQwenImageEditPlus' in info
 a=json.loads((p/'qwen-asset.json').read_text())
 assert a['name'] in info['CheckpointLoaderSimple']['input']['required']['ckpt_name'][0]
 g=json.loads((p/'qwen-edit-api.json').read_text())
 result=comfy.api('/prompt',{'prompt':g,'client_id':'qwen-rapid-acceptance'})
 (p/'qwen-submitted.json').write_text(json.dumps(result,indent=2))
 print(result)
elif sys.argv[1]=='check':
 pid=json.loads((p/'qwen-submitted.json').read_text())['prompt_id']
 h=comfy.api('/history/'+pid)
 if pid not in h:
  print('RUNNING',{k:len(v) for k,v in comfy.api('/queue').items()});sys.exit(0)
 (p/'qwen-history.json').write_text(json.dumps(h,indent=2))
 print(h[pid]['status'])
 for output in h[pid].get('outputs',{}).values():
  for im in output.get('images',[]):
   url=comfy.ROOT+'/view?'+urllib.parse.urlencode(im)
   req=urllib.request.Request(url,headers=comfy.HEADERS)
   (p/'samples/qwen-rapid-v19-edit.png').write_bytes(urllib.request.urlopen(req).read())
   print('SAVED',p/'samples/qwen-rapid-v19-edit.png')
elif sys.argv[1]=='publish':
 name='10 - Qwen Rapid AIO v19 - Image Edit.json'
 w=json.loads((p/'workflows'/name).read_text())
 # Validate every link has matching endpoint slots before saving the graph.
 nodes={n['id']:n for n in w['nodes']}
 for lid,src,ss,dst,ds,t in w['links']:
  assert nodes[dst]['inputs'][ds]['link']==lid
  assert lid in nodes[src]['outputs'][ss]['links']
 remote.api('/api/contents/ComfyUI/user/default/workflows/Neil%20Qwen%20Rapid','PUT',{'type':'directory'})
 remote.api('/api/contents/ComfyUI/user/default/workflows/Neil%20Qwen%20Rapid/'+urllib.parse.quote(name),'PUT',{'type':'file','format':'text','content':json.dumps(w,indent=2)})
 check=remote.api('/api/contents/ComfyUI/user/default/workflows/Neil%20Qwen%20Rapid/'+urllib.parse.quote(name))
 assert json.loads(check['content'])==w
 print('PUBLISHED and read-back verified',name)

