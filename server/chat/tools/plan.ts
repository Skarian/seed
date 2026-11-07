import { castOf } from '../../../shared/cast.js';
import { shotKey } from '../../../shared/choices.js';
import { shotsFromBrief, shotFromTitle } from '../../../shared/shots.js';
import { latest, openGroup } from '../model.js';
import { current, defineTool, namedInput, ToolFailure, type ToolSession } from './define.js';

/** The tools that shape the open plan and record the owner's choices when they ask in words. */
export function planTools(session: ToolSession) {
  const { host } = session;
  const leaveOut = defineTool({
    name: 'leave_out_request',
    label: 'Leave out request',
    description:
      'Leave a draft out of the open plan (left_out true), or put it back (left_out false). Use it whenever the user narrows the plan, drops a direction or asks for fewer drafts, so the plan matches what you say. The draft stays visible to the user, unselected, and is not deleted. Copy request_id from the current review.',
    properties: { request_id: { type: 'string' }, left_out: { type: 'boolean' } },
    run: input => {
      const chat = current(session),
        group = openGroup(chat),
        card = group?.cards.find(c => c.id === String(input.request_id));
      if (!group || !card)
        throw new ToolFailure('Request not found. Use a request_id listed in the current review.', {}, true);
      // A plan always keeps at least one selected draft: leaving out every draft would leave "Make 0 images" while the
      // reply says the plan is ready. To drop the whole plan, the user sets it aside.
      if (input.left_out !== false && !card.left_out && group.cards.filter(c => !c.left_out).length <= 1)
        throw new ToolFailure(
          'This is the last selected draft, so it stays in. To change it, edit it; if the user wants no drafts at all, tell them to set the plan aside.',
        );
      if (input.left_out === false) delete card.left_out;
      else card.left_out = true;
      const kept = group.cards.filter(c => !c.left_out).length;
      host.save(chat);
      return {
        request_id: card.id,
        left_out: Boolean(card.left_out),
        drafts_selected: kept,
        drafts_left_out: group.cards.length - kept,
        next_action: 'Describe the plan by the drafts still selected.',
      };
    },
  });
  // The order of drafts in the plan is the order of the film or book: the agent can set it.
  const order = defineTool({
    name: 'order_requests',
    label: 'Order drafts',
    description:
      'Put the drafts of the open plan in a new order (for example story or page order). Send every request_id of the current review once, in the new order.',
    properties: { request_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 16 } },
    run: input => {
      const chat = current(session),
        group = openGroup(chat),
        ids = (input.request_ids ?? []) as unknown[],
        cards = group?.cards ?? [];
      if (
        !group ||
        ids.length !== cards.length ||
        new Set(ids).size !== ids.length ||
        ids.some(x => !cards.some(c => c.id === x))
      )
        throw new ToolFailure('Send every request_id of the current review exactly once, in the new order.', {}, true);
      group.cards = ids.map(x => cards.find(c => c.id === x)!);
      host.save(chat);
      return {
        order: group.cards.map(c => latest(c).request.title ?? c.id),
        next_action: 'Say the new order in one short sentence.',
      };
    },
  });
  // The owner's choice of take for a shot, made by Seed when the owner asks in words ("use take 2 for shot 2").
  const chooseTake = defineTool({
    name: 'choose_take',
    label: 'Choose take',
    description:
      'Mark a made result as the chosen take for a numbered shot, when the user asks (for example "use take 2 for shot 2"). Give the shot number and the input handle of the result (an image is the chosen keyframe, a video the chosen clip). Use it once per shot the user names.',
    properties: { shot: { type: 'string', maxLength: 8 }, input: { type: 'string', maxLength: 20 } },
    run: input => {
      const chat = current(session);
      const shot = String(input.shot ?? '')
        .replace(/^shot\s*/i, '')
        .trim();
      const asset = namedInput(session, input.input);
      if (!/^\d{1,3}$/.test(shot) || !asset || (asset.kind !== 'image' && asset.kind !== 'video'))
        throw new ToolFailure('Give a shot number and the input handle of a made image or clip.');
      // The choice is stored by the shot's name (from the brief's shot list, else the result's own title), so it
      // follows the shot when shots are renumbered.
      const named =
        shotsFromBrief(chat.brief).find(s => s.n === Number(shot))?.name ??
        (() => {
          const meta = host.jobs.media.get(asset.asset_id)?.metadata as { job_id?: unknown } | undefined;
          const job = typeof meta?.job_id === 'string' ? host.jobs.get(meta.job_id) : undefined;
          const own = job?.request.title ? shotFromTitle(job.request.title) : undefined;
          return own && own.n === Number(shot) ? own.name : '';
        })();
      const kind = asset.kind === 'video' ? 'clip' : 'image';
      host.choose(session.id, { shot: shotKey(Number(shot), named), kind, asset: asset.asset_id });
      return {
        shot,
        chosen: kind === 'clip' ? 'clip' : 'keyframe',
        next_action: 'Say in one short sentence which take is now chosen for the shot.',
      };
    },
  });
  // The owner's approval of a reference image for a character, place or prop of the brief, when they ask in words.
  const approveReference = defineTool({
    name: 'approve_reference',
    label: 'Approve reference',
    description:
      'Approve a made image as the reference for a character, place or prop listed in cast_and_places, when the user asks (for example "approve take 3 as Ines\'s reference"). Give the name exactly as cast_and_places lists it and the input handle of the image. Shots that include that name are then drafted from it. Use it once per name.',
    properties: { name: { type: 'string', maxLength: 60 }, input: { type: 'string', maxLength: 20 } },
    run: input => {
      const chat = current(session);
      const wanted = String(input.name ?? '')
        .trim()
        .toLowerCase();
      const entry = castOf(chat).find(e => e.name.toLowerCase() === wanted);
      const asset = namedInput(session, input.input);
      if (!entry)
        throw new ToolFailure(
          'That name is not in cast_and_places. Add it to the brief first (update_brief), then approve.',
          { names: castOf(chat).map(e => e.name) },
        );
      if (!asset || asset.kind !== 'image') throw new ToolFailure('Give the input handle of a made image.');
      host.choose(session.id, { reference: entry.name, asset: asset.asset_id });
      return {
        name: entry.name,
        approved: true,
        next_action: 'Say in one short sentence that this image is now the approved reference for the name.',
      };
    },
  });
  return [leaveOut, order, chooseTake, approveReference];
}
