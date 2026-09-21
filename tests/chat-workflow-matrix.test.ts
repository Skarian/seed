import {describe,expect,it} from 'vitest';
import {imageRequest,seeds,type ImageRequest} from '../server/workflows.js';
import {chatReferenceLabels,preserveChatLabels,validateChatReferences} from '../server/chat/references.js';
import {settingsOnlyMessage} from '../server/chat/context.js';
import type {InputReference} from '../server/media.js';

const image:ImageRequest={workflow:'text-to-image',mode:'sfw',prompt:'A fox resting in a forest',seed:'42',count:1,output:{aspect:'16:9',size:'1mp'}};
const video:ImageRequest={...image,workflow:'text-to-video',output:{aspect:'16:9',size:'768p',duration_seconds:5},audio:{output:'generated'}};
const picture=(id:string,role:InputReference['role']='reference'):InputReference=>({id,asset_id:id,kind:'image',role,framing:'fit'});
const clip=(id:string,kind:'video'|'audio',include_audio=false):InputReference=>({id,asset_id:id,kind,role:'reference',range:{start_seconds:0,duration_seconds:3},...(kind==='video'?{include_audio}: {})});
const reference=(references:InputReference[],prompt='A fox walks forward'):ImageRequest=>({...video,workflow:'reference-to-video',references,prompt});

describe('workflow and reference combinations',()=>{
  const cases:[string,ImageRequest][]=[
    ['image',image],['text video',video],
    ['single opening frame',reference([picture('first','first_frame')],'<Picture 1> walks forward')],
    ['opening and closing guides',reference([picture('first','first_frame'),picture('last','last_frame')])],
    ['single general image',reference([picture('subject')],'<Picture 1> walks forward')],
    ['multiple general images',reference([picture('subject'),picture('scene')],'<Picture 1> walks through <Picture 2>')],
    ['video reference',reference([clip('motion','video')],'Follow <Video 1>')],
    ['audio reference',reference([clip('sound','audio')],'Follow <Audio 1>')],
    ['video soundtrack',reference([clip('motion','video',true)],'Follow <Video 1> and <Audio 1>')],
    ['image video and audio',reference([picture('subject'),clip('motion','video',true),clip('sound','audio')],'<Picture 1> follows <Video 1>, with <Audio 1> and <Audio 2>')],
  ];
  it.each(cases)('accepts %s without an agent repair loop',(_name,request)=>{
    const parsed=imageRequest(request);expect(()=>validateChatReferences(parsed)).not.toThrow();
    expect(parsed.workflow).toBe(request.workflow);expect(parsed.references??[]).toEqual(request.references??[]);
  });
  it.each(['sfw','nsfw'] as const)('retains %s settings across all workflows',mode=>{
    for(const [,request] of cases){const parsed=imageRequest({...request,mode,note:'Forest study'});expect(parsed.mode).toBe(mode);expect(parsed.note).toBe('Forest study');}
  });
  it('rejects unsupported video resolution',()=>expect(()=>imageRequest({...video,output:{...video.output,size:'720p'}})).toThrow('768p'));
  it('does not silently accept images on text-only workflows',()=>{
    expect(()=>imageRequest({...video,references:[picture('subject')]})).toThrow();
    expect(()=>imageRequest({...image,references:[picture('subject')]})).toThrow();
  });
  it('requires input references for reference video',()=>expect(()=>imageRequest(reference([]))).toThrow());
});

describe('reference labels and modifications',()=>{
  it('labels the opening frame consistently with video validation when a closing frame is also present',()=>{
    const request=reference([picture('first','first_frame'),picture('last','last_frame')],'<Picture 1> walks toward the closing frame');
    expect([...chatReferenceLabels(request)]).toEqual([['first','<Picture 1>']]);
    expect(()=>validateChatReferences(imageRequest(request))).not.toThrow();
  });
  it('does not assign a Picture label to a closing-frame-only guide',()=>{
    const request=reference([picture('last','last_frame')]);
    expect([...chatReferenceLabels(request)]).toEqual([]);
    expect(()=>validateChatReferences(imageRequest(request))).not.toThrow();
    expect(()=>validateChatReferences({...request,prompt:'Finish at <Picture 1>'})).toThrow();
    expect(()=>imageRequest({...request,prompt:'Finish at <Picture 1>'})).toThrow();
  });
  it('does not number a first-frame guide as a general image when video is present',()=>{
    const request=reference([picture('first','first_frame'),clip('motion','video')]);
    expect([...chatReferenceLabels(request)]).toEqual([['motion','<Video 1>']]);
    expect(()=>validateChatReferences({...request,prompt:'Animate <Picture 1> using <Video 1>'})).toThrow();
  });
  it('numbers extracted soundtracks before standalone audio regardless of input order',()=>{
    const request=reference([clip('sound','audio'),clip('motion','video',true),picture('subject')]);
    const labels=chatReferenceLabels(request);
    expect(labels.get('motion:audio')).toBe('<Audio 1>');expect(labels.get('sound')).toBe('<Audio 2>');
    expect(labels.get('motion')).toBe('<Video 1>');expect(labels.get('subject')).toBe('<Picture 1>');
  });
  it('renumbers visual mentions by asset identity when reordered',()=>{
    const before=reference([picture('fox'),picture('forest')],'<Picture 1> enters <Picture 2>');
    const after=preserveChatLabels(before,{...before,references:[...before.references!].reverse()});
    expect(after.prompt).toBe('<Picture 2> enters <Picture 1>');expect(()=>validateChatReferences(after)).not.toThrow();
  });
  it('renumbers soundtracks correctly when disabling one',()=>{
    const before=reference([clip('motion','video',true),clip('sound','audio')],'Use <Audio 2>');
    const after=preserveChatLabels(before,{...before,references:[clip('motion','video'),clip('sound','audio')]});
    expect(after.prompt).toBe('Use <Audio 1>');expect(()=>validateChatReferences(after)).not.toThrow();
  });
  it('requires the prompt to be repaired after removing a referenced asset',()=>{
    const before=reference([picture('fox'),picture('forest')],'<Picture 1> enters <Picture 2>');
    const after=preserveChatLabels(before,{...before,references:[picture('forest')]});
    expect(after.prompt).toContain('[removed reference]');expect(()=>validateChatReferences(after)).toThrow();
  });
  it('respects explicitly rewritten prompts instead of renumbering them again',()=>{
    const before=reference([picture('fox'),picture('forest')],'<Picture 1> enters <Picture 2>');
    const after=preserveChatLabels(before,{...before,references:[picture('forest')],prompt:'Pan across <Picture 1>'});
    expect(after.prompt).toBe('Pan across <Picture 1>');expect(()=>validateChatReferences(after)).not.toThrow();
  });
});

describe('settings modifications and visual context',()=>{
  it.each(['Set seed to 44','Please change the count to 3.','Make 2 outputs','Change aspect ratio to 9:16'])('omits image bytes only for clear settings: %s',text=>expect(settingsOnlyMessage(text)).toBe(true));
  it.each(['Make it warmer','Set seed to 44 and make the fox larger','Make 2 outputs with different lighting','Use the same image but change the camera angle','Change the background to a forest'])('keeps image context for visual or mixed instructions: %s',text=>expect(settingsOnlyMessage(text)).toBe(false));
  it.each([image,video,reference([picture('first','first_frame')])])('preserves explicit per-output seeds for $workflow',request=>{
    const parsed=imageRequest({...request,count:2,resolved_seeds:['42','100']});expect(seeds(parsed)).toEqual(['42','100']);
    expect(()=>imageRequest({...parsed,count:3})).toThrow('seeds');
  });
});
