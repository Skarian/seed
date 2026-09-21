import json, urllib.request, concurrent.futures, pathlib
ROOT=pathlib.Path(__file__).resolve().parent
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Runpod-planning-audit'}),timeout=45) as r:return json.load(r)
registry=json.loads((ROOT/'template/src/models_registry.json').read_text())
selected={k:v for k,v in registry.items() if not ('fl2va_bf16' in k or 'ref2va_bf16' in k or 'fp8_scaled' in k)}
def metadata(item):
    name,data=item
    repo,path=data['url'].split('huggingface.co/')[1].split('/resolve/main/')
    info=get('https://huggingface.co/api/models/'+repo+'?blobs=true')
    f=next(x for x in info['siblings'] if x['rfilename']==path)
    return dict(name=name,bytes=f.get('size',f.get('lfs',{}).get('size')),sha256=f.get('lfs',{}).get('sha256'),revision=info['sha'],url=data['url'],gated=info.get('gated'))
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:assets=list(pool.map(metadata,selected.items()))
(ROOT/'verified-assets.json').write_text(json.dumps(assets,indent=2))
print(json.dumps({'assets':assets,'total_bytes':sum(x['bytes'] for x in assets)},indent=2))
for repo,num in [('Hearmeman24/comfyui-minimax',24),('Comfy-Org/ComfyUI',15988),('Comfy-Org/ComfyUI',15320)]:
    obj=get(f'https://api.github.com/repos/{repo}/issues/{num}')
    comments=get(obj['comments_url'])
    result={'url':obj['html_url'],'state':obj['state'],'title':obj['title'],'body':obj['body'],'comments':[x['body'] for x in comments]}
    (ROOT/f'issue-{num}.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result)[:10000])
