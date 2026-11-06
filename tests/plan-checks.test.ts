import { it, expect } from 'vitest';
import { askedFor, checkDraft, readablePrompt, editablePrompt, briefGaps, silencedPrompt, briefGapList, addBriefDetails } from '../web/app/project/checks.js';

// Synthetic fixtures only.
const message = (role: 'user' | 'assistant', text: string, id = Math.random().toString(36), assets: string[] = []) => ({ id, role, text, assets, created_at: '2026-11-04T00:00:00Z' });
const card = (request: any, run_id = 'run') => ({ id: 'card', workflow: request.workflow, revisions: [{ number: 1, request, notes: {}, decision: 'undecided' as const, job_ids: [], run_id }] });
const project = (messages: any[], extra: any = {}) => ({ messages, jobs: [], groups: [], asset_manifest: [], ...extra }) as any;

it('reads the newest explicit shape, length and sound from what the user wrote', () => {
  expect(askedFor([message('user', 'Make it square please'), message('user', 'Actually portrait 4:5, a 6-second clip, silent')] as any)).toEqual({ aspect: '4:5', seconds: 6, silent: true });
  expect(askedFor([message('user', 'A wide landscape shot with sound')] as any)).toEqual({ aspect: 'landscape', silent: false });
});

it('offers a one-tap fix when a draft ignores a supported shape', () => {
  const p = project([message('user', 'One portrait 4:5 image of a tent'), message('assistant', 'Ready', 'run')]);
  const checks = checkDraft(card({ workflow: 'text-to-image', prompt: 'tent', output: { aspect: '9:16', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' }) as any, p);
  expect(checks[0]!.text).toBe('You asked for portrait 4:5; this draft is portrait 9:16.');
  expect(checks[0]!.fixes[0]!.patch(card({ workflow: 'text-to-image', prompt: 'tent', output: { aspect: '9:16', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' }).revisions[0]!.request as any)).toMatchObject({ output: { aspect: '4:5' } });
});

it('turns an unsupported square video into a visible choice, and flags unused attachments', () => {
  const p = project([message('user', 'A 5-second square clip from this', 'ask', ['asset-a']), message('assistant', 'Prepared', 'run')]);
  const checks = checkDraft(card({ workflow: 'text-to-video', prompt: 'clip', output: { aspect: '16:9', size: '768p', duration_seconds: 5 }, count: 1, seed: 'random', mode: 'sfw', audio: { output: 'generated' } }) as any, p);
  expect(checks[0]!.text).toContain("which video can't make");
  expect(checks[0]!.fixes.map(f => f.label)).toEqual(['Use portrait 9:16', 'Keep landscape 16:9']);
  expect(checks.some(c => c.text.includes('not used by this draft'))).toBe(true);
});

it('shows input names instead of internal tokens', () => {
  const p = project([], { asset_manifest: [{ id: 'asset-a', name: 'Moss fox', kind: 'image', note: '' }] });
  expect(readablePrompt({ workflow: 'reference-to-video', prompt: '<Picture 1> wakes and blinks', references: [{ id: 'input1', asset_id: 'asset-a', kind: 'image', role: 'first_frame' }] } as any, p)).toBe('“Moss fox” wakes and blinks');
});

it('does not apply a request about one draft to its siblings', () => {
  const p = project([message('user', 'Make only the cat one landscape'), message('assistant', 'Updated', 'run')]);
  const draft = card({ workflow: 'text-to-image', prompt: 'teapot', output: { aspect: '4:5', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' });
  expect(checkDraft(draft as any, p, 4)).toEqual([]);
  const all = project([message('user', 'Make them all square'), message('assistant', 'Updated', 'run')]);
  expect(checkDraft(draft as any, all, 4)[0]!.text).toBe('You asked for square; this draft is portrait 4:5.');
});

it('shows structured video prompts as plain sections', () => {
  const text = readablePrompt({ workflow: 'text-to-video', prompt: 'integrated_multimodal_description: A paper wave rolls in.\n[Shot 1] Slow push.\noverall_soundscape: Silence.\nnon_diegetic_music: N/A' } as any, project([]));
  expect(text).toBe('Scene: A paper wave rolls in.\nPart 1: Slow push.\nSound: Silence.');
});

it('turns an unsupported ratio such as 3:2 into a visible choice with a crop path', () => {
  const p = project([message('user', 'Two dawn postcards in landscape 3:2, no words'), message('assistant', 'Prepared', 'run')]);
  const checks = checkDraft(card({ workflow: 'text-to-image', prompt: 'cafe', output: { aspect: '16:9', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' }) as any, p);
  expect(checks[0]!.text).toBe("You asked for 3:2, which Seed can't make directly. This draft is landscape 16:9. After it's made, Crop turns it into 3:2 on this device, no GPU.");
  expect(checks[0]!.fixes.map(f => f.label)).toEqual(['Keep landscape 16:9, crop to 3:2 after']);
});

it('edits a structured video prompt in readable form and converts it back exactly', () => {
  const p = project([], { asset_manifest: [{ id: 'asset-a', name: 'Lantern', kind: 'image', note: '' }] });
  const r = { workflow: 'reference-to-video', prompt: 'integrated_multimodal_description: <Picture 1> sways.\n[Shot 1] Slow push.\nnon_diegetic_music: N/A', references: [{ id: 'input1', asset_id: 'asset-a', kind: 'image', role: 'first_frame' }] } as any;
  const e = editablePrompt(r, p)!;
  expect(e.text).toBe('Scene: “Lantern” sways.\nPart 1: Slow push.');
  expect(e.back(e.text)).toBe(r.prompt);
  expect(e.back('Scene: “Lantern” sways gently.\nPart 1: Slow push.')).toBe('integrated_multimodal_description: <Picture 1> sways gently.\n[Shot 1] Slow push.\nnon_diegetic_music: N/A');
  expect(editablePrompt({ workflow: 'text-to-image', prompt: 'A plain prompt' } as any, p)).toBeNull();
});

it('points out sound nobody asked for, with silence one tap away', () => {
  const request = { workflow: 'text-to-video', prompt: 'steam rising', output: { aspect: '16:9', size: '768p', duration_seconds: 5 }, count: 1, seed: 'random', mode: 'sfw', audio: { output: 'generated' } };
  const quiet = checkDraft(card(request) as any, project([message('user', 'A 5-second clip of steam rising'), message('assistant', 'Prepared', 'run')]));
  const sound = quiet.find(c => c.text.includes('added sound'))!;
  expect(sound.fixes.map(f => f.label)).toEqual(['Make it silent', 'Keep the sound']);
  expect(sound.fixes[0]!.patch(request as any)).toMatchObject({ audio: { output: 'silent' } });
  const asked = checkDraft(card(request) as any, project([message('user', 'A clip of steam rising with soft ambient sound'), message('assistant', 'Prepared', 'run')]));
  expect(asked.some(c => c.text.includes('added sound'))).toBe(false);
});

it('reads a clip’s own shot tags as parts, and converts them back exactly', () => {
  const r = { workflow: 'reference-to-video', prompt: '[Shot 1] Mara climbs the stairs.\nThe lamp glows (as in [Shot 2]).', output: { aspect: '16:9', size: '768p' }, count: 1, seed: 'random', mode: 'sfw', references: [] };
  expect(readablePrompt(r as any, project([]))).toBe('Part 1: Mara climbs the stairs.\nThe lamp glows (as in part 2).');
  const e = editablePrompt(r as any, project([]))!;
  expect(e.back(e.text + ' Slowly.')).toBe('[Shot 1] Mara climbs the stairs.\nThe lamp glows (as in [Shot 2]). Slowly.');
});

it('keeps a draft’s checks after the owner edits it by hand', () => {
  const p = project([message('user', 'A portrait poster from this', 'ask', ['asset-a']), message('assistant', 'Prepared', 'run')]);
  const request = { workflow: 'text-to-image', prompt: 'poster', output: { aspect: '4:5', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' };
  const edited = { id: 'card', workflow: 'text-to-image', revisions: [{ number: 1, request, notes: {}, decision: 'undecided', job_ids: [], run_id: 'run' }, { number: 2, request: { ...request, prompt: 'poster, horizon low' }, notes: {}, decision: 'undecided', job_ids: [] }] };
  expect(checkDraft(edited as any, p).some(c => c.text.includes('not used by this draft'))).toBe(true);
});

it('lists brief details a draft leaves out, and adds them in one step', () => {
  const brief = ['# The Last Tide', '', '**Characters**', '- **Mara**: 32 years old, warm brown skin, short black curly bob, small scar through her left eyebrow.', '- **Wardrobe**: Mustard-yellow waxed raincoat over a dark teal sweater, brass compass on a red cord.', '', '## Rules', '- Soft film grain'].join('\n');
  const prompt = 'Medium shot of Mara, warm brown skin and short black curls, in a mustard waxed raincoat over a teal sweater, brass compass on a red cord, at the lighthouse.';
  expect(briefGaps(prompt, brief)).toEqual(['small scar through her left eyebrow', 'soft film grain']);
  expect(briefGaps('An empty stormy sea at dawn, soft film grain.', brief)).toEqual([]);
  const request = { workflow: 'text-to-image', prompt, output: { aspect: '16:9', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' };
  const check = checkDraft(card(request) as any, project([message('user', 'Shot 1'), message('assistant', 'Ready', 'run')], { brief })).find(c => c.code === 'continuity')!;
  expect(check.text).toBe('Missing from this prompt: Mara’s small scar through her left eyebrow; “soft film grain”.');
  expect(check.soft).toBe(true);
  expect((check.fixes[0]!.patch(request as any) as any).prompt).toBe(prompt.replace('Mara,', 'Mara, with small scar through her left eyebrow,') + ' Soft film grain.');
});

it('reads shape words about faces, rooms and camera moves as description, not canvas', () => {
  expect(askedFor([message('user', 'Mira has a square face and a tall lighthouse behind her; a wide establishing shot')] as any).aspect).toBeUndefined();
  expect(askedFor([message('user', 'A portrait of Mira at dusk')] as any).aspect).toBeUndefined();
  expect(askedFor([message('user', 'Make it square please')] as any).aspect).toBe('1:1');
  expect(askedFor([message('user', 'Make it portrait for phones')] as any).aspect).toBe('portrait');
});

it('still flags an attached image the draft never used after a follow-up revision', () => {
  const p = project([message('user', 'A poster of her from this', 'ask', ['asset-a']), message('assistant', 'Prepared', 'run1'), message('user', 'Make the sky darker', 'ask2'), message('assistant', 'Updated', 'run2')]);
  const request = { workflow: 'text-to-image', prompt: 'poster', output: { aspect: '4:5', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' };
  const c = { id: 'card', workflow: 'text-to-image', revisions: [{ number: 1, request, notes: {}, decision: 'undecided', job_ids: [], run_id: 'run1' }, { number: 2, request: { ...request, prompt: 'poster, darker sky' }, notes: {}, decision: 'undecided', job_ids: [], run_id: 'run2' }] };
  expect(checkDraft(c as any, p).some(x => x.text.includes('not used by this draft'))).toBe(true);
});

it('does not ask a distant figure for face details, and drops a stray "and"', () => {
  const brief = ['## Characters', '- Maren: freckles, copper braid, a wool scarf, and black rubber boots'].join('\n');
  expect(briefGaps('Extreme wide shot: Maren tiny in frame on the cliff, wool scarf', brief)).toEqual([]);
  expect(briefGaps('Close-up of Maren, copper braid', brief)).toEqual(['freckles', 'a wool scarf']);
});

it('reads a clock time as scene content and a decimal ratio as a shape', () => {
  expect(askedFor([message('user', 'A red station clock stopped at 6:17 above the platform')] as any).other).toBeUndefined();
  expect(askedFor([message('user', 'The clock reads 6:17 pm')] as any).other).toBeUndefined();
  expect(askedFor([message('user', 'Frame everything for 2.39:1 widescreen')] as any).other).toBe('2.39:1');
  expect(askedFor([message('user', 'A 3:2 postcard')] as any).other).toBe('3:2');
});

it('counts a named character as covering who they are, and skips hair in a close-up of hands', () => {
  const brief = ['## Characters', '- Ines: 10-year-old girl, short black bob, freckles, red raincoat'].join('\n');
  expect(briefGaps('Medium shot of 10-year-old Ines in a red raincoat, short black bob', brief)).toEqual(['freckles']);
  expect(briefGaps('Close-up of Ines’s hands on the brass lens, red raincoat cuffs', brief)).toEqual([]);
});

it('keeps the video engine scaffold out of the editor and puts it back at the start of the scene', () => {
  const p = project([], { asset_manifest: [{ id: 'asset-a', name: 'Shot 2. Profile', kind: 'image', note: '' }] });
  const lead = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
  const r = { workflow: 'reference-to-video', prompt: `integrated_multimodal_description: ${lead} Mara pauses.\n[Shot 1] Slow drift right.`, references: [{ id: 'input1', asset_id: 'asset-a', kind: 'image', role: 'first_frame' }] } as any;
  expect(readablePrompt(r, p)).toBe('Scene: Mara pauses.\nPart 1: Slow drift right.');
  const e = editablePrompt(r, p)!;
  expect(e.text).toBe('Scene: Mara pauses.\nPart 1: Slow drift right.');
  expect(e.back(e.text)).toBe(r.prompt);
  expect(e.back('Scene: Mara pauses, then looks back.\nPart 1: Slow drift right.')).toBe(`integrated_multimodal_description: ${lead} Mara pauses, then looks back.\n[Shot 1] Slow drift right.`);
});

it('making a clip silent also rewrites its Sound section', () => {
  const request = { workflow: 'text-to-video', prompt: 'Scene: steam rising.\noverall_soundscape: kettle hiss and rain\nCamera: static', output: { aspect: '16:9', size: '768p', duration_seconds: 5 }, count: 1, seed: 'random', mode: 'sfw', audio: { output: 'generated' } };
  expect(silencedPrompt('Scene: steam.\nSound: kettle hiss,\nrain on glass\nCamera: static')).toBe('Scene: steam.\nSound: Silence.\nCamera: static');
  expect(silencedPrompt('No sound section here')).toBe('No sound section here');
  const fix = checkDraft(card(request) as any, project([message('user', 'A 5-second clip of steam rising'), message('assistant', 'Prepared', 'run')])).find(c => c.text.includes('added sound'))!.fixes[0]!;
  expect(fix.patch(request as any)).toMatchObject({ audio: { output: 'silent' } });
});

it('silences the video format’s own soundscape field', () => {
  expect(silencedPrompt('integrated_multimodal_description: steam.\noverall_soundscape: kettle hiss\nnon_diegetic_music: N/A')).toBe('integrated_multimodal_description: steam.\noverall_soundscape: Silence.\nnon_diegetic_music: N/A');
});

it('does not treat a project-wide continuity rule as a missing detail', () => {
  const brief = '## Rules\n- Maintain strict continuity of Nia’s wardrobe across shots\n- Soft film grain';
  const gaps = briefGapList('A wide shot of a harbour at dusk', brief).map(g => g.text);
  expect(gaps).toEqual(['soft film grain']);
});

it('the continuity fix changes the prompt even when the brief writes the name in capitals', () => {
  const out = addBriefDetails('Mara walks the pier at dusk.', [{ who: 'MARA', text: 'carries a small tin storm lantern' }]);
  expect(out).toBe('Mara, who carries a small tin storm lantern, walks the pier at dusk.');
  expect(addBriefDetails('Hands grip a lantern.', [{ who: 'Eli', text: 'green oilskin' }])).toBe('Hands grip a lantern. Eli: green oilskin.');
});

it('reads portrait framing as composition, not as a request for a portrait canvas', () => {
  expect(askedFor([message('user', 'Make Shot 2 a 65mm three-quarter portrait framing of Mara')] as any).aspect).toBeUndefined();
  expect(askedFor([message('user', 'Use portrait framing for the close-up')] as any).aspect).toBeUndefined();
  expect(askedFor([message('user', 'A portrait shot of the keeper')] as any).aspect).toBeUndefined();
  expect(askedFor([message('user', 'Make it portrait, please')] as any).aspect).toBe('portrait');
  expect(askedFor([message('user', 'A vertical poster')] as any).aspect).toBe('portrait');
});

it('reads "she has …" as the detail itself and skips instructions inside a character line', () => {
  const brief = '## Characters\n- Mara: short black curls, she has a silver triangular earring, preserve Mara’s specific wardrobe and accessories';
  const gaps = briefGapList('Mara walks along the pier with short black curls.', brief).map(g => g.text);
  expect(gaps).toEqual(['a silver triangular earring']);
});

it('does not hold every draft to one shape when a message asks for several', () => {
  const said = askedFor([message('user', 'Plan them first: a portrait one-sheet, a square tile and a wide banner.')] as any);
  expect(said.aspect).toBeUndefined();
  expect(said.mixed).toBe(true);
});

it('a tiny light in the scene does not switch off character checks', () => {
  const brief = '## Characters\n- Maren: red wool hat, freckles';
  const gaps = briefGapList('A two-shot: Maren and her grandfather in the lamp room, a tiny ship light far out at sea.', brief).map(g => g.text);
  expect(gaps).toContain('red wool hat');
});

it('reads "square" as a shape only when it is about the picture', () => {
  expect(askedFor([message('user', 'Her ochre oilskin has a square navy repair on the left sleeve.')] as any).aspect).toBeUndefined();
  expect(askedFor([message('user', 'Make it square please')] as any).aspect).toBe('1:1');
  expect(askedFor([message('user', 'A square image of the lantern')] as any).aspect).toBe('1:1');
  expect(askedFor([message('user', 'Lantern on a table, square.')] as any).aspect).toBe('1:1');
});

it('offers the closest size when the user asked for exact pixels', () => {
  const p = project([message('user', 'Three keyframes at 1920×1080, one take each.'), message('assistant', 'Ready', 'run')]);
  const req = { workflow: 'text-to-image', prompt: 'harbour', output: { aspect: '16:9', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw' };
  const check = checkDraft(card(req) as any, p).find(c => c.code === 'size')!;
  expect(check.text).toMatch(/^You asked for 1920 × 1080; this draft is 1344 × 768\./);
  const patched = check.fixes[0]!.patch(req as any) as any;
  expect(patched.output.size).not.toBe('image-768');
});

it('does not ask for the details of a character the prompt puts out of frame', () => {
  const brief = '## Characters\n- Asha: mustard scarf, left-ear cuff\n\n## Rules\n- Soft film grain';
  const gaps = briefGapList('The empty bench after departure; Asha is out of frame, only her flower remains on the slats.', brief).map(g => g.text);
  expect(gaps).toEqual(['soft film grain']);
});

it('does not ask a picture to show personality', () => {
  const brief = '## Characters\n- Odile: silver bob, tortoiseshell glasses, calm, dry humour, kind';
  const gaps = briefGapList('Odile in the tram doorway.', brief).map(g => g.text);
  expect(gaps).toEqual(['silver bob', 'tortoiseshell glasses']);
});

it('never splits a possessive when adding details, and leaves legwear out of a waist-up shot', () => {
  expect(addBriefDetails('Close on Mara’s gloved hands around the lantern.', [{ who: 'Mara', text: 'mustard raincoat' }])).toBe(
    'Close on Mara’s gloved hands around the lantern. Mara: mustard raincoat.',
  );
  const brief = '## Characters\n- Mara: mustard raincoat, navy trousers, scuffed boots';
  const gaps = briefGapList('A waist-up reference of Mara on the pier.', brief).map(g => g.text);
  expect(gaps).toEqual(['mustard raincoat']);
});

it('words appended at the end of a clip prompt go into the picture, not the sound section', () => {
  const r = { workflow: 'text-to-video', prompt: 'integrated_multimodal_description: Fog over the pier.\n[Shot 1] Slow push in.\noverall_soundscape: Silence.\nnon_diegetic_music: Soft strings.', references: [] } as any;
  const e = editablePrompt(r, project([]))!;
  const out = e.back(e.text + ' Hold on her face for the last second.');
  expect(out).toContain('[Shot 1] Slow push in. Hold on her face for the last second.');
  expect(out).toContain('overall_soundscape: Silence.');
  expect(out.endsWith('non_diegetic_music: Soft strings.')).toBe(true);
});

it('bulk continuity fixes stay grammatical and keep shot-specific rules to their shot', () => {
  const brief = '## Characters\n- Mara: female, late 40s, weathered mustard oilskin coat, navy knitted jumper\n\n## Rules\n- The amber light in Shot 4 is a slow three-second fade\n- Soft film grain';
  const prompt = 'Medium shot of Mara, standing on the pier.';
  const gaps = briefGapList(prompt, brief);
  expect(gaps.map(g => g.text)).toEqual(['weathered mustard oilskin coat', 'navy knitted jumper', 'soft film grain']);
  expect(addBriefDetails(prompt, gaps)).toBe('Medium shot of Mara, with weathered mustard oilskin coat, navy knitted jumper, standing on the pier. Soft film grain.');
});

it('reads who is in frame and the framing from the shot record before the wording', () => {
  const brief = '## Characters\n- Mara: weathered mustard oilskin coat, small scar through her left eyebrow\n- Ines: red knitted hat\n';
  // The words never name Ines, but the record says she is in the shot: her hat is checked.
  expect(briefGapList('Two figures on the pier at dusk.', brief, { cast: ['Ines'] }).map(g => g.text)).toEqual(['red knitted hat']);
  // Mara is named in the words but recorded as out of frame: nothing about her is checked.
  expect(briefGapList('Ines waits on the pier while Mara calls from the boat.', brief, { cast: ['Ines'], offscreen: ['Mara'] }).map(g => g.text)).toEqual(['red knitted hat']);
  // A recorded wide framing checks the outfit only, never a scar.
  expect(briefGapList('Mara walks the causeway.', brief, { cast: ['Mara'], framing: 'wide' }).map(g => g.text)).toEqual([]);
});

it('checks the look of the place a shot is set in, not only its characters', () => {
  const brief = '## Characters\n- Mara: mustard oilskin coat\n\n## Places\n- The Lighthouse: white tower, red iron door, salt-stained windows\n- Harbour: green fishing boats\n';
  // Recorded place: the lighthouse details are checked, the harbour's are not.
  expect(briefGapList('Mara stands by a white tower in a mustard oilskin coat.', brief, { cast: ['Mara'], place: 'Lighthouse door', framing: 'medium' }).map(g => g.text)).toEqual(['red iron door', 'salt-stained windows']);
  // No record: the place is found by its name in the words.
  expect(briefGapList('Dawn over the harbour, no people.', brief).map(g => g.text)).toEqual(['green fishing boats']);
  // A close-up shows too little of the place.
  expect(briefGapList('Close-up of Mara in a mustard oilskin coat.', brief, { cast: ['Mara'], place: 'Lighthouse', framing: 'close-up' })).toEqual([]);
});

it('reads the cast and places from the brief, folding wardrobe lines into the character above', async () => {
  const { castFromBrief } = await import('../shared/cast.js');
  const brief = '# Salt Lamp\n## Characters\n- **Maren** (12): black bob, freckles\n- Wardrobe: mustard oilskin raincoat\n- Tomas: white beard\n\n## Places\n- The Lighthouse: white tower, red door\n\n## Rules\n- No text: anywhere\n';
  expect(castFromBrief(brief)).toEqual([
    { kind: 'character', name: 'Maren', look: 'black bob, freckles; mustard oilskin raincoat' },
    { kind: 'character', name: 'Tomas', look: 'white beard' },
    { kind: 'place', name: 'The Lighthouse', look: 'white tower, red door' },
  ]);
});

it('drops subject tags from video prompts without leaving empty brackets or doubled colons', () => {
  const text = readablePrompt({ workflow: 'text-to-video', prompt: 'subject_definitions: <Subject 1>: Ines Marrow, a clockmaker.\n[Shot 1] Ines (<Subject 1>) bends over the bench.' } as any, project([]));
  expect(text).toBe('Subjects: Ines Marrow, a clockmaker.\nPart 1: Ines bends over the bench.');
});

it('does not ask for a look that an approved reference image of the draft already carries', () => {
  const brief = ['## Characters', '- Mara: small scar through her left eyebrow, mustard raincoat', '## Rules', '- Soft film grain'].join('\n');
  const prompt = 'Medium shot of the woman from <image1> at the lighthouse.';
  const request = { workflow: 'image-to-image', engine: 'klein', prompt, output: { aspect: '16:9', size: 'image-768' }, count: 1, seed: 'random', mode: 'sfw', references: [{ id: 'input1', asset_id: 'mara-ref', kind: 'image', role: 'source' }], shot: { number: 2, name: 'The Door', cast: ['Mara'], framing: 'medium' } };
  const chat = (picks: Record<string, string>) => project([message('user', 'Shot 2'), message('assistant', 'Ready', 'run')], { brief, picks });
  expect(checkDraft(card(request) as any, chat({})).find(c => c.code === 'continuity')!.text).toContain('Mara’s');
  expect(checkDraft(card(request) as any, chat({ 'ref:Mara': 'mara-ref' })).find(c => c.code === 'continuity')!.text).toBe('Missing from this prompt: “soft film grain”.');
});

it('never asks to add a negative rule or a relationship word to a prompt', () => {
  const brief = ['## Characters', '- Pim: 9, grandson, odd laces', '## Rules', '- No text, logos, or watermarks', '- Never show the sea'].join('\n');
  expect(briefGaps('Pim with odd laces walks the orchard.', brief)).toEqual([]);
});

it('adds cast and places from another project under their headings', async () => {
  const { addToBrief, castFromBrief } = await import('../shared/cast.js');
  const brief = '# Picture book\n\n## Characters\n- Odile Brann: veil\n';
  const out = addToBrief(brief, [
    { kind: 'character', name: 'Pim', look: '9, odd laces' },
    { kind: 'place', name: 'The Orchard', look: 'old apple trees' },
    { kind: 'character', name: 'odile brann', look: 'duplicate' },
  ]);
  expect(castFromBrief(out).map(e => `${e.kind}:${e.name}:${e.look}`)).toEqual([
    'character:Pim:9, odd laces',
    'character:Odile Brann:veil',
    'place:The Orchard:old apple trees',
  ]);
});
