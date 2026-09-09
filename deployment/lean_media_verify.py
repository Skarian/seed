import subprocess,json
path='/workspace/ComfyUI/output/LeanAcceptance/replacement-h3_00001-audio.mp4'
r=subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_type,width,height,r_frame_rate:format=duration','-of','json',path],capture_output=True,text=True,check=True)
print(r.stdout)
