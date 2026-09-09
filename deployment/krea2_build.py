import json,pathlib,uuid,copy
p=pathlib.Path(__file__).parent
info=json.loads((p/'krea2-object-info.json').read_text())
def node(t,**i):return {'class_type':t,'inputs':i}
g={
 '1':node('UNETLoader',unet_name='krea2_turbo_int8_convrot.safetensors',weight_dtype='default'),
 '2':node('CLIPLoader',clip_name='qwen3vl_4b_fp8_scaled.safetensors',type='krea2',device='default'),
 '3':node('VAELoader',vae_name='qwen_image_vae.safetensors'),
 '4':node('CLIPTextEncode',clip=['2',0],text='Editorial portrait photograph of an adult woman with short curly auburn hair, freckles, green eyes, wearing a plain blue cotton jacket over a white shirt. Waist-up, looking at the camera, relaxed smile. Soft daylight, neutral gray studio background, realistic skin texture, sharp photograph.'),
 '5':node('CLIPTextEncode',clip=['2',0],text=''),
 '6':node('EmptySD3LatentImage',width=1024,height=1024,batch_size=1),
 '7':node('KSampler',model=['1',0],positive=['4',0],negative=['5',0],latent_image=['6',0],seed=20260908,steps=8,cfg=1.0,sampler_name='euler',scheduler='simple',denoise=1.0),
 '8':node('VAEDecode',samples=['7',0],vae=['3',0]),
 '9':node('SaveImage',images=['8',0],filename_prefix='Krea2/text-to-image')}
edit=copy.deepcopy(g)
edit['10']=node('LoadImage',image='krea2-identity-reference.png')
edit['11']=node('VAEEncode',pixels=['10',0],vae=['3',0])
edit['12']=node('LoraLoaderModelOnly',model=['1',0],lora_name='krea2_identity_edit_v1_2.safetensors',strength_model=1.0)
edit['13']=node('Krea2EditModelPatch',model=['12',0],source_latent=['11',0],vae=['3',0],source_image=['10',0],target_latent=['6',0],ref_boost=4.0,ref_boost_a=1.0,fit_mode='fit')
edit['4']=node('Krea2EditGroundedEncode',clip=['2',0],image=['10',0],prompt='Change her blue jacket to a bright red jacket. Preserve her face, hair, pose, white shirt, lighting and background.',grounding_px=768,system_prompt='')
edit['5']=node('Krea2EditGroundedEncode',clip=['2',0],image=['10',0],prompt='',grounding_px=768,system_prompt='')
edit['7']['inputs'].update(model=['13',0],steps=10)
edit['9']['inputs']['filename_prefix']='Krea2/identity-edit'
def ui(graph):
 nodes=[];links=[];idx={}
 pos={'1':[0,0],'2':[0,340],'3':[0,680],'4':[850,0],'5':[850,360],'6':[850,730],'7':[1280,0],'8':[1680,0],'9':[2090,0],'10':[410,0],'11':[410,400],'12':[410,740],'13':[850,1060]}
 for k,n in graph.items():
  spec=info[n['class_type']];widgets=[];ins=[]
  for group in ['required','optional']:
   for name,typ in spec['input'].get(group,{}).items():
    if name not in n['inputs']:continue
    v=n['inputs'][name];t=typ[0]
    if isinstance(v,list):ins.append({'name':name,'type':t,'link':None})
    else:
     widgets.append(v)
     if len(typ)>1 and typ[1].get('control_after_generate'):widgets.append('fixed')
  o={'id':int(k),'type':n['class_type'],'pos':pos[k],'size':[350,290],'flags':{},'order':len(nodes),'mode':0,'inputs':ins,'outputs':[{'name':name,'type':t,'links':[]} for name,t in zip(spec.get('output_name',spec['output']),spec['output'])],'properties':{'Node name for S&R':n['class_type']},'widgets_values':widgets}
  nodes.append(o);idx[k]=o
 for k,n in graph.items():
  for slot,i in enumerate(idx[k]['inputs']):
   src,ss=n['inputs'][i['name']];lid=len(links)+1
   links.append([lid,int(src),ss,int(k),slot,i['type']]);i['link']=lid;idx[src]['outputs'][ss]['links'].append(lid)
 return {'id':str(uuid.uuid4()),'revision':0,'last_node_id':max(map(int,graph)),'last_link_id':len(links),'nodes':nodes,'links':links,'groups':[],'config':{},'extra':{'ds':{'scale':.65,'offset':[40,40]}},'version':.4}
w=ui(g)
(p/'workflows'/'06 - Krea 2 - Text to image.json').write_text(json.dumps(w,indent=2))
ew=json.loads((p.parent/'research/krea2/edit-workflow.json').read_text())
for n in ew['nodes']:
 if n['id']==55:n['widgets_values'][0]=g['1']['inputs']['unet_name']
 if n['id']==71:n['widgets_values'][0]=edit['12']['inputs']['lora_name']
 if n['id']==72:n['widgets_values'][0]='krea2-identity-reference.png'
 if n['id']==84:n['widgets_values'][0]=edit['4']['inputs']['prompt']
 if n['id']==29:n['widgets_values'][0]='Krea2/identity-edit'
 if n['id']==53:n['widgets_values'][0:2]=[20260908,'fixed']
 if n['id']==100:n['widgets_values']=['Installed: Krea 2 Turbo INT8 ConvRot, Qwen3VL 4B FP8, Qwen Image VAE, full Identity Edit v1.2.']
(p/'workflows'/'07 - Krea 2 - Identity Edit.json').write_text(json.dumps(ui(edit),indent=2))
for name,graph in [('t2i',g),('edit',edit)]:
 (p/f'krea2-{name}-api.json').write_text(json.dumps(graph,indent=2))
print('Built two browser workflows and matching acceptance prompts')
