"""One-off deployment acceptance; not part of startup."""
import pathlib,json,sys,time,urllib.request,urllib.parse,urllib.error,http.cookiejar
import comfy,remote
p=pathlib.Path(__file__).parent
state=p/'lean-tests.json'
tests=json.loads(state.read_text()) if state.exists() else {}
mode=sys.argv[1]
if mode=='ready':
 info=comfy.api('/object_info')
 required=['Phr00tTextEncodeQwenImageEditPlus','Krea2EditGroundedEncode','Krea2EditModelPatch','MiniMaxH3ImageToVideo','VHS_VideoCombine']
 assert all(x in info for x in required)
 expected={'CheckpointLoaderSimple':('ckpt_name','Qwen-Rapid-AIO-NSFW-v19.safetensors'),'UNETLoader':('unet_name','minimax_h3_fl2va_pruned_int8_convrot.safetensors')}
 for node,(field,name) in expected.items():assert name in info[node]['input']['required'][field][0]
 cookies=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
 opener.addheaders=[('User-Agent','Mozilla/5.0')]
 for path in ['/','/object_info','/queue','/view?filename=krea2-identity-reference.png&type=input']:
  try:r=opener.open(comfy.ROOT+path,timeout=30)
  except urllib.error.HTTPError as e:
   assert e.code in (302,401,403),(path,e.code)
  else:assert '/login' in r.url,(path,r.url)
 login=opener.open(comfy.ROOT+'/login',timeout=30)
 xsrf=next(c.value for c in cookies if c.name=='_xsrf')
 creds=json.loads((p/'access.private.json').read_text())
 data=urllib.parse.urlencode({'_xsrf':xsrf,'password':creds['jupyter_token'],'next':'/'}).encode()
 opener.open(urllib.request.Request(comfy.ROOT+'/login',data=data,headers={'Referer':comfy.ROOT+'/login'}),timeout=30).read()
 assert json.load(opener.open(comfy.ROOT+'/queue',timeout=30))==comfy.api('/queue')
 ws=remote.websocket.create_connection(comfy.ROOT.replace('https:','wss:')+'/ws?clientId=lean-cookie-test',cookie='; '.join(c.name+'='+c.value for c in cookies),origin=comfy.ROOT,timeout=30)
 try:assert json.loads(ws.recv())['type']=='status'
 finally:ws.close()
 print('READY: required nodes/models, anonymous redirect, browser-cookie login and WebSocket passed')
elif mode=='submit':
 label=sys.argv[2];kind=sys.argv[3]
 filename={'qwen':'qwen-edit-api.json','krea':'krea2-edit-api.json','h3':'test-fl2va-api.json'}[kind]
 g=json.loads((p/filename).read_text())
 for n in g.values():
  if 'filename_prefix' in n['inputs']:n['inputs']['filename_prefix']='LeanAcceptance/'+label
 r=comfy.api('/prompt',{'prompt':g,'client_id':'lean-deployment-test'})
 tests[label]={'kind':kind,'pod':json.loads((p/'configuration.json').read_text())['podId'],'submitted':time.time(),**r}
 state.write_text(json.dumps(tests,indent=2));print(label,r)
elif mode=='check':
 for label,item in tests.items():
  if item['pod']!=json.loads((p/'configuration.json').read_text())['podId']:continue
  h=comfy.api('/history/'+item['prompt_id'])
  if not h:print(label,'running/queued');continue
  row=h[item['prompt_id']];(p/('lean-'+label+'-history.json')).write_text(json.dumps(h,indent=2))
  item['status']=row['status']['status_str'];item['outputs']=row.get('outputs',{})
  print(label,item['status'], 'outputs',len(item['outputs']))
 state.write_text(json.dumps(tests,indent=2))
