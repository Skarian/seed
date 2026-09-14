import {photoCases} from './agent-eval-photo-cases.mjs';
/** Explicit new stimulus/version. Frozen original cases and their artifact remain untouched. */
export const photoV2Cases=photoCases.filter(c=>c.photoFixtures.some(f=>f.id==='photo-cafe')).map(original=>{
 const value=JSON.parse(JSON.stringify(original)
  .replaceAll('photo-cafe','photo-cafe-v2')
  .replaceAll('cafe-interior.jpg','cafe-interior-v2.jpg')
  .replaceAll('columns/arches/windows/tables','columns/arches/framed portraits')
  .replaceAll('columns/arches/round tables','columns/arches/framed portraits')
  .replaceAll('windows','framed portraits'));
 value.id=original.id+'-cafe-v2';value.category='heldout-photo-v2';value.fixtureVersion='cafe-w00160-v2';
 value.semanticRubric.push('Clean replacement room shows tall cream columns, decorated arches, dark wood and two large framed portraits. Painted figures remain paintings, not additional live characters. The requested round table is invented staging, not a claimed visible source detail.');
 if(value.finalSemanticRubric)value.finalSemanticRubric.push('Room uses the clean W00160 fixture. Do not invent visible windows or animate its painted figures.');
 return value;
});
