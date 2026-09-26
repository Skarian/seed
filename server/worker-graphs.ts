import type { ImageRequest } from "./workflows.js";
import type { PreparedReference } from "./media.js";
import { loraRoute } from "../shared/workflows.js";
export type GraphLora = {
  filename: string;
  sha256: string;
  strength_model: number;
};
type Graph = Record<
  string,
  { class_type: string; inputs: Record<string, any> }
>;
function withLoras(graph: Graph, loras: GraphLora[], base: string) {
  let model: [string, number] = [base, 0];
  loras.forEach((l, i) => {
    const key = String(30 + i);
    graph[key] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model,
        lora_name: l.filename,
        strength_model: l.strength_model,
      },
    };
    model = [key, 0];
  });
  return model;
}
export function graphFor(
  request: ImageRequest,
  id: string,
  seed: string,
  loras: GraphLora[],
  references: PreparedReference[] = [],
) {
  if(request.workflow==='image-to-image') return editGraph(request,id,seed,references);
  if (request.workflow !== "text-to-image")
    return videoGraph(request, id, seed, loras, references);
  const [width, height] =
    request.output.aspect === "16:9" ? [1280, 720] : [720, 1280];
  const graph: Record<
    string,
    { class_type: string; inputs: Record<string, unknown> }
  > = {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "krea2_turbo_int8_convrot.safetensors",
        weight_dtype: "default",
      },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen3vl_4b_fp8_scaled.safetensors",
        type: "krea2",
        device: "default",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: "qwen_image_vae.safetensors" },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: request.prompt },
    },
    "5": {
      class_type: "ConditioningZeroOut",
      inputs: { conditioning: ["4", 0] },
    },
    "6": {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
        seed: Number(seed),
        steps: 8,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1,
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["7", 0], vae: ["3", 0] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { images: ["8", 0], filename_prefix: "seed/" + id + "/image" },
    },
  };
  graph["7"]!.inputs.model = withLoras(graph, loras, "1");
  return graph;
}

function editGraph(request:ImageRequest,id:string,seed:string,refs:PreparedReference[]):Graph {
  if(!refs.length || refs[0]?.role!=='source')throw Error('A prepared source image is required.');
  const graph:Graph={
    '1':{class_type:'UNETLoader',inputs:{unet_name:'qwen_image_2.1_int8_convrot.safetensors',weight_dtype:'default'}},
    '2':{class_type:'CLIPLoader',inputs:{clip_name:'qwen3vl_8b_int8_convrot.safetensors',type:'qwen_image',device:'default'}},
    '3':{class_type:'VAELoader',inputs:{vae_name:'qwen_image_2.1_vae_bf16.safetensors'}},
    '4':{class_type:'TextEncodeQwenImage21',inputs:{clip:['2',0],vae:['3',0],prompt:request.prompt,negative_prompt:'',resolution:0}},
    '6':{class_type:'QwenImage21Cache',inputs:{model:['1',0],device:'auto',dtype:'default'}},
    '7':{class_type:'KSampler',inputs:{model:['6',0],positive:['4',0],negative:['4',1],latent_image:['4',2],seed:Number(seed),steps:25,cfg:1,sampler_name:'euler',scheduler:'simple',denoise:1}},
    '8':{class_type:'VAEDecode',inputs:{samples:['7',0],vae:['3',0]}},
    '9':{class_type:'SaveImage',inputs:{images:['8',0],filename_prefix:'seed/'+id+'/image'}},
  };
  refs.forEach((r,index)=>{const key=String(100+index);graph[key]={class_type:'SeedLoadEditImage',inputs:{image:'seed/'+id+'/'+r.filename}};graph['4']!.inputs['images.image_'+(index+1)]=[key,0];});
  return graph;
}

