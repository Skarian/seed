import {expect,it} from 'vitest';
import {prepareToolRequest,type RequestToolContext} from '../server/chat/request-tools.js';

const context:RequestToolContext={workflow:'reference-to-video',mode:'sfw',referenceMode:'stable',assets:[
 {handle:'input1',asset_id:'photo-a',kind:'image'},
 {handle:'input2',asset_id:'photo-b',kind:'image'},
 {handle:'input3',asset_id:'video-a',kind:'video',duration_seconds:8}
]};

it('does not silently retain an opening-guide instruction after that input becomes an ending guide',()=>{
 const previous=prepareToolRequest(context,{prompt:'Match [[input1]].',inputs:[{asset:'input1',role:'first_frame'}]});
 expect(previous.prompt).toContain('<Picture 1>');
 // Either remap through preserved instance metadata, or require a replacement prompt.
 let result;
 try{result=prepareToolRequest({...context,previous},{inputs:[{id:'input1',role:'last_frame'}]});}
 catch(error){expect(String(error)).toMatch(/prompt|guide|input/i);return;}
 expect(result.prompt).not.toContain('opening-frame guide');
});

it('does not let a new asset silently reuse an existing custom input identity',()=>{
 const previous=prepareToolRequest(context,{prompt:'Keep [[input1]].',inputs:[{asset:'input2',instance:'input1'}]});
 expect(previous.references![0]!.asset_id).toBe('photo-b');
 // The omitted id means NEW input. Its default handle must not impersonate the old instance.
 expect(()=>prepareToolRequest({...context,previous},{inputs:[{asset:'input1'}]})).toThrow();
});

it('preserves two instances of one source when only one audio channel changes',()=>{
 const previous=prepareToolRequest(context,{prompt:'Follow [[early]], then [[late]].',inputs:[{asset:'input3',instance:'early',start_seconds:0,duration_seconds:2,include_audio:false},{asset:'input3',instance:'late',start_seconds:6,duration_seconds:2,include_audio:false}]});
 const result=prepareToolRequest({...context,previous},{inputs:[{id:'early'},{id:'late',include_audio:true}]});
 expect(result.references!.map(r=>[r.id,r.asset_id,r.range,r.include_audio])).toEqual([
  ['early','video-a',{start_seconds:0,duration_seconds:2},false],['late','video-a',{start_seconds:6,duration_seconds:2},true]
 ]);
 expect(result.prompt).toBe(previous.prompt);
});

for(const from of ['reference','first_frame','last_frame'] as const)for(const to of ['reference','first_frame','last_frame'] as const)if(from!==to){
 it(`preserves image identity across ${from} to ${to}`,()=>{
  const previous=prepareToolRequest(context,{prompt:'Match [[input1]].',inputs:[{asset:'input1',role:from}]});
  const result=prepareToolRequest({...context,previous},{inputs:[{id:'input1',role:to}]});
  expect(result.references![0]).toMatchObject({id:'input1',asset_id:'photo-a',role:to});
  expect(result.prompt).toBe(`Match ${to==='last_frame'?'the ending-frame guide':'<Picture 1>'}.`);
 });
}

it('accepts a known source ID without confusing it with an input instance',()=>{
 const result=prepareToolRequest(context,{prompt:'Use [[photo-a]] and [[video-a]] with [[video-a:audio]].',inputs:[{asset:'photo-a'},{asset:'video-a',start_seconds:1,duration_seconds:2,include_audio:true}]});
 expect(result.prompt).toBe('Use <Picture 1> and <Video 1> with <Audio 1>.');
 expect(result.references!.map(r=>r.id)).toEqual(['input1','input3']);
 expect(()=>prepareToolRequest(context,{prompt:'Use [[video-a]].',inputs:[{asset:'video-a',instance:'early',start_seconds:0,duration_seconds:2},{asset:'video-a',instance:'late',start_seconds:4,duration_seconds:2}]})).toThrow('not available');
});

it('a new request may resolve a known source handle placed in id without guessing unknown identities',()=>{
 const result=prepareToolRequest(context,{prompt:'Use [[input1]].',inputs:[{id:'input1',role:'first_frame'}]});
 expect(result.references![0]).toMatchObject({id:'input1',asset_id:'photo-a',role:'first_frame'});
 expect(()=>prepareToolRequest(context,{prompt:'Scene.',inputs:[{id:'missing'}]})).toThrow('Unknown input id');
});
