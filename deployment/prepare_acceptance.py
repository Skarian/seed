import pathlib,json,base64
p=pathlib.Path(__file__).parent
manifest=json.loads((p.parent/'research/hearmeman_h3/verified-assets.json').read_text())
validator='''import pathlib,json,hashlib,time
root=pathlib.Path('/workspace/ComfyUI/models')
results=[]
for item in MANIFEST:
 paths=list(root.rglob(item['name']))
 assert len(paths)==1,(item['name'],paths)
 f=paths[0]
 assert not f.is_symlink(),str(f)
 h=hashlib.file_digest(f.open('rb'),'sha256').hexdigest()
 results.append(dict(name=f.name,bytes=f.stat().st_size,sha256=h,ok=h==item['sha256'] and f.stat().st_size==item['bytes']))
 pathlib.Path('/workspace/h3-deployment/asset-validation.json').write_text(json.dumps(results,indent=2))
 print(f.name,results[-1]['ok'],flush=True)
assert all(r['ok'] for r in results)
print('ALL_ASSETS_VERIFIED',flush=True)
'''.replace('MANIFEST',repr(manifest))
code='''import pathlib, subprocess, base64
v=pathlib.Path('/workspace/h3-deployment/validate_assets.py')
v.write_bytes(base64.b64decode(PAYLOAD))
log=open('/workspace/h3-deployment/validation.log','w')
proc=subprocess.Popen(['python',str(v)],stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
print('validator pid',proc.pid)
subprocess.run(['ffmpeg','-v','error','-y','-i','/workspace/ComfyUI/output/H3_Acceptance/FL2VA_Turbo8_00001-audio.mp4','-frames:v','1','/workspace/ComfyUI/input/h3-test-reference.png'],check=True)
print(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_name,codec_type,width,height,duration','-of','json','/workspace/ComfyUI/output/H3_Acceptance/FL2VA_Turbo8_00001-audio.mp4'],text=True))
'''.replace('PAYLOAD',repr(base64.b64encode(validator.encode()).decode()))
(p/'start_acceptance.py').write_text(code)
