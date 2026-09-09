import json, pathlib, time
from comfy import api
def node(t,**inputs):return {'class_type':t,'inputs':inputs}
p={
'1':node('UNETLoader',unet_name='minimax_h3_fl2va_pruned_int8_convrot.safetensors',weight_dtype='default'),
'2':node('CLIPLoader',clip_name='qwen3vl_32b_minimax_h3_int8_convrot.safetensors',type='minimax',device='default'),
'3':node('VAELoader',vae_name='minimax_h3_video_vae_fp16.safetensors'),
'4':node('VAELoader',vae_name='minimax_h3_audio_vae_fp32.safetensors'),
'5':node('LoraLoaderModelOnly',model=['1',0],lora_name='minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors',strength_model=0.8),
'6':node('MiniMaxH3ImageToVideo',clip=['2',0],vae=['3',0],prompt='A small red toy sailboat floats on a calm garden pond. Gentle ripples spread across the water. A slow cinematic camera push in, warm afternoon sunlight, realistic reflections. Audio: soft water ripples and birds chirping in the distance.',width=1344,height=768,length=124),
'7':node('BasicGuider',model=['5',0],conditioning=['6',0]),
'8':node('RandomNoise',noise_seed=42),
'9':node('KSamplerSelect',sampler_name='euler'),
'10':node('BasicScheduler',model=['5',0],scheduler='simple',steps=8,denoise=1.0),
'11':node('SamplerCustomAdvanced',noise=['8',0],guider=['7',0],sampler=['9',0],sigmas=['10',0],latent_image=['6',1]),
'12':node('VAEDecode',samples=['11',0],vae=['3',0]),
'13':node('VAEDecodeAudio',samples=['11',0],vae=['4',0]),
'14':node('VHS_VideoCombine',images=['12',0],audio=['13',0],frame_rate=24,loop_count=0,filename_prefix='H3_Acceptance/FL2VA_Turbo8',format='video/h264-mp4',pix_fmt='yuv420p',crf=18,save_metadata=True,trim_to_audio=False,pingpong=False,save_output=True),
}
root=pathlib.Path(__file__).parent
(root/'test-fl2va-api.json').write_text(json.dumps(p,indent=2))
if __name__=='__main__':
 r=api('/prompt',{'prompt':p,'client_id':'h3-acceptance'})
 (root/'generation-state.json').write_text(json.dumps({'fl2va':r,'submitted':time.time()},indent=2))
 print(r)
