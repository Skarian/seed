import {test,expect} from 'vitest';
import {inputLabels,parseInputLabel,promptBindings,remapReferences,type LabelInput} from '../shared/reference-labels.js';
const refs:LabelInput[]=[{asset_id:'photo',kind:'image',role:'reference'},{asset_id:'clip',kind:'video',role:'reference',include_audio:true},{asset_id:'sound',kind:'audio',role:'reference'}];

test('composer slots understand every label emitted by image editing and video inputs',()=>{
 const edit:LabelInput[]=[{id:'style',asset_id:'style-file',kind:'image',role:'reference'},{id:'source',asset_id:'source-file',kind:'image',role:'source'}];
 expect([...inputLabels(edit).values()].map(parseInputLabel)).toEqual([{kind:'image',number:1},{kind:'image',number:2}]);
 expect([...inputLabels(refs).values()].map(parseInputLabel)).toEqual([{kind:'audio',number:1},{kind:'image',number:1},{kind:'video',number:1},{kind:'audio',number:2}]);
 for(const label of ['<image0>','<image>','<Picture 0>','Unknown label'])expect(parseInputLabel(label)).toBeUndefined();
 expect(remapReferences('Use <image1> with <image2>.',inputLabels(edit),inputLabels(edit.slice(1)))).toBe('Use <image1> with [removed reference].');
});
test('soundtracks reserve slots and changing inputs preserves mention identity',()=>{
 const before=inputLabels(refs);expect(before.get('sound')).toBe('<Audio 2>');
 const after=inputLabels(refs.map(r=>({...r,include_audio:false})));
 expect(remapReferences('Use <Audio 1> then <Audio 2>.',before,after)).toBe('Use [removed reference] then <Audio 1>.');
 expect(remapReferences('Use <Picture 1>.',before,inputLabels(refs.slice(1)))).toBe('Use [removed reference].');
});

test('canonical labels use input identities even when source file ids differ',()=>{
 const labels=inputLabels([{id:'subject-instance',asset_id:'photo-file',kind:'image',role:'reference'}]);
 expect(labels.get('subject-instance')).toBe('<Picture 1>');expect(labels.has('photo-file')).toBe(false);
});

test('two clips from one source retain distinct video and soundtrack labels',()=>{
 const clips:LabelInput[]=[{id:'opening-clip',asset_id:'same-video',kind:'video',role:'reference',include_audio:true},{id:'ending-clip',asset_id:'same-video',kind:'video',role:'reference',include_audio:true},{id:'music',asset_id:'song-file',kind:'audio',role:'reference'}];
 const before=inputLabels(clips);
 expect([...before]).toEqual([['opening-clip:audio','<Audio 1>'],['ending-clip:audio','<Audio 2>'],['opening-clip','<Video 1>'],['ending-clip','<Video 2>'],['music','<Audio 3>']]);
 const after=inputLabels([clips[1]!,clips[0]!,clips[2]!]);
 expect(remapReferences('First <Video 1> with <Audio 1>, then <Video 2> with <Audio 2>; music <Audio 3>.',before,after))
   .toBe('First <Video 2> with <Audio 2>, then <Video 1> with <Audio 1>; music <Audio 3>.');
});

test('removing one instance never transfers its mentions to another clip of the same file',()=>{
 const clips:LabelInput[]=[{id:'opening',asset_id:'same',kind:'video',role:'reference',include_audio:true},{id:'ending',asset_id:'same',kind:'video',role:'reference',include_audio:true}];
 expect(remapReferences('Use <Video 1> and <Video 2> with <Audio 1> and <Audio 2>.',inputLabels(clips),inputLabels(clips.slice(1))))
   .toBe('Use [removed reference] and <Video 1> with [removed reference] and <Audio 1>.');
});

test('unnumbered guide references follow the same input through role changes and removal',()=>{
 const before:LabelInput[]=[{id:'frame',asset_id:'photo',kind:'image',role:'first_frame'},{id:'motion',asset_id:'clip',kind:'video',role:'reference'}];
 const after=before.map(r=>r.id==='frame'?{...r,role:'last_frame'}:r);
 expect(remapReferences('Start at the opening-frame guide with <Video 1>.',promptBindings(before),promptBindings(after))).toBe('Start at the ending-frame guide with <Video 1>.');
 expect(remapReferences('Follow the opening-frame guide.',promptBindings(before),promptBindings(before.slice(1)))).toBe('Follow [removed reference].');
});
