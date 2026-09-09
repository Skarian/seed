import pathlib,json,secrets,base64
p=pathlib.Path(__file__).parent
cred=p/'access.private.json'
if not cred.exists():
    cred.write_text(json.dumps({'username':'neil','password':secrets.token_urlsafe(30),'jupyter_token':secrets.token_urlsafe(36)},indent=2))
c=json.loads(cred.read_text())
payload={'name':'Neil H3 - Hearmeman v8 secured','imageName':'hearmeman/comfyui-minimax-template@sha256:5b01d3f62ce157792bd6aab4bef0b7c6b4c95b1b37ed4d9e3454f898e1bcca15','containerDiskInGb':150,'volumeInGb':10,'volumeMountPath':'/workspace','ports':['8080/http','8888/http'],'isServerless':False,'env':{'JUPYTER_TOKEN':c['jupyter_token'],'H3_UI_PASSWORD':c['password'],'H3_BOOTSTRAP_B64':base64.b64encode((p/'bootstrap.sh').read_bytes()).decode(),'download_minimax_h3':'true','minimax_quant':'int8','COMFYUI_VERSION':'approved','PERSIST_MODELS_TO_VOLUME':'true'},'dockerStartCmd':['bash -c \'echo "$H3_BOOTSTRAP_B64" | base64 -d > /tmp/h3-bootstrap.sh && exec bash /tmp/h3-bootstrap.sh\''],'readme':'Stock Hearmeman H3 v8 with Jupyter form sign-in for ComfyUI on 8080 and token-protected Jupyter on 8888. REQUIRED: attach neil-h3-models network volume at /workspace before deployment. Both pruned INT8 modes. 100 GB persistent volume separate from temporary container disk.'}
(p/'template.private.json').write_text(json.dumps(payload,indent=2))
print(json.dumps(payload))
