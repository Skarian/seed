import {it,expect} from 'vitest';
import {imageRequest} from '../server/workflows.js';
import {falRequest} from '../server/fal-request.js';
const base={workflow:'text-to-video',prompt:'A forest',mode:'sfw',output:{aspect:'16:9',size:'768p',duration_seconds:5}};
it('pins standard H3, native resolution and prompt expansion off',()=>{
 const mapped=falRequest(imageRequest(base),'42');expect(mapped.endpoint).toBe('minimax/h3/text-to-video');expect(mapped.input).toMatchObject({resolution:'768P',prompt_expansion_mode:'disabled',seed:42,enable_safety_checker:true});
 expect(()=>imageRequest({...base,quality:"fast"})).toThrow('Unknown setting');
});
it('maps end-only guides to I2V and rejects mixed routes',()=>{
 const ref={id:'last',asset_id:'a',kind:'image',role:'last_frame'};
 const request=imageRequest({...base,workflow:'reference-to-video',references:[ref]});
 const mapped=falRequest(request,'42',[{kind:'image',role:'last_frame',url:'https://example.com/end.png'}]);expect(mapped.endpoint).toBe('minimax/h3/image-to-video');expect(mapped.input.end_image_url).toBe('https://example.com/end.png');
 expect(()=>imageRequest({...request,references:[ref,{...ref,id:'r',role:'reference'}]})).toThrow('either reference');
});
it('preserves audio slot order and translates prompt labels',()=>{
 const refs=[{id:'audio',asset_id:'a',kind:'audio',role:'reference',range:{start_seconds:0,duration_seconds:3}},{id:'video',asset_id:'v',kind:'video',role:'reference',include_audio:true,range:{start_seconds:0,duration_seconds:3}}];
 const request=imageRequest({...base,workflow:'reference-to-video',mode:'nsfw',references:refs,prompt:'Use <Video 1>, soundtrack <Audio 1> and <Audio 2>'});
 const mapped=falRequest(request,'42',[{kind:'audio',role:'reference',url:'audio'},{kind:'video',role:'reference',url:'video',audio_url:'soundtrack'}]);
 expect(mapped.input.reference_audio_urls).toEqual(['soundtrack','audio']);expect(mapped.input.prompt).toBe('Use Video 1, soundtrack Audio 1 and Audio 2');expect(mapped.input.loras).toBeUndefined();
 const adapted=falRequest(request,'42',[],[{id:'adapter',revision:'v1',scale:0.7,path:'https://example.com/lora'}]);expect(adapted.endpoint).toMatch(/\/lora$/);expect(adapted.input.loras).toEqual([{path:'https://example.com/lora',scale:0.7}]);
});
