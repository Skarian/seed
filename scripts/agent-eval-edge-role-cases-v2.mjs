/** Separate v2 role-transition fixtures. Do not mutate the frozen v1 matrix. */
import {edgeCases as frozenV1Cases} from './agent-eval-edge-cases.mjs';

export const edgeRoleFixtureVersion='centered-sphere-role-transitions-v2';
const roles=['reference','first_frame','last_frame'];
const roleText={reference:'general reference',first_frame:'opening-frame guide',last_frame:'ending-frame guide'};
// Visually checked fixtures/eval-subject.png: flat yellow circle centered on dark
// green, with no arch, floor line, cast shadow, texture or other visible object.
const story=`Create an eight-second restrained graphic stop-motion scene matching the supplied sphere image: one flat yellow circular sphere silhouette centered on a uniform dark green background. Keep its actual yellow color, circular outline, apparent diameter, flat fill and background color. Do not invent a tabletop edge, arch, shadow, face, lettering, texture, shading or any other object. Keep a locked straight-on camera and constant flat lighting. During 0–1 seconds hold the source's centered composition. During 1–3 seconds translate the circle horizontally a short distance to screen left, less than half its own radius, with restrained discrete stop-motion steps. During 3–5 seconds move through center to the same short distance on screen right. During 5–7 seconds return to the exact original center position. During 7–8 seconds hold the original centered composition again. The silhouette never changes size or shape, rotates, leaves the frame or changes depth. No cuts, zooms, extra circles, people, captions, speech or music. Use faint soft motion sounds only while the circle moves when output audio is enabled. Both the initial and final held compositions match the supplied image within the selected Fit framing; do not stretch or crop the circle to fill the output.`;
const invariants=[
 'Single flat yellow circular silhouette on uniform dark green; no invented arch, tabletop, cast shadow, face, texture or third-dimensional shading.',
 'Timing is centered hold0–1, slight translation left1–3, across center to right3–5, return to center5–7, centered hold7–8. Distance below half its radius, constant size/shape, no rotation or camera motion.',
 'Both endpoints visibly match the actual centered-circle image within Fit framing; no conflict between fixed staging and first/last guide composition.',
 'Motion video contributes only broad stepped pacing; no test-pattern pixels, colors, objects or source audio appear.',
 'Seed731, count2, fast/native16:9, duration8, formatvideo, generated output audio, exact note and both asset identities/order remain unchanged.',
];

export const edgeRoleCasesV2=roles.flatMap(from=>roles.filter(to=>to!==from).map(to=>{
 const source=frozenV1Cases.find(c=>c.id===`edge-${from}-to-${to}`);
 if(!source)throw Error(`Missing frozen role case ${from} -> ${to}`);
 const result=structuredClone(source);
 result.id=`edge-v2-${from}-to-${to}`;
 result.fixtureVersion=edgeRoleFixtureVersion;
 result.category='revision-edge-v2';
 result.create=`${story} Use the sphere image as a ${roleText[from]}, with Fit framing. Also use the test-pattern video as a general motion reference, source seconds 0–2 with source audio off. Borrow only broad movement pacing; the explicit circle trajectory and timing above take precedence over source motion. The test pattern itself must never appear. Prepare one request for review, not a generation. Set starting seed 731, batch size 2, quality fast, size native, aspect ratio 16:9, length 8 seconds, output format video, output audio generated. Save this exact note: Revision edge / preserve everything else`;
 result.feedback=`Edit the same request. Change only the IMAGE role from ${roleText[from]} to ${roleText[to]}. Keep its Fit framing and the video input, source range0–2 and source audio OFF unchanged. Update the prompt's input bindings and any starting/ending-guide instruction necessary for the new role. Both endpoints already match the source, so preserve the exact centered/left/right/center timeline and held endpoints rather than changing staging. A general reference supplies appearance without requiring frame conditioning; an opening guide anchors the initial held composition; an ending guide anchors the final held composition. Retain only the conditioning role now requested. Preserve every other setting, input identity/order, note, circle appearance, camera and sound. Do not create another request.`;
 result.semanticRubric=[...invariants,`Initial image role is ${roleText[from]}; video is a reference, so frame guides have no invented numbered Picture label.`];
 result.finalSemanticRubric=[...invariants,`Image becomes ${roleText[to]}; remove the former ${roleText[from]} conditioning assertion without removing the unchanged visual centered holds.`,
  to==='reference'?'Picture1 binds only the image appearance; Video1 still binds motion. No remaining claim that image is a required first/last frame.':`Image binds the unnumbered ${to==='first_frame'?'opening':'ending'}-frame guide; Video1 still binds motion. Correct endpoint is explicitly anchored, no fabricated Picture number.`,
  'Necessary prompt edits update role meaning, not just token spelling; all unrelated creative instructions remain intact.'];
 return result;
}));
if(edgeRoleCasesV2.length!==6||new Set(edgeRoleCasesV2.map(c=>c.id)).size!==6)throw Error('Expected all six distinct v2 role transitions.');
