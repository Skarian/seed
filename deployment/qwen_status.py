import pathlib,urllib.request,json
p=pathlib.Path('/workspace/h3-deployment')
print('VERIFIED',(p/'qwen-verified.json').exists())
for f in pathlib.Path('/workspace/ComfyUI/models/checkpoints').glob('*'):print(f.name,f.stat().st_size)
print((p/'qwen-download.log').read_text()[-250:])
for proc in pathlib.Path('/proc').iterdir():
 if not proc.name.isdigit():continue
 try:
  if b'/workspace/h3-deployment/qwen_download.py' not in (proc/'cmdline').read_bytes():continue
  print('DOWNLOAD PROCESS',proc.name)
  print('IO',(proc/'io').read_text())
  for fd in (proc/'fd').iterdir():
   if 'Qwen-Rapid' in str(fd.resolve()):print('READ PROGRESS',(proc/'fdinfo'/fd.name).read_text())
 except OSError:pass
q=json.load(urllib.request.urlopen('http://127.0.0.1:8188/queue'))
print('QUEUE COUNTS',{k:len(v) for k,v in q.items()})
