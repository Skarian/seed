/** Frozen browser-driven cases: exactly 25 user sends, including five revisions. */
export const fixtures = {
 woman:{id:'photo-woman',kind:'image',sourcePath:'.local/agent-test-photos/woman-orange-suit.jpg',name:'Woman portrait.jpg'},
 man:{id:'photo-man',kind:'image',sourcePath:'.local/agent-test-photos/man-orange-suit.jpg',name:'Man portrait.jpg'},
 cafe:{id:'photo-cafe-v2',kind:'image',sourcePath:'.local/agent-test-photos/cafe-interior-v2.jpg',name:'Cafe interior.jpg'},
 dog:{id:'photo-dog',kind:'image',sourcePath:'.local/agent-test-photos/golden-retriever.jpg',name:'Golden dog.jpg'},
 motion:{id:'eval-motion',kind:'video',name:'Motion study.mp4',duration_seconds:6},
 sound:{id:'eval-sound',kind:'audio',name:'Alert tone.wav',duration_seconds:6},
};
const m=(mention,label)=>({mention,...(label?{label}:{})});
const im=(asset,role='reference')=>({asset,kind:'image',role,framing:'fit'});
const vi=(start=1,duration=3,include_audio=false)=>({asset:'motion',kind:'video',role:'reference',include_audio,range:{start_seconds:start,duration_seconds:duration}});
const au=(start=1,duration=3)=>({asset:'sound',kind:'audio',role:'reference',range:{start_seconds:start,duration_seconds:duration}});
const settings={seed:'42',count:1,quality:'fast',output:{aspect:'16:9',size:'native',duration_seconds:10},audio:{output:'generated'}};
function create(id,assets,segments,references,rubric,overrides={}){
 const expected={...settings,...overrides,references};
 return {id,assets,segments:[...segments,` Prepare one request for review. General references only unless I explicitly said opening or ending frame. Use fast quality, native size, ${expected.output.aspect}, ${expected.output.duration_seconds} seconds, batch size ${expected.count}, seed ${expected.seed}, ${expected.audio.output==='silent'?'silent output':'generated output audio'}.${expected.note?' Save the note exactly: '+expected.note:''}`],workflow:'reference-to-video',expected,rubric};
}
function edit(id,parentId,assets,segments,expected,rubric){return{id,parentId,assets,segments,workflow:'reference-to-video',expected,rubric};}
export const cases=[
 create('ui01-dialogue-ownership',['woman','man','cafe'],[
  'Use ',m('woman'),' as the woman on screen left, ',m('man'),' as the man on screen right, and ',m('cafe'),' only for the room. Keep both people’s actual appearance and orange suits. Seat them at one table with their helmets out of view. In 0–3 seconds hold a medium two-shot. In 3–6 seconds the woman says exactly "Did you save me a seat?" In 6–9 seconds the man says exactly "The best one in the room." In 9–10 seconds they smile. Low room tone, no music or subtitles. Keep the camera fixed.'
 ],[im('woman'),im('man'),im('cafe')],['Woman left speaks question; man right speaks reply in the correct windows.','Faces and orange clothing stay distinct; room patrons are not copied.','Fixed shot, helmets absent, exact dialogue and sound exclusions retained.'],{note:'Window table / dialogue test'}),
 create('ui02-mention-order',['woman','man','cafe'],[
  'Although I uploaded the woman first, start with ',m('man'),' standing at screen left. Put ',m('woman'),' seated at screen right, and use ',m('cafe'),' as the location. The man offers an empty chair in 0–4 seconds and says "Please, sit here." The woman stays in her own seat and answers "I am already comfortable" in 4–8 seconds. Hold her amused expression for the last two seconds. Preserve their clothes and faces, soft daylight, medium-wide camera, quiet room tone, no music.'
 ],[im('man'),im('woman'),im('cafe')],['Mention order may differ from upload order but source identities remain correct.','Man left offers chair; woman right remains seated; correct speakers and exact lines.']),
 create('ui03-dog-location',['cafe','dog'],[
  'Put ',m('dog'),' beside a table in ',m('cafe'),'. Preserve the dog’s coat and ears, but remove the room’s existing people from the new scene. For 0–4 seconds the dog waits seated; in 4–7 it turns toward the window; in 7–10 it looks back at the camera. A slow lateral camera move is welcome. No barking, dialogue, text, or added animals.'
 ],[im('dog'),im('cafe')],['Dog uses dog source and room uses cafe source despite reversed attachment order.','Dog remains seated throughout; three gaze phases and camera move retained.'],{audio:{output:'silent'}}),
 create('ui04-image-video',['woman','motion'],[
  'Use ',m('woman'),' for the character’s appearance and ',m('motion'),' source seconds 1–4 as a general motion reference with its source audio off. The video is a motion study, not a background to copy. Have her walk two steps toward the camera, stop at 5 seconds, then smile and say "We made it" during 6–8 seconds. Keep her orange suit and her helmet held in her hands. Plain studio background, gentle tracking camera, natural footsteps and speech, no music.'
 ],[im('woman'),vi()],['Video clip1–4, audio off, character from image.','Walk-stop-speech windows and held helmet survive; no test pattern in scene.']),
 create('ui05-two-clips',['dog','motion'],[
  'Use ',m('dog'),' for the dog. Use ',m('motion'),' twice as separate inputs: source seconds 0–2 first and source seconds 4–6 second, both source audio off. The first clip guides camera movement during output seconds 0–5; the second during 5–10. Show the same dog walking across a grassy clearing and stopping at the end. Do not reproduce the source pattern. Add natural footsteps and wind, no voice or music.'
 ],[im('dog'),vi(0,2),vi(4,2)],['Two separate input instances share one video asset, ranges0–2 and4–6.','Each clip bound to correct output half; dog appearance preserved.']),
 create('ui06-sound-ownership',['dog','sound','cafe'],[
  'Place ',m('dog'),' in ',m('cafe'),'. Use source seconds 1–4 of ',m('sound'),' as a short electronic alert reference, not as a voice. At output second 3 the alert sounds from offscreen; the seated dog turns its head toward the sound, then relaxes by second 8. Fixed low camera. Quiet room ambience and that one alert, no speech, music or barking.'
 ],[im('dog'),im('cafe'),au()],['Audio1–4 is alert reference, not dialogue; exact alert timing.','Dog gaze follows sound without leaving seated pose.']),
 create('ui07-video-and-separate-audio',['woman','motion','sound'],[
  'Use ',m('woman'),' for the person. Use ',m('motion'),' source seconds 0–3 for camera motion with source audio ON, and ',m('sound'),' source seconds 2–5 as a separate alert. Her room is a control room, not the source pattern. The video soundtrack supplies a continuous low background tone; the separate audio supplies one foreground alert at second 5. She looks up at that alert and says "That is our signal" in seconds 6–9. Preserve her orange suit; slow push-in, no music.'
 ],[im('woman'),vi(0,3,true),au(2,3)],['Video soundtrack and separate audio reference remain distinct.','Correct clip ranges and source audio true; exact line belongs to woman.']),
 create('ui08-plain-and-mention',['woman','man','dog'],[
  'The woman portrait is our main character. Put ',m('dog'),' at her feet, and put ',m('man'),' in the background waving. Keep the woman sharp and the man slightly out of focus. At second 2 she bends down and pats the dog once; at second 6 she looks up and returns the man’s wave. Keep each person’s source clothing. Outdoor lawn, warm afternoon light, birds and rustling leaves, no speech or music.'
 ],[im('woman'),im('dog'),im('man')],['Plain-described woman and both mentioned assets all retained.','Woman foreground interacts with dog and waves to man; no identity swap.']),
 create('ui09-portrait-with-motion',['man','motion'],[
  'Make ',m('man'),' the subject, preserving his actual face and orange suit. Use ',m('motion'),' source seconds 1–4 as a general motion guide with source audio off. The man stands against a plain dark wall, looks left during 0–4 seconds and toward camera during 4–10 seconds. He holds his helmet in both hands throughout. Gentle orbit camera, silent output.'
 ],[im('man'),vi()],['Man reference and motion reference distinct; helmet remains held.','Two gaze stages and gentle orbit retained.'],{audio:{output:'silent'},seed:'321',count:2}),
 create('ui10-opening-and-ending',['woman','man'],[
  'Use ',m('woman'),' as the opening frame and ',m('man'),' as the ending frame, not general image references. Make a stylized ten-second editorial dissolve between the two portraits: hold the first for 0–3 seconds, gradually dissolve during 3–7, hold the second for 7–10. Keep the original framing of each photograph. No speech, text, or added objects.'
 ],[im('woman','first_frame'),im('man','last_frame')],['Only first/last guides, no falsely numbered general references.','Dissolve timing, portrait framing and silent output retained.'],{audio:{output:'silent'}}),
 create('ui11-opening-plus-reference',['woman','cafe'],[
  'Start exactly from ',m('woman'),' as the opening-frame guide. Use ',m('cafe'),' as a general reference for the room revealed as the camera slowly pulls back. Keep the woman and her clothes consistent; the room can transform around her in a gentle dreamlike transition. She stays seated and silent, holding her helmet. No additional people. Soft ambient room sound only.'
 ],[im('woman','first_frame'),im('cafe')],['Woman opening guide; cafe general reference, never swap roles.','Slow pullback with room transition; subject identity and helmet retained.']),
 create('ui12-three-subjects',['woman','dog','man'],[
  'In a garden, ',m('man'),' stands left, ',m('woman'),' stands right, and ',m('dog'),' sits between them. For 0–4 seconds the man says "Who is ready for a walk?" During 4–7 seconds the woman answers "He has been ready all day." In 7–10 seconds both look down at the dog, which wags its tail but remains sitting. Medium-wide shot, keep the two orange suits and dog’s actual coat. Gentle wind, no music or subtitles.'
 ],[im('man'),im('woman'),im('dog')],['All three identities and spatial roles correctly bound despite upload order.','Exact speaker lines/timing and seated tail-wag retained.']),
 create('ui13-repeat-mention',['woman','man'],[
  m('woman'),' should be on the left and ',m('man'),' on the right. Begin with both looking at the horizon. At 4 seconds ',m('woman'),' turns to him and asks "Do you see it?" At 7 seconds ',m('man'),' nods once but does not speak. Keep their source outfits and a locked medium two-shot, with soft wind and no music or subtitles.'
 ],[im('woman'),im('man')],['Repeated mentions do not duplicate image inputs.','Woman asks; man nods silently; source identities preserved.']),
 create('ui14-photo-and-plain-audio',['cafe','sound','dog'],[
  'Use ',m('cafe'),' for a quiet room and ',m('dog'),' as the only animal. The attached alert tone should be a reference using source seconds 0–2. At output second 2 the tone sounds once; the dog lifts one ear and looks toward camera right, then settles. Warm late sunlight, slow zoom toward its face, no other people, speech, music or repeated alert.'
 ],[im('cafe'),im('dog'),au(0,2)],['Unmentioned attached audio still included with correct clip.','Single alert and deliberate zoom preserved; no default ban on zoom.']),
 create('ui15-all-media',['cafe','woman','motion','sound'],[
  'Put ',m('woman'),' at a table in ',m('cafe'),'. Use ',m('motion'),' source seconds 2–5 as a camera-motion reference with source audio off. Use ',m('sound'),' source seconds 0–3 as an offscreen alert. In 0–3 she sorts two postcards; at 4 the alert sounds; in 5–8 she says "One more minute" while keeping the cards on the table; finish with her returning to the cards. Keep her source clothing, a slow push-in and quiet room ambience. No music.'
 ],[im('woman'),im('cafe'),vi(2,3),au(0,3)],['All four sources and independent ranges are correct.','Two added postcards are allowed; action ordering, exact line and retained cards explicit.']),
 create('ui16-plain-two-people',['woman','man'],[
  'Use both attached portraits as general references: the woman stands on screen left, the man on screen right. Preserve their own faces and orange outfits. They are at a station. During 0–4 seconds she asks "Is this our train?" During 4–8 he replies "Not yet." End with both looking down the platform. Fixed medium two-shot and low station ambience, no music, text or other people.'
 ],[im('woman'),im('man')],['Both plain-described portraits correctly bound; exact speakers and lines.','Original faces/outfits and quiet station context retained.']),
 create('ui17-plain-dog-room',['dog','cafe'],[
  'Use the dog photograph for the dog and the cafe photograph for the room, both general references. The dog walks from left to right between two tables during 0–6 seconds, then sits facing the camera for the rest. Remove existing room patrons. Low tracking camera that stops when the dog stops; faint footsteps and room tone, no voice or music.'
 ],[im('dog'),im('cafe')],['Both unlabeled image attachments interpreted correctly.','Walking then sitting, tracking-stop camera and patron removal explicit.']),
 create('ui18-plain-video',['man','motion'],[
  'Use the man portrait for appearance and the attached motion-study video source seconds 3–6 as a general camera-motion reference, with its audio off. Show him walking into a sunlit studio, stopping at 5 seconds and saying "This will do" during 6–9. Keep his orange suit and carry the helmet in his left hand. Do not show the video’s colored pattern. Natural footsteps and voice, no music.'
 ],[im('man'),vi(3,3)],['Plain video source selection3–6 and audio off.','Left-hand helmet ownership and exact speech timing retained.']),
 create('ui19-plain-audio',['woman','sound'],[
  'Use the woman portrait as a general reference. Use the attached tone source seconds 2–4 as an electronic alert reference. She studies a wall clock in a plain office; at second 4 the alert sounds and she looks into the camera, then says "Right on time" during 5–8 seconds. Hold her smile to the end. Keep her source clothing, medium close-up, faint room ambience, no music or subtitles.'
 ],[im('woman'),au(2,2)],['Audio source2–4 is alert not voice.','Clock is allowed added prop; exact woman dialogue and staging retained.']),
 create('ui20-plain-batch',['dog','cafe','motion'],[
  'Use the dog and cafe photographs as general references, and source seconds 0–3 of the attached motion-study video with its source audio disabled. Place the dog under one table, watching the window. During 0–5 seconds slowly move closer; during 5–10 seconds hold while the dog tilts its head. The source video is only motion guidance. Silent output, no patrons or other animals.'
 ],[im('dog'),im('cafe'),vi(0,3)],['Dog/room/video all mapped from ordinary language.','Slow move then hold, dog under table, silent output preserved.'],{count:2,seed:'777',audio:{output:'silent'},note:'Quiet dog / batch study'}),
];
cases.push(
 edit('ui21-edit-dialogue','ui01-dialogue-ownership',['woman','man','cafe'],['Edit this request only. Change ',m('man'),'’s reply to exactly "I kept it just for you." Keep ',m('woman'),'’s question, both speaking windows, the room, input order, all other prompt details, note and every setting unchanged.'],cases[0].expected,['Only man reply changes; woman question and all other scene details unchanged.','Same request group, new revision, identical inputs/settings/note.']),
 edit('ui22-edit-second-clip','ui05-two-clips',['dog','motion'],['Edit the existing request. For ',m('motion','Video 2'),', enable source audio only on the SECOND input instance, source seconds 4–6. Leave the first 0–2 clip muted. Keep ',m('dog'),', both clips and their order, scene, output audio and every other setting unchanged.'],{...cases[4].expected,references:[im('dog'),vi(0,2),vi(4,2,true)]},['Only second video instance gains source audio; ranges and order survive.','No extra card or merged clips.']),
 edit('ui23-edit-framing','ui09-portrait-with-motion',['man','motion'],['Edit this request: change image framing for ',m('man'),' from fit to fill. Keep ',m('motion'),' unchanged. Do not change the prompt, clip, source audio, image role, seed, batch or any other setting.'],{...cases[8].expected,references:[{...im('man'),framing:'fill'},vi()]},['Only image framing changes; prompt/settings byte-identical where possible.','Same request receives revision.']),
 edit('ui24-plain-reply-edit','ui16-plain-two-people',['woman','man'],['Edit the same request. Replace only the man’s reply "Not yet." with "In two minutes." Keep his 4–8 second speech window, the woman’s question, both positions and faces, input order, camera, ambience and all settings unchanged.'],cases[15].expected,['Only exact man reply changes; old reply absent.','All inputs and settings stay unchanged, one group revised.']),
 edit('ui25-plain-batch-edit','ui20-plain-batch',['dog','cafe','motion'],['Edit that same request. Change batch size from 2 to 3 and starting seed from 777 to 778. Keep the entire prompt, three inputs, source clip range, muted source audio, silent output, note and every other setting unchanged.'],{...cases[19].expected,count:3,seed:'778'},['Only count and seed change.','Prompt, input identities/ranges/roles, note and output audio preserved.'])
);
if(cases.length!==25||cases.filter(c=>c.parentId).length!==5||cases.filter(c=>c.segments.some(s=>typeof s==='object')).length!==18)throw Error('Expected25 prompts:18 mention,7 plain,5 followups.');
