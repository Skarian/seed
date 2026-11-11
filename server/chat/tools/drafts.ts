import { randomUUID } from 'node:crypto';
import { validateToolArguments } from '@earendil-works/pi-ai';
import type { ChatCard, ChatWorkflow } from '../../../shared/chat.js';
import { castOf } from '../../../shared/cast.js';
import { shotsFromBrief, shotNameKey, shotFromTitle } from '../../../shared/shots.js';
import { asksSavedStyle } from '../../../shared/styles-asked.js';
import { loraRoute, isVideoWorkflow } from '../../../shared/workflows.js';
import type { ImageRequest } from '../../workflows.js';
import { addPlan, agentRequest, latest, openGroup, referenceMode } from '../model.js';
import { validateChatReferences, validateCastReferences, withCastLooks } from '../references.js';
import { requestToolSchemas, prepareToolRequest, requestToolResultError, toolInputLabels } from '../request-tools.js';
import { current, defineTool, ToolFailure, type ToolSession } from './define.js';
import { stylesFor } from './kind.js';
import { silencedPrompt } from '../../../shared/generation.js';
import { asked, asksForMotion, asksForSound } from '../../../shared/asked.js';

/** create_request and edit_request for one kind of work: a draft saved for review, never made. */
export function draftTools(session: ToolSession, workflow: ChatWorkflow) {
  const { host } = session;
  const { mode: chatMode } = host.get(session.id);
  const schemas = requestToolSchemas(workflow, chatMode, stylesFor(host.jobs, chatMode, workflow).length > 0);
  const mode = referenceMode();
  return (['create', 'edit'] as const).map(operation =>
    defineTool({
      name: `${operation}_request` as const,
      label: operation === 'create' ? 'Create request' : 'Edit request',
      description:
        (operation === 'create'
          ? 'Prepare one new request for user review. Does not generate media.'
          : 'Change an existing request. Copy request_id from context. Send only changed fields; all omitted fields stay unchanged.') +
        (workflow === 'image-to-image'
          ? ' Styles (loras) cannot be used with edits or shots from reference images (FLUX 3 Image Klein); they work with new pictures from words (Krea 2) and clips. If the user asked for a style here, describe the look in the prompt and tell them in one sentence that the style was not applied and that a words-only version can use it.'
          : ''),
      parameters: schemas[operation],
      failure: error => requestToolResultError(error, operation),
      run: value => {
        const chat = current(session);
        // choose_kind earlier in this step switched the kind of work: the draft is saved as that kind, and its fields
        // (checked by the agent library for the old kind) are checked again for it, so the agent never reports drafts
        // that were silently dropped.
        const kind: ChatWorkflow = chat.workflow ?? workflow;
        if (kind !== workflow)
          validateToolArguments(
            {
              name: `${operation}_request`,
              description: '',
              parameters: requestToolSchemas(kind, chatMode)[operation],
            },
            { type: 'toolCall', id: '', name: `${operation}_request`, arguments: value },
          );
        // A plan can hold several kinds of work (keyframes, their edits and their animations); each draft has its own.
        let group = openGroup(chat);
        const editId = operation === 'edit' ? String(value.request_id) : session.target;
        const card = editId ? group?.cards.find(c => c.id === editId) : undefined;
        if (editId && !card)
          throw new ToolFailure(
            'Request not found. Use a request_id listed in current review. A failed create has no request_id.',
            {},
            true,
          );
        if (card && session.snapshots.get(card.id) !== latest(card).number)
          throw new ToolFailure(
            'Request changed after this agent started. Read the current request before editing; no changes were saved.',
            {},
            true,
          );
        // Editing a draft with another kind's tools changes its kind in place (a shot becomes an edit of a reference,
        // or its animation): it starts from that kind's defaults and keeps its title and prompt.
        const changesKind = Boolean(card && card.workflow !== kind);
        // What is drafted must match what was asked: a new clip needs the person to have asked for motion in their
        // recent messages, so a request for stills can never come back as "Make 2 clips".
        if (!card && /video/.test(kind)) {
          const recent = asked(chat.messages, 2).join(' ');
          if (recent.trim() && !asksForMotion(recent))
            throw new ToolFailure(
              'The user did not ask for a clip. Draft a picture instead (call choose_kind with image or edit), or ask whether they want a clip.',
            );
        }
        // A draft never changes between picture and clip in place: a still plan would silently become "Make 2 clips",
        // or a clip plan would be lost. The other medium is always a new draft.
        if (changesKind && /video/.test(card!.workflow) !== /video/.test(kind))
          throw new ToolFailure(
            /video/.test(card!.workflow)
              ? 'This draft is a clip. A picture is a new draft: call choose_kind for it and use create_request; leave the clip draft as it is unless the user asks to remove it.'
              : 'This draft is a picture. A clip (an animation of it) is a new draft: use create_request with the picture as its start frame; leave the picture draft as it is.',
          );
        const prior = card ? latest(card).request : undefined;
        const request = prepareToolRequest(
          {
            workflow: kind,
            mode: chat.mode,
            assets: session.assets,
            previous: changesKind ? undefined : prior,
            referenceMode: mode,
            cloudWorkflows: host.jobs.pool.cloudWorkflows(),
          },
          changesKind
            ? (({ request_id: _id, ...rest }) => ({ title: prior!.title, prompt: prior!.prompt, ...rest }))(value)
            : value,
        );
        // Where work runs is the owner's policy: a draft Seed writes keeps the project's latest explicit choice (Seed
        // PC only, say) unless this call names one, so a revision never widens it to a rented GPU.
        if (!Object.hasOwn(value, 'runs_on') && request.target === undefined) {
          const chosen =
            prior?.target ??
            // Groups and cards are kept in the order they were made: the last one with a choice is the latest.
            chat.groups
              .flatMap(g => g.cards)
              .map(c => latest(c).request.target)
              .filter(Boolean)
              .at(-1);
          if (
            chosen &&
            !(
              chosen === 'cloud' &&
              request.engine === 'klein' &&
              !host.jobs.pool.cloudWorkflows().includes('image-to-image:klein')
            )
          )
            request.target = chosen;
        }
        for (const ref of request.references ?? [])
          if (!chat.assets.includes(ref.asset_id)) throw Error('Input is not attached to this chat.');
        host.assertAssets(chat, [...new Set((request.references ?? []).map(r => r.asset_id))]);
        validateChatReferences(request);
        request.prompt = validateCastReferences(request, castOf(chat), chat.choices, session.castWarned);
        // A saved style named in the prompt must also be selected, so the words and the controls agree.
        if (request.workflow !== 'image-to-image') {
          const named = host.jobs.loras
            .list(chat.mode)
            .filter(l => l.name && l.name.length > 3 && request.prompt.toLowerCase().includes(l.name.toLowerCase()));
          if (named.length && !(request.loras ?? []).some(x => named.some(l => l.id === x.id)))
            throw Error(
              `The prompt names the saved style “${named[0]!.name}” but does not select it. Set loras to id ${named[0]!.id}, revision ${named[0]!.revision}, and take the style name out of the prompt; if it cannot be used for this kind of draft, say so.`,
            );
        }
        // Each referenced character's look from the brief rides along in words, so a new frame keeps it.
        request.prompt = withCastLooks(request, castOf(chat), chat.choices);
        // Sound nobody asked for is a creative change: a new clip stays silent unless the user's recent messages ask
        // for sound (an existing draft keeps the sound it already had).
        const silenced =
          isVideoWorkflow(request.workflow) &&
          request.audio?.output !== 'silent' &&
          !asksForSound(asked(chat.messages, 3).join(' ')) &&
          prior?.audio?.output !== request.audio?.output;
        if (silenced) request.audio = { ...request.audio, output: 'silent' };
        // A silent clip must not keep describing sound: its sound section reads "Silence." Only when the clip becomes
        // silent in this change (or Seed wrote new sound text): a sound section the previous version already had,
        // including anything the owner typed there, is left as it was.
        const priorSound = prior ? silencedPrompt(prior.prompt) === prior.prompt : true;
        if (
          isVideoWorkflow(request.workflow) &&
          request.audio?.output === 'silent' &&
          (silenced ||
            prior?.audio?.output !== 'silent' ||
            (priorSound && silencedPrompt(request.prompt) !== request.prompt))
        )
          request.prompt = silencedPrompt(request.prompt);
        if (request.workflow !== 'image-to-image')
          host.jobs.loras.resolve(request.loras, loraRoute(request), request.mode);
        group ??= addPlan(chat, 'assembling', kind, []);
        let saved: ChatCard;
        const before = card ? latest(card).request : undefined;
        if (card) {
          card.revisions.push(host.revision(chat, request, latest(card).number + 1, latest(card).source_job_id));
          card.workflow = kind;
          saved = card;
        } else {
          if (group.cards.length >= 16) throw Error('A review supports at most 16 requests.');
          // A second draft with the same title is almost always a duplicate: point the agent at editing the first.
          const twin = request.title
            ? group.cards.find(
                c => (latest(c).request.title ?? '').trim().toLowerCase() === request.title!.trim().toLowerCase(),
              )
            : undefined;
          if (twin)
            throw Error(
              `A draft titled "${request.title}" is already in this plan (request_id ${twin.id}). Change it with edit_request instead of creating another, or give the new draft a different title if it is truly separate work.`,
            );
          saved = { id: randomUUID(), workflow: kind, revisions: [host.revision(chat, request, 1)] };
          group.cards.push(saved);
        }
        latest(saved).run_id = session.runId;
        session.snapshots.set(saved.id, latest(saved).number);
        if (session.target === saved.id) session.target = undefined;
        delete group.submission_error;
        host.save(chat);
        return receipt(session, chat, request, before, saved, silenced);
      },
    }),
  );
}

