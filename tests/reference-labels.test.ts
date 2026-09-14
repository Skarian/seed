import {test,expect} from 'vitest';
import {inputLabels,remapReferences,type LabelInput} from '../shared/reference-labels.js';
const refs:LabelInput[]=[{asset_id:'photo',kind:'image',role:'reference'},{asset_id:'clip',kind:'video',role:'reference',include_audio:true},{asset_id:'sound',kind:'audio',role:'reference'}];
test('soundtracks reserve slots and changing inputs preserves mention identity',()=>{
 const before=inputLabels(refs);expect(before.get('sound')).toBe('<Audio 2>');
 const after=inputLabels(refs.map(r=>({...r,include_audio:false})));
 expect(remapReferences('Use <Audio 1> then <Audio 2>.',before,after)).toBe('Use [removed reference] then <Audio 1>.');
 expect(remapReferences('Use <Picture 1>.',before,inputLabels(refs.slice(1)))).toBe('Use [removed reference].');
});
