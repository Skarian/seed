import pathlib,json,copy,uuid
p=pathlib.Path(__file__).parent
src=p.parent/'research/qwen-rapid'
w=json.loads((src/'Qwen-Rapid-AIO.json').read_text())
print('SOURCE LINKS',w['links'])
for n in w['nodes']:
 if n['type']=='LoadImage':print('SOURCE IMAGE',n['id'],n['outputs'])
fixed=(src/'nodes_qwen.v2.py').read_text().replace('TextEncodeQwenImageEditPlus','Phr00tTextEncodeQwenImageEditPlus').replace('TextEncodeQwenImageEdit"','Phr00tTextEncodeQwenImageEdit"')
(p/'qwen_rapid_nodes.py').write_text(fixed)
model='Qwen-Rapid-AIO-NSFW-v19.safetensors'
# Adapt the author's graph to one reference and a saved output.
w['nodes']=[n for n in w['nodes'] if n['id']!=8]
w['links']=[l for l in w['links'] if l[1]!=8 and l[3]!=8]
original_links={l[0] for l in w['links']}
for n in w['nodes']:
 for i in n.get('inputs',[]):
  if i.get('link') not in original_links:i['link']=None
for n in w['nodes']:
 if n['id']==1:
  n['widgets_values']=[model]
  n['properties']['models']=[{'name':model,'url':'https://huggingface.co/Phr00t/Qwen-Image-Edit-Rapid-AIO/resolve/'+(src/'revision.txt').read_text().strip()+'/v19/'+model,'directory':'checkpoints'}]
 if n['id']==7:n['widgets_values']=['krea2-identity-reference.png','image']
 if n['id']==9:n['widgets_values']=[1024,1024,1]
 if n['id']==2:n['widgets_values']=[20260908,'fixed',4,1.0,'euler_ancestral','beta',1.0]
 if n['id'] in (3,4):
  n['type']='Phr00tTextEncodeQwenImageEditPlus'
  n['properties']['Node name for S&R']=n['type']
  n['widgets_values']=['Change her blue jacket to a bright red jacket. Preserve her face, hair, pose, white shirt, lighting and background.' if n['id']==3 else '']
  for i in n['inputs']:
   if i.get('link') not in {l[0] for l in w['links']}:i['link']=None
  # Ensure the sole reference occupies image1 regardless of the old graph's layout.
  for l in w['links']:
   if l[1]==7 and l[3]==n['id']:
    for i in n['inputs']:
     if i.get('link')==l[0]:i['link']=None
    slot=next(j for j,i in enumerate(n['inputs']) if i['name']=='image1')
    l[4]=slot;n['inputs'][slot]['link']=l[0]
  lid=max(l[0] for l in w['links'])+1
  if not any(i['name']=='image4' for i in n['inputs']):n['inputs'].append({'name':'image4','type':'IMAGE','link':None})
  n['inputs'].append({'name':'target_latent','type':'LATENT','link':lid})
  w['links'].append([lid,9,0,n['id'],len(n['inputs'])-1,'LATENT'])
 if n['id']==6:
  n['type']='SaveImage';n['properties']['Node name for S&R']='SaveImage'
  n['widgets_values']=['QwenRapid/identity-edit-v19'];n['size']=[480,480]
for n in w['nodes']:
 for slot,o in enumerate(n.get('outputs',[])):o['links']=[l[0] for l in w['links'] if l[1]==n['id'] and l[2]==slot]
positions={1:[20,20],7:[20,240],9:[20,720],3:[440,20],4:[440,420],2:[910,20],5:[1320,20],6:[1680,20]}
for n in w['nodes']:
 n['pos']=positions[n['id']]
 n['size']=[400,300] if n['id'] in (3,4) else [340,180]
 if n['id']==7:n['size']=[360,400]
 if n['id']==2:n['size']=[350,480]
 if n['id']==6:n['size']=[520,600]
w['extra']={'ds':{'scale':0.65,'offset':[30,50]},'source':'https://huggingface.co/Phr00t/Qwen-Image-Edit-Rapid-AIO','source_revision':(src/'revision.txt').read_text().strip()}
w['id']=str(uuid.uuid4());w['last_link_id']=max(l[0] for l in w['links'])
out=p/'workflows/10 - Qwen Rapid AIO v19 - Image Edit.json'
out.write_text(json.dumps(w,indent=2))
g={}
info=json.loads((p/'qwen-object-info.json').read_text())
for n in w['nodes']:
 t=n['type'];inputs={}
 for i in n.get('inputs',[]):
  if i.get('link') is not None:
   l=next(l for l in w['links'] if l[0]==i['link']);inputs[i['name']]=[str(l[1]),l[2]]
 vals=iter(n.get('widgets_values',[]))
 spec=info.get(t,info['TextEncodeQwenImageEditPlus'])
 for group in ('required','optional'):
  for name,typ in spec['input'].get(group,{}).items():
   if name in inputs:continue
   if isinstance(typ[0],list) or typ[0] in ('STRING','INT','FLOAT','BOOLEAN'):
    inputs[name]=next(vals)
    if len(typ)>1 and typ[1].get('control_after_generate'):next(vals)
 g[str(n['id'])]={'class_type':t,'inputs':inputs}
(p/'qwen-edit-api.json').write_text(json.dumps(g,indent=2))
print('BUILT',out)
