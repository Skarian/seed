import urllib.request,urllib.error,json,pathlib
from comfy import ROOT,api
from remote import ROOT as ADMIN
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(NoRedirect)
results={}
for name,url in [('comfy_unauthenticated',ROOT+'/system_stats'),('jupyter_unauthenticated',ADMIN+'/api/status')]:
 try:
  r=opener.open(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}));results[name]={'status':r.status}
 except urllib.error.HTTPError as e:results[name]={'status':e.code,'location':e.headers.get('Location')}
results['authenticated_system_stats']=bool(api('/system_stats').get('devices'))
assert results['comfy_unauthenticated']['status']==302
assert results['jupyter_unauthenticated']['status']==403
assert results['authenticated_system_stats']
pathlib.Path(__file__).with_name('access-validation.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
