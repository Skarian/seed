import {describe,it,expect} from 'vitest';
import {validateToolCall} from '@earendil-works/pi-ai';
import {prepareToolRequest,compileStablePrompt,toolInputLabels,requestToolResultError,requestToolSchemas,requestToolRules,ToolRequestError,type RequestToolContext} from '../server/chat/request-tools.js';
import {imageRequest} from '../server/workflows.js';
import {VideoRequestError} from '../server/video.js';
const context:RequestToolContext={workflow:'reference-to-video',mode:'sfw',assets:[
  {handle:'image1',asset_id:'image-a',kind:'image'},
  {handle:'image2',asset_id:'image-b',kind:'image'},
  {handle:'video1',asset_id:'video-a',kind:'video',duration_seconds:10},
  {handle:'audio1',asset_id:'audio-a',kind:'audio',duration_seconds:8}
]};
const base={prompt:'<Picture 1> speaks in <Video 1>.',inputs:[{asset:'image1'},{asset:'video1',start_seconds:0,duration_seconds:3,include_audio:true}]};
const previous=()=>prepareToolRequest(context,base);
describe('simple request adapter',()=>{
  it('supports every canonical configurable setting and generates ids from supplied handles',()=>{
    const result=prepareToolRequest(context,{...base,prompt:'<Picture 1> speaks.',batch_size:3,seed:'42',aspect_ratio:'9:16',size:'768p',duration_seconds:15,audio_output:'silent',note:'Save this note'});
    expect(result).toMatchObject({count:3,seed:'42',note:'Save this note',output:{aspect:'9:16',size:'768p',duration_seconds:15,format:'video'},audio:{output:'silent'},references:[{id:'image1',asset_id:'image-a',kind:'image',role:'reference'},{id:'video1',kind:'video',range:{start_seconds:0,duration_seconds:3}}]});
  });
  it('edits one duration without losing aspect,size,inputs,note,or source settings',()=>{
    const original={...previous(),note:'keep'};const copy=structuredClone(original);
    const result=prepareToolRequest({...context,previous:original},{request_id:'card',duration_seconds:9});
    expect(result).toEqual({...original,output:{...original.output,duration_seconds:9}});expect(original).toEqual(copy);
  });
  it('updates a single input property while keeping other input fields by id',()=>{
    const original=previous();const result=prepareToolRequest({...context,previous:original},{inputs:[{id:'image1'},{id:'video1',duration_seconds:4}]});
    expect(result.references![1]).toEqual({...original.references![1],range:{start_seconds:0,duration_seconds:4}});
  });
  it('remaps unchanged prompt by input identity on reorder and rejects removed mentioned input',()=>{
    const original=prepareToolRequest(context,{prompt:'<Picture 1> meets <Picture 2>.',inputs:[{asset:'image1'},{asset:'image2'}]});
    expect(prepareToolRequest({...context,previous:original},{inputs:[{id:'image2'},{id:'image1'}]}).prompt).toBe('<Picture 2> meets <Picture 1>.');
    expect(()=>prepareToolRequest({...context,previous:original},{inputs:[{id:'image2'}]})).toThrow('no longer has the same input');
  });
  it('validates a simultaneous prompt and input edit against the final inputs',()=>{
    const original=previous();const result=prepareToolRequest({...context,previous:original},{prompt:'<Picture 1> walks.',inputs:[{id:'image1'}]});
    expect(result.references).toHaveLength(1);expect(result.prompt).toBe('<Picture 1> walks.');
  });
  it('reports independent role,clip,and quality problems together without irrelevant revise advice',()=>{
    try{prepareToolRequest(context,{prompt:'Scene.',size:'720p',inputs:[{asset:'video1',role:'first_frame',duration_seconds:1}]});throw Error('expected rejection');}
    catch(error){const result=requestToolResultError(error,'create');expect(result.saved).toBe(false);expect(result.errors.map(e=>e.field)).toEqual(expect.arrayContaining(['inputs[0].role','inputs[0].start_seconds','inputs[0].duration_seconds','size']));expect(result.next_action).toContain('No request was created');expect(JSON.stringify(result)).not.toContain('operation revise');}
  });
  it('rejects unknown inputs, invented ids, numeric strings and clips exceeding source',()=>{
    for(const input of [{asset:'Picture 1'},{asset:'video1',id:'invented',start_seconds:0,duration_seconds:3},{asset:'video1',start_seconds:'0',duration_seconds:3},{asset:'video1',start_seconds:9,duration_seconds:3}])expect(()=>prepareToolRequest(context,{prompt:'Scene.',inputs:[input]})).toThrow();
  });
  it('rejects duplicate handle but permits distinct instances of the same asset',()=>{
    expect(()=>prepareToolRequest(context,{prompt:'Scene.',inputs:[{asset:'video1',start_seconds:0,duration_seconds:3},{asset:'video1',start_seconds:4,duration_seconds:3}]})).toThrow('already used');
    const expanded={...context,assets:[...context.assets,{...context.assets[2]!,handle:'clip2'}]};
    const result=prepareToolRequest(expanded,{prompt:'<Video 1> then <Video 2>.',inputs:[{asset:'video1',start_seconds:0,duration_seconds:3},{asset:'clip2',start_seconds:4,duration_seconds:3}]});
    expect(result.references!.map(r=>r.id)).toEqual(['video1','clip2']);
    expect(prepareToolRequest({...expanded,previous:result},{inputs:[{id:'video1'},{id:'clip2',duration_seconds:2}]}).references![1]!.range!.duration_seconds).toBe(2);
  });
  it('clears note explicitly and invalidates saved output seeds only for seed/batch edits',()=>{
    const original={...previous(),note:'old',resolved_seeds:['4']};
    expect(prepareToolRequest({...context,previous:original},{note:''}).note).toBeUndefined();
    expect(prepareToolRequest({...context,previous:original},{duration_seconds:7}).resolved_seeds).toEqual(['4']);
    expect(prepareToolRequest({...context,previous:original},{batch_size:2}).resolved_seeds).toBeUndefined();
  });
  it('text-only workflows reject input settings instead of discarding them',()=>{
    for(const workflow of ['text-to-image','text-to-video'] as const){const c={...context,workflow};expect(prepareToolRequest(c,{prompt:'Scene.'}).workflow).toBe(workflow);expect(()=>prepareToolRequest(c,{...base})).toThrow('Unknown setting');}
  });
});
describe('stable prompt experiment',()=>{
  it('compiles instance tokens and soundtrack channels with exact audio numbering',()=>{
    const refs=prepareToolRequest(context,{...base,inputs:[...base.inputs,{asset:'audio1',start_seconds:0,duration_seconds:2}]}).references!;
    expect(compileStablePrompt('[[image1]] in [[video1]], using [[video1:audio]] and [[audio1]].',refs)).toBe('<Picture 1> in <Video 1>, using <Audio 1> and <Audio 2>.');
    expect(toolInputLabels(refs).get('audio1')).toBe('<Audio 2>');
  });
  it('does not invent a Picture label for mixed-route opening guides',()=>{
    const refs=previous().references!.map(r=>r.kind==='image'?{...r,role:'first_frame' as const}:r);
    expect(compileStablePrompt('Use [[image1]] and [[video1]].',refs)).toBe('Use the opening-frame guide and <Video 1>.');
    expect(compileStablePrompt('End at [[image1]].',[{...refs[0]!,role:'last_frame'},refs[1]!])).toBe('End at the ending-frame guide.');
    expect(compileStablePrompt('[[image1]]',[refs[0]!])).toBe('<Picture 1>');
  });
  it('rejects raw provider labels, missing tokens, and malformed tokens',()=>{
    for(const prompt of ['<Picture 1>','[[missing]]','[[image1]'])expect(()=>compileStablePrompt(prompt,previous().references!)).toThrow(ToolRequestError);
  });
  it('rejects a shared source token after naming clips and reports only actual instance tokens',()=>{
    const refs=prepareToolRequest(context,{prompt:'Scene.',inputs:[
      {asset:'video1',instance:'clipA',start_seconds:0,duration_seconds:2,include_audio:true},
      {asset:'video1',instance:'clipB',start_seconds:4,duration_seconds:2,include_audio:false}
    ]}).references!;
    expect(()=>compileStablePrompt('[[clipA]] then [[clipB]], excluding colors from [[video1]].',refs)).toThrow('Available prompt tokens: [[clipA:audio]], [[clipA]], [[clipB]].');
    try{compileStablePrompt('[[video1]]',refs);}catch(error){
      const fix=(error as ToolRequestError).issues[0]!.fix!;
      expect(fix).toContain('shared source in plain words');expect(fix).not.toContain('include_audio');
    }
    expect(compileStablePrompt('[[clipA]] then [[clipB]], excluding colors from the source video.',refs)).toBe('<Video 1> then <Video 2>, excluding colors from the source video.');
    expect(()=>compileStablePrompt('[[clipB:audio]]',refs)).toThrow('That video soundtrack is excluded');
    expect(requestToolRules('stable')).toContain('never selects one clip or adds the whole video');
  });
  it('compiles a known shared video source without selecting one of its clips',()=>{
    const original=prepareToolRequest({...context,referenceMode:'stable'},{prompt:'[[clipA]] then [[clipB]]. Exclude colors from [[video1]].',inputs:[
      {asset:'video1',instance:'clipA',start_seconds:0,duration_seconds:2,include_audio:true},
      {asset:'video1',instance:'clipB',start_seconds:4,duration_seconds:2,include_audio:false}
    ]});
    expect(original.prompt).toBe('<Video 1> then <Video 2>. Exclude colors from the source video shared by <Video 1> and <Video 2>.');
    expect(original.references).toHaveLength(2);
    const refs=original.references!;
    expect(()=>compileStablePrompt('[[video1:audio]]',refs,context.assets)).toThrow('not available');
    expect(()=>compileStablePrompt('[[invented]]',refs,context.assets)).toThrow('not available');
    expect(()=>compileStablePrompt('[[video1]]',refs.slice(0,1),context.assets)).toThrow('not available');
    const ambiguousAssets=[...context.assets,{handle:'video1',asset_id:'other-video',kind:'video' as const}];
    expect(()=>compileStablePrompt('[[video1]]',refs,ambiguousAssets)).toThrow('not available');
    expect(compileStablePrompt('[[video1]]',[{...refs[0]!,id:'video1'},refs[1]!],context.assets)).toBe('<Video 1>');
    const reordered=prepareToolRequest({...context,referenceMode:'stable',previous:original},{inputs:[{id:'clipB'},{id:'clipA'}]});
    expect(reordered.prompt).toBe('<Video 2> then <Video 1>. Exclude colors from the source video shared by <Video 2> and <Video 1>.');
    expect(()=>prepareToolRequest({...context,referenceMode:'stable',previous:original},{inputs:[{id:'clipA'}]})).toThrow('no longer has the same input');
  });
  it('compiles supplied edits once and preserves canonical prompt on settings-only edit',()=>{
    const original=prepareToolRequest({...context,referenceMode:'stable'},{...base,prompt:'[[image1]] in [[video1]].'});
    expect(original.prompt).toBe('<Picture 1> in <Video 1>.');
    expect(prepareToolRequest({...context,referenceMode:'stable',previous:original},{duration_seconds:8}).prompt).toBe(original.prompt);
  });
});
it('canonical video errors remain useful without the agent adapter',()=>{
  try{imageRequest({workflow:'reference-to-video',mode:'sfw',prompt:'Scene.',output:{aspect:'16:9',size:'720p',duration_seconds:5},references:[{id:'v',asset_id:'v',kind:'video',role:'first_frame'}]});throw Error('expected rejection');}
  catch(error){expect(error).toBeInstanceOf(VideoRequestError);expect((error as VideoRequestError).issues.map(i=>i.field)).toEqual(expect.arrayContaining(['output.size','references[0].role','references[0].range']));}
});

