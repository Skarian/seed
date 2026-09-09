import sys,json,pathlib,urllib.parse
import remote,comfy
root=pathlib.Path('research/app-mode')
base='/api/contents/ComfyUI/user/default/workflows/'
def get(p):
 d=remote.api(urllib.parse.quote(base+p,safe='/'));return json.loads(d['content']) if isinstance(d['content'],str) else d['content']
report=[]
for src in sorted(root.glob('current-0[678]*.json')):
 name=src.name.removeprefix('current-'); original=json.loads(src.read_text())
 assert get('Neil Krea 2/'+name)==original,'Original changed'
 w=get('Krea Apps/'+name.replace('.json','.app.json'))
 assert w['extra']['linearMode'] is True
 assert all(k.startswith(w['id']+':') for k,_ in w['extra']['linearData']['inputs'])
 assert w['extra']['linearData']['outputs']==['9']
 def connections(graph):
  nodes={n['id']:n for n in graph['nodes']}
  return [(a,b,c,d,nodes[d]['inputs'][e]['name'],f) for a,b,c,d,e,f in graph['links']]
 assert connections(w)==connections(original),'Semantic graph connections changed'
 if name.startswith('08'):
  n=next(n for n in w['nodes'] if n['id']==10)
  assert n['mode']==0 and n['widgets_values']==['custom','1, 1, 1, 1, 1, 1, 1, 2.5, 5.0, 1.1, 4.0, 1.0',2.0,False]
  assert not any(':10:' in k for k,_ in w['extra']['linearData']['inputs'])
 report.append({'app':name,'id':w['id'],'inputs':w['extra']['linearData']['inputs'],'original_unchanged':True})
hist=comfy.api('/history?max_items=30'); runs=[]
for pid,h in hist.items():
 p=h['prompt'][2];seed=p.get('7',{}).get('inputs',{}).get('seed')
 if seed not in (20260981,20260982,20260983):continue
 assert h['status']['status_str']=='success'
 runs.append({'id':pid,'seed':seed,'status':h['status'],'outputs':h['outputs'],'prompt':p})
assert len({r['seed'] for r in runs})==3,'All three App tests must complete'
(root/'delivery-verification.json').write_text(json.dumps({'apps':report,'runs':runs},indent=2))
print(json.dumps({'apps':len(report),'successful_runs':len(runs),'outputs':[r['outputs'] for r in runs]},indent=2))
