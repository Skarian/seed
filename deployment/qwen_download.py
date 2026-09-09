import pathlib,subprocess,json,hashlib,time,os,concurrent.futures,collections
base=pathlib.Path('/workspace/h3-deployment')
a=json.loads((base/'qwen-asset.json').read_text())
dest=pathlib.Path('/workspace/ComfyUI/models/checkpoints')/a['name']
dest.parent.mkdir(parents=True,exist_ok=True)
part=dest.with_suffix('.part')
if not dest.exists() and not (part.exists() and part.stat().st_size==a['size'] and not pathlib.Path(str(part)+'.aria2').exists()):
 subprocess.run(['aria2c','--continue=true','--max-connection-per-server=8','--split=8','--min-split-size=16M','--file-allocation=none','--summary-interval=30','--console-log-level=warn','--dir='+str(part.parent),'--out='+part.name,a['url']],check=True)
check=dest if dest.exists() else part
h=hashlib.sha256();block=8*1024*1024
fd=os.open(check,os.O_RDONLY)
def read_chunk(offset):
 count=min(block,a['size']-offset);data=bytearray()
 while len(data)<count:
  b=os.pread(fd,count-len(data),offset+len(data))
  if not b:raise IOError('Unexpected EOF')
  data.extend(b)
 return data
try:
 with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
  offsets=iter(range(0,a['size'],block));pending=collections.deque()
  for off in offsets:
   pending.append(pool.submit(read_chunk,off))
   if len(pending)>=32:h.update(pending.popleft().result())
  while pending:h.update(pending.popleft().result())
finally:os.close(fd)
assert check.stat().st_size==a['size'] and h.hexdigest()==a['sha256'],'Model verification failed'
if check==part:part.rename(dest)
(base/'qwen-verified.json').write_text(json.dumps(a,indent=2))
print('VERIFIED',dest,flush=True)