export function videoGraph(
  request: ImageRequest,
  id: string,
  seed: string,
  loras: GraphLora[],
  refs: PreparedReference[] = [],
) {
  const route = loraRoute(request);
  const seconds = request.output.duration_seconds!;
  const [width, height] =
    request.output.aspect === "16:9" ? [1344, 768] : [768, 1344];
  const graph: Record<
    string,
    { class_type: string; inputs: Record<string, any> }
  > = {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: `minimax_h3_${route}2va_pruned_int8_convrot.safetensors`,
        weight_dtype: "default",
      },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
        type: "minimax",
        device: "default",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" },
    },
    "4": {
      class_type: "VAELoader",
      inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" },
    },
    "6": {
      class_type:
        route === "ref" ? "MiniMaxH3ReferenceToVideo" : "MiniMaxH3ImageToVideo",
      inputs: {
        clip: ["2", 0],
        vae: ["3", 0],
        prompt: request.prompt,
        width,
        height,
        length: 17 * Math.ceil((seconds * 24 - 5) / 17) + 5,
        ...(route === "ref"
          ? { audio_vae: ["4", 0], ref_image_size: "match" }
          : {}),
      },
    },
    "7": {
      class_type: "BasicGuider",
      inputs: { model: ["19", 0], conditioning: ["6", 0] },
    },
    "8": { class_type: "RandomNoise", inputs: { noise_seed: Number(seed) } },
    "9": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "10": {
      class_type: "BasicScheduler",
      inputs: { model: ["19", 0], scheduler: "simple", steps: 8, denoise: 1 },
    },
    "11": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["8", 0],
        guider: ["7", 0],
        sampler: ["9", 0],
        sigmas: ["10", 0],
        latent_image: ["6", 1],
      },
    },
    "12": {
      class_type: "VAEDecode",
      inputs: { samples: ["11", 0], vae: ["3", 0] },
    },
    "13": {
      class_type: "VAEDecodeAudio",
      inputs: { samples: ["11", 0], vae: ["4", 0] },
    },
    "14": {
      class_type: "SeedVideoSave",
      inputs: {
        images: ["12", 0],
        audio: ["13", 0],
        seconds,
        filename_prefix: "seed/" + id + "/video",
        audio_mode: request.audio?.output ?? "generated",
        export_version: "native-v1",
      },
    },
  };
  {
    graph["16"] = {
      class_type: "MiniMaxH3SigmaShift",
      inputs: { model: ["1", 0], shift_video: 12, shift_audio: 3 },
    };
    graph["17"] = {
      class_type: "ModelAttentionBackend",
      inputs: {
        model: withLoras(graph, loras, "16"),
        attention: "comfy kitchen attention",
      },
    };
    // v0.35.0 DynamicCombo inputs use the flat API form, not its normalized Python dictionary.
    graph["19"] = {
      class_type: "BlockSparseAttention",
      inputs: {
        model: ["17", 0],
        selection: "sol-attn",
        "selection.tau": 1.3,
        start_percent: 0.2,
        end_percent: 1,
        dense_blocks: "",
        min_tokens: 12288,
        extra_tokens: 256,
        sink_conditioning: "exact_kv_and_rows",
        verbose: true,
      },
    };
    graph["7"]!.inputs.model = ["19", 0];
    graph["9"]!.inputs.sampler_name = "res_multistep";
    graph["10"]!.inputs.model = ["19", 0];
    graph["10"]!.inputs.steps = 30;
  }
  let node = 40,
    image = 0,
    video = 0,
    audio = 0;
  let positive: any = ["6", 0];
  for (const ref of refs) {
    const key = String(node++),
      filename = "seed/" + id + "/" + ref.filename;
    graph[key] = {
      class_type:
        ref.kind === "image"
          ? "LoadImage"
          : ref.kind === "audio"
            ? "LoadAudio"
            : "SeedLoadVideo",
      inputs: {
        [ref.kind === "image"
          ? "image"
          : ref.kind === "audio"
            ? "audio"
            : "filename"]: filename,
      },
    };
    if (ref.role === "first_frame" || ref.role === "last_frame") {
      if (route === "fl" && ref.role === "first_frame") {
        graph["6"]!.inputs.first_frame = [key, 0];
        continue;
      }
      const guide = String(node++);
      graph[guide] = {
        class_type: "MiniMaxH3AddGuide",
        inputs: {
          positive,
          latent: ["6", 1],
          vae: ["3", 0],
          image: [key, 0],
          frame_idx: ref.role === "first_frame" ? 0 : seconds * 24 - 1,
        },
      };
      positive = [guide, 0];
    } else if (ref.kind === "image")
      graph["6"]!.inputs["ref_images.ref_image_" + image++] = [key, 0];
    else if (ref.kind === "video") {
      graph["6"]!.inputs["ref_videos.ref_video_" + video] = [key, 0];
      if (ref.audio_filename) {
        const a = String(node++);
        graph[a] = {
          class_type: "LoadAudio",
          inputs: { audio: "seed/" + id + "/" + ref.audio_filename },
        };
        graph["6"]!.inputs["ref_video_audios.ref_video_audio_" + video] = [
          a,
          0,
        ];
      }
      video++;
    } else graph["6"]!.inputs["ref_audios.ref_audio_" + audio++] = [key, 0];
  }
  graph["7"]!.inputs.conditioning = positive;
  return graph;
}
