import pathlib,os,signal,json,time
base=pathlib.Path('/workspace/h3-deployment')
p=pathlib.Path('/proc/19947/cmdline')
if p.exists() and b'/workspace/h3-deployment/qwen_download.py' in p.read_bytes():
 os.kill(19947,signal.SIGTERM)
 time.sleep(.5)
a=json.loads((base/'qwen-asset.json').read_text())
dest=pathlib.Path('/workspace/ComfyUI/models/checkpoints')/a['name']
part=dest.with_suffix('.part')
if not dest.exists():
 assert part.stat().st_size==a['size']
 assert not pathlib.Path(str(part)+'.aria2').exists()
 part.rename(dest)
assert dest.stat().st_size==a['size']
(base/'qwen-install-status.json').write_text(json.dumps({'size_verified':True,'sha256_verified':False,'note':'User requested skipping remaining hash verification.'},indent=2))
print('READY',dest)
