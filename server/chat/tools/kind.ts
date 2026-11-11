import type { ChatMode, ChatWorkflow } from '../../../shared/chat.js';
import type { Jobs } from '../../jobs.js';
import { chatKinds } from '../model.js';
import { current, defineTool, ToolFailure, type ToolSession } from './define.js';

/**
 * The owner's ready styles a kind of work can use: pictures from words take image styles, words-only clips the
 * first/last-frame ones, animations any clip style. Edits (FLUX 3 Image Klein) take none.
 */
export function stylesFor(jobs: Jobs, mode: ChatMode, workflow: ChatWorkflow | null) {
  const fits = (route: 'image' | 'fl' | 'ref') =>
    workflow === 'text-to-image'
      ? route === 'image'
      : workflow === 'text-to-video'
        ? route === 'fl'
        : workflow === 'reference-to-video' && route !== 'image';
  return jobs.loras.list(mode).filter(l => l.source_status === 'ready' && fits(l.route));
}
/** The styles as the agent reads them (available_loras). */
export const styleCatalog = (jobs: Jobs, mode: ChatMode, workflow: ChatWorkflow | null) =>
  stylesFor(jobs, mode, workflow).map(l => ({
    id: l.id,
    revision: l.revision,
    name: l.name,
    version: l.version,
    description: l.description ?? '',
    trigger_words: l.trigger_words ?? [],
    source_status: l.source_status,
    default_scale: l.default_scale,
    min_scale: l.min_scale,
    max_scale: l.max_scale,
    compatible_with:
      l.route === 'image'
        ? 'Krea images'
        : l.route === 'fl'
          ? 'Text to video and first/last-frame guides'
          : 'General image/video/audio references',
  }));

/**
 * The agent chooses the kind of work itself. `chosen` loads that kind's guide and draft tools for the agent's next
 * model request.
 */
export function kindTool(session: ToolSession, chosen: (workflow: ChatWorkflow) => void) {
  return defineTool({
    name: 'choose_kind',
    label: 'Choose kind',
    description:
      'Choose what kind of media to prepare before creating requests: image (a new still from words), edit (change an existing image; needs an image input), video (a new clip from words only), animate (a clip guided by image, video or audio inputs, such as a start frame). Call it on its own, wait for its result, and only then call create_request, whenever the needed kind differs from the active kind. It does not generate media.',
    properties: { kind: { type: 'string', enum: Object.keys(chatKinds) } },
    run: input => {
      const kind = String(input.kind);
      if (!Object.hasOwn(chatKinds, kind))
        throw new ToolFailure('Unknown kind.', { choices: Object.keys(chatKinds) }, true);
      const workflow = chatKinds[kind as keyof typeof chatKinds],
        chat = current(session);
      // Drafts of other kinds already in the open plan stay; new drafts of this kind join the same plan.
      if (chat.workflow !== workflow) {
        chat.workflow = workflow;
        chat.version++;
        session.host.save(chat);
      }
      chosen(workflow);
      return {
        kind,
        available_loras: styleCatalog(session.host.jobs, chat.mode, workflow),
        next_action:
          'Prepare the drafts now with create_request, or edit_request for an existing draft. Drafts of other kinds stay in the plan; editing one with these tools turns it into this kind and keeps its title and prompt unless you change them.',
      };
    },
  });
}
