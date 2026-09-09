"""Run setup diagnostics over this deployment's authenticated Jupyter API."""
import sys, pathlib, json, urllib.request, uuid, datetime
BASE = pathlib.Path(__file__).parent
sys.path.insert(0, str(BASE / 'vendor'))
import websocket
creds = json.loads((BASE / 'access.private.json').read_text())
POD = json.loads((BASE / 'configuration.json').read_text())['podId']
ROOT = f'https://{POD}-8888.proxy.runpod.net'
HEADERS = {'Authorization': 'token ' + creds['jupyter_token'], 'User-Agent':'Mozilla/5.0'}
def api(path, method='GET', data=None):
    r = urllib.request.Request(ROOT + path, method=method, headers=HEADERS | {'Content-Type':'application/json'}, data=None if data is None else json.dumps(data).encode())
    with urllib.request.urlopen(r, timeout=30) as response:
        b = response.read()
        return json.loads(b) if b else None
def execute(code):
    kid = api('/api/kernels', 'POST', {'name':'python3'})['id']
    ws = None
    try:
        ws = websocket.create_connection(ROOT.replace('https:', 'wss:') + '/api/kernels/' + kid + '/channels', header=HEADERS, timeout=60)
        mid = uuid.uuid4().hex
        msg = {'header':{'msg_id':mid,'username':'neil','session':uuid.uuid4().hex,'date':datetime.datetime.now(datetime.timezone.utc).isoformat(),'msg_type':'execute_request','version':'5.3'},'parent_header':{},'metadata':{},'channel':'shell','content':{'code':code,'silent':False,'store_history':False,'user_expressions':{},'allow_stdin':False,'stop_on_error':True}}
        ws.send(json.dumps(msg))
        while True:
            r = json.loads(ws.recv())
            if r.get('parent_header',{}).get('msg_id') != mid: continue
            kind = r['msg_type']; content = r['content']
            if kind == 'stream': print(content['text'], end='', flush=True)
            elif kind == 'error': raise RuntimeError(content['ename'] + ': ' + content['evalue'])
            elif kind in ('execute_result','display_data'): print(content.get('data',{}).get('text/plain',''))
            elif kind == 'status' and content['execution_state'] == 'idle': break
    finally:
        if ws: ws.close()
        api('/api/kernels/' + kid, 'DELETE')
if __name__ == '__main__':
    if sys.argv[1] == 'health': print(api('/api/status'))
    else: execute(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