/** A verified receipt: what actually changed and which named images the draft now uses. Replies must match it. */
function receipt(
  session: ToolSession,
  chat: ReturnType<typeof current>,
  request: ImageRequest,
  before: ImageRequest | undefined,
  saved: ChatCard,
  silenced: boolean,
) {
  const { host } = session;
  const manifest = host.contextAssets(chat);
  const named = (refs: ImageRequest['references']) =>
    (refs ?? []).map(r => ({ role: r.role, image: manifest.find(a => a.id === r.asset_id)?.name ?? 'an input' }));
  const changed = before
    ? (['prompt', 'title', 'count', 'output', 'audio', 'loras', 'seed', 'detail'] as const)
        .filter(k => JSON.stringify(before[k]) !== JSON.stringify(request[k]))
        .map(String)
    : [];
  const inputsBefore = named(before?.references),
    inputsNow = named(request.references);
  if (before && JSON.stringify(inputsBefore) !== JSON.stringify(inputsNow)) changed.push('inputs');
  // A words-only draft made while the user attached images: say so in the result, so the reply cannot claim otherwise.
  const attached = [...chat.messages].reverse().find(m => m.role === 'user')?.assets ?? [];
  const wordsOnly =
    (request.workflow === 'text-to-image' || request.workflow === 'text-to-video') &&
    attached.some(a => host.jobs.media.get(a)?.kind === 'image');
  const noStyle = !(request.loras ?? []).length;
  // A changed shot whose brief line still describes the old version: the agent is shown that line, so a change of
  // mind reaches the shot list (the Storyboard reads it) and not only the draft.
  const own = shotFromTitle(request.title ?? '');
  const line =
    before && changed.includes('prompt') && own.n !== null
      ? shotsFromBrief(host.get(session.id).brief).find(
          s => shotNameKey(s.name) === shotNameKey(own.name) || s.n === own.n,
        )
      : undefined;
  return {
    saved: true,
    status: 'draft saved for review; this draft has not been made yet',
    next_action: before
      ? 'Report only the fields listed in changed, and name the images in inputs_now. If something the user asked for is not in changed, say plainly that it was not changed.'
      : 'Tell the user the draft is ready to review and has not been made yet. Name the images in inputs_now.',
    ...(before ? { changed, inputs_before: inputsBefore } : {}),
    inputs_now: inputsNow,
    // A style the user asked for cannot ride on a picture made from references: the reply must say so.
    ...(request.workflow === 'image-to-image' && noStyle && asked(chat.messages, 3).some(asksSavedStyle)
      ? {
          no_style:
            'No style is attached to this draft: styles cannot be used on pictures made from references (FLUX 3 Image Klein). Do not say it is in the style. If the user asked for a style on this draft, tell them in one sentence that the look is described in words instead, and that a picture from words (Krea 2) can use the style with less likeness; if their style was for another draft, say nothing about it here.',
        }
      : {}),
    // A style asked for on a draft that can carry one, but not attached: the reply must not claim it.
    ...(request.workflow !== 'image-to-image' && noStyle && asked(chat.messages, 1).some(asksSavedStyle)
      ? {
          style_missing:
            'This draft has no style attached. If the user asked for a style on this draft, call edit_request with loras set to that style (from the styles listed for this kind) before replying; never say a draft uses a style unless its request shows it in loras.',
        }
      : {}),
    ...(silenced
      ? {
          saved_silent:
            'Saved silent: the user did not ask for sound. Say the clip is silent and that sound can be added if they want it; do not describe any sound design.',
        }
      : {}),
    ...(wordsOnly
      ? {
          words_only:
            'The user attached images, but this draft is made from words only and does not use them. Do not say it uses or follows the attached image. If the user wants the image to guide this shot, call choose_kind with edit (or animate) and edit_request this draft with the image as its input; otherwise tell them plainly that this draft is words only.',
        }
      : {}),
    ...(line
      ? {
          brief_shot: `${line.n}. ${line.name}: ${line.action}`,
          brief_shot_note:
            'This is how the brief’s shot list still describes this shot. If the user’s change replaces any of it, call update_brief with that line rewritten (and its name, when the name no longer fits), and give the draft the same “Shot N: Name” title; otherwise leave the brief as it is.',
        }
      : {}),
    request_id: saved.id,
    revision: latest(saved).number,
    request: agentRequest(request, session.assets),
    reference_labels: Object.fromEntries(toolInputLabels(request.references ?? [])),
  };
}
