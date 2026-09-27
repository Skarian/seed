import { isVideoWorkflow } from '../shared/workflows.js';
import type { ImageRequest } from '../shared/generation.js';
import { patchGeneration } from '../shared/generation.js';
import { workflowIds, type WorkflowId } from '../shared/studio.js';

export type GenerationDraft = { request: ImageRequest; sourceJob?: string };
export type GenerationDrafts = Record<WorkflowId, GenerationDraft>;
export type DraftAction =
  | { type: 'change'; workflow: WorkflowId; patch: Partial<ImageRequest> }
  | { type: 'replace'; workflow: WorkflowId; draft: GenerationDraft }
  | { type: 'reset'; workflow: WorkflowId };

export function emptyGeneration(workflow: WorkflowId): GenerationDraft {
  if(workflow==='image-to-image')return {request:{workflow,mode:'sfw',prompt:'',seed:'random',count:1,references:[],output:{aspect:'source',size:'1mp'}}};
  const video = isVideoWorkflow(workflow);
  return {
    request: {
      workflow,
      mode: 'sfw',
      prompt: '',
      count: 1,
      seed: 'random',
      loras: [],
      output: {
        aspect: '16:9',
        size: video ? '768p' : '1mp',
        ...(video ? { duration_seconds: 5 } : {}),
      },
      ...(video ? { audio: { output: 'generated' } } : {}),
    },
  };
}

export function generationDraftReducer(
  state: GenerationDrafts,
  action: DraftAction,
): GenerationDrafts {
  if (action.type === 'reset')
    return { ...state, [action.workflow]: emptyGeneration(action.workflow) };
  if (action.type === 'replace') return { ...state, [action.workflow]: action.draft };
  const draft = state[action.workflow],
    request = patchGeneration(draft.request,action.patch);
  if (action.patch.seed !== undefined || action.patch.count !== undefined)
    delete request.resolved_seeds;
  return { ...state, [action.workflow]: { ...draft, request } };
}

/** Normalize persisted drafts, including the original flat format, without losing user prompts. */
export function restoreGenerationDrafts(saved: Record<string, any> = {}): GenerationDrafts {
  return Object.fromEntries(
    workflowIds.map((workflow) => {
      const entry = saved[workflow],
        old = entry?.request ?? entry ?? {},
        fresh = emptyGeneration(workflow),
        video = isVideoWorkflow(workflow);
      const count =
        Number.isInteger(old.count) && old.count >= 1 && old.count <= 16 ? old.count : 1;
      const duration = Number(old.output?.duration_seconds ?? old.duration);
      const request = patchGeneration(fresh.request, {
        ...fresh.request,
        prompt: typeof old.prompt === 'string' ? old.prompt : '',
        note: typeof old.note === 'string' ? old.note : '',
        count,
        seed:
          typeof old.seed === 'string' && (entry?.request || old.randomSeed === false)
            ? old.seed
            : 'random',
        loras: Array.isArray(old.loras) ? old.loras : [],
        output: {
          ...fresh.request.output,
          aspect: (old.output?.aspect ?? old.aspect) === '9:16' ? '9:16' : '16:9',
          ...(video
            ? {
                duration_seconds:
                  Number.isInteger(duration) && duration >= 5 && duration <= 15 ? duration : 5,
              }
            : {}),
        },
        ...(video
          ? {
              audio: {
                output: (old.audio?.output ?? old.audio) === 'silent' ? 'silent' : 'generated',
              },
            }
          : {}),
        ...((old.resolved_seeds ?? old.resolvedSeeds)?.length === count
          ? { resolved_seeds: old.resolved_seeds ?? old.resolvedSeeds }
          : {}),
      } as Partial<ImageRequest>);
      return [
        workflow,
        { request, sourceJob: typeof entry?.sourceJob === 'string' ? entry.sourceJob : undefined },
      ];
    }),
  ) as GenerationDrafts;
}
