import remote,pathlib
p=pathlib.Path(__file__).parent
for name in ['krea2-assets.json','krea2-node-revision.txt','krea2_download.py']:
 remote.api('/api/contents/h3-deployment/'+name,'PUT',{'type':'file','format':'text','content':(p/name).read_text()})
remote.execute((p/'krea2_stage.py').read_text())
