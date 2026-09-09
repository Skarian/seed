import sys,time,json,pathlib,uuid,urllib.error
from comfy import api,ROOT,HEADERS
sys.path.insert(0,str(pathlib.Path(__file__).parent/'vendor'))
import websocket
p=pathlib.Path(__file__).parent
start=float(sys.argv[1]); result={'start_requested_epoch':start,'events':{}}
def event(name,detail=None):
 result['events'][name]={'elapsed_seconds':round(time.time()-start,2),'detail':detail}
 (p/'resume-benchmark.json').write_text(json.dumps(result,indent=2))
 print(name,result['events'][name],flush=True)
deadline=start+900
while time.time()<deadline:
 try:
  d=api('/system_stats')
  if d.get('devices'):break
 except Exception:pass
 time.sleep(3)
else:raise RuntimeError('Service readiness timed out')
event('comfy_ready')
client=uuid.uuid4().hex
ws=websocket.create_connection(ROOT.replace('https:','wss:')+'/ws?clientId='+client,header=HEADERS,timeout=30)
prompt=json.loads((p/'test-fl2va-api.json').read_text())
prompt['8']['inputs']['noise_seed']=314159
prompt['14']['inputs']['filename_prefix']='H3_Benchmark/Resume_Turbo8'
r=api('/prompt',{'prompt':prompt,'client_id':client})
result['prompt_id']=r['prompt_id'];event('generation_submitted')
while time.time()<deadline:
 try:msg=ws.recv()
 except websocket.WebSocketTimeoutException:continue
 if not isinstance(msg,str):continue
 m=json.loads(msg);t=m.get('type');d=m.get('data',{})
 if t=='executing' and d.get('node')=='11' and 'sampler_node_entered' not in result['events']:event('sampler_node_entered')
 if t=='progress' and 'first_sampling_progress' not in result['events']:event('first_sampling_progress',d)
 if t=='execution_error':event('error',d);raise RuntimeError(d.get('exception_message'))
 if t=='executing' and d.get('node') is None:break
 if t=='execution_success':break
ws.close()
h=api('/history/'+r['prompt_id'])
if not h:time.sleep(1);h=api('/history/'+r['prompt_id'])
record=h.get(r['prompt_id'],{})
assert record.get('status',{}).get('status_str')=='success',record.get('status')
(p/'resume-benchmark-history.json').write_text(json.dumps(h,indent=2))
event('video_completed',record.get('outputs'))
