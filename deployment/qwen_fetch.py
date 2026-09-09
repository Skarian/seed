import pathlib,json,urllib.request
p=pathlib.Path(__file__).parent.parent/'research/qwen-rapid'
p.mkdir(parents=True,exist_ok=True)
repo='https://huggingface.co/Phr00t/Qwen-Image-Edit-Rapid-AIO'
meta=json.load(urllib.request.urlopen('https://huggingface.co/api/models/Phr00t/Qwen-Image-Edit-Rapid-AIO'))
rev=meta['sha']
for name in ['Qwen-Rapid-AIO.json','README.md','fixed-textencode-node/nodes_qwen.v2.py']:
 data=urllib.request.urlopen(repo+'/resolve/'+rev+'/'+name).read()
 (p/pathlib.Path(name).name).write_bytes(data)
(p/'revision.txt').write_text(rev)
w=json.loads((p/'Qwen-Rapid-AIO.json').read_text())
print('REV',rev)
for n in w['nodes']:print(n['id'],n['type'],n.get('widgets_values'))
