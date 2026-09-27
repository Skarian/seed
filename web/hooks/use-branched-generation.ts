import { useEffect, useState } from 'react';
import type { JobRecord } from '../../shared/jobs.js';
import type { WorkflowId } from '../../shared/studio.js';
import type { GenerationDraft } from '../generation-draft.js';
import type { useReferences } from '../references.js';

export function useBranchedGeneration(
  mode: 'sfw' | 'nsfw',
  replace: (workflow: WorkflowId, draft: GenerationDraft) => void,
  references: ReturnType<typeof useReferences>,
  onWorkflowChange: (workflow: WorkflowId) => void,
  editingReferences?:ReturnType<typeof useReferences>,
) {
  const [error, setError] = useState<{ mode: string; workflow: WorkflowId; message: string }>();
  useEffect(() => {
    // Generate remains mounted in Chat; only the destination may consume a branch URL.
    if (location.pathname !== '/') return;
    const query = new URLSearchParams(location.search),
      id = query.get('fromJob');
    if (!id) return;
    const controller = new AbortController();
    async function load() {
      const response = await fetch('/api/v1/jobs/' + encodeURIComponent(id!), {
        signal: controller.signal,
      });
      if (!response.ok) throw Error('Original request is no longer available.');
      const job: JobRecord = await response.json();
      if (job.request.mode !== mode) throw Error('This request is not available here.');
      const refs = await Promise.all(
        (job.request.references ?? []).map(async (ref) => {
          const response = await fetch('/api/v1/assets/' + ref.asset_id, {
            signal: controller.signal,
          });
          const asset = response.ok ? await response.json() : null;
          return {
            id: ref.id,
            asset_id: ref.asset_id,
            name: asset?.name ?? 'No longer available',
            kind: ref.kind,
            type: asset?.mime_type ?? ref.kind + '/*',
            url: '/api/v1/assets/' + ref.asset_id + '/content',
            role: ref.role,
            framing: ref.framing,
            include_audio: ref.include_audio,
            start: ref.range?.start_seconds ?? 0,
            end: (ref.range?.start_seconds ?? 0) + (ref.range?.duration_seconds ?? 0),
            duration: asset?.metadata?.duration_seconds,
            width: asset?.metadata?.width,
            height: asset?.metadata?.height,
          };
        }),
      );
      const originals = await Promise.all(
        (query.get('outputs')?.split(',') ?? [id!]).map(async (output) => {
          const response = await fetch('/api/v1/jobs/' + encodeURIComponent(output), {
            signal: controller.signal,
          });
          if (!response.ok) throw Error('An original output is no longer available.');
          return (await response.json()) as JobRecord;
        }),
      );
      if (originals.some((output) => output.submission_id !== job.submission_id))
        throw Error('Choose outputs from one request.');
      if (controller.signal.aborted) return;
      replace(job.request.workflow, {
        sourceJob: job.id,
        request: {
          ...job.request,
          count: originals.length,
          seed: query.get('seed') === 'new' ? 'random' : job.seed,
          resolved_seeds:
            query.get('seed') === 'new' ? undefined : originals.map((output) => output.seed),
        },
      });
      (job.request.workflow==='image-to-image'?editingReferences??references:references).replace(refs);
      onWorkflowChange(job.request.workflow);
      if (refs.some((ref) => ref.name === 'No longer available'))
        setError({
          mode,
          workflow: job.request.workflow,
          message:
            'An original input is no longer available. Remove or replace it before generating.',
        });
      history.replaceState(null, '', '/');
    }
    void load().catch((failure) => {
      if (!controller.signal.aborted)
        setError({ mode, workflow: 'text-to-image', message: failure.message });
    });
    return () => controller.abort();
    // A branch is loaded once per URL/mode, not whenever the live references change.
  }, [mode]);
  return error;
}