describe('provider-readable enums and input instance contract',()=>{
  it('emits ordinary string enums rather than anyOf constant alternatives',()=>{
    for(const workflow of ['text-to-image','text-to-video','reference-to-video'] as const){
      const schemas=requestToolSchemas(workflow,'nsfw');
      for(const schema of [schemas.create,schemas.edit]){
        const raw=JSON.parse(JSON.stringify(schema));expect(JSON.stringify(raw)).not.toContain('anyOf');
        expect(raw.properties.aspect_ratio).toMatchObject({type:'string',enum:['16:9','9:16']});
        if(workflow!=='text-to-image')expect(raw.properties.audio_output).toMatchObject({type:'string',enum:['generated','silent']});
      }
    }
  });
  it('rejects invented audio enum values in the real SDK and names real choices in adapter errors',()=>{
    const tool={name:'create_request',description:'test',parameters:requestToolSchemas('text-to-video','sfw').create};
    for(const audio_output of ['none','video']){
      expect(()=>validateToolCall([tool],{id:'t',name:tool.name,arguments:{prompt:'Scene.',audio_output},type:'toolCall'})).toThrow('audio_output: must be equal to one of the allowed values');
      expect(()=>prepareToolRequest({...context,workflow:'text-to-video'},{prompt:'Scene.',audio_output})).toThrow('audio_output: Choose generated or silent');
    }
    expect(JSON.parse(JSON.stringify(tool.parameters)).properties.audio_output.description).toContain('For silence, set silent explicitly');
    expect(requestToolRules()).toContain('Do not omit a setting to bypass a rejection');
  });
  it('explains new asset versus existing id and accepts only genuine existing ids',()=>{
    expect(requestToolRules()).toContain('For a new input, use asset, not id.');
    expect(()=>prepareToolRequest(context,{prompt:'Scene.',inputs:[{id:'not-a-source',role:'first_frame'}]})).toThrow('Unknown input id');
    expect(prepareToolRequest(context,{prompt:'Scene.',inputs:[{asset:'image1',role:'first_frame'}]}).references![0]!.role).toBe('first_frame');
  });
  it('supports two new clipped instances of one asset and compiles their independent soundtracks',()=>{
    const result=prepareToolRequest({...context,referenceMode:'stable'},{prompt:'[[clipA]] followed by [[clipB]], with [[clipA:audio]] only.',inputs:[
      {asset:'video1',instance:'clipA',start_seconds:0,duration_seconds:2,include_audio:true},
      {asset:'video1',instance:'clipB',start_seconds:4,duration_seconds:3,include_audio:false}
    ]});
    expect(result.prompt).toBe('<Video 1> followed by <Video 2>, with <Audio 1> only.');
    expect(result.references!.map(r=>[r.id,r.asset_id])).toEqual([['clipA','video-a'],['clipB','video-a']]);
    const edit=prepareToolRequest({...context,previous:result},{inputs:[{id:'clipB'},{id:'clipA'}]});
    expect(edit.prompt).toBe('<Video 2> followed by <Video 1>, with <Audio 1> only.');
  });
  it('rejects ambiguous or invalid instance names and id plus instance',()=>{
    for(const instance of ['', 'bad name', 'clip:audio', 'x'.repeat(101)])expect(()=>prepareToolRequest(context,{prompt:'Scene.',inputs:[{asset:'image1',instance}]})).toThrow('inputs[0].instance');
    expect(()=>prepareToolRequest(context,{prompt:'Scene.',inputs:[{asset:'image1',instance:'same'},{asset:'image2',instance:'same'}]})).toThrow('already used');
    expect(()=>prepareToolRequest({...context,previous:previous()},{inputs:[{id:'image1',instance:'new'}]})).toThrow('Do not combine instance with id');
    expect(()=>prepareToolRequest({...context,previous:previous()},{inputs:[{asset:'image2',instance:'image1'}]})).toThrow('belongs to an existing input');
  });
});

