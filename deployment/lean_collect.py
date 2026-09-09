"""Collect completed acceptance artifacts through the authenticated proxy."""
import json,pathlib,urllib.request,urllib.parse,comfy
p=pathlib.Path(__file__).parent
tests=json.loads((p/'lean-tests.json').read_text())
samples=p/'samples/lean'; samples.mkdir(exist_ok=True)
for label,item in tests.items():
    if item.get('status')!='success':continue
    for node in item['outputs'].values():
        for media in node.get('images',[])+node.get('gifs',[]):
            args={k:media[k] for k in ('filename','subfolder','type') if k in media}
            req=urllib.request.Request(comfy.ROOT+'/view?'+urllib.parse.urlencode(args),headers=comfy.HEADERS)
            target=samples/media['filename']
            if not target.exists():
                with urllib.request.urlopen(req,timeout=60) as r:target.write_bytes(r.read())
            print(label,target.name,target.stat().st_size,'bytes')
