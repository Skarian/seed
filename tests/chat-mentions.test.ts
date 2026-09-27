import {expect,it} from 'vitest';
import {bindChatMentions,agentMentionContext} from '../server/chat/mentions.js';
import type {InputReference} from '../server/media.js';
const assets=[{id:'a',kind:'image'},{id:'b',kind:'image'},{id:'v',kind:'video'},{id:'s',kind:'audio'}];
const handles=assets.map((asset,index)=>({asset_id:asset.id,handle:'input'+(index+1),kind:asset.kind}));
const refs:InputReference[]=[{id:'early',asset_id:'v',kind:'video',role:'reference',range:{start_seconds:0,duration_seconds:2},include_audio:true},{id:'late',asset_id:'v',kind:'video',role:'reference',range:{start_seconds:4,duration_seconds:2},include_audio:true}];
const scope={card_id:'card',revision:2,references:refs};
it('resolves source identity rather than displayed numbering',()=>{
 const text='Move [Picture 1](asset:b) toward [Picture 2](asset:a).';
 const stored=bindChatMentions(text,undefined,assets);
 expect(agentMentionContext(text,stored,handles).text).toBe('Move [[input2]] toward [[input1]].');
 expect(text).toContain('[Picture 1](asset:b)');
});
it('distinguishes a standalone audio source from a video soundtrack',()=>{
 const text='Use [Audio 1](asset:s) and [Audio 2](asset:v).';
 const result=agentMentionContext(text,bindChatMentions(text,undefined,assets),handles);
 expect(result.text).toBe('Use [[input4]] and [[input3:audio]].');
});
it('binds separate clips and their soundtrack channels immutably to a revision',()=>{
 const text='Match [Video 2](asset:v), using [Audio 1](asset:v).';
 const bindings=bindChatMentions(text,[{token:'[Video 2](asset:v)',asset_id:'v',input_id:'late'},{token:'[Audio 1](asset:v)',asset_id:'v',input_id:'early',channel:'audio'}],assets,scope);
 expect(bindings.map(b=>[b.input_id,b.channel,b.card_id,b.revision])).toEqual([['late',undefined,'card',2],['early','audio','card',2]]);
 expect(bindings[0]!.input_settings).toEqual({role:'reference',start_seconds:4,duration_seconds:2,include_audio:true});
 refs.reverse();try{expect(agentMentionContext(text,bindings,handles,[scope]).text).toBe('Match [[late]], using [[early:audio]].');}finally{refs.reverse();}
 const historical=agentMentionContext(text,bindings,handles,[{...scope,revision:3}]);
 expect(historical.text).toBe('Match [[input3]], using [[input3:audio]].');
 expect(historical.mention_bindings![0]).toMatchObject({input_id:'late',historical_instance:true,input_settings:{start_seconds:4,duration_seconds:2}});
});
it('legacy history resolves sources without inventing current clip bindings',()=>{
 const result=agentMentionContext('Old [Video 2](asset:v)',undefined,handles);
 expect(result.text).toBe('Old [[input3]]');expect(result.mention_bindings![0]!.input_id).toBeUndefined();
});
it('rejects unavailable media, mismatched claims, foreign instances and client revision scope',()=>{
 expect(()=>bindChatMentions('[Picture 1](asset:missing)',undefined,assets)).toThrow('no longer');
 expect(()=>bindChatMentions('[Picture 1](asset:a)',[{token:'[Picture 1](asset:a)',asset_id:'b'}],assets)).toThrow('does not match');
 expect(()=>bindChatMentions('[Video 1](asset:v)',[{token:'[Video 1](asset:v)',asset_id:'v',input_id:'foreign'}],assets,scope)).toThrow('instance changed');
 expect(()=>bindChatMentions('[Video 1](asset:v)',[{token:'[Video 1](asset:v)',asset_id:'v',card_id:'foreign'}],assets,scope)).toThrow('server');
});
it('never treats standalone audio as a video soundtrack even when explicitly requested in binding',()=>{
 expect(()=>bindChatMentions('[Audio 1](asset:s)',[{token:'[Audio 1](asset:s)',asset_id:'s',channel:'audio'}],assets)).toThrow('video input');
});
it('marks deleted historical mentions unavailable instead of pointing to a new source',()=>{
 expect(agentMentionContext('[Picture 1](asset:a)',[{token:'[Picture 1](asset:a)',asset_id:'a'}],handles.filter(a=>a.asset_id!=='a')).text).toBe('[Input no longer available]');
});
