import json,time
from test_generation import p,node,root
from comfy import api
p['1']['inputs']['unet_name']='minimax_h3_ref2va_pruned_int8_convrot.safetensors'
p['5']['inputs']['lora_name']='minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors'
p['6']=node('MiniMaxH3ReferenceToVideo',clip=['2',0],vae=['3',0],audio_vae=['4',0],prompt='The red toy sailboat in <Picture 1> glides slowly across a calm garden pond. Gentle ripples, warm afternoon sunlight, realistic reflections. Slow cinematic camera movement. Audio: soft water and distant birds.',width=1344,height=768,length=124,ref_image_size='match',**{'ref_images.ref_image_0':['15',0]})
p['15']=node('LoadImage',image='h3-test-reference.png')
p['14']['inputs']['filename_prefix']='H3_Acceptance/REF2VA_Turbo8'
(root/'test-ref2va-api.json').write_text(json.dumps(p,indent=2))
r=api('/prompt',{'prompt':p,'client_id':'h3-acceptance'})
(root/'ref-generation-state.json').write_text(json.dumps({'ref2va':r,'submitted':time.time()},indent=2))
print(r)
