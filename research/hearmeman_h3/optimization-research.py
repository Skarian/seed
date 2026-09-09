import urllib.request,json,pathlib,concurrent.futures
root=pathlib.Path(__file__).parent/'optimizations'; root.mkdir(exist_ok=True)
urls={
'turbo':'https://raw.githubusercontent.com/ModelTC/Minimax-H3-Turbo/main/README.md',
'speednodes':'https://raw.githubusercontent.com/linjian-ufo/comfyui-speed-minimaxH3/main/README_EN.md',
'sol-blackwell':'https://raw.githubusercontent.com/KingGore/ComfyUI_sol-attn_Blackwell/main/README.md',
'hybrid':'https://huggingface.co/abakanai/Minimax_h3_hybrid/raw/main/README.md',
'regression':'https://api.github.com/repos/Comfy-Org/ComfyUI/issues/15665',
'regression-comments':'https://api.github.com/repos/Comfy-Org/ComfyUI/issues/15665/comments',
'model-metadata':'https://huggingface.co/api/models/Comfy-Org/MiniMax-H3?blobs=true',
}
def get(item):
    name,url=item
    with urllib.request.urlopen(url,timeout=40) as r:s=r.read().decode()
    (root/(name+'.txt')).write_text(s,encoding='utf8')
    if name=='model-metadata':
        data=json.loads(s)
        names=['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors','minimax_h3_fl2va_bf16.safetensors','minimax_h3_fl2va_pruned_bf16.safetensors']
        print([(x['rfilename'],x.get('size')) for x in data['siblings'] if x['rfilename'].split('/')[-1] in names])
    elif name=='regression':print(name,json.loads(s)['state'],json.loads(s)['body'])
    elif name=='regression-comments':print(name,[(x['user']['login'],x['body'][:3000]) for x in json.loads(s)][-8:])
    else:print(name,'saved',len(s))
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:list(pool.map(get,urls.items()))