it('keeps guide-token compilation deterministic through a simultaneous role and prompt edit',()=>{
  const original=previous();
  const revised=prepareToolRequest({...context,previous:original,referenceMode:'stable'},{inputs:[{id:'image1',role:'first_frame'}],prompt:'Start at [[image1]].'});
  expect(revised.prompt).toBe('Start at <Picture 1>.');
  expect(requestToolRules('stable')).toContain('Keep image framing fit unless the user asks to crop.');
  expect(requestToolRules('stable')).toContain('include_audio true even when final audio_output is silent');
});


describe('edit source identity',()=>{
  it('rejects swapping sources under existing ids without mutating the original',()=>{
    const original=prepareToolRequest(context,{prompt:'<Picture 1> approaches <Picture 2>.',inputs:[{asset:'image1'},{asset:'image2'}]});
    const copy=structuredClone(original);
    expect(()=>prepareToolRequest({...context,previous:original},{inputs:[{id:'image1',asset:'image2'},{id:'image2',asset:'image1'}]})).toThrow('To reorder, list existing ids');
    expect(original).toEqual(copy);
  });
  it('preserves uniquely identified existing instances when asset handles are supplied for reorder',()=>{
    const original=prepareToolRequest(context,{prompt:'<Picture 1> approaches <Picture 2>.',inputs:[{asset:'image1',instance:'orb'},{asset:'image2',instance:'sign'}]});
    const result=prepareToolRequest({...context,previous:original},{inputs:[{asset:'image2'},{asset:'image1'}]});
    expect(result.references).toEqual([original.references![1],original.references![0]]);
    expect(result.prompt).toBe('<Picture 2> approaches <Picture 1>.');
  });
  it('rejects ambiguous source-only edits when two clips share the source',()=>{
    const original=prepareToolRequest(context,{prompt:'Scene.',inputs:[{asset:'video1',instance:'early',start_seconds:0,duration_seconds:3},{asset:'video1',instance:'late',start_seconds:4,duration_seconds:3}]});
    expect(()=>prepareToolRequest({...context,previous:original},{inputs:[{asset:'video1'}]})).toThrow('multiple existing inputs');
    expect(prepareToolRequest({...context,previous:original},{inputs:[{id:'late'},{id:'early'}]}).references).toEqual([original.references![1],original.references![0]]);
  });
  it('replaces a source only through replace_asset and clears incompatible clip fields',()=>{
    const original=previous();
    const result=prepareToolRequest({...context,previous:original},{prompt:'The images meet.',inputs:[{id:'image1'},{id:'video1',replace_asset:'image2'}]});
    expect(result.references![1]).toEqual({id:'video1',asset_id:'image-b',kind:'image',role:'reference'});
    expect(()=>prepareToolRequest(context,{prompt:'Scene.',inputs:[{replace_asset:'image1'}]})).toThrow('Replacement needs an existing id');
    expect(()=>prepareToolRequest({...context,previous:original},{inputs:[{id:'image1',asset:'image1',replace_asset:'image2'}]})).toThrow('cannot be combined');
  });
});


