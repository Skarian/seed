import {afterEach,describe,it,expect,vi} from 'vitest';
import {validateToolCall} from '@earendil-works/pi-ai';
import {prepareToolRequest,compileStablePrompt,toolInputLabels,requestToolResultError,requestToolSchemas,requestToolRules,ToolRequestError,type RequestToolContext} from '../server/chat/request-tools.js';
import {imageRequest} from '../server/workflows.js';
import {VideoRequestError} from '../server/video.js';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {openDatabase} from '../server/db.js';
import {prepareStorage,resolvePaths} from '../server/storage.js';
import {Jobs} from '../server/jobs.js';
import {Chats} from '../server/chat/service.js';
import {fakePool} from './fake-pool.js';
const context:RequestToolContext={workflow:'reference-to-video',mode:'sfw',assets:[
  {handle:'image1',asset_id:'image-a',kind:'image'},
  {handle:'image2',asset_id:'image-b',kind:'image'},
  {handle:'video1',asset_id:'video-a',kind:'video',duration_seconds:10},
  {handle:'audio1',asset_id:'audio-a',kind:'audio',duration_seconds:8}
]};
const base={prompt:'<Picture 1> speaks in <Video 1>.',inputs:[{asset:'image1'},{asset:'video1',start_seconds:0,duration_seconds:3,include_audio:true}]};
const previous=()=>prepareToolRequest(context,base);
afterEach(()=>vi.unstubAllEnvs());
describe('simple request adapter',()=>{
  it('defaults new videos to 20 steps, preserves omitted steps on edits, and validates explicit choices',()=>{
    const original=previous();expect(original.steps).toBe(20);
    const selected=prepareToolRequest({...context,previous:original},{request_id:'card',steps:15});
    expect(selected.steps).toBe(15);
    expect(prepareToolRequest({...context,previous:selected},{request_id:'card',note:'Keep settings'}).steps).toBe(15);
    expect(()=>prepareToolRequest({...context,previous:selected},{request_id:'card',steps:8})).toThrow(/steps/);
    expect(requestToolSchemas('text-to-video','sfw').create.properties.steps).toMatchObject({enum:[10,15,20,30]});
    expect(requestToolSchemas('text-to-image','sfw').create.properties.steps).toBeUndefined();
  });
  it('supports model-editable settings and generates ids from supplied handles',()=>{
    const result=prepareToolRequest(context,{...base,prompt:'<Picture 1> speaks.',batch_size:3,seed:'42',aspect_ratio:'9:16',duration_seconds:15,audio_output:'silent',note:'Save this note'});
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
describe('Chat resolution ownership',()=>{
  const workflows=['text-to-image','image-to-image','text-to-video','reference-to-video'] as const;
  const creation=(workflow:string)=>({prompt:'A quiet scene.',...(['image-to-image','reference-to-video'].includes(workflow)?{inputs:[{asset:'image1'}]}:{})});
  it('omits size from create/edit schemas and rejects it even when it equals the current default',()=>{
    for(const workflow of workflows){
      const c={...context,workflow},original=prepareToolRequest(c,creation(workflow)),copy=structuredClone(original);
      for(const operation of ['create','edit'] as const){
        const schema=requestToolSchemas(workflow,'sfw')[operation];
        expect(schema.properties).not.toHaveProperty('size');
        const tool={name:operation+'_request',description:'test',parameters:schema};
        const raw={...(operation==='create'?creation(workflow):{request_id:'card',prompt:'A new scene.'}),size:original.output.size};
        expect(()=>validateToolCall([tool],{id:'t',name:tool.name,arguments:raw,type:'toolCall'})).toThrow();
        expect(()=>prepareToolRequest({...c,...(operation==='edit'?{previous:original}:{})},raw)).toThrow('size: Unknown setting');
      }
      expect(original).toEqual(copy);
      expect(requestToolRules('stable',workflow)).toContain('Never send size in a tool call');
    }
  });
  it('uses fixed creation sizes even when candidate resolutions are enabled',()=>{
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS','1');
    for(const workflow of workflows)expect(prepareToolRequest({...context,workflow},creation(workflow)).output.size).toBe(workflow.endsWith('video')?'768p':'image-768');
  });
  it('preserves manual overrides through prompt, settings, and source edits without mutating the original',()=>{
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS','1');
    for(const workflow of workflows){
      const c={...context,workflow},created=prepareToolRequest(c,creation(workflow));
      const original=imageRequest({...created,output:{...created.output,size:workflow.endsWith('video')?'480p':'2mp'}}),copy=structuredClone(original);
      const edits:Record<string,unknown>[]=[{prompt:'A misty scene.'},{note:'Keep this selection'},{batch_size:2},{seed:'7'}];
      if(workflow!=='image-to-image')edits.push({aspect_ratio:'9:16'});
      if(original.references?.length)edits.push({inputs:[{id:'image1',replace_asset:'image2',role:original.references[0]!.role}]});
      for(const edit of edits)expect(prepareToolRequest({...c,previous:original},edit).output.size).toBe(original.output.size);
      expect(()=>prepareToolRequest({...c,previous:original},{prompt:'Rejected scene.',size:created.output.size})).toThrow('size: Unknown setting');
      expect(original).toEqual(copy);
    }
  });
  it('rejects tool size before persisting a revision and preserves a manual size on a correctly targeted edit',async()=>{
    vi.stubEnv('SEED_QUALIFY_RESOLUTIONS','1');
    mkdirSync('.local/tests',{recursive:true});const root=mkdtempSync(path.resolve('.local/tests/request-resolution-')),paths=resolvePaths(root);prepareStorage(paths);
    writeFileSync(path.join(paths.config,'generate-preferences.json'),JSON.stringify({image:'2mp',video:'480p'}));
    const db=openDatabase(paths.data),pool=fakePool(db,paths).pool,jobs=new Jobs(db,paths,pool),chats=new Chats(db,paths,jobs);
    try{
      for(const workflow of ['text-to-image','text-to-video'] as const){
        let chat=chats.create('sfw');chat=chats.settings(chat.id,chat.version,{workflow});
        const tools=()=>(chats as any).workflowTools(chat.id,chat.epoch,workflow,'fixture-run',[]);
        const [create]=tools();
        await expect(create.execute('bad-create',{prompt:'A scene.',size:workflow==='text-to-image'?'image-768':'768p'})).rejects.toThrow('Unknown setting');
        expect(chats.view(chat.id).groups).toHaveLength(0);
        const result=await create.execute('create',{prompt:'A scene.'});
        expect(result.details.request).not.toHaveProperty('size');
        let card=chats.view(chat.id).groups[0]!.cards[0]!,request=card.revisions[0]!.request;
        expect(request.output.size).toBe(workflow==='text-to-image'?'image-768':'768p');
        const {mode,...manual}=request;
        chats.revise(chat.id,card.id,1,{...manual,output:{...manual.output,size:workflow==='text-to-image'?'2mp':'480p'}});
        card=chats.view(chat.id).groups[0]!.cards[0]!;const before=structuredClone(card);
        const [,edit]=tools();
        await expect(edit.execute('bad-edit',{request_id:card.id,prompt:'Rejected prompt.',size:request.output.size})).rejects.toThrow('Unknown setting');
        expect(chats.view(chat.id).groups[0]!.cards[0]).toEqual(before);
        const edited=await edit.execute('edit',{request_id:card.id,prompt:'A misty scene.'});
        card=chats.view(chat.id).groups[0]!.cards[0]!;
        expect(card.revisions).toHaveLength(3);
        expect(card.revisions.at(-1)!.request).toMatchObject({prompt:'A misty scene.',output:{size:workflow==='text-to-image'?'2mp':'480p'}});
        expect(edited.details.request).not.toHaveProperty('size');
      }
    }finally{await chats.close();await jobs.close();await pool.close();db.close();rmSync(root,{recursive:true,force:true});}
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
        expect(raw.properties.aspect_ratio).toMatchObject({type:'string',enum:workflow==='text-to-image'?['16:9','9:16','1:1','4:5']:['16:9','9:16']});
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

describe('shot details',()=>{
  const image={workflow:'text-to-image' as const,mode:'sfw' as const,assets:[]};
  it('saves shot details and merges edits field by field',()=>{
    const first=prepareToolRequest(image,{prompt:'A girl on a causeway.',title:'Shot 1: Causeway',shot:{number:1,name:'Causeway',cast:['Maren'],framing:'wide',delivery:'2.39:1'}});
    expect(first.shot).toEqual({number:1,name:'Causeway',cast:['Maren'],framing:'wide',delivery:'2.39:1'});
    const edited=prepareToolRequest({...image,previous:first},{request_id:'card',shot:{lens_mm:85,framing:'close-up'}});
    expect(edited.shot).toEqual({number:1,name:'Causeway',cast:['Maren'],framing:'close-up',delivery:'2.39:1',lens_mm:85});
    expect(imageRequest(edited).shot).toEqual(edited.shot);
    expect(()=>prepareToolRequest(image,{prompt:'x',shot:{delivery:'wide'}})).toThrow();
    expect(()=>imageRequest({...first,shot:{number:0}})).toThrow(/number/);
    expect(requestToolSchemas('text-to-image','sfw').create.properties.shot).toBeDefined();
  });
});
describe('runs_on',()=>{
  const edit:RequestToolContext={workflow:'image-to-image',mode:'sfw',assets:[{handle:'image1',asset_id:'image-a',kind:'image'}]};
  const draft={prompt:'The girl from [[image1]] at the door',inputs:[{asset:'image1',role:'source'}],aspect_ratio:'16:9'};
  it('sets where a draft is made when the owner says so, and keeps it on later edits',()=>{
    const pc=prepareToolRequest(edit,{...draft,runs_on:'seed_pc'});expect(pc.target).toBe('local');
    expect(prepareToolRequest({...edit,previous:pc},{request_id:'card',note:'x'}).target).toBe('local');
    expect(prepareToolRequest({...edit,previous:pc},{request_id:'card',runs_on:'auto'}).target).toBeUndefined();
  });
  it('refuses a cloud GPU for FLUX 3 Image Klein',()=>{
    expect(()=>prepareToolRequest(edit,{...draft,runs_on:'cloud'})).toThrow(ToolRequestError);
    expect(prepareToolRequest(edit,{...draft,engine:'qwen',aspect_ratio:'source',runs_on:'cloud'}).target).toBe('cloud');
  });
});
