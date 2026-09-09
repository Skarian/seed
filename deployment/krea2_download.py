import pathlib,json,urllib.request,hashlib,concurrent.futures,subprocess
base=pathlib.Path('/workspace/h3-deployment')
assets=json.loads((base/'krea2-assets.json').read_text())
root=pathlib.Path('/workspace/ComfyUI/models')
def download(a):
 p=root/a['path'];p.parent.mkdir(parents=True,exist_ok=True)
 if not p.exists():
  tmp=p.with_suffix('.part')
  subprocess.run(['aria2c','--continue=true','--max-connection-per-server=8','--split=8','--min-split-size=16M','--file-allocation=none','--summary-interval=30','--console-log-level=warn','--dir='+str(tmp.parent),'--out='+tmp.name,a['url']],check=True)
  h=hashlib.sha256();n=0
  with tmp.open('rb') as f:
   while b:=f.read(8*1024*1024):h.update(b);n+=len(b)
  assert n==a['size'] and h.hexdigest()==a['sha256'],a['path']
  tmp.rename(p)
 else:
  h=hashlib.sha256()
  with p.open('rb') as f:
   while b:=f.read(8*1024*1024):h.update(b)
  assert p.stat().st_size==a['size'] and h.hexdigest()==a['sha256']
 print('VERIFIED',a['path'],flush=True)
 return a
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:result=list(pool.map(download,assets))
(base/'krea2-verified.json').write_text(json.dumps(result,indent=2))
print('ALL DOWNLOADS VERIFIED',flush=True)
