import pathlib,os,signal,subprocess,time
matches=[]
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:args=(p/'cmdline').read_bytes().split(b'\0')
 except OSError:continue
 if b'/ComfyUI/main.py' in args:matches.append((int(p.name),[a.decode() for a in args if a]))
assert len(matches)==1,matches
pid,args=matches[0]
os.kill(pid,signal.SIGTERM)
for _ in range(40):
 if not pathlib.Path('/proc',str(pid)).exists():break
 time.sleep(.25)
log=open('/workspace/h3-deployment/krea2-comfy.log','a')
p=subprocess.Popen(args,cwd='/ComfyUI',stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
print('RESTARTED COMFY',p.pid)
