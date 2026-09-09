import os,pathlib,sys,json
root=pathlib.Path(__file__).resolve().parent
os.environ['COMFYUI_RUNTIME_DIR']=str(root/'runtime')
os.environ['PYTHONUTF8']='1'
p=root/'template/tools/test_provisioner.py'
sys.path.insert(0,str(p.parent))
s=p.read_text().replace('l.split("\\t")[1].rsplit("/", 1)[1]', 'Path(l.split("\\t")[1]).name')
print('Harness adaptation only: parse destination basename with pathlib for Windows.')
exec(compile(s,str(p),'exec'),{'__file__':str(p),'__name__':'audit_test'})
namespace={'__file__':str(p),'__name__':'audit_test'}
exec(compile(s,str(p),'exec'),namespace)
namespace['main']()
a=json.loads((root/'verified-assets.json').read_text())
print('Total asset bytes:',sum(x['bytes'] for x in a))
