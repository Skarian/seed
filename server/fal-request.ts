import type { ImageRequest } from './workflows.js';
import type { LoraSelection } from './loras.js';

export function loraRoute(request: Pick<ImageRequest, 'workflow'> & {references?: Array<{role:string}>}) { return request.workflow === 'text-to-image' ? 'image' : request.workflow === 'reference-to-video' && !request.references?.some(r => r.role !== 'reference') ? 'ref' : 'fl'; }
export function falRequest(request: ImageRequest, seed: string, urls: Array<{ kind: string; role: string; url: string; audio_url?: string }> = [], loras: Array<LoraSelection & { path: string }> = []) {
  const input: Record<string, unknown> = { prompt: request.prompt.replace(/<(Picture|Video|Audio) (\d+)>/g, (_, kind: string, n: string) => `${kind === 'Picture' ? 'Image' : kind} ${n}`), seed: Number(seed), enable_safety_checker: request.mode === 'sfw', sync_mode: false };
  let endpoint: string;
  if (request.workflow === 'text-to-image') {
    endpoint = 'fal-ai/krea-2/turbo';
    Object.assign(input, { image_size: request.output.aspect === '16:9' ? { width: 1280, height: 720 } : { width: 720, height: 1280 }, num_images: 1, output_format: 'png', enable_prompt_expansion: false, acceleration: 'none' });
  } else {
    Object.assign(input, { duration: request.output.duration_seconds, resolution: '768P', prompt_expansion_mode: 'disabled' });
    if (request.workflow === 'text-to-video') { endpoint = 'minimax/h3/text-to-video'; input.aspect_ratio = request.output.aspect; }
    else if (loraRoute(request) === 'fl') {
      endpoint = 'minimax/h3/image-to-video';
      for (const ref of urls) input[ref.role === 'first_frame' ? 'image_url' : 'end_image_url'] = ref.url;
    } else {
      endpoint = 'minimax/h3/reference-to-video'; input.aspect_ratio = request.output.aspect;
      input.reference_image_urls = urls.filter(r => r.kind === 'image').map(r => r.url);
      input.reference_video_urls = urls.filter(r => r.kind === 'video').map(r => r.url);
      // Matches shared/reference-labels: video soundtracks precede standalone audio.
      input.reference_audio_urls = [...urls.flatMap(r => r.audio_url ? [r.audio_url] : []), ...urls.filter(r => r.kind === 'audio').map(r => r.url)];
    }
  }
  if (loras.length) { endpoint += '/lora'; input.loras = loras.map(l => ({ path: l.path, scale: l.scale })); }
  return { endpoint, input };
}
