import copy, json, pathlib, uuid
import comfy, remote

ROOT = pathlib.Path(__file__).parent
SOURCE = ROOT.parent / 'research/krea2/rebalance'
WEIGHTS = '1, 1, 1, 1, 1, 1, 1, 2.5, 5.0, 1.1, 4.0, 1.0'
info = comfy.api('/object_info')
assert 'ConditioningKrea2Rebalance' in info
files = {}
for old, new, mode in [
    ('06 - Krea 2 - Text to image', '08 - Krea 2 - Text to image - Rebalanced', 't2i'),
    ('07 - Krea 2 - Identity Edit', '09 - Krea 2 - Identity Edit - Rebalanced', 'edit'),
]:
    w = json.loads((SOURCE / (old + '.json')).read_text(encoding='utf-8'))
    w['id'] = str(uuid.uuid4())
    w['revision'] = 0
    nid = max(n['id'] for n in w['nodes']) + 1
    lid = max(l[0] for l in w['links']) + 1
    sampler = next(n for n in w['nodes'] if n['type'] == 'KSampler')
    positive_slot = next(i for i, v in enumerate(sampler['inputs']) if v['name'] == 'positive')
    link = next(l for l in w['links'] if l[0] == sampler['inputs'][positive_slot]['link'])
    link[3:5] = [nid, 0]
    sampler['inputs'][positive_slot]['link'] = lid
    w['links'].append([lid, nid, 0, sampler['id'], positive_slot, 'CONDITIONING'])
    for n in w['nodes']:
        if n['pos'][0] >= 1280:
            n['pos'][0] += 480
        if n['id'] == 4:
            n['title'] = 'PROMPT - Describe your image' if mode == 't2i' else 'EDIT PROMPT - Describe the change'
        if n['type'] == 'SaveImage':
            n['widgets_values'][0] = 'Krea2/rebalanced-' + mode
    w['nodes'].append({
        'id': nid, 'type': 'ConditioningKrea2Rebalance',
        'title': 'POST-PROMPT REBALANCER - Weights and multiplier',
        'pos': [1280, 0], 'size': [440, 240], 'flags': {},
        'order': len(w['nodes']), 'mode': 0,
        'inputs': [{'name': 'conditioning', 'type': 'CONDITIONING', 'link': link[0]}],
        'outputs': [{'name': 'conditioning', 'type': 'CONDITIONING', 'links': [lid]}],
        'properties': {'Node name for S&R': 'ConditioningKrea2Rebalance'},
        'widgets_values': ['custom', WEIGHTS, 2.0, False],
        'color': '#323', 'bgcolor': '#535',
    })
    w['last_node_id'], w['last_link_id'] = nid, lid
    # Verify every link matches both endpoints, including the rerouted positive edge.
    by_id = {n['id']: n for n in w['nodes']}
    for l in w['links']:
        assert l[0] in by_id[l[1]]['outputs'][l[2]]['links']
        assert by_id[l[3]]['inputs'][l[4]]['link'] == l[0]
    files[new + '.json'] = w
    (ROOT / 'workflows' / (new + '.json')).write_text(json.dumps(w, indent=2))
    # Construct acceptance graph from the copy itself, including its widget values.
    graph = {}
    links = {l[0]: l for l in w['links']}
    for n in w['nodes']:
        spec = info[n['type']]
        inputs, wi = {}, 0
        sockets = {v['name']: v for v in n['inputs']}
        for group in ['required', 'optional']:
            for name, typ in spec['input'].get(group, {}).items():
                if name in sockets:
                    edge = links[sockets[name]['link']]
                    inputs[name] = [str(edge[1]), edge[2]]
                elif wi < len(n.get('widgets_values', [])) and (isinstance(typ[0], list) or typ[0] in ['STRING', 'FLOAT', 'INT', 'BOOLEAN']):
                    inputs[name] = n['widgets_values'][wi]
                    wi += 1
                    if len(typ) > 1 and typ[1].get('control_after_generate'):
                        wi += 1
        graph[str(n['id'])] = {'class_type': n['type'], 'inputs': inputs}
    (ROOT / f'rebalance-{mode}-api.json').write_text(json.dumps(graph, indent=2))

remote.execute('import pathlib,json\np=pathlib.Path("/workspace/ComfyUI/user/default/workflows/Neil Krea 2")\nfiles=' + repr(files) + '\nfor n,d in files.items():\n assert not (p/n).exists(), "Copy already exists"\n (p/n).write_text(json.dumps(d,indent=2))\nprint("Created",list(files))')
print('Saved and validated both workflow copies')
