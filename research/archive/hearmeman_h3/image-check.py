import urllib.request,json,pathlib
root=pathlib.Path(__file__).resolve().parent
def fetch(url,headers={}):
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=40) as r:return json.load(r)
repo='hearmeman/comfyui-minimax-template'
token=fetch('https://auth.docker.io/token?service=registry.docker.io&scope=repository:'+repo+':pull')['token']
headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json'}
m=fetch('https://registry-1.docker.io/v2/'+repo+'/manifests/v8',headers)
if 'manifests' in m:
    d=next(x for x in m['manifests'] if x.get('platform',{}).get('architecture')=='amd64')['digest']
    m=fetch('https://registry-1.docker.io/v2/'+repo+'/manifests/'+d,headers)
c=fetch('https://registry-1.docker.io/v2/'+repo+'/blobs/'+m['config']['digest'],headers)
out={'config':c['config'],'created':c.get('created'),'history':[x.get('created_by') for x in c.get('history',[])],'compressed_layers_bytes':sum(x['size'] for x in m['layers'])}
(root/'image-config.json').write_text(json.dumps(out,indent=2))
print(json.dumps({k:v for k,v in out.items() if k!='history'},indent=2))
print('SSH-related image history:',[x for x in out['history'] if 'ssh' in x.lower()])
