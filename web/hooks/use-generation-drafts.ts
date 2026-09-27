import { useCallback, useEffect, useReducer, useState } from 'react';
import type { WorkflowId } from '../../shared/studio.js';
import type { ImageRequest } from '../../shared/generation.js';
import {
  generationDraftReducer,
  restoreGenerationDrafts,
  type GenerationDraft,
} from '../generation-draft.js';

const storageKey = 'seed.drafts.v3';
function load() {
  try {
    // Older local drafts remain importable; all new writes use storageKey.
    return restoreGenerationDrafts(
      JSON.parse(
        localStorage.getItem(storageKey) ?? localStorage.getItem('seed.drafts.fal.v2') ?? localStorage.getItem('seed.drafts.fal.v1') ?? '{}',
      ),
    );
  } catch {
    return restoreGenerationDrafts();
  }
}
export function useGenerationDrafts(workflow: WorkflowId, mode: 'sfw' | 'nsfw') {
  const [drafts, dispatch] = useReducer(generationDraftReducer, undefined, load);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(drafts));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [drafts]);
  const change = useCallback(
    (patch: Partial<ImageRequest>) => dispatch({ type: 'change', workflow, patch }),
    [workflow],
  );
  const replace = useCallback(
    (workflow: WorkflowId, draft: GenerationDraft) =>
      dispatch({ type: 'replace', workflow, draft }),
    [],
  );
  const reset = useCallback(() => dispatch({ type: 'reset', workflow }), [workflow]);
  const draft = drafts[workflow];
  return {
    request: { ...draft.request, mode },
    sourceJob: draft.sourceJob,
    editHasPrompt: Boolean(drafts['image-to-image'].request.prompt.trim()),
    change,
    replace,
    reset,
    storageError,
  };
}
