const picture=(asset_id,role='reference')=>({asset_id,kind:'image',role,framing:'fit'});
const motion=(include_audio=false)=>({asset_id:'eval-motion',kind:'video',role:'reference',include_audio,range:{start_seconds:1,duration_seconds:3}});
const sound=()=>({asset_id:'eval-sound',kind:'audio',role:'reference',range:{start_seconds:1,duration_seconds:3}});
const subject=()=>picture('eval-subject'),scene=()=>picture('eval-scene');
export const lanes=[
  {id:'image',workflow:'text-to-image',references:[],description:'Create an image of a yellow sphere resting on a green stage.'},
  {id:'video',workflow:'text-to-video',references:[],description:'Create a video of a yellow sphere rolling across a green stage.'},
  {id:'opening',workflow:'reference-to-video',references:[picture('eval-subject','first_frame')],description:'Animate the yellow sphere image as the first frame. It rolls gently to the right.'},
  {id:'bookends',workflow:'reference-to-video',references:[picture('eval-subject','first_frame'),picture('eval-scene','last_frame')],description:'Use the yellow sphere as first frame and blue triangle as last frame. Transition smoothly between them.'},
  {id:'two-images',workflow:'reference-to-video',references:[subject(),scene()],description:'Use the yellow sphere as general subject reference and the blue triangle as general scene reference. The subject moves toward the scene.'},
  {id:'motion',workflow:'reference-to-video',references:[motion()],description:'Use the moving test pattern video as motion reference, seconds 1 through 4, without its soundtrack. Show a sphere moving with the reference motion.'},
  {id:'sound',workflow:'reference-to-video',references:[sound()],description:'Use the separate tone audio, seconds 1 through 4, as an audio reference for a video of a pulsating sphere.'},
  {id:'opening-motion',workflow:'reference-to-video',references:[picture('eval-subject','first_frame'),motion()],description:'Use the yellow sphere as opening frame and moving test pattern video as motion reference, seconds 1 through 4 without its soundtrack.'},
  {id:'mixed',workflow:'reference-to-video',references:[subject(),motion(true),sound()],description:'Use the yellow sphere as a general image reference, the moving test pattern video for motion AND its extracted soundtrack, and the separate tone as a second audio reference. Both temporal references use seconds 1 through 4.'},
];
const baseExpected=lane=>({workflow:lane.workflow,seed:'42',count:1,output:{aspect:'16:9',size:lane.workflow==='text-to-image'?'1mp':'native',...(lane.workflow==='text-to-image'?{}:{duration_seconds:5})},...(lane.workflow==='text-to-image'?{}:{quality:'fast',audio:{output:'silent'}}),references:lane.references});
const createText=(lane,mode)=>`${lane.description} Prepare exactly one request for review, do not generate. Seed 42, count 1, landscape 16:9. ${lane.workflow==='text-to-image'?'Image size 1mp.':'Five seconds, native size, fast quality, silent output audio.'} ${mode==='nsfw'?'Use Spicy generation mode.':''}`;
const cases=[];
const add=(category,id,lane,extra={},mode='sfw')=>cases.push({id:category+'-'+id,category,lane:lane.id,workflow:lane.workflow,mode,assets:[...new Set(lane.references.map(r=>r.asset_id))],create:createText(lane,mode),expected:{...baseExpected(lane),mode},...extra});
for(const mode of ['sfw','nsfw'])for(const lane of lanes)add('fresh-create',lane.id+'-'+mode,lane,{},mode);

const settings=[
  ['seed','Set seed to 876.',{'seed':'876'}],
  ['count','Change the count to 3.',{count:3}],
  ['aspect','Change aspect ratio to 9:16.',{'output.aspect':'9:16'}],
  ['random','Use a new random seed.',{seed:'random'}],
  ['combined','Set seed to 99 and count to 2. Keep everything else exactly the same.',{seed:'99',count:2}],
  ['portrait-count','Make 2 outputs in portrait 9:16. Preserve the prompt and all inputs.',{count:2,'output.aspect':'9:16'}],
];
for(const lane of [lanes[0],lanes[1],lanes[8]])for(const [id,feedback,changes] of settings)add('settings',lane.id+'-'+id,lane,{feedback,changes,preservePrompt:true});

