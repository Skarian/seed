import json,pathlib,copy,uuid,base64
root=pathlib.Path(__file__).parent
info=json.loads((root/'object_info.json').read_text())
base=json.loads((root/'test-fl2va-api.json').read_text())
ref=json.loads((root/'test-ref2va-api.json').read_text())
def ui(prompt):
 nodes=[]; links=[]; index={}
 positions={'1':[20,20],'2':[20,250],'3':[20,450],'4':[20,600],'5':[390,20],'6':[770,200],'7':[1160,40],'8':[770,650],'9':[1160,500],'10':[1160,300],'11':[1530,200],'12':[1890,100],'13':[1890,330],'14':[2250,150],'15':[380,500]}
 for key,n in prompt.items():
  spec=info[n['class_type']]; ins=[]; widgets=[]
  for group in ['required','optional']:
   for name,typ in spec['input'].get(group,{}).items():
    if name not in n['inputs']:continue
    value=n['inputs'][name];t=typ[0]
    if isinstance(value,list) and len(value)==2 and str(value[0]) in prompt and isinstance(value[1],int):
     ins.append({'name':name,'type':t if isinstance(t,str) else 'COMBO','link':None});continue
    widgets.append(value)
    if len(typ)>1 and isinstance(typ[1],dict) and typ[1].get('control_after_generate'):widgets.append('fixed')
  for name,value in n['inputs'].items():
   if '.' in name: ins.append({'name':name,'type':'IMAGE','link':None})
  if n['class_type']=='VHS_VideoCombine': widgets={k:v for k,v in n['inputs'].items() if not isinstance(v,list)}
  out=[{'name':name,'type':t,'links':[]} for name,t in zip(spec.get('output_name',spec['output']),spec['output'])]
  obj={'id':int(key),'type':n['class_type'],'pos':positions[key],'size':[330,310 if key=='6' else 190],'flags':{},'order':len(nodes),'mode':0,'inputs':ins,'outputs':out,'properties':{'Node name for S&R':n['class_type']},'widgets_values':widgets}
  if key=='6': obj['size']=[360,430]
  if key=='14':obj['size']=[450,500]
  nodes.append(obj);index[key]=obj
 for key,n in prompt.items():
  for slot,i in enumerate(index[key]['inputs']):
   value=n['inputs'][i['name']];src,srcslot=str(value[0]),value[1];lid=len(links)+1
   links.append([lid,int(src),srcslot,int(key),slot,i['type']]);i['link']=lid;index[src]['outputs'][srcslot]['links'].append(lid)
 return {'id':str(uuid.uuid4()),'revision':0,'last_node_id':max(int(k) for k in prompt),'last_link_id':len(links),'nodes':nodes,'links':links,'groups':[],'config':{},'extra':{'ds':{'scale':0.65,'offset':[40,40]}},'version':0.4}
workflows={}
for name,p in [('01 - Text to video - Turbo 8',base),('02 - Image to video - Turbo 8',copy.deepcopy(base)),('03 - Reference to video - Turbo 8',ref),('04 - Text to video - Standard 20',copy.deepcopy(base)),('05 - Reference to video - Standard 20',copy.deepcopy(ref))]:
 if name.startswith('02'):
  p['15']={'class_type':'LoadImage','inputs':{'image':'h3-test-reference.png'}};p['6']['inputs']['first_frame']=['15',0]
 if 'Standard' in name:
  p['5']['inputs']['strength_model']=0.0;p['10']['inputs']['steps']=20
 p['14']['inputs']['filename_prefix']='H3/'+name
 workflows[name+'.json']=ui(p)
out=root/'workflows';out.mkdir(exist_ok=True)
for name,w in workflows.items():(out/name).write_text(json.dumps(w,indent=2))
code='import pathlib,json\nroot=pathlib.Path("/workspace/ComfyUI/user/default/workflows/Neil H3");root.mkdir(parents=True,exist_ok=True)\n'
code+='workflows='+repr(workflows)+'\nfor name,w in workflows.items(): (root/name).write_text(json.dumps(w,indent=2))\nprint("Saved",len(workflows),"ready workflows")\n'
(root/'install_workflows.py').write_text(code)
