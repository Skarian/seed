"""Build the two native App mode workflows from our accepted H3 graph."""
import copy, json, pathlib, uuid, urllib.parse
import comfy, remote
P=pathlib.Path(__file__).parent
objects=comfy.api('/object_info')
base='/api/contents/ComfyUI/user/default/workflows/MiniMax Apps'
def put(path,data): return remote.api(urllib.parse.quote(path,safe='/'),'PUT',data)
try: remote.api(urllib.parse.quote(base,safe='/'))
except Exception: put(base,{'type':'directory'})

for animate in (False,True):
    name='02 - Animate an image' if animate else '01 - Create a video'
    source=P/'workflows'/('02 - Image to video - Turbo 8.json' if animate else '01 - Text to video - Turbo 8.json')
    w=json.loads(source.read_text()); w['id']=str(uuid.uuid5(uuid.NAMESPACE_URL,'neil-minimax-app/'+name))
    g=json.loads((P/'test-fl2va-api.json').read_text())
    if animate:
        g['15']={'class_type':'LoadImage','inputs':{'image':'h3-test-reference.png'}}
        g['18']={'class_type':'ImageScale','inputs':{'image':['15',0],'upscale_method':'lanczos','width':['16',0],'height':['16',1],'crop':'center'}}
        g['6']['inputs']['first_frame']=['18',0]
    g['16']={'class_type':'NeilH3Presets','inputs':{'format':'TikTok - Portrait 9:16 (720p)','duration':'5 seconds'}}
    for i,key in enumerate(('width','height','length')):g['6']['inputs'][key]=['16',i]
    g['17']={'class_type':'NeilH3Finish','inputs':{'images':['12',0],'audio':['13',0],'seconds':['16',3]}}
    g['14']['inputs'].update(images=['17',0],audio=['17',1],filename_prefix='MiniMax/'+name)
    prompt=('The scene in the starting image comes gently to life. Natural subtle movement, a slow camera push in. Audio: soft ambient sounds matching the scene.' if animate else 'A small red toy sailboat floats on a calm garden pond. Gentle ripples, warm afternoon sunlight, a slow camera push in. Audio: water ripples and distant birds.')
    g['6']['inputs']['prompt']=prompt
    nodes={n['id']:n for n in w['nodes']}
    for nid in ((16,17,18) if animate else (16,17)):
        typ=g[str(nid)]['class_type']; info=objects[typ]
        nodes[nid]={'id':nid,'type':typ,'pos':[750 if nid==16 else 2200,850], 'size':[360,160], 'flags':{},'order':nid,'mode':0,'inputs':[], 'outputs':[], 'properties':{'Node name for S&R':typ},'widgets_values':[]}
    # Rebuild graph links from the executable API graph; primitive inputs get widgets.
    links=[]
    for n in nodes.values():
        n['inputs']=[]; n['outputs']=[]
        info=objects[n['type']]
        for i,typ in enumerate(info.get('output',[])):
            n['outputs'].append({'name':info.get('output_name',info['output'])[i],'type':typ,'links':[]})
    for sid,api_node in g.items():
        n=nodes[int(sid)]; schema=objects[n['type']]['input']; specs={**schema.get('required',{}),**schema.get('optional',{})}
        widget_values=[]
        for key,val in api_node['inputs'].items():
            spec=specs.get(key)
            if not spec:continue # VHS format-dependent widgets are preserved below.
            typ=spec[0]; primitive=isinstance(typ,list) or typ in ('STRING','INT','FLOAT','BOOLEAN','COMBO')
            slot={'name':key,'type':'COMBO' if isinstance(typ,list) else typ,'link':None}
            if primitive:slot['widget']={'name':key}
            if isinstance(val,list) and len(val)==2 and str(val[0]) in g:
                lid=len(links)+1;slot['link']=lid
                origin=nodes[int(val[0])]; origin['outputs'][val[1]]['links'].append(lid)
                links.append([lid,int(val[0]),val[1],int(sid),len(n['inputs']),slot['type']])
                if primitive:widget_values.append(spec[1].get('default',0) if len(spec)>1 and isinstance(spec[1],dict) else 0)
            elif primitive:
                widget_values.append(val)
                if n['type']=='RandomNoise' and key=='noise_seed':widget_values.append('randomize')
            n['inputs'].append(slot)
        n['widgets_values']=widget_values
        if n['type']=='VHS_VideoCombine':n['widgets_values']={k:v for k,v in api_node['inputs'].items() if not isinstance(v,list)}
    selected=([(15,'image','Starting image')] if animate else [])+[(6,'prompt','Motion and sound' if animate else 'Describe your video'),(16,'format','Format'),(16,'duration','Duration'),(8,'noise_seed','Seed')]
    for nid,key,label in selected:
        next(x for x in nodes[nid]['inputs'] if x['name']==key)['label']=label
    w.update(nodes=list(nodes.values()),links=links,last_node_id=max(nodes),last_link_id=len(links))
    w.setdefault('extra',{}).update(linearMode=True,linearData={'inputs':[[f"{w['id']}:{nid}:{key}",key] for nid,key,_ in selected],'outputs':['14']})
    target=name+'.app.json'; (P/'workflows'/target).write_text(json.dumps(w,indent=2))
    (P/('minimax-'+('image' if animate else 'text')+'-api.json')).write_text(json.dumps(g,indent=2))
    put(base+'/'+target,{'type':'file','format':'text','content':json.dumps(w,indent=2)})
    print('Published',target)
