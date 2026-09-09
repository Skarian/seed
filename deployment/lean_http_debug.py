import urllib.request,urllib.error
import comfy
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
o=urllib.request.build_opener(NoRedirect());o.addheaders=[('User-Agent','Mozilla/5.0')]
for path in ['/','/login','/login?next=%2F','/queue']:
 try:r=o.open(comfy.ROOT+path)
 except urllib.error.HTTPError as e:r=e
 print(path,r.status,r.headers.get('Location'),r.read(200).decode(errors='replace'))