const revisions=[
  ['warm','Make the lighting warmer. Change only the prompt; preserve all inputs, roles and settings.'],
  ['close','Move the camera closer. Change only the prompt, preserving every input and setting.'],
  ['blue','Add soft blue rim lighting. Keep every reference and all settings unchanged.'],
  ['slow','Describe the motion as slow and deliberate. Preserve all inputs and settings.'],
  ['background','Add distant trees in the background. Change only the prompt.'],
  ['remove-detail','Remove mentions of fog or haze; explicitly describe clear air instead. Keep references and settings identical.'],
];
for(const lane of [lanes[0],lanes[3],lanes[8]])for(const [id,feedback] of revisions)add('revisions',lane.id+'-'+id,lane,{feedback,promptMustChange:true,changes:{}});

const labelCases=[
  ['reorder-images',lanes[4],'Reverse the order of the two image references. Keep the sphere as the moving subject and triangle as the destination. Preserve all other settings.',{references:[scene(),subject()]}],
  ['remove-scene',lanes[4],'Remove the blue triangle reference and its mentions. Keep the yellow sphere as the subject. Preserve all settings.',{references:[subject()]}],
  ['disable-soundtrack',lanes[8],'Disable the video reference soundtrack. Keep the separate tone as the audio reference, keeping video and image inputs and all other settings.',{references:[subject(),motion(false),sound()]}],
  ['remove-standalone-audio',lanes[8],'Remove the separate tone audio reference and its mentions. Keep the video soundtrack and all other inputs/settings.',{references:[subject(),motion(true)]}],
  ['first-frame-plus-motion',lanes[7],'Describe the opening sphere moving according to the video. Opening frame is a guide, not a general Picture label. Only change the prompt.',{}],
  ['closing-only',lanes[3],'Remove the opening frame. Keep only the blue triangle as the closing-frame guide and describe arrival there without a numbered Picture label. Preserve settings.',{references:[picture('eval-scene','last_frame')]}],
];
for(const mode of ['sfw','nsfw'])for(const [id,lane,feedback,changes] of labelCases)add('labels',id+'-'+mode,lane,{feedback,changes,checkLabels:true},mode);

const recoveries=[
  ['invalid-count',lanes[0],'Prepare an image with count 99. Do not silently reduce it; ask me for a supported count.','Use count 2 instead.',{count:2}],
  ['invalid-seed',lanes[0],'Use seed 999999999999999999999999999. If unsupported, ask me rather than substituting one.','Use seed 42 instead.',{seed:'42'}],
  ['invalid-aspect',lanes[1],'Use square 1:1 video. If unsupported, ask me rather than changing aspect silently.','Use landscape 16:9 instead.',{}],
  ['short-duration',lanes[1],'Make a one-second video. If unsupported, ask me instead of silently changing duration.','Use five seconds instead.',{}],
  ['missing-input',lanes[2],'Animate a first-frame image, but I have not attached it yet. Ask for the missing asset; do not invent an ID.','Here is the first-frame image. Prepare the request now.',{}],
  ['impossible-range',lanes[5],'Use seconds 30 through 33 of the attached six-second video. Ask for a valid range rather than silently clipping.','Use seconds 1 through 4 instead.',{}],
];
for(const mode of ['sfw','nsfw'])for(const [id,lane,invalid,correction,changes] of recoveries)add('recovery',id+'-'+mode,lane,{invalid,correction,changes,missingInitially:id==='missing-input'},mode);

const contexts=[
  ['return-to-request',lanes[0],'Now return to the request and set its seed to 876.',{seed:'876'},false],
  ['visual-return',lanes[2],'Return to the opening sphere image. Make its lighting warmer without changing its role or any settings.',{},false],
  ['settings-after-history',lanes[8],'Change count to 2 on the existing request. Keep all images, video, soundtrack, separate audio and the prompt unchanged.',{count:2},false],
  ['compact-settings',lanes[8],'Return to the existing request and set seed to 99. Preserve everything else.',{seed:'99'},true],
  ['compact-visual',lanes[4],'Make the subject lighting warmer in the existing request. Preserve both image identities and settings.',{},true],
  ['compact-roles',lanes[3],'Set portrait aspect 9:16 on the existing request. Preserve the first and last frame roles and all other settings.',{'output.aspect':'9:16'},true],
];
for(const mode of ['sfw','nsfw'])for(const [id,lane,feedback,changes,longHistory] of contexts)add('context',id+'-'+mode,lane,{feedback,changes,history:true,longHistory,preservePrompt:Object.keys(changes).length>0},mode);

export const matrix=cases;
if(matrix.length!==90)throw Error('Expected 90 base cases, got '+matrix.length);
export function userText(text,repetition,paraphrase){
  if(!paraphrase||repetition===0)return text;
  return repetition%2?`Please update my creative request according to these directions: ${text}`:`For this request, these are my instructions. ${text} Prepare it for my review.`;
}
