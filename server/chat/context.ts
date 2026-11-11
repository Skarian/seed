import type { TurnStep } from '../../shared/chat.js';
import { castOf } from '../../shared/cast.js';
import { approvedReference, referenceSkipped } from '../../shared/choices.js';
import { agentMentionContext } from './mentions.js';
import { agentRequest, chatKinds, latest, openGroup, referenceMode, type StoredChat } from './model.js';
import { chatReferenceLabels } from './references.js';
import { toolInputLabels, type ToolAsset } from './request-tools.js';
import { workerPolicy } from './rules.js';
import type { visualContext } from './visual-context.js';

/** One project asset as Seed reads it: its name in words, what it is chosen for, and its note. */
export interface ContextAsset {
  id: string;
  name: string;
  chosen_for?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
  note: string;
}

/** The project's media the agent can name: input1, input2… in the order of the asset manifest. */
export const toolAssetsOf = (manifest: ContextAsset[]): ToolAsset[] =>
  manifest
    .map((a, index) => ({
      handle: 'input' + (index + 1),
      asset_id: a.id,
      kind: a.kind as ToolAsset['kind'],
      duration_seconds: Number(a.metadata?.duration) || undefined,
    }))
    .filter(a => a.kind);

/** A reply names pictures, never Seed's handles: [[input21]] reads as the picture's own name. */
export const nameInputs = (text: string, toolAssets: ToolAsset[], manifest: ContextAsset[]) =>
  text.replace(/\[\[\s*(input\d+)\s*\]\]/gi, (_whole, handle: string) => {
    const a = toolAssets.find(x => x.handle === handle.toLowerCase());
    const name = a && manifest.find(m => m.id === a.asset_id)?.name;
    return name ? '“' + name + '”' : 'the picture';
  });

/** The drafts a turn works on (the one the owner asked about, or the plan's), each with its plan. */
const workingCards = (chat: StoredChat, ids: string[]) =>
  chat.groups.flatMap(group => group.cards.filter(c => ids.includes(c.id)).map(card => ({ group, card })));

/** The parts of video and audio inputs the turn's drafts use, so Seed looks at those frames. */
export function inputRanges(chat: StoredChat, cardIds: string[]) {
  const ranges = new Map<string, Array<{ start_seconds: number; duration_seconds: number; input_id: string }>>();
  for (const { card } of workingCards(chat, cardIds))
    for (const ref of latest(card).request.references ?? [])
      if (ref.range)
        ranges.set(ref.asset_id, [...(ranges.get(ref.asset_id) ?? []), { ...ref.range, input_id: ref.id }]);
  return ranges;
}

/** The conversation as the agent reads it: each earlier message, its mentions bound to the inputs' handles. */
export function agentHistory(chat: StoredChat, runId: string, toolAssets: ToolAsset[], cardIds: string[]) {
  const scopes = workingCards(chat, cardIds).map(({ card }) => ({
    card_id: card.id,
    revision: latest(card).number,
    references: latest(card).request.references ?? [],
  }));
  return chat.messages
    .filter(m => m.role !== 'event' && m.id !== runId)
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      ...agentMentionContext(m.text, m.mention_bindings, toolAssets, scopes),
    }));
}

/** The last draft attempt of earlier turns on the same work (same kind, same draft, no new inputs since), if it failed. */
function lastAttempt(chat: StoredChat, runId: string) {
  const scope = chat.messages.find(m => m.id === runId)?.transcript?.scope ?? {};
  if (scope.source_assets?.length) return undefined;
  let attempt: TurnStep | undefined;
  for (const prior of [...chat.messages].reverse()) {
    const was = prior.transcript?.scope;
    if (!was || prior.id === runId) continue;
    if (was.workflow !== chat.workflow || was.target_request_id !== scope.target_request_id) break;
    attempt = [...prior.transcript!.steps]
      .reverse()
      .find(s => s.kind === 'tool' && ['create_request', 'edit_request'].includes(s.name ?? ''));
    if (attempt || was.source_assets?.length) break;
  }
  if (!attempt || attempt.state === 'succeeded') return undefined;
  const text = (attempt.result as { content?: Array<{ type: string; text?: string }> } | undefined)?.content
    ?.filter(p => p.type === 'text')
    .map(p => p.text)
    .join('\n');
  let result: unknown = attempt.result;
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      result = { message: text.slice(0, 3000), truncated: text.length > 3000 };
    }
  }
  return { tool: attempt.name, input: attempt.input, saved: false, result };
}

