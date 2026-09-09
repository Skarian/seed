import json, pathlib, sys, uuid, urllib.parse, copy
import remote, comfy

root=pathlib.Path('research/app-mode')
base='/api/contents/ComfyUI/user/default/workflows'
def path(s):return urllib.parse.quote(s,safe='/')
def put(s,data):return remote.api(path(s),'PUT',data)
def mkdir(s):
    try:remote.api(path(s))
    except Exception:put(s,{'type':'directory'})
mkdir(base+'/Krea Apps')
mkdir(base+'/Backups/App mode originals')
objects=comfy.api('/object_info')
for source in sorted(root.glob('current-0[678]*.json')):
    original=json.loads(source.read_text())
    name=source.name.removeprefix('current-')
    put(base+'/Backups/App mode originals/'+name,{'type':'file','format':'text','content':json.dumps(original,indent=2)})
    w=copy.deepcopy(original); w['id']=str(uuid.uuid4())
    edit=name.startswith('07')
    # Three-element tuples for each selected widget.
    selected=([(10,'image','Reference image')] if edit else [])+[(4,'prompt' if edit else 'text','Edit prompt' if edit else 'Prompt'),(6,'width','Width (px)'),(6,'height','Height (px)'),(7,'seed','Seed')]
    labels={(nid,key):label for nid,key,label in selected}
    for n in w['nodes']:
        inputs=n.setdefault('inputs',[])
        schema=objects[n['type']]['input']
        for section in ('required','optional'):
            for key,spec in schema.get(section,{}).items():
                typ=spec[0]
                if isinstance(typ,list) or typ in ('STRING','INT','FLOAT','BOOLEAN'):
                    slot=next((i for i in inputs if i['name']==key),None)
                    if slot is None:
                        slot={'name':key,'localized_name':key,'type':'COMBO' if isinstance(typ,list) else typ,'widget':{'name':key},'link':None}; inputs.append(slot)
                    if (n['id'],key) in labels:slot['label']=labels[(n['id'],key)]
    w.setdefault('extra',{}).update(linearMode=True,linearData={'inputs':[[f"{w['id']}:{nid}:{key}",key] for nid,key,_ in selected],'outputs':['9']})
    target=name.replace('.json','.app.json')
    put(base+'/Krea Apps/'+target,{'type':'file','format':'text','content':json.dumps(w,indent=2)})
    (root/target).write_text(json.dumps(w,indent=2))
    print(target,w['id'])
