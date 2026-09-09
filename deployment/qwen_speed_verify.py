import remote,pathlib
p=pathlib.Path(__file__).parent
remote.api('/api/contents/h3-deployment/qwen_download.py','PUT',{'type':'file','format':'text','content':(p/'qwen_download.py').read_text()})
remote.execute('''import pathlib,os,signal,subprocess
p=pathlib.Path('/proc/19198/cmdline')
if p.exists() and b'/workspace/h3-deployment/qwen_download.py' in p.read_bytes():os.kill(19198,signal.SIGTERM)
log=open('/workspace/h3-deployment/qwen-download.log','a')
proc=subprocess.Popen(['python3','/workspace/h3-deployment/qwen_download.py'],stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
print('VERIFICATION PID',proc.pid)
''')
