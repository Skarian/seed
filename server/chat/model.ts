import type { ChatCard, ChatView, ChatWorkflow } from '../../shared/chat.js';
import { isVideoWorkflow } from '../../shared/workflows.js';
import { movePlan, planOpen } from '../../shared/plan.js';
import { videoDetail, videoSteps } from '../../shared/video-settings.js';
import type { ImageRequest } from '../workflows.js';
import type { ChatAccounting } from './provider.js';
import type { ConversationSummary } from './context.js';
import { toolPromptBindings, toolPromptReferencePattern, type ToolAsset } from './request-tools.js';

/** A project as stored: the view the owner sees, plus what only the server keeps. */
export interface StoredChat extends ChatView {
  title_manual?: boolean;
  title_accounting?: ChatAccounting[];
  title_error?: string;
  summary?: ConversationSummary;
  runs: Array<{
    id: string;
    workflow?: ChatWorkflow | null;
    source_assets?: string[];
    target_request_id?: string;
    accounting: ChatAccounting[];
    state: string;
  }>;
}

export const latest = (card: ChatCard) => card.revisions.at(-1)!;
export const now = () => new Date().toISOString();
/** The plan still open for review or revision, if any. */
export const openGroup = (chat: ChatView) => chat.groups.find(planOpen);
/** When a turn ends (or a restart cuts it off), the open plan goes back to review, or away if it is still empty. */
export function settlePlan(chat: StoredChat) {
  const plan = openGroup(chat);
  if (!plan) return;
  if (!plan.cards.length) {
    chat.groups = chat.groups.filter(g => g.id !== plan.id);
    return;
  }
  movePlan(plan, 'reviewing');
  for (const card of plan.cards)
    if (card.timeline_start && card.timeline_start > latest(card).number) card.timeline_start = latest(card).number;
}

/** User-facing kinds of work and the workflow each one runs. */
export const chatKinds = {
  image: 'text-to-image',
  edit: 'image-to-image',
  video: 'text-to-video',
  animate: 'reference-to-video',
} as const satisfies Record<string, ChatWorkflow>;

/** How the agent refers to inputs in prompts. Read in one place (tests switch it per case). */
export function referenceMode(): 'stable' | 'direct' {
  return process.env.SEED_AGENT_REFERENCE_MODE === 'direct' ? 'direct' : 'stable';
}

/** Agent snapshots mirror the flat tool fields; canonical requests remain persisted unchanged. */
export function agentRequest(request: ImageRequest, assets: ToolAsset[] = []) {
  const bindings = new Map(
    [...toolPromptBindings(request.references ?? [])].map(([id, label]) => [label, '[[' + id + ']]']),
  );
  const prompt =
    referenceMode() === 'stable'
      ? request.prompt.replace(toolPromptReferencePattern, label => bindings.get(label) ?? label)
      : request.prompt;
  return {
    prompt,
    batch_size: request.count,
    seed: request.seed,
    aspect_ratio: request.output.aspect,
    loras: request.loras ?? [],
    ...(request.title ? { title: request.title } : {}),
    ...(request.note ? { note: request.note } : {}),
    ...(request.mode === 'nsfw' ? { mode: request.mode } : {}),
    ...(isVideoWorkflow(request.workflow)
      ? {
          duration_seconds: request.output.duration_seconds,
          audio_output: request.audio?.output,
          steps: videoSteps(request),
          detail: videoDetail(request),
        }
      : {}),
    ...(request.references
      ? {
          inputs: request.references.map(ref => ({
            id: ref.id,
            asset: assets.find(a => a.asset_id === ref.asset_id)?.handle ?? ref.asset_id,
            role: ref.role,
            ...(ref.framing ? { framing: ref.framing } : {}),
            ...(ref.range ?? {}),
            ...(ref.kind === 'video' ? { include_audio: Boolean(ref.include_audio) } : {}),
          })),
        }
      : {}),
  };
}