/** Everything the agent is told about the project for one turn, as the data part of its prompt. */
export function agentContext(turn: {
  chat: StoredChat;
  runId: string;
  /** The draft the owner asked about, if any. */
  target?: string;
  cardIds: string[];
  manifest: ContextAsset[];
  toolAssets: ToolAsset[];
  /** The styles the active kind can use. */
  styles: unknown[];
  compact: Awaited<ReturnType<typeof compactConversation>>;
  visual: Awaited<ReturnType<typeof visualContext>>;
}) {
  const { chat, manifest, toolAssets, visual } = turn;
  const defaultLabels = toolInputLabels(
    toolAssets.map(a => ({ id: a.handle, asset_id: a.asset_id, kind: a.kind, role: 'reference' as const })),
  );
  return JSON.stringify({
    project_brief: chat.brief || null,
    // Each character and place in the brief, and whether the owner has approved a reference image for it.
    cast_and_places: castOf(chat).map(e => {
      const approved = approvedReference(chat.choices, e.name),
        handle = approved && toolAssets.find(t => t.asset_id === approved)?.handle;
      return {
        name: e.name,
        kind: e.kind,
        // The exact token of the approved picture, so the model never guesses which handle is whose.
        reference: handle
          ? `approved: [[${handle}]] is ${e.name}; write ${e.name}’s name beside [[${handle}]]`
          : approved
            ? `approved: the input whose chosen_for is “approved reference for ${e.name}”`
            : referenceSkipped(chat.choices, e.name)
              ? 'not needed (the owner said so)'
              : 'none yet',
      };
    }),
    delivery_frame: chat.frame
      ? `The owner delivers this project at ${chat.frame}; drafts are made at the closest supported shape and cropped to it afterwards, so keep important action inside a ${chat.frame} frame.`
      : null,
    active_kind: Object.entries(chatKinds).find(([, w]) => w === chat.workflow)?.[0] ?? null,
    available_loras: turn.styles,
    worker_policy: workerPolicy,
    last_attempt: lastAttempt(chat, turn.runId),
    earlier_conversation_summary: turn.compact.summary?.text,
    conversation: turn.compact.recent,
    assets: manifest,
    available_inputs: toolAssets.map(a => {
      const listed = manifest.find(m => m.id === a.asset_id);
      return {
        ...a,
        ...(referenceMode() === 'direct' ? { prompt_label: defaultLabels.get(a.handle) } : {}),
        ...(a.kind === 'video'
          ? {
              soundtrack_token: '[[' + a.handle + ':audio]]',
              soundtrack_usage: 'Set include_audio true to use this soundtrack.',
            }
          : {}),
        prompt_token: '[[' + a.handle + ']]',
        name: listed?.name,
        ...(listed?.chosen_for ? { chosen_for: listed.chosen_for } : {}),
      };
    }),
    images_in_order: visual.evidence.filter(e => e.type === 'image').map(e => e.asset_id),
    visual_evidence_in_order: visual.evidence,
    video_evidence_note:
      'Video images are sampled frames, not a full video. Audio has not been supplied. Do not claim to hear audio.',
    unavailable_images: visual.unavailable,
    unavailable_inputs: visual.unavailable_inputs,
    request_context: workingCards(chat, turn.cardIds).map(({ group, card }) => ({
      id: card.id,
      state: group.state,
      ...(card.left_out ? { left_out: true } : {}),
      ...latest(card),
      request: agentRequest(latest(card).request, toolAssets),
      reference_labels: Object.fromEntries(chatReferenceLabels(latest(card).request)),
    })),
    review: openGroup(chat)?.cards.map(c => ({ id: c.id, revision: latest(c).number, decision: latest(c).decision })),
    feedback_card: turn.target,
  });
}

export interface ConversationLine {
  role: string;
  text: string;
}
export interface ConversationSummary {
  through: number;
  text: string;
}

export async function compactConversation(
  history: ConversationLine[],
  previous: ConversationSummary | undefined,
  summarize: (input: string) => Promise<string>,
) {
  const start = previous?.through ?? 0;
  if (start > history.length) throw Error('Conversation summary is inconsistent with its history.');
  if (JSON.stringify(history.slice(start)).length <= 60000) return { summary: previous, recent: history.slice(start) };
  const through = Math.max(start, history.length - 8);
  if (through === start) return { summary: previous, recent: history.slice(start) };
  const input = JSON.stringify({
    previous_summary: previous?.text ?? '',
    earlier_messages: history.slice(start, through),
  });
  if (input.length > 200000)
    throw Error(
      'The earlier conversation exceeds the summarization budget. Start a new chat with the relevant assets.',
    );
  const text = (await summarize(input)).trim();
  if (!text || text.length > 16000)
    throw Error('Conversation summary did not complete within its budget. Try sending again.');
  return { summary: { through, text }, recent: history.slice(through) };
}

// Only omit visual context for narrowly recognized, entirely settings-only messages.
// Unrecognized or mixed requests keep the images; merely seeing them in an older turn is insufficient.
export function settingsOnlyMessage(text: string): boolean {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, '')
    .replace(/^please\s+/, '');
  return (
    /^(?:(?:set|change|use|make)\s+)?(?:the\s+)?seed\s+(?:(?:to|is)\s+)?(?:random|\d+)$/.test(value) ||
    /^(?:(?:set|change)\s+)?(?:the\s+)?(?:count|output count|number of outputs)\s+(?:to\s+)?\d+$/.test(value) ||
    /^(?:make|generate|create)\s+\d+\s+(?:outputs?|copies|variations)$/.test(value) ||
    /^(?:(?:set|change)\s+)?(?:the\s+)?(?:aspect ratio|aspect)\s+(?:to\s+)?(?:16:9|9:16)$/.test(value)
  );
}