it('requires source handles in the create schema and distinguishes missing sources',()=>{
  const schema=requestToolSchemas('reference-to-video','sfw').create;
  expect(schema.properties.inputs!.items.required).toContain('asset');
  expect(()=>prepareToolRequest(context,{prompt:'Scene.',inputs:[{role:'reference'}]})).toThrow('Missing asset handle. Copy a supplied asset handle: image1, image2, video1, audio1.');
});


it('normalizes redundant standalone audio flags and aliases without changing source meaning',()=>{
  const result=prepareToolRequest({...context,referenceMode:'stable'},{prompt:'Use [[audio1:audio]] for timing.',inputs:[{asset:'audio1',include_audio:true,start_seconds:1,duration_seconds:3}]});
  expect(result.prompt).toBe('Use <Audio 1> for timing.');
  expect(result.references).toEqual([{id:'audio1',asset_id:'audio-a',kind:'audio',role:'reference',range:{start_seconds:1,duration_seconds:3}}]);
  expect(()=>prepareToolRequest(context,{prompt:'Scene.',inputs:[{asset:'audio1',include_audio:false,start_seconds:1,duration_seconds:3}]})).toThrow('Remove that input from the list');
  const refs=previous().references!;
  expect(()=>compileStablePrompt('[[image1:audio]]',refs)).toThrow('not available');
  expect(()=>compileStablePrompt('[[video1:audio]]',refs.map(r=>r.kind==='video'?{...r,include_audio:false}:r))).toThrow('not available');
});
