import pathlib,remote
p=pathlib.Path(__file__).parent
for name in ['LEAN-SETUP.md','START-HERE.md']:
    remote.api('/api/contents/h3-deployment/'+name,'PUT',{'type':'file','format':'text','content':(p/name).read_text(encoding='utf-8')})
print('Operating guide saved on the network volume.')
