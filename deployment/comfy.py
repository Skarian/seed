import json, base64, urllib.request, pathlib
P=pathlib.Path(__file__).parent
C=json.loads((P/'access.private.json').read_text())
ROOT='https://'+json.loads((P/'configuration.json').read_text())['podId']+'-8080.proxy.runpod.net'
HEADERS={'User-Agent':'Mozilla/5.0','Authorization':'token '+C['jupyter_token']}
def api(path, data=None):
 req=urllib.request.Request(ROOT+path,headers=HEADERS|{'Content-Type':'application/json'},data=None if data is None else json.dumps(data).encode())
 with urllib.request.urlopen(req,timeout=60) as r:return json.load(r)
if __name__=='__main__':
 import sys
 d=api(sys.argv[1])
 if len(sys.argv)>2:pathlib.Path(sys.argv[2]).write_text(json.dumps(d,indent=2))
 else:print(json.dumps(d,indent=2))
